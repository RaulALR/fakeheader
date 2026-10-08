import { describe, expect, it } from 'vitest';
import { createSavedRuleTemplate, instantiateSavedRuleTemplate } from './custom-templates';

describe('custom rule templates', () => {
  it('never copies a sensitive value into persistent template data', () => {
    const template = createSavedRuleTemplate(
      {
        id: 'auth-rule',
        name: 'Auth',
        enabled: true,
        pinned: true,
        kind: 'headers',
        target: 'request',
        operation: 'set',
        header: 'Authorization',
        value: 'Bearer template-secret',
        sensitive: true,
        valueRef: 'auth-rule',
        domains: ['localhost'],
      },
      'Auth template',
    );
    expect(template.rule.value).toBeUndefined();
    expect(JSON.stringify(template)).not.toContain('template-secret');
    expect(template.rule).toMatchObject({ enabled: false, pinned: false, sensitive: true });
  });

  it('instantiates a disabled rule with fresh nested IDs', () => {
    const template = createSavedRuleTemplate(
      {
        id: 'query-rule',
        enabled: true,
        kind: 'query',
        domains: ['localhost'],
        queryParams: [{ id: 'query-param', operation: 'set', key: 'debug', value: 'true' }],
      },
      'Debug query',
    );
    const rule = instantiateSavedRuleTemplate(template);
    expect(rule.enabled).toBe(false);
    expect(rule.id).not.toBe(template.rule.id);
    expect(rule.queryParams?.[0].id).not.toBe(template.rule.queryParams?.[0].id);
    expect(rule.queryParams?.[0].value).toBe('true');
  });
});
