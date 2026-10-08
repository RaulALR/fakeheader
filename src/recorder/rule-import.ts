import { REQUEST_METHODS, RESOURCE_TYPES, type HeaderRule } from '../types/rule';
import type { TrafficEntry, TrafficHeader } from '../types/recorder';
import { newId } from '../utils/ids';
import { isSensitiveTrafficHeader } from '../utils/sensitive';
import { validateHeaderName, validateHeaderValue } from '../rules/validators';

const UNSAFE_REQUEST_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'referer',
]);
const UNSAFE_RESPONSE_HEADERS = new Set(['content-length', 'set-cookie']);

function importableHeaders(
  headers: TrafficHeader[],
  target: 'request' | 'response',
): TrafficHeader[] {
  const seen = new Set<string>();
  return headers.filter((header) => {
    const name = header.name.trim();
    const normalized = name.toLowerCase();
    if (
      seen.has(normalized) ||
      isSensitiveTrafficHeader(name) ||
      header.value === '[REDACTED]' ||
      header.value === '[BINARY]' ||
      validateHeaderName(name) ||
      validateHeaderValue(header.value) ||
      (target === 'request' &&
        (UNSAFE_REQUEST_HEADERS.has(normalized) || normalized.startsWith('sec-'))) ||
      (target === 'response' && UNSAFE_RESPONSE_HEADERS.has(normalized))
    )
      return false;
    seen.add(normalized);
    return true;
  });
}

export interface RecorderRuleImport {
  rules: HeaderRule[];
  skipped: number;
  host: string;
}

export function rulesFromTrafficEntry(
  entry: TrafficEntry,
  target: 'request' | 'response',
): RecorderRuleImport {
  const source =
    target === 'request' ? (entry.requestHeaders ?? []) : (entry.responseHeaders ?? []);
  const headers = importableHeaders(source, target).slice(0, 25);
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return { rules: [], skipped: source.length, host: '' };
  }
  if (!['http:', 'https:'].includes(url.protocol))
    return { rules: [], skipped: source.length, host: '' };
  const method = entry.method.toLowerCase();
  const requestMethods = REQUEST_METHODS.includes(method as (typeof REQUEST_METHODS)[number])
    ? ([method] as HeaderRule['requestMethods'])
    : undefined;
  const resourceType = RESOURCE_TYPES.includes(entry.type as (typeof RESOURCE_TYPES)[number])
    ? ([entry.type] as HeaderRule['resourceTypes'])
    : undefined;
  const host = `${url.protocol}//${url.host}`;
  return {
    host,
    skipped: source.length - headers.length,
    rules: headers.map((header) => ({
      id: newId(),
      name: `Capturada ${entry.method}: ${header.name}`.slice(0, 100),
      group: 'Recorder import',
      tags: ['recorder'],
      kind: 'headers',
      enabled: false,
      priority: 1,
      target,
      operation: 'set',
      header: header.name.trim(),
      value: header.value,
      domains: [host],
      ...(requestMethods ? { requestMethods } : {}),
      ...(resourceType ? { resourceTypes: resourceType } : {}),
    })),
  };
}
