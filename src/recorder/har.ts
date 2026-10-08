import type { RecorderState, TrafficEntry, TrafficHeader } from '../types/recorder';
import { isSensitiveQueryParameter, isSensitiveTrafficHeader } from '../utils/sensitive';

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of [...url.searchParams.keys()])
      if (isSensitiveQueryParameter(key)) url.searchParams.set(key, '[REDACTED]');
    return url.toString();
  } catch {
    return value;
  }
}

function safeHeaders(headers: TrafficHeader[] = []): TrafficHeader[] {
  return headers.map((header) => ({
    name: header.name,
    value: isSensitiveTrafficHeader(header.name) ? '[REDACTED]' : header.value,
  }));
}

function headerSize(headers: TrafficHeader[]): number {
  return headers.reduce((sum, header) => sum + header.name.length + header.value.length + 4, 0);
}

function toHarEntry(entry: TrafficEntry) {
  const requestHeaders = safeHeaders(entry.requestHeaders);
  const responseHeaders = safeHeaders(entry.responseHeaders);
  const duration = Math.max(0, entry.durationMs ?? 0);
  const url = safeUrl(entry.url);
  let queryString: Array<{ name: string; value: string }> = [];
  try {
    queryString = [...new URL(url).searchParams.entries()].map(([name, value]) => ({
      name,
      value,
    }));
  } catch {}
  return {
    startedDateTime: new Date(entry.startedAt).toISOString(),
    time: duration,
    request: {
      method: entry.method,
      url,
      httpVersion: 'HTTP/1.1',
      headers: requestHeaders,
      queryString,
      cookies: [],
      headersSize: headerSize(requestHeaders),
      bodySize: -1,
    },
    response: {
      status: entry.statusCode ?? 0,
      statusText: entry.error ?? entry.statusLine ?? '',
      httpVersion: 'HTTP/1.1',
      headers: responseHeaders,
      cookies: [],
      content: { size: 0, mimeType: '' },
      redirectURL:
        responseHeaders.find((header) => header.name.toLowerCase() === 'location')?.value ?? '',
      headersSize: headerSize(responseHeaders),
      bodySize: -1,
    },
    cache: {},
    timings: { send: 0, wait: duration, receive: 0 },
    serverIPAddress: entry.ip,
    comment: `Pestaña ${entry.tabId} de FakeHeader; tipo de recurso ${entry.type}; cuerpos no capturados`,
  };
}

export function exportRecorderHar(state: RecorderState, tabId?: number): string {
  const sessions = Object.values(state.tabs).filter(
    (session) => tabId === undefined || session.tabId === tabId,
  );
  return JSON.stringify(
    {
      log: {
        version: '1.2',
        creator: { name: 'FakeHeader', version: '1.0.0' },
        pages: [],
        entries: sessions
          .flatMap((session) => session.entries)
          .sort((first, second) => first.startedAt - second.startedAt)
          .map(toHarEntry),
        comment: 'Exportación local saneada. Los cuerpos de solicitud y respuesta se omiten de forma intencionada.',
      },
    },
    null,
    2,
  );
}
