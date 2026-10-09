import { describe, expect, it } from 'vitest';
import { importCurlCommand } from './curl-import';

const ids = () => {
  let value = 0;
  return () => `curl-${++value}`;
};

describe('cURL import', () => {
  it('creates disabled, host-scoped header rules and marks secrets', () => {
    const result = importCurlCommand(
      `curl 'https://api.example.com/v1/users' -H 'iv-user: caca' -H 'Authorization: Bearer token'`,
      { createId: ids() },
    );
    expect(result.rules).toMatchObject([
      {
        id: 'curl-1',
        enabled: false,
        header: 'iv-user',
        value: 'caca',
        requestMethods: ['get'],
      },
      {
        id: 'curl-2',
        enabled: false,
        header: 'Authorization',
        sensitive: true,
        valueRef: 'curl-2',
      },
    ]);
    expect(result.rules.every((rule) => rule.domains?.[0] === 'https://api.example.com')).toBe(
      true,
    );
  });

  it('supports common header flags and an endpoint scope', () => {
    const result = importCurlCommand(
      `curl.exe --url="http://localhost:8080/api?q=1" -A "Fake Agent" -b "sid=secret" -H "X-Empty;"`,
      { scope: 'path', createId: ids() },
    );
    expect(result.rules.map((rule) => rule.header)).toEqual(['User-Agent', 'Cookie', 'X-Empty']);
    expect(result.rules[0].urlFilter).toBe('|http://localhost:8080/api?q=1');
    expect(result.rules[1]).toMatchObject({ sensitive: true, value: 'sid=secret' });
    expect(result.rules[2]).toMatchObject({ operation: 'set', value: '' });
  });

  it('does not import bodies or credentials and keeps the last duplicate header', () => {
    const result = importCurlCommand(
      `curl https://example.com -d '{"unsafe":true}' -u user:password -H 'X-Test: one' -H 'X-Test: two'`,
      { createId: ids() },
    );
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].value).toBe('two');
    expect(result.rules[0].requestMethods).toEqual(['post']);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'El cuerpo de la solicitud no se importa: DNR no permite modificarlo.',
        'Las credenciales Basic/Digest de --user no se importan.',
        'Se conservó el último valor de X-Test.',
      ]),
    );
  });

  it('rejects non-cURL text, unsafe URLs and malformed headers', () => {
    expect(() => importCurlCommand('echo https://example.com -H "X-Test: ok"')).toThrow();
    expect(() => importCurlCommand('curl file:///tmp/a -H "X-Test: ok"')).toThrow();
    expect(() =>
      importCurlCommand('curl https://user:password@example.com -H "X-Test: ok"'),
    ).toThrow();
    expect(() => importCurlCommand('curl https://example.com -H "bad header"')).toThrow();
  });
});
