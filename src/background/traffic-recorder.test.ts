import { describe, expect, it } from 'vitest';
import { parseRecorderState } from './traffic-recorder';

describe('traffic recorder storage parsing', () => {
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
});
