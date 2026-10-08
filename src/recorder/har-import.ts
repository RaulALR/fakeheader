import type { TrafficEntry, TrafficHeader } from '../types/recorder';
import type { HeaderRule } from '../types/rule';
import { rulesFromTrafficEntry } from './rule-import';

const MAX_HAR_BYTES = 5 * 1024 * 1024;
const MAX_HAR_ENTRIES = 500;
const MAX_IMPORTED_RULES = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHeaders(value: unknown): TrafficHeader[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 100)
    .filter(
      (header): header is { name: string; value: string } =>
        isRecord(header) && typeof header.name === 'string' && typeof header.value === 'string',
    )
    .map((header) => ({
      name: header.name.slice(0, 256),
      value: header.value.slice(0, 2048),
    }));
}

function parseHarEntry(value: unknown, index: number): TrafficEntry | null {
  if (!isRecord(value) || !isRecord(value.request) || !isRecord(value.response)) return null;
  const request = value.request;
  const response = value.response;
  if (typeof request.method !== 'string' || typeof request.url !== 'string') return null;
  try {
    const url = new URL(request.url.slice(0, 8192));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
  } catch {
    return null;
  }
  return {
    requestId: `har-${index}`,
    tabId: 0,
    startedAt: Date.now(),
    method: request.method.slice(0, 16),
    url: request.url.slice(0, 8192),
    type: 'xmlhttprequest',
    requestHeaders: parseHeaders(request.headers),
    responseHeaders: parseHeaders(response.headers),
  };
}

export interface HarRuleImportResult {
  rules: HeaderRule[];
  entriesRead: number;
  skipped: number;
  truncated: boolean;
}

export function rulesFromHar(
  text: string,
  target: 'request' | 'response' | 'both',
): HarRuleImportResult {
  if (new TextEncoder().encode(text).byteLength > MAX_HAR_BYTES)
    throw new Error('El HAR supera el límite local de 5 MB.');
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }
  if (!isRecord(raw) || !isRecord(raw.log) || !Array.isArray(raw.log.entries))
    throw new Error('El JSON no tiene una estructura HAR válida.');
  const sourceEntries = raw.log.entries;
  const entries = sourceEntries
    .slice(0, MAX_HAR_ENTRIES)
    .map(parseHarEntry)
    .filter((entry): entry is TrafficEntry => entry !== null);
  const candidates: HeaderRule[] = [];
  let skipped = sourceEntries.length - entries.length;
  for (const entry of entries) {
    if (target === 'request' || target === 'both') {
      const imported = rulesFromTrafficEntry(entry, 'request');
      candidates.push(...imported.rules);
      skipped += imported.skipped;
    }
    if (target === 'response' || target === 'both') {
      const imported = rulesFromTrafficEntry(entry, 'response');
      candidates.push(...imported.rules);
      skipped += imported.skipped;
    }
  }
  const unique = new Map<string, HeaderRule>();
  for (const rule of candidates) {
    const key = JSON.stringify([
      rule.target,
      rule.header?.toLowerCase(),
      rule.value,
      rule.domains,
      rule.requestMethods,
    ]);
    if (unique.has(key)) skipped += 1;
    else unique.set(key, rule);
  }
  const deduplicated = [...unique.values()];
  return {
    rules: deduplicated.slice(0, MAX_IMPORTED_RULES),
    entriesRead: entries.length,
    skipped,
    truncated: sourceEntries.length > MAX_HAR_ENTRIES || deduplicated.length > MAX_IMPORTED_RULES,
  };
}
