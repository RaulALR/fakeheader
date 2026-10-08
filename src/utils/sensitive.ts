const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-amz-security-token',
]);

const SENSITIVE_TRAFFIC_HEADER =
  /(^|[-_])(auth|authorization|cookie|credential|csrf|key|password|secret|session|signature|token|xsrf)([-_]|$)/i;

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.trim().toLowerCase());
}

export function isSensitiveTrafficHeader(name: string): boolean {
  return isSensitiveHeader(name) || SENSITIVE_TRAFFIC_HEADER.test(name.trim());
}

export function isSensitiveQueryParameter(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    'auth',
    'code',
    'cookie',
    'credential',
    'key',
    'password',
    'secret',
    'session',
    'signature',
    'token',
  ].some((part) => normalized.includes(part));
}

export function maskSensitiveValue(value = ''): string {
  if (/^bearer\s/i.test(value)) return `Bearer ${'*'.repeat(16)}`;
  return '*'.repeat(16);
}
