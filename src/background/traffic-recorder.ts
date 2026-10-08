import { MAX_RECORDED_REQUESTS_PER_TAB, MAX_RECORDER_BYTES, RECORDER_KEY } from '../config';
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

export function getRecorderState(): Promise<RecorderResult> {
  return enqueueRecorder(async () => ({ ok: true, state: await readState() }));
}

export function startRecording(tabId: number): Promise<RecorderResult> {
  return enqueueRecorder(async () => {
    if (!(await chrome.permissions.contains({ permissions: ['webRequest'] })))
      return { ok: false, error: 'Falta el permiso opcional webRequest.' };
    registerTrafficRecorderListeners();
    const state = await readState();
    const existing = state.tabs[String(tabId)];
    state.tabs[String(tabId)] = existing
      ? { ...existing, active: true, stoppedAt: undefined }
      : { tabId, active: true, startedAt: Date.now(), entries: [] };
    await writeState(state);
    return { ok: true, state };
  });
}

export function stopRecording(tabId: number): Promise<RecorderResult> {
  return enqueueRecorder(async () => {
    const state = await readState();
    const session = state.tabs[String(tabId)];
    if (session) {
      session.active = false;
      session.stoppedAt = Date.now();
      await writeState(state);
    }
    return { ok: true, state };
  });
}

export function stopAllRecordings(): Promise<RecorderResult> {
  return enqueueRecorder(async () => {
    const state = await readState();
    for (const session of Object.values(state.tabs)) {
      session.active = false;
      session.stoppedAt = Date.now();
    }
    await writeState(state);
    return { ok: true, state };
  });
}

export function clearRecordings(tabId?: number): Promise<RecorderResult> {
  return enqueueRecorder(async () => {
    const state = await readState();
    if (tabId === undefined) state.tabs = {};
    else delete state.tabs[String(tabId)];
    await writeState(state);
    return { ok: true, state };
  });
}

async function updateEntry(
  tabId: number,
  requestId: string,
  create: () => TrafficEntry,
  update: (entry: TrafficEntry) => void,
): Promise<void> {
  const state = await readState();
  const session = state.tabs[String(tabId)];
  if (!session?.active) return;
  let entry = [...session.entries].reverse().find((item) => item.requestId === requestId);
  if (!entry) {
    entry = create();
    session.entries.push(entry);
  }
  update(entry);
  session.entries = session.entries.slice(-MAX_RECORDED_REQUESTS_PER_TAB);
  await writeState(state);
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

function queueEvent(operation: () => Promise<void>): void {
  void enqueueRecorder(operation).catch(() => undefined);
}

let listenersRegistered = false;
export function registerTrafficRecorderListeners(): void {
  if (listenersRegistered) return;
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      queueEvent(() =>
        updateEntry(
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
      queueEvent(() =>
        updateEntry(
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
      queueEvent(() =>
        updateEntry(
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
      queueEvent(() =>
        updateEntry(
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
      queueEvent(() =>
        updateEntry(
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
