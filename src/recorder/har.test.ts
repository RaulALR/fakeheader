import { describe, expect, it } from 'vitest';
import type { RecorderState } from '../types/recorder';
import { exportRecorderHar } from './har';

describe('HAR export', () => {
  it('redacts secrets and omits bodies', () => {
    const state: RecorderState = {
      tabs: {
        '4': {
          tabId: 4,
          active: false,
          startedAt: 1,
          entries: [
            {
              requestId: 'request',
              tabId: 4,
              startedAt: 1,
              method: 'GET',
              type: 'xmlhttprequest',
              url: 'https://api.example.com/users?apiKey=TOP_SECRET&id=7',
              requestHeaders: [
                { name: 'Authorization', value: 'Bearer TOP_SECRET' },
                { name: 'iv-user', value: 'developer' },
              ],
              responseHeaders: [{ name: 'Set-Cookie', value: 'session=TOP_SECRET' }],
            },
          ],
        },
      },
    };
    const har = exportRecorderHar(state);
    expect(har).not.toContain('TOP_SECRET');
    expect(har).toContain('[REDACTED]');
    expect(har).toContain('developer');
    expect(har).toContain('bodies not captured');
  });
});
