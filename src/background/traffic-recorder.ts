import {
  MAX_RECORDED_REQUESTS_PER_TAB,
  MAX_RECORDER_BYTES,
  MAX_RESPONSE_BODY_CHARS,
  RECORDER_KEY,
} from '../config';
import type { RecorderResult, RecorderState, TrafficEntry, TrafficHeader } from '../types/recorder';
import { isSensitiveQueryParameter, isSensitiveTrafficHeader } from '../utils/sensitive';

function emptyState(): RecorderState {
  return { tabs: {} };
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value.slice(0, 8192));
    url.hash = '';
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of [...url.searchParams.keys()])
      if (isSensitiveQueryParameter(key)) url.searchParams.set(key, '[REDACTED]');
    return url.toString();
  } catch {
    return value.slice(0, 8192);
  }
}

function sanitizeHeaders(headers?: chrome.webRequest.HttpHeader[]): TrafficHeader[] | undefined {
  if (!headers) return undefined;
  return headers.slice(0, 100).map((header) => ({
    name: header.name.slice(0, 256),
    value: isSensitiveTrafficHeader(header.name)
      ? '[REDACTED]'
      : (header.value ?? (header.binaryValue ? '[BINARY]' : '')).slice(0, 2048),
  }));
}

function parseHeaders(value: unknown): TrafficHeader[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(
      (header): header is { name: string; value: string } =>
        typeof header === 'object' &&
        header !== null &&
        'name' in header &&
        typeof header.name === 'string' &&
        'value' in header &&
        typeof header.value === 'string',
    )
    .slice(0, 100)
    .map((header) => ({
      name: header.name.slice(0, 256),
      value: isSensitiveTrafficHeader(header.name) ? '[REDACTED]' : header.value.slice(0, 2048),
    }));
}

function parseEntry(value: unknown, tabId: number): TrafficEntry | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !('startedAt' in value) ||
    typeof value.startedAt !== 'number' ||
    !Number.isFinite(value.startedAt) ||
    !('method' in value) ||
    typeof value.method !== 'string' ||
    !('url' in value) ||
    typeof value.url !== 'string' ||
    !('type' in value) ||
    typeof value.type !== 'string'
  )
    return null;
  const entry = value as Record<string, unknown>;
  return {
    requestId: value.requestId.slice(0, 256),
    tabId,
    startedAt: value.startedAt,
    method: value.method.slice(0, 16),
    url: sanitizeUrl(value.url),
    type: value.type.slice(0, 64),
    ...(typeof entry.completedAt === 'number' && Number.isFinite(entry.completedAt)
      ? { completedAt: entry.completedAt }
      : {}),
    ...(typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs)
      ? { durationMs: Math.max(0, entry.durationMs) }
      : {}),
    ...(typeof entry.statusCode === 'number' && Number.isInteger(entry.statusCode)
      ? { statusCode: entry.statusCode }
      : {}),
    ...(typeof entry.statusLine === 'string' ? { statusLine: entry.statusLine.slice(0, 512) } : {}),
    ...(entry.fromCache === true ? { fromCache: true } : {}),
    ...(typeof entry.ip === 'string' ? { ip: entry.ip.slice(0, 128) } : {}),
    ...(parseHeaders(entry.requestHeaders)
      ? { requestHeaders: parseHeaders(entry.requestHeaders) }
      : {}),
    ...(parseHeaders(entry.responseHeaders)
      ? { responseHeaders: parseHeaders(entry.responseHeaders) }
      : {}),
    ...(typeof entry.responseBody === 'string' &&
    entry.responseBody.length <= MAX_RESPONSE_BODY_CHARS
      ? { responseBody: entry.responseBody }
      : {}),
    ...(entry.responseBodyEncoding === 'base64' ? { responseBodyEncoding: 'base64' as const } : {}),
    ...(typeof entry.responseBodySize === 'number' &&
    Number.isInteger(entry.responseBodySize) &&
    entry.responseBodySize >= 0
      ? { responseBodySize: entry.responseBodySize }
      : {}),
    ...(entry.responseBodyTruncated === true ? { responseBodyTruncated: true } : {}),
    ...(typeof entry.responseMimeType === 'string'
      ? { responseMimeType: entry.responseMimeType.slice(0, 256) }
      : {}),
    ...(typeof entry.responseBodyError === 'string'
      ? { responseBodyError: entry.responseBodyError.slice(0, 512) }
      : {}),
    ...(typeof entry.error === 'string' ? { error: entry.error.slice(0, 512) } : {}),
  };
}

export function parseRecorderState(value: unknown): RecorderState {
  if (typeof value !== 'object' || value === null || !('tabs' in value)) return emptyState();
  const rawTabs = (value as { tabs?: unknown }).tabs;
  if (typeof rawTabs !== 'object' || rawTabs === null || Array.isArray(rawTabs))
    return emptyState();
  const tabs: RecorderState['tabs'] = {};
  for (const [key, raw] of Object.entries(rawTabs).slice(0, 100)) {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('tabId' in raw) ||
      !Number.isInteger(raw.tabId) ||
      raw.tabId < 0 ||
      String(raw.tabId) !== key ||
      !('startedAt' in raw) ||
      typeof raw.startedAt !== 'number' ||
      !Number.isFinite(raw.startedAt) ||
      raw.startedAt < 0 ||
      raw.startedAt > 8.64e15 ||
      !('entries' in raw) ||
      !Array.isArray(raw.entries)
    )
      continue;
    const session = raw as Record<string, unknown>;
    tabs[key] = {
      tabId: raw.tabId,
      active: session.active === true,
      startedAt: raw.startedAt,
      ...(typeof session.stoppedAt === 'number' && Number.isFinite(session.stoppedAt)
        ? { stoppedAt: session.stoppedAt }
        : {}),
      ...(typeof session.captureToken === 'string' && session.captureToken.length <= 128
        ? { captureToken: session.captureToken }
        : {}),
      ...(typeof session.captureError === 'string'
        ? { captureError: session.captureError.slice(0, 512) }
        : {}),
      entries: raw.entries
        .slice(-MAX_RECORDED_REQUESTS_PER_TAB)
        .map((entry: unknown) => parseEntry(entry, raw.tabId))
        .filter((entry: TrafficEntry | null): entry is TrafficEntry => entry !== null),
    };
  }
  return { tabs };
}

async function readState(): Promise<RecorderState> {
  const result = await chrome.storage.session.get(RECORDER_KEY);
  return parseRecorderState(result[RECORDER_KEY]);
}

async function writeState(value: RecorderState): Promise<void> {
  const state = parseRecorderState(value);
  while (
    Object.values(state.tabs).some((session) => session.entries.length) &&
    new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_RECORDER_BYTES
  ) {
    const oldest = Object.values(state.tabs)
      .filter((session) => session.entries.length)
      .sort((first, second) => first.entries[0].startedAt - second.entries[0].startedAt)[0];
    oldest.entries.shift();
  }
  await chrome.storage.session.set({ [RECORDER_KEY]: state });
}

let recorderQueue: Promise<void> = Promise.resolve();
function enqueueRecorder<T>(operation: () => Promise<T>): Promise<T> {
  const result = recorderQueue.then(operation, operation);
  recorderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

interface DebuggerRequestMetadata {
  method: string;
  url: string;
  startedAt: number;
  type?: string;
  statusCode?: number;
  statusLine?: string;
  mimeType?: string;
}

const debuggerTabs = new Set<number>();
const debuggerRequests = new Map<string, DebuggerRequestMetadata>();
let debuggerListenersRegistered = false;

function debuggerRequestKey(tabId: number, requestId: string): string {
  return `${tabId}:${requestId}`;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

async function recordDebuggerResponseBody(
  tabId: number,
  requestId: string,
  encodedDataLength?: number,
): Promise<void> {
  const key = debuggerRequestKey(tabId, requestId);
  const metadata = debuggerRequests.get(key);
  debuggerRequests.delete(key);
  if (!metadata || !['XHR', 'Fetch'].includes(metadata.type ?? '')) return;
  const completedAt = Date.now();
  let capture: Record<string, unknown> = {
    method: metadata.method,
    url: metadata.url,
    startedAt: metadata.startedAt,
    completedAt,
    statusCode: metadata.statusCode,
    statusLine: metadata.statusLine,
    mimeType: metadata.mimeType,
  };
  try {
    const result = objectValue(
      await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }),
    );
    if (!result || typeof result.body !== 'string')
      throw new Error('Chrome no devolvió el cuerpo de la respuesta.');
    const body = result.body;
    const base64Encoded = result.base64Encoded === true;
    const bodySize = base64Encoded
      ? Math.max(
          0,
          Math.floor((body.length * 3) / 4) -
            (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0),
        )
      : new TextEncoder().encode(body).byteLength;
    capture = {
      ...capture,
      body: body.slice(0, MAX_RESPONSE_BODY_CHARS),
      bodySize:
        Number.isFinite(encodedDataLength) && encodedDataLength! >= 0
          ? Math.max(bodySize, encodedDataLength!)
          : bodySize,
      ...(base64Encoded ? { encoding: 'base64' } : {}),
      ...(body.length > MAX_RESPONSE_BODY_CHARS ? { truncated: true } : {}),
    };
  } catch (error) {
    capture = {
      ...capture,
      error:
        error instanceof Error
          ? error.message
          : 'Chrome no pudo recuperar el cuerpo de la respuesta.',
    };
  }
  const state = await readState();
  const token = state.tabs[String(tabId)]?.captureToken;
  if (token) await recordResponseCapture(tabId, token, capture);
}

function handleDebuggerEvent(
  source: chrome.debugger.DebuggerSession,
  method: string,
  raw?: object,
): void {
  const tabId = source.tabId;
  if (tabId === undefined || !debuggerTabs.has(tabId)) return;
  const params = objectValue(raw);
  if (!params) return;
  const requestId = typeof params.requestId === 'string' ? params.requestId : undefined;
  if (!requestId) return;
  const key = debuggerRequestKey(tabId, requestId);
  if (method === 'Network.requestWillBeSent') {
    const request = objectValue(params.request);
    if (typeof request?.url !== 'string' || typeof request.method !== 'string') return;
    debuggerRequests.set(key, {
      method: request.method.toUpperCase().slice(0, 16),
      url: request.url,
      startedAt:
        typeof params.wallTime === 'number' && Number.isFinite(params.wallTime)
          ? params.wallTime * 1000
          : Date.now(),
      ...(typeof params.type === 'string' ? { type: params.type } : {}),
    });
    return;
  }
  if (method === 'Network.responseReceived') {
    const response = objectValue(params.response);
    const current = debuggerRequests.get(key);
    if (!current || !response) return;
    if (typeof params.type === 'string') current.type = params.type;
    if (typeof response.status === 'number') current.statusCode = response.status;
    if (typeof response.statusText === 'string') current.statusLine = response.statusText;
    if (typeof response.mimeType === 'string') current.mimeType = response.mimeType;
    if (typeof response.url === 'string') current.url = response.url;
    return;
  }
  if (method === 'Network.loadingFinished') {
    const encodedDataLength =
      typeof params.encodedDataLength === 'number' ? params.encodedDataLength : undefined;
    void recordDebuggerResponseBody(tabId, requestId, encodedDataLength).catch(() => undefined);
    return;
  }
  if (method === 'Network.loadingFailed') debuggerRequests.delete(key);
}

async function markDebuggerDetached(tabId: number): Promise<void> {
  const state = await readState();
  const session = state.tabs[String(tabId)];
  if (!session?.active) return;
  session.captureError =
    'Chrome desconectó la captura completa. Cierra DevTools y reinicia la grabación.';
  await writeState(state);
}

export function registerDebuggerCaptureListeners(): void {
  if (debuggerListenersRegistered) return;
  chrome.debugger.onEvent.addListener(handleDebuggerEvent);
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId === undefined || !debuggerTabs.delete(source.tabId)) return;
    for (const key of debuggerRequests.keys())
      if (key.startsWith(`${source.tabId}:`)) debuggerRequests.delete(key);
    void enqueueRecorder(() => markDebuggerDetached(source.tabId!)).catch(() => undefined);
  });
  debuggerListenersRegistered = true;
}

async function startDebuggerCapture(tabId: number): Promise<void> {
  registerDebuggerCaptureListeners();
  if (debuggerTabs.has(tabId)) return;
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch {
    try {
      await chrome.debugger.sendCommand(target, 'Network.enable');
    } catch {
      throw new Error(
        'No se pudo conectar la captura completa. Cierra DevTools en esta pestaña e inténtalo de nuevo.',
      );
    }
  }
  try {
    await chrome.debugger.sendCommand(target, 'Network.enable', {
      maxTotalBufferSize: 50 * 1024 * 1024,
      maxResourceBufferSize: 8 * 1024 * 1024,
      maxPostDataSize: 0,
    });
    debuggerTabs.add(tabId);
  } catch (error) {
    await chrome.debugger.detach(target).catch(() => undefined);
    throw error;
  }
}

async function stopDebuggerCapture(tabId: number): Promise<void> {
  const attached = debuggerTabs.delete(tabId);
  for (const key of debuggerRequests.keys())
    if (key.startsWith(`${tabId}:`)) debuggerRequests.delete(key);
  if (attached) await chrome.debugger.detach({ tabId }).catch(() => undefined);
}

function installRecorderBridge(token: string): void {
  const scope = window as unknown as Record<string, unknown>;
  const key = '__fakeHeaderRecorderBridgeV1';
  const previous = scope[key] as { token?: string; remove?: () => void } | undefined;
  if (previous?.token === token) return;
  previous?.remove?.();
  const handler = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | null;
    if (
      !data ||
      data.source !== 'fakeheader-response-recorder' ||
      data.token !== token ||
      typeof data.capture !== 'object' ||
      data.capture === null
    )
      return;
    void chrome.runtime
      .sendMessage({
        type: 'record-response-body',
        captureToken: token,
        responseCapture: data.capture,
      })
      .catch(() => undefined);
  };
  window.addEventListener('message', handler);
  window.postMessage({ source: 'fakeheader-response-recorder-bridge-ready', token }, '*');
  scope[key] = { token, remove: () => window.removeEventListener('message', handler) };
}

function installPageResponseCapture(token: string, maxBodyChars: number): void {
  const scope = window as unknown as Record<string, unknown>;
  const key = '__fakeHeaderResponseRecorderV1';
  const previous = scope[key] as { token?: string; restore?: () => void } | undefined;
  if (previous?.token === token) return;
  previous?.restore?.();

  const originalFetch = window.fetch;
  const originalOpen = window.XMLHttpRequest.prototype.open;
  const originalSend = window.XMLHttpRequest.prototype.send;
  const xhrMetadata = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  let active = true;
  let bridgeReady = false;
  const pendingCaptures: Record<string, unknown>[] = [];

  const absoluteUrl = (value: string) => {
    try {
      return new URL(value, window.location.href).href;
    } catch {
      return value;
    }
  };
  const textSize = (value: string) => new TextEncoder().encode(value).byteLength;
  const limit = (value: string) => ({
    body: value.slice(0, maxBodyChars),
    truncated: value.length > maxBodyChars,
  });
  const bytesToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  };
  const isTextual = (mimeType: string) =>
    !mimeType || /^(?:text\/)|(?:json|xml|javascript|x-www-form-urlencoded|svg)/i.test(mimeType);
  const emit = (capture: Record<string, unknown>) => {
    if (!active) return;
    if (!bridgeReady) {
      if (pendingCaptures.length < 20) pendingCaptures.push(capture);
      return;
    }
    window.postMessage({ source: 'fakeheader-response-recorder', token, capture }, '*');
  };
  const handleBridgeReady = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | null;
    if (
      !data ||
      data.source !== 'fakeheader-response-recorder-bridge-ready' ||
      data.token !== token
    )
      return;
    bridgeReady = true;
    for (const capture of pendingCaptures.splice(0)) emit(capture);
  };
  window.addEventListener('message', handleBridgeReady);
  const captureResponse = async (response: Response, method: string, startedAt: number) => {
    const completedAt = Date.now();
    const mimeType = response.headers.get('content-type') ?? '';
    const common = {
      method,
      url: response.url,
      startedAt,
      completedAt,
      statusCode: response.status,
      statusLine: response.statusText,
      mimeType,
    };
    try {
      if (response.type === 'opaque') {
        emit({ ...common, error: 'Chrome no permite leer el cuerpo de una respuesta opaca.' });
        return;
      }
      if (isTextual(mimeType)) {
        const body = await response.text();
        emit({ ...common, ...limit(body), bodySize: textSize(body) });
      } else {
        const buffer = await response.arrayBuffer();
        const encoded = bytesToBase64(buffer);
        emit({
          ...common,
          ...limit(encoded),
          encoding: 'base64',
          bodySize: buffer.byteLength,
        });
      }
    } catch (error) {
      emit({
        ...common,
        error: error instanceof Error ? error.message : 'No se pudo leer el cuerpo.',
      });
    }
  };

  const recorderFetch = (async (...args: Parameters<typeof window.fetch>) => {
    const startedAt = Date.now();
    const input = args[0];
    const init = args[1];
    const method = String(
      init?.method ?? (input instanceof Request ? input.method : 'GET'),
    ).toUpperCase();
    const response = await originalFetch(...args);
    void captureResponse(response.clone(), method, startedAt);
    return response;
  }) as typeof window.fetch;
  window.fetch = recorderFetch;

  const recorderOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    xhrMetadata.set(this, { method: method.toUpperCase(), url: absoluteUrl(String(url)) });
    return (originalOpen as unknown as (...args: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest,
    );
  } as typeof originalOpen;
  const recorderSend = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest['send']>
  ) {
    const startedAt = Date.now();
    this.addEventListener(
      'loadend',
      () => {
        const metadata = xhrMetadata.get(this) ?? { method: 'GET', url: this.responseURL };
        const mimeType = this.getResponseHeader('content-type') ?? '';
        const common = {
          method: metadata.method,
          url: this.responseURL || metadata.url,
          startedAt,
          completedAt: Date.now(),
          statusCode: this.status,
          statusLine: this.statusText,
          mimeType,
        };
        void (async () => {
          try {
            if (this.responseType === '' || this.responseType === 'text') {
              const body = this.responseText;
              emit({ ...common, ...limit(body), bodySize: textSize(body) });
            } else if (this.responseType === 'json') {
              const body = JSON.stringify(this.response);
              emit({ ...common, ...limit(body), bodySize: textSize(body) });
            } else if (this.responseType === 'arraybuffer') {
              const buffer = this.response as ArrayBuffer;
              const encoded = bytesToBase64(buffer);
              emit({
                ...common,
                ...limit(encoded),
                encoding: 'base64',
                bodySize: buffer.byteLength,
              });
            } else if (this.responseType === 'blob') {
              const blob = this.response as Blob;
              const encoded = bytesToBase64(await blob.arrayBuffer());
              emit({
                ...common,
                ...limit(encoded),
                encoding: 'base64',
                bodySize: blob.size,
              });
            } else if (this.responseType === 'document') {
              const body = this.responseXML
                ? new XMLSerializer().serializeToString(this.responseXML)
                : '';
              emit({ ...common, ...limit(body), bodySize: textSize(body) });
            }
          } catch (error) {
            emit({
              ...common,
              error: error instanceof Error ? error.message : 'No se pudo leer el cuerpo.',
            });
          }
        })();
      },
      { once: true },
    );
    return originalSend.apply(this, args);
  } as typeof originalSend;
  window.XMLHttpRequest.prototype.open = recorderOpen;
  window.XMLHttpRequest.prototype.send = recorderSend;

  scope[key] = {
    token,
    restore: () => {
      active = false;
      pendingCaptures.length = 0;
      window.removeEventListener('message', handleBridgeReady);
      if (window.fetch === recorderFetch) window.fetch = originalFetch;
      if (window.XMLHttpRequest.prototype.open === recorderOpen)
        window.XMLHttpRequest.prototype.open = originalOpen;
      if (window.XMLHttpRequest.prototype.send === recorderSend)
        window.XMLHttpRequest.prototype.send = originalSend;
      delete scope[key];
    },
  };
}

function removeRecorderBridge(): void {
  const scope = window as unknown as Record<string, unknown>;
  const key = '__fakeHeaderRecorderBridgeV1';
  const current = scope[key] as { remove?: () => void } | undefined;
  current?.remove?.();
  delete scope[key];
}

function removePageResponseCapture(): void {
  const scope = window as unknown as Record<string, unknown>;
  const key = '__fakeHeaderResponseRecorderV1';
  const current = scope[key] as { restore?: () => void } | undefined;
  current?.restore?.();
}

export async function ensureResponseCapture(tabId: number): Promise<void> {
  if (debuggerTabs.has(tabId)) return;
  const state = await readState();
  const session = state.tabs[String(tabId)];
  if (!session?.active || !session.captureToken) return;
  if (!(await chrome.permissions.contains({ permissions: ['scripting'] })))
    throw new Error('Falta el permiso scripting para capturar respuestas completas.');
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: installPageResponseCapture,
    args: [session.captureToken, MAX_RESPONSE_BODY_CHARS],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: installRecorderBridge,
    args: [session.captureToken],
  });
}

async function stopResponseCapture(tabId: number): Promise<void> {
  if (!(await chrome.permissions.contains({ permissions: ['scripting'] }))) return;
  await Promise.allSettled([
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: removePageResponseCapture,
    }),
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: removeRecorderBridge,
    }),
  ]);
}

export function recordResponseCapture(
  tabId: number,
  token: string | undefined,
  raw: unknown,
): Promise<RecorderResult> {
  return flushQueuedEvents().then(() =>
    enqueueRecorder(async () => {
      const state = await readState();
      const session = state.tabs[String(tabId)];
      if (!session?.active || !token || token !== session.captureToken)
        return { ok: false, error: 'La captura ya no está activa.' };
      if (typeof raw !== 'object' || raw === null)
        return { ok: false, error: 'Respuesta capturada no válida.' };
      const value = raw as Record<string, unknown>;
      if (
        typeof value.method !== 'string' ||
        typeof value.url !== 'string' ||
        typeof value.startedAt !== 'number' ||
        typeof value.completedAt !== 'number'
      )
        return { ok: false, error: 'Respuesta capturada no válida.' };
      const method = value.method.slice(0, 16).toUpperCase();
      const url = sanitizeUrl(value.url);
      const startedAt = value.startedAt;
      const candidates = session.entries
        .filter(
          (entry) =>
            entry.method === method &&
            entry.url === url &&
            entry.responseBody === undefined &&
            Math.abs(entry.startedAt - startedAt) <= 15_000,
        )
        .sort(
          (first, second) =>
            Math.abs(first.startedAt - startedAt) - Math.abs(second.startedAt - startedAt),
        );
      const entry =
        candidates[0] ??
        ({
          requestId: `body-${crypto.randomUUID()}`,
          tabId,
          startedAt,
          method,
          url,
          type: 'xmlhttprequest',
        } satisfies TrafficEntry);
      if (!candidates.length) session.entries.push(entry);
      entry.completedAt = value.completedAt;
      entry.durationMs = Math.max(0, value.completedAt - startedAt);
      if (typeof value.statusCode === 'number' && Number.isInteger(value.statusCode))
        entry.statusCode = value.statusCode;
      if (typeof value.statusLine === 'string') entry.statusLine = value.statusLine.slice(0, 512);
      if (typeof value.mimeType === 'string') entry.responseMimeType = value.mimeType.slice(0, 256);
      if (typeof value.body === 'string')
        entry.responseBody = value.body.slice(0, MAX_RESPONSE_BODY_CHARS);
      if (value.encoding === 'base64') entry.responseBodyEncoding = 'base64';
      if (
        typeof value.bodySize === 'number' &&
        Number.isInteger(value.bodySize) &&
        value.bodySize >= 0
      )
        entry.responseBodySize = value.bodySize;
      if (
        value.truncated === true ||
        (typeof value.body === 'string' && value.body.length > MAX_RESPONSE_BODY_CHARS)
      )
        entry.responseBodyTruncated = true;
      if (typeof value.error === 'string') entry.responseBodyError = value.error.slice(0, 512);
      session.entries = session.entries.slice(-MAX_RECORDED_REQUESTS_PER_TAB);
      await writeState(state);
      return { ok: true, state };
    }),
  );
}

export function getRecorderState(): Promise<RecorderResult> {
  return flushQueuedEvents().then(() =>
    enqueueRecorder(async () => ({ ok: true, state: await readState() })),
  );
}

export function startRecording(tabId: number): Promise<RecorderResult> {
  return enqueueRecorder(async () => {
    if (!(await chrome.permissions.contains({ permissions: ['webRequest'] })))
      return { ok: false, error: 'Falta el permiso opcional webRequest.' };
    registerTrafficRecorderListeners();
    const state = await readState();
    const existing = state.tabs[String(tabId)];
    try {
      await startDebuggerCapture(tabId);
    } catch (error) {
      if (existing) {
        existing.active = false;
        existing.stoppedAt = Date.now();
        existing.captureError =
          error instanceof Error ? error.message : 'No se pudo iniciar la captura completa.';
        await writeState(state);
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo iniciar la captura completa.',
        state,
      };
    }
    state.tabs[String(tabId)] = existing
      ? {
          ...existing,
          active: true,
          stoppedAt: undefined,
          captureToken: crypto.randomUUID(),
          captureError: undefined,
        }
      : {
          tabId,
          active: true,
          startedAt: Date.now(),
          captureToken: crypto.randomUUID(),
          entries: [],
        };
    try {
      await writeState(state);
      await stopResponseCapture(tabId);
    } catch (error) {
      await stopDebuggerCapture(tabId);
      state.tabs[String(tabId)].active = false;
      state.tabs[String(tabId)].stoppedAt = Date.now();
      await writeState(state);
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo preparar la captura de respuestas completas.',
        state,
      };
    }
    return { ok: true, state };
  });
}

export function stopRecording(tabId: number): Promise<RecorderResult> {
  return flushQueuedEvents().then(() =>
    enqueueRecorder(async () => {
      const state = await readState();
      const session = state.tabs[String(tabId)];
      if (session) {
        session.active = false;
        session.stoppedAt = Date.now();
        await writeState(state);
      }
      await stopDebuggerCapture(tabId);
      await stopResponseCapture(tabId);
      return { ok: true, state };
    }),
  );
}

export function stopAllRecordings(): Promise<RecorderResult> {
  return enqueueRecorder(async () => {
    const state = await readState();
    for (const session of Object.values(state.tabs)) {
      session.active = false;
      session.stoppedAt = Date.now();
    }
    await writeState(state);
    await Promise.allSettled(
      Object.values(state.tabs).map((session) => stopDebuggerCapture(session.tabId)),
    );
    await Promise.allSettled(
      Object.values(state.tabs).map((session) => stopResponseCapture(session.tabId)),
    );
    return { ok: true, state };
  });
}

export function migrateReplacedRecording(
  addedTabId: number,
  removedTabId: number,
): Promise<RecorderResult> {
  return flushQueuedEvents().then(() =>
    enqueueRecorder(async () => {
      const state = await readState();
      const previous = state.tabs[String(removedTabId)];
      delete state.tabs[String(removedTabId)];
      delete state.tabs[String(addedTabId)];
      if (previous) {
        state.tabs[String(addedTabId)] = {
          ...previous,
          tabId: addedTabId,
          ...(previous.active ? { captureToken: crypto.randomUUID() } : {}),
        };
      }
      await writeState(state);
      await stopDebuggerCapture(removedTabId);
      if (previous?.active) {
        try {
          await startDebuggerCapture(addedTabId);
          state.tabs[String(addedTabId)].captureError = undefined;
        } catch (error) {
          state.tabs[String(addedTabId)].captureError =
            error instanceof Error ? error.message : 'No se pudo migrar la captura completa.';
          await writeState(state);
        }
      }
      await writeState(state);
      await stopResponseCapture(removedTabId).catch(() => undefined);
      return { ok: true, state };
    }),
  );
}

export function clearRecordings(tabId?: number): Promise<RecorderResult> {
  return flushQueuedEvents().then(() =>
    enqueueRecorder(async () => {
      const state = await readState();
      const removedTabIds =
        tabId === undefined ? Object.values(state.tabs).map((session) => session.tabId) : [tabId];
      if (tabId === undefined) state.tabs = {};
      else delete state.tabs[String(tabId)];
      await writeState(state);
      await Promise.allSettled(
        removedTabIds.map((removedTabId) => stopDebuggerCapture(removedTabId)),
      );
      await Promise.allSettled(
        removedTabIds.map((removedTabId) => stopResponseCapture(removedTabId)),
      );
      return { ok: true, state };
    }),
  );
}

function updateEntry(
  state: RecorderState,
  tabId: number,
  requestId: string,
  create: () => TrafficEntry,
  update: (entry: TrafficEntry) => void,
): boolean {
  const session = state.tabs[String(tabId)];
  if (!session?.active) return false;
  let entry = [...session.entries].reverse().find((item) => item.requestId === requestId);
  if (!entry) {
    entry = create();
    session.entries.push(entry);
  }
  update(entry);
  session.entries = session.entries.slice(-MAX_RECORDED_REQUESTS_PER_TAB);
  return true;
}

function baseEntry(details: {
  requestId: string;
  tabId: number;
  timeStamp: number;
  method: string;
  url: string;
  type: string;
}): TrafficEntry {
  return {
    requestId: details.requestId,
    tabId: details.tabId,
    startedAt: details.timeStamp,
    method: details.method,
    url: sanitizeUrl(details.url),
    type: details.type,
  };
}

type RecorderMutation = (state: RecorderState) => boolean;
const pendingEventMutations: RecorderMutation[] = [];
let eventFlushTimer: ReturnType<typeof setTimeout> | undefined;

function flushQueuedEvents(): Promise<void> {
  if (eventFlushTimer !== undefined) clearTimeout(eventFlushTimer);
  eventFlushTimer = undefined;
  if (!pendingEventMutations.length) return Promise.resolve();
  const batch = pendingEventMutations.splice(0);
  return enqueueRecorder(async () => {
    const state = await readState();
    let changed = false;
    for (const mutation of batch) changed = mutation(state) || changed;
    if (changed) await writeState(state);
  });
}

function queueEvent(operation: RecorderMutation): void {
  pendingEventMutations.push(operation);
  if (eventFlushTimer !== undefined) return;
  eventFlushTimer = setTimeout(() => {
    void flushQueuedEvents().catch(() => undefined);
  }, 75);
}

let listenersRegistered = false;
export function registerTrafficRecorderListeners(): void {
  if (listenersRegistered) return;
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      queueEvent((state) =>
        updateEntry(
          state,
          details.tabId,
          details.requestId,
          () => baseEntry(details),
          () => undefined,
        ),
      );
      return undefined;
    },
    { urls: ['http://*/*', 'https://*/*'] },
  );
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      queueEvent((state) =>
        updateEntry(
          state,
          details.tabId,
          details.requestId,
          () => baseEntry(details),
          (entry) => {
            entry.requestHeaders = sanitizeHeaders(details.requestHeaders);
          },
        ),
      );
      return undefined;
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['requestHeaders', 'extraHeaders'],
  );
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      queueEvent((state) =>
        updateEntry(
          state,
          details.tabId,
          details.requestId,
          () => baseEntry(details),
          (entry) => {
            entry.statusCode = details.statusCode;
            entry.statusLine = details.statusLine;
            entry.responseHeaders = sanitizeHeaders(details.responseHeaders);
          },
        ),
      );
      return undefined;
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['responseHeaders', 'extraHeaders'],
  );
  chrome.webRequest.onCompleted.addListener(
    (details) =>
      queueEvent((state) =>
        updateEntry(
          state,
          details.tabId,
          details.requestId,
          () => baseEntry(details),
          (entry) => {
            entry.completedAt = details.timeStamp;
            entry.durationMs = Math.max(0, details.timeStamp - entry.startedAt);
            entry.statusCode = details.statusCode;
            entry.fromCache = details.fromCache;
            if (details.ip) entry.ip = details.ip;
          },
        ),
      ),
    { urls: ['http://*/*', 'https://*/*'] },
  );
  chrome.webRequest.onErrorOccurred.addListener(
    (details) =>
      queueEvent((state) =>
        updateEntry(
          state,
          details.tabId,
          details.requestId,
          () => baseEntry(details),
          (entry) => {
            entry.completedAt = details.timeStamp;
            entry.durationMs = Math.max(0, details.timeStamp - entry.startedAt);
            entry.error = details.error;
          },
        ),
      ),
    { urls: ['http://*/*', 'https://*/*'] },
  );
  listenersRegistered = true;
}
