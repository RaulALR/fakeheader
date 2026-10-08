import { describe, expect, it } from 'vitest';
import {
  extractHostPermissionsFromUrlFilter,
  hostPermissionPatterns,
  parseHostTarget,
  permissionPatternsForRule,
} from './host-targets';

describe('host permission generation', () => {
  it.each([
    ['localhost', ['http://localhost/*', 'https://localhost/*']],
    ['127.0.0.1', ['http://127.0.0.1/*', 'https://127.0.0.1/*']],
    ['192.168.1.20', ['http://192.168.1.20/*', 'https://192.168.1.20/*']],
    ['[::1]', ['http://[::1]/*', 'https://[::1]/*']],
    ['example.com', ['http://example.com/*', 'https://example.com/*']],
    ['*.example.com', ['http://*.example.com/*', 'https://*.example.com/*']],
    ['https://api.example.com', ['https://api.example.com/*']],
    ['http://localhost:3000', ['http://localhost:3000/*']],
  ])('creates valid minimal patterns for %s', (input, expected) => {
    expect(hostPermissionPatterns(parseHostTarget(input as string))).toEqual(expected);
  });

  it('extracts a host from safe URL filters without broadening globally', () => {
    expect(extractHostPermissionsFromUrlFilter('||api.example.com^')).toEqual([
      'http://*.api.example.com/*',
      'https://*.api.example.com/*',
    ]);
    expect(extractHostPermissionsFromUrlFilter('|https://api.example.com/v1/*')).toEqual([
      'https://api.example.com/*',
    ]);
    expect(extractHostPermissionsFromUrlFilter('*token*')).toBeNull();
  });

  it('requires an explicit all-websites flag for global permission', () => {
    expect(permissionPatternsForRule({ urlFilter: '*token*' })).toEqual([]);
    expect(permissionPatternsForRule({ allWebsites: true })).toEqual(['http://*/*', 'https://*/*']);
  });
});
