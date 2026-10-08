import { describe, expect, it } from 'vitest';
import type { FakeHeaderSettings } from '../types/profile';
import { compileSessionRules, ruleToDnr } from './converters';

const settings: FakeHeaderSettings = {
  schemaVersion: 6,
  templates: [],
  autoActivations: [],
  scripts: [],
  environments: [],
  safety: { autoDisableOnNavigation: false },
  profiles: [
    {
      id: 'development',
      name: 'Development',
      enabled: true,
      rules: [
        {
          id: 'dev-rule',
          enabled: true,
          target: 'request',
          operation: 'set',
          header: 'X-Environment',
          value: 'dev',
          domains: ['localhost'],
        },
      ],
    },
    {
      id: 'staging',
      name: 'Staging',
      enabled: true,
      rules: [
        {
          id: 'stage-rule',
          enabled: true,
          target: 'request',
          operation: 'set',
          header: 'X-Environment',
          value: 'stage',
          domains: ['https://api.example.com'],
        },
      ],
    },
  ],
};

describe('session DNR conversion', () => {
  it('binds a rule only to explicitly active tabs', () => {
    const rules = compileSessionRules(settings, { '1': { tabId: 1, profileId: 'development' } });
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.tabIds).toEqual([1]);
    expect(JSON.stringify(rules)).not.toContain('"tabIds":[2]');
  });

  it('isolates profiles per tab and assigns sequential IDs', () => {
    const rules = compileSessionRules(settings, {
      '10': { tabId: 10, profileId: 'development' },
      '14': { tabId: 14, profileId: 'staging' },
    });
    expect(rules.map((rule) => rule.id)).toEqual([1, 2]);
    expect(rules[0].condition.tabIds).toEqual([10]);
    expect(rules[1].condition.tabIds).toEqual([14]);
    expect(rules[0].action.requestHeaders?.[0].value).toBe('dev');
    expect(rules[1].action.requestHeaders?.[0].value).toBe('stage');
  });

  it('groups tabs sharing one profile without losing isolation', () => {
    const rules = compileSessionRules(settings, {
      '1': { tabId: 1, profileId: 'development' },
      '3': { tabId: 3, profileId: 'development' },
    });
    expect(rules[0].condition.tabIds).toEqual([1, 3]);
  });

  it('compiles advanced DNR conditions without widening the scope', () => {
    const rule = ruleToDnr(
      {
        id: 'advanced',
        enabled: true,
        kind: 'block',
        domains: ['api.example.com'],
        requestMethods: ['post', 'put'],
        excludedResourceTypes: ['image'],
        domainType: 'thirdParty',
        initiatorDomains: ['app.example.com'],
        excludedInitiatorDomains: ['admin.example.com'],
        urlFilter: '|https://api.example.com/V2/',
        isUrlFilterCaseSensitive: true,
      },
      1,
      [7],
    );
    expect(rule.condition).toMatchObject({
      tabIds: [7],
      requestDomains: ['api.example.com'],
      requestMethods: ['post', 'put'],
      excludedResourceTypes: ['image'],
      domainType: 'thirdParty',
      initiatorDomains: ['app.example.com'],
      excludedInitiatorDomains: ['admin.example.com'],
      isUrlFilterCaseSensitive: true,
    });
  });

  it('resolves sensitive values from session secrets', () => {
    const rule = ruleToDnr(
      {
        id: 'auth-rule',
        enabled: true,
        target: 'request',
        operation: 'set',
        header: 'Authorization',
        sensitive: true,
        valueRef: 'auth-secret',
        domains: ['api.example.com'],
      },
      1,
      [8],
      { 'auth-secret': 'Bearer FAKE_TEST_TOKEN' },
    );
    expect(rule.action.requestHeaders?.[0].value).toBe('Bearer FAKE_TEST_TOKEN');
  });

  it('compiles redirect, block, replace and query parameter rules', () => {
    const redirect = ruleToDnr(
      {
        id: 'redirect',
        enabled: true,
        kind: 'redirect',
        redirectUrl: 'http://localhost:3000/{{PATH}}',
        domains: ['api.example.com'],
      },
      1,
      [4],
      {},
      1,
      { PATH: 'users' },
    );
    const block = ruleToDnr(
      { id: 'block', enabled: true, kind: 'block', domains: ['ads.example.com'] },
      2,
      [4],
    );
    const replace = ruleToDnr(
      {
        id: 'replace',
        enabled: true,
        kind: 'replace',
        regexFilter: '^https://api\\.example\\.com/(.*)$',
        regexSubstitution: 'http://localhost:8080/\\1',
        domains: ['api.example.com'],
      },
      3,
      [4],
    );
    const query = ruleToDnr(
      {
        id: 'query',
        enabled: true,
        kind: 'query',
        domains: ['api.example.com'],
        queryParams: [
          { id: 'set-debug', operation: 'set', key: 'debug', value: '{{DEBUG}}' },
          { id: 'remove-cache', operation: 'remove', key: 'cache' },
        ],
      },
      4,
      [4],
      {},
      1,
      { DEBUG: 'true' },
    );
    expect(redirect.action.redirect?.url).toBe('http://localhost:3000/users');
    expect(block.action.type).toBe('block');
    expect(replace.action.redirect?.regexSubstitution).toBe('http://localhost:8080/\\1');
    expect(query.action.redirect?.transform?.queryTransform).toEqual({
      addOrReplaceParams: [{ key: 'debug', value: 'true' }],
      removeParams: ['cache'],
    });
  });

  it('keeps environment values isolated per tab', () => {
    const variableSettings: FakeHeaderSettings = {
      schemaVersion: 6,
      templates: [],
      autoActivations: [],
      scripts: [],
      safety: { autoDisableOnNavigation: false },
      profiles: [
        {
          id: 'dev',
          name: 'Dev',
          enabled: true,
          rules: [
            {
              id: 'env-header',
              enabled: true,
              kind: 'headers',
              target: 'request',
              operation: 'set',
              header: 'X-Environment',
              value: '{{ENV}}',
              domains: ['localhost'],
            },
          ],
        },
      ],
      environments: [
        { id: 'local', name: 'Local', variables: [{ id: 'v1', key: 'ENV', value: 'local' }] },
        { id: 'stage', name: 'Stage', variables: [{ id: 'v2', key: 'ENV', value: 'stage' }] },
      ],
    };
    const rules = compileSessionRules(variableSettings, {
      '1': { tabId: 1, profileId: 'dev', environmentId: 'local' },
      '2': { tabId: 2, profileId: 'dev', environmentId: 'stage' },
    });
    expect(rules).toHaveLength(2);
    expect(rules[0].condition.tabIds).toEqual([1]);
    expect(rules[0].action.requestHeaders?.[0].value).toBe('local');
    expect(rules[1].condition.tabIds).toEqual([2]);
    expect(rules[1].action.requestHeaders?.[0].value).toBe('stage');
  });

  it('rejects a variable that resolves a redirect to a non-HTTP scheme', () => {
    expect(() =>
      ruleToDnr(
        {
          id: 'safe-redirect',
          enabled: true,
          kind: 'redirect',
          redirectUrl: '{{DESTINATION}}',
          domains: ['localhost'],
        },
        1,
        [1],
        {},
        1,
        { DESTINATION: 'javascript:alert(1)' },
      ),
    ).toThrow('HTTP o HTTPS');
  });
});
