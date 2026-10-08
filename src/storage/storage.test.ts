import { describe, expect, it } from 'vitest';
import type { FakeHeaderSettings } from '../types/profile';
import { collectSessionSecrets, hydrateSettings, sanitizeSettingsForLocal } from './storage';

const settings: FakeHeaderSettings = {
  schemaVersion: 6,
  templates: [],
  autoActivations: [],
  scripts: [],
  environments: [],
  safety: { autoDisableOnNavigation: false },
  profiles: [
    {
      id: 'dev',
      name: 'Development',
      enabled: true,
      rules: [
        {
          id: 'auth-rule',
          enabled: true,
          target: 'request',
          operation: 'set',
          header: 'Authorization',
          value: 'Bearer FAKE_TEST_TOKEN',
          sensitive: true,
          valueRef: 'auth-secret',
          domains: ['localhost'],
        },
        {
          id: 'plain-rule',
          enabled: true,
          target: 'request',
          operation: 'set',
          header: 'X-Environment',
          value: 'dev',
          domains: ['localhost'],
        },
      ],
    },
  ],
};

describe('secret storage separation', () => {
  it('removes sensitive values from the local representation', () => {
    const local = sanitizeSettingsForLocal(settings);
    const serialized = JSON.stringify(local);
    expect(serialized).not.toContain('FAKE_TEST_TOKEN');
    expect(local.profiles[0].rules[0]).toMatchObject({ sensitive: true, valueRef: 'auth-secret' });
    expect(local.profiles[0].rules[1].value).toBe('dev');
  });

  it('stores and hydrates secrets only through the session map', () => {
    const local = sanitizeSettingsForLocal(settings);
    const secrets = collectSessionSecrets(settings);
    expect(secrets).toEqual({ 'auth-secret': 'Bearer FAKE_TEST_TOKEN' });
    expect(hydrateSettings(local, secrets).profiles[0].rules[0].value).toBe(
      'Bearer FAKE_TEST_TOKEN',
    );
  });

  it('keeps sensitive environment variables out of local storage', () => {
    const withEnvironment: FakeHeaderSettings = {
      ...settings,
      environments: [
        {
          id: 'local',
          name: 'Local',
          variables: [
            {
              id: 'token-variable',
              key: 'TOKEN',
              value: 'VARIABLE_SECRET',
              sensitive: true,
              valueRef: 'token-secret',
            },
          ],
        },
      ],
    };
    const local = sanitizeSettingsForLocal(withEnvironment);
    const secrets = collectSessionSecrets(withEnvironment);
    expect(JSON.stringify(local)).not.toContain('VARIABLE_SECRET');
    expect(secrets['token-secret']).toBe('VARIABLE_SECRET');
    expect(hydrateSettings(local, secrets).environments[0].variables[0].value).toBe(
      'VARIABLE_SECRET',
    );
  });
});
