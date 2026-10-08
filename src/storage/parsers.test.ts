import { describe, expect, it } from 'vitest';
import { parseActiveTabs, parseHistory, parseSecrets, parseSettings } from './parsers';
import { safeSettingsFromStorage } from './storage';

describe('untrusted storage parsing', () => {
  it('returns a safe rule-free configuration for corrupt local storage', () => {
    const result = safeSettingsFromStorage({ schemaVersion: 2, profiles: 'malicious' });
    expect(result.valid).toBe(false);
    expect(result.settings.profiles[0].rules).toEqual([]);
  });
  it('rejects unknown schema versions and unsafe rules', () => {
    expect(() => parseSettings({ schemaVersion: 1, profiles: [] })).toThrow();
    expect(() =>
      parseSettings({
        schemaVersion: 2,
        profiles: [
          {
            id: 'p',
            name: 'P',
            enabled: true,
            rules: [
              {
                id: 'r',
                enabled: true,
                target: 'request',
                operation: 'set',
                header: 'Bad Header',
                value: 'x',
                domains: ['localhost'],
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
  it('treats missing session storage as no active tabs and no secrets', () => {
    expect(parseActiveTabs(undefined)).toEqual({});
    expect(parseSecrets(undefined)).toEqual({});
  });
  it('drops malformed and mismatched tab state entries', () => {
    expect(parseActiveTabs({ '1': { tabId: 2, profileId: 'dev' }, bad: '<script>' })).toEqual({});
  });
  it('migrates schema version 2 header rules to the current version', () => {
    const migrated = parseSettings({
      schemaVersion: 2,
      profiles: [
        {
          id: 'p',
          name: 'P',
          enabled: true,
          rules: [
            {
              id: 'r',
              enabled: true,
              target: 'request',
              operation: 'set',
              header: 'X-Test',
              value: 'ok',
              domains: ['localhost'],
            },
          ],
        },
      ],
    });
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.templates).toEqual([]);
    expect(migrated.profiles[0].rules[0].kind).toBe('headers');
    expect(migrated.environments).toEqual([]);
    expect(migrated.autoActivations).toEqual([]);
  });
  it('rejects unknown rule kinds instead of silently accepting them', () => {
    expect(() =>
      parseSettings({
        schemaVersion: 4,
        environments: [],
        profiles: [
          {
            id: 'p',
            name: 'P',
            enabled: true,
            rules: [
              {
                id: 'r',
                enabled: true,
                kind: 'execute-script',
                domains: ['localhost'],
              },
            ],
          },
        ],
      }),
    ).toThrow('Tipo de regla inválido');
  });
  it('preserves allowlisted advanced conditions and rejects unknown methods', () => {
    const source = {
      schemaVersion: 4,
      environments: [],
      profiles: [
        {
          id: 'p',
          name: 'P',
          enabled: true,
          rules: [
            {
              id: 'r',
              enabled: true,
              kind: 'block',
              group: 'API',
              tags: ['backend', 'debug'],
              pinned: true,
              domains: ['api.example.com'],
              requestMethods: ['post'],
              excludedResourceTypes: ['image'],
              initiatorDomains: ['app.example.com'],
              domainType: 'thirdParty',
            },
          ],
        },
      ],
    };
    expect(parseSettings(source).profiles[0].rules[0]).toMatchObject({
      requestMethods: ['post'],
      group: 'API',
      tags: ['backend', 'debug'],
      pinned: true,
      excludedResourceTypes: ['image'],
      initiatorDomains: ['app.example.com'],
      domainType: 'thirdParty',
    });
    expect(() =>
      parseSettings({
        ...source,
        profiles: [
          {
            ...source.profiles[0],
            rules: [{ ...source.profiles[0].rules[0], requestMethods: ['trace'] }],
          },
        ],
      }),
    ).toThrow('Método HTTP inválido');
  });
  it('loads schema 5 templates while stripping sensitive values', () => {
    const parsed = parseSettings({
      schemaVersion: 5,
      profiles: [{ id: 'p', name: 'P', enabled: true, rules: [] }],
      environments: [],
      templates: [
        {
          id: 'template',
          name: 'Auth template',
          rule: {
            id: 'template-rule',
            enabled: false,
            kind: 'headers',
            target: 'request',
            operation: 'set',
            header: 'Authorization',
            value: 'Bearer imported-secret',
            domains: ['localhost'],
          },
        },
      ],
    });
    expect(parsed.templates).toHaveLength(1);
    expect(parsed.templates[0].rule.value).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain('imported-secret');
  });
  it('accepts only exact and unique origins for automatic activation', () => {
    const source = {
      schemaVersion: 6,
      profiles: [{ id: 'p', name: 'P', enabled: true, rules: [] }],
      environments: [],
      templates: [],
      autoActivations: [
        {
          id: 'activation',
          enabled: true,
          origin: 'http://localhost:3000',
          profileId: 'p',
        },
      ],
      safety: { autoDisableOnNavigation: false },
    };
    expect(parseSettings(source).autoActivations[0].origin).toBe('http://localhost:3000');
    expect(() =>
      parseSettings({
        ...source,
        autoActivations: [{ ...source.autoActivations[0], origin: 'http://localhost:3000/path' }],
      }),
    ).toThrow('origen HTTP(S) exacto');
    expect(() =>
      parseSettings({
        ...source,
        autoActivations: [source.autoActivations[0], { ...source.autoActivations[0], id: 'other' }],
      }),
    ).toThrow('Cada origen');
  });
  it('strips sensitive values from untrusted history entries', () => {
    const history = parseHistory([
      {
        id: 'snapshot',
        createdAt: 1,
        label: 'Previous state',
        settings: {
          schemaVersion: 6,
          profiles: [
            {
              id: 'p',
              name: 'P',
              enabled: true,
              rules: [
                {
                  id: 'auth',
                  enabled: true,
                  target: 'request',
                  operation: 'set',
                  header: 'Authorization',
                  value: 'Bearer HISTORY_SECRET',
                  domains: ['localhost'],
                },
              ],
            },
          ],
          environments: [],
          templates: [],
          autoActivations: [],
          safety: { autoDisableOnNavigation: false },
        },
      },
    ]);
    expect(JSON.stringify(history)).not.toContain('HISTORY_SECRET');
    expect(history[0].settings.profiles[0].rules[0].sensitive).toBe(true);
  });
});
