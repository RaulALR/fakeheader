import { describe, expect, it } from 'vitest';
import { isSensitiveHeader, maskSensitiveValue } from './sensitive';

describe('secret handling', () => {
  it.each([
    'Authorization',
    'Proxy-Authorization',
    'Cookie',
    'Set-Cookie',
    'X-API-Key',
    'Api-Key',
    'X-Auth-Token',
  ])('recognises %s', (header) => expect(isSensitiveHeader(header)).toBe(true));
  it.each(['', 'a', 'abcd', 'long-secret-token-value', 'session=cookie-value'])(
    'never reveals any character from a non-Bearer secret',
    (value) => {
      const masked = maskSensitiveValue(value);
      expect(masked).toBe('****************');
      expect(masked).not.toContain(value || 'impossible-value');
    },
  );
  it('shows only the authentication scheme for Bearer values', () => {
    const masked = maskSensitiveValue('Bearer FAKE_TEST_TOKEN');
    expect(masked).toBe('Bearer ****************');
    expect(masked).not.toContain('FAKE_TEST_TOKEN');
  });
});
