import { describe, expect, it } from 'vitest';
import {
  validateDomain,
  validateHeaderName,
  validateHeaderValue,
  validateRule,
  validateUrlFilter,
} from './validators';

describe('validators', () => {
  it('validates names and rejects header injection', () => {
    expect(validateHeaderName('X-FakeHeader-Test')).toBeNull();
    expect(validateHeaderName('Bad Header')).not.toBeNull();
    expect(validateHeaderValue('safe\r\nInjected: yes')).not.toBeNull();
  });
  it('accepts localhost, IPv4, IPv6 and scheme-qualified hosts', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '192.168.1.20',
      '[::1]',
      'http://localhost:3000',
      'https://api.example.com',
    ])
      expect(validateDomain(host)).toBeNull();
  });
  it('rejects unsafe URL scopes and implicit global matching', () => {
    expect(validateUrlFilter('||*example')).not.toBeNull();
    expect(
      validateRule({
        id: 'r',
        enabled: true,
        target: 'request',
        operation: 'set',
        header: 'X-Test',
        value: 'x',
      }).valid,
    ).toBe(false);
  });
  it('rejects append for non-allowlisted request headers', () =>
    expect(
      validateRule({
        id: 'r',
        enabled: true,
        target: 'request',
        operation: 'append',
        header: 'X-Custom',
        value: 'v',
        domains: ['localhost'],
      }).valid,
    ).toBe(false));
  it('validates advanced conditions and rejects ambiguous include/exclude pairs', () => {
    const base = {
      id: 'r',
      enabled: true,
      kind: 'block' as const,
      domains: ['api.example.com'],
    };
    expect(
      validateRule({
        ...base,
        requestMethods: ['post'],
        excludedResourceTypes: ['image'],
        initiatorDomains: ['app.example.com'],
        domainType: 'thirdParty',
      }).valid,
    ).toBe(true);
    expect(
      validateRule({
        ...base,
        requestMethods: ['get'],
        excludedRequestMethods: ['post'],
      }).valid,
    ).toBe(false);
    expect(validateRule({ ...base, initiatorDomains: ['https://app.example.com'] }).valid).toBe(
      false,
    );
  });
  it('validates groups and tags as bounded metadata', () => {
    const base = {
      id: 'r',
      enabled: true,
      kind: 'block' as const,
      domains: ['localhost'],
    };
    expect(validateRule({ ...base, group: 'Auth', tags: ['local', 'debug'] }).valid).toBe(true);
    expect(validateRule({ ...base, group: '', tags: ['debug', 'DEBUG'] }).valid).toBe(false);
    expect(
      validateRule({ ...base, tags: Array.from({ length: 13 }, (_, index) => `t${index}`) }).valid,
    ).toBe(false);
  });
});
