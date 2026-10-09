import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecorderState } from '../types/recorder';
import {
  migrateReplacedRecording,
  parseRecorderState,
  recordResponseCapture,
  startRecording,
} from './traffic-recorder';

describe('traffic recorder storage parsing', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('redacts sensitive URLs and headers from untrusted session state', () => {
    const state = parseRecorderState({
      tabs: {
        '8': {
          tabId: 8,
          active: true,
          startedAt: 1,
          entries: [
            {
              requestId: 'request',
              tabId: 8,
              startedAt: 2,
              method: 'GET',
              type: 'xmlhttprequest',
              url: 'https://user:password@example.com/data?access_token=URL_SECRET&id=2#fragment',
              requestHeaders: [
                { name: 'X-Custom-Token', value: 'HEADER_SECRET' },
                { name: 'iv-user', value: 'developer' },
              ],
            },
          ],
        },
      },
    });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('URL_SECRET');
    expect(serialized).not.toContain('HEADER_SECRET');
    expect(serialized).not.toContain('fragment');
    expect(serialized).toContain('developer');
  });

  it('drops malformed tab sessions', () => {
    expect(parseRecorderState({ tabs: { wrong: { tabId: 3, entries: [] } } })).toEqual({
      tabs: {},
    });
  });

  it('keeps captured response bodies and their metadata in session state', () => {
    const state = parseRecorderState({
      tabs: {
        '5': {
          tabId: 5,
          active: false,
          startedAt: 1,
          captureToken: 'capture-token',
          entries: [
            {
              requestId: 'response',
              tabId: 5,
              startedAt: 2,
              method: 'GET',
              type: 'xmlhttprequest',
              url: 'http://localhost:4200/api/data',
              responseBody: '{"result":"ok"}',
              responseBodySize: 15,
              responseMimeType: 'application/json',
            },
          ],
        },
      },
    });

    expect(state.tabs['5'].captureToken).toBe('capture-token');
    expect(state.tabs['5'].entries[0]).toMatchObject({
      responseBody: '{"result":"ok"}',
      responseBodySize: 15,
      responseMimeType: 'application/json',
    });
  });

  it('associates a captured fetch response with its webRequest entry', async () => {
    let stored: RecorderState = {
      tabs: {
        '7': {
          tabId: 7,
          active: true,
          startedAt: 1,
          captureToken: 'token',
          entries: [
            {
              requestId: 'network-request',
              tabId: 7,
              startedAt: 1_000,
              method: 'GET',
              url: 'http://localhost:4200/api/data',
              type: 'xmlhttprequest',
            },
          ],
        },
      },
    };
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: vi.fn(async () => ({ fakeHeaderRecorder: stored })),
          set: vi.fn(async (value: { fakeHeaderRecorder: RecorderState }) => {
            stored = value.fakeHeaderRecorder;
          }),
        },
      },
    });

    const result = await recordResponseCapture(7, 'token', {
      method: 'GET',
      url: 'http://localhost:4200/api/data',
      startedAt: 1_010,
      completedAt: 1_025,
      statusCode: 200,
      statusLine: 'OK',
      mimeType: 'application/json',
      body: '{"saved":true}',
      bodySize: 14,
    });

    expect(result.ok).toBe(true);
    expect(stored.tabs['7'].entries).toHaveLength(1);
    expect(stored.tabs['7'].entries[0]).toMatchObject({
      requestId: 'network-request',
      statusCode: 200,
      responseBody: '{"saved":true}',
      responseMimeType: 'application/json',
    });
  });

  it('keeps an active recording when Chrome replaces the tab id', async () => {
    let stored: RecorderState = {
      tabs: {
        '20': {
          tabId: 20,
          active: true,
          startedAt: 1,
          captureToken: 'old-token',
          entries: [
            {
              requestId: 'request',
              tabId: 20,
              startedAt: 2,
              method: 'GET',
              url: 'http://localhost/data',
              type: 'xmlhttprequest',
            },
          ],
        },
      },
    };
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: vi.fn(async () => ({ fakeHeaderRecorder: stored })),
          set: vi.fn(async (value: { fakeHeaderRecorder: RecorderState }) => {
            stored = value.fakeHeaderRecorder;
          }),
        },
      },
      permissions: { contains: vi.fn(async () => false) },
    });

    const result = await migrateReplacedRecording(21, 20);

    expect(result.ok).toBe(true);
    expect(stored.tabs['20']).toBeUndefined();
    expect(stored.tabs['21']).toMatchObject({
      tabId: 21,
      active: true,
      startedAt: 1,
    });
    expect(stored.tabs['21'].captureToken).not.toBe('old-token');
    expect(stored.tabs['21'].entries).toHaveLength(1);
  });

  it('captures an XHR JSON body through the Chrome network debugger', async () => {
    let stored: RecorderState = { tabs: {} };
    let debuggerEvent:
      | ((source: chrome.debugger.DebuggerSession, method: string, params?: object) => void)
      | undefined;
    const sendCommand = vi.fn(
      async (_target: chrome.debugger.DebuggerSession, method: string) =>
        method === 'Network.getResponseBody'
          ? { body: '{"result":"complete"}', base64Encoded: false }
          : {},
    );
    const event = () => ({ addListener: vi.fn() });
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: vi.fn(async () => ({ fakeHeaderRecorder: stored })),
          set: vi.fn(async (value: { fakeHeaderRecorder: RecorderState }) => {
            stored = value.fakeHeaderRecorder;
          }),
        },
      },
      permissions: {
        contains: vi.fn(async (value: { permissions?: string[] }) =>
          Boolean(value.permissions?.includes('webRequest')),
        ),
      },
      webRequest: {
        onBeforeRequest: event(),
        onBeforeSendHeaders: event(),
        onHeadersReceived: event(),
        onCompleted: event(),
        onErrorOccurred: event(),
      },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach: vi.fn(async () => undefined),
        sendCommand,
        onEvent: {
          addListener: vi.fn(
            (
              listener: (
                source: chrome.debugger.DebuggerSession,
                method: string,
                params?: object,
              ) => void,
            ) => {
              debuggerEvent = listener;
            },
          ),
        },
        onDetach: { addListener: vi.fn() },
      },
    });

    expect((await startRecording(30)).ok).toBe(true);
    debuggerEvent?.(
      { tabId: 30 },
      'Network.requestWillBeSent',
      {
        requestId: 'cdp-request',
        wallTime: 2,
        type: 'XHR',
        request: { method: 'GET', url: 'http://localhost/api/data' },
      },
    );
    debuggerEvent?.(
      { tabId: 30 },
      'Network.responseReceived',
      {
        requestId: 'cdp-request',
        type: 'XHR',
        response: {
          url: 'http://localhost/api/data',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
        },
      },
    );
    debuggerEvent?.(
      { tabId: 30 },
      'Network.loadingFinished',
      { requestId: 'cdp-request', encodedDataLength: 21 },
    );

    await vi.waitFor(() =>
      expect(stored.tabs['30'].entries[0]).toMatchObject({
        statusCode: 200,
        responseBody: '{"result":"complete"}',
        responseMimeType: 'application/json',
      }),
    );
    expect(sendCommand).toHaveBeenCalledWith(
      { tabId: 30 },
      'Network.getResponseBody',
      { requestId: 'cdp-request' },
    );
  });
});
