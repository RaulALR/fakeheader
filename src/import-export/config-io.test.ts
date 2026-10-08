import { describe, expect, it } from 'vitest';
import type { FakeHeaderSettings } from '../types/profile';
import { exportConfiguration, importConfiguration } from './config-io';

const settings: FakeHeaderSettings = {
  schemaVersion: 6,
  templates: [],
  autoActivations: [],
  scripts: [],
  environments: [],
  safety: { autoDisableOnNavigation: false },
  profiles: [
    {
      id: 'p',
      name: 'Dev',
      enabled: true,
      rules: [
        {
          id: 'r',
          enabled: true,
          target: 'request',
          operation: 'set',
          header: 'Authorization',
          value: 'Bearer FAKE_TEST_TOKEN',
          sensitive: true,
          valueRef: 'r',
          domains: ['api.example.com'],
        },
      ],
    },
  ],
};

describe('configuration import/export', () => {
  it('always redacts session secrets in the normal export', () => {
    const exported = exportConfiguration(settings);
    expect(exported).toContain('[REDACTED]');
    expect(exported).not.toContain('FAKE_TEST_TOKEN');
  });
  it('includes a secret only through the explicit mode', () =>
    expect(exportConfiguration(settings, true)).toContain('Bearer FAKE_TEST_TOKEN'));
  it('disables a redacted rule when it is imported', () =>
    expect(importConfiguration(exportConfiguration(settings)).profiles[0].rules[0].enabled).toBe(
      false,
    ));
  it('ignores unknown properties and rejects malformed JSON', () => {
    const imported = importConfiguration(JSON.stringify({ ...settings, malicious: '<script>' }));
    expect('malicious' in imported).toBe(false);
    expect(() => importConfiguration('{"profiles":"bad"}')).toThrow();
  });
  it('never exports a secret embedded in a custom template', () => {
    const unsafeInMemory: FakeHeaderSettings = {
      ...settings,
      templates: [
        {
          id: 'template',
          name: 'Auth',
          rule: {
            id: 'template-rule',
            enabled: false,
            target: 'request',
            operation: 'set',
            header: 'Authorization',
            value: 'Bearer NEVER_EXPORT_TEMPLATE_SECRET',
            sensitive: true,
            domains: ['localhost'],
          },
        },
      ],
    };
    expect(exportConfiguration(unsafeInMemory, true)).not.toContain('NEVER_EXPORT_TEMPLATE_SECRET');
  });
});
