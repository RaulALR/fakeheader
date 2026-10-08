interface ParsedMatchPattern {
  scheme: 'http' | 'https' | '*';
  host: string;
  path: string;
}

function parseMatchPattern(pattern: string): ParsedMatchPattern | null {
  const match = /^(http|https|\*):\/\/([^/]+)(\/.*)$/i.exec(pattern.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase() as ParsedMatchPattern['scheme'];
  const host = match[2].toLowerCase();
  const path = match[3];
  if (
    !host ||
    host.includes('@') ||
    /\s/.test(host) ||
    (host.includes('*') && host !== '*' && !host.startsWith('*.')) ||
    (host.startsWith('*.') && host.slice(2).includes('*'))
  )
    return null;
  const hostname = host.startsWith('*.') ? host.slice(2) : host;
  if (host !== '*' && !/^\[[0-9a-f:.]+\]$/i.test(hostname) && !/^[a-z0-9.-]+$/i.test(hostname))
    return null;
  return { scheme, host, path };
}

export function isValidScriptMatchPattern(pattern: string): boolean {
  return parseMatchPattern(pattern) !== null;
}

function wildcardPathMatches(pattern: string, value: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(value);
}

export function scriptMatchesUrl(
  matches: string[],
  excludeMatches: string[],
  urlValue: string,
): boolean {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const matchesPattern = (patternValue: string) => {
    const pattern = parseMatchPattern(patternValue);
    if (!pattern) return false;
    if (pattern.scheme !== '*' && `${pattern.scheme}:` !== url.protocol) return false;
    const hostname = url.hostname.toLowerCase();
    if (pattern.host !== '*') {
      const expected = pattern.host.startsWith('*.') ? pattern.host.slice(2) : pattern.host;
      if (
        hostname !== expected &&
        (!pattern.host.startsWith('*.') || !hostname.endsWith(`.${expected}`))
      )
        return false;
    }
    return wildcardPathMatches(pattern.path, `${url.pathname}${url.search}`);
  };
  return matches.some(matchesPattern) && !excludeMatches.some(matchesPattern);
}

export function permissionOriginsForScriptPatterns(patterns: string[]): string[] {
  const origins = new Set<string>();
  for (const value of patterns) {
    const pattern = parseMatchPattern(value);
    if (!pattern) continue;
    if (pattern.scheme === '*') {
      origins.add(`http://${pattern.host}/*`);
      origins.add(`https://${pattern.host}/*`);
    } else origins.add(`${pattern.scheme}://${pattern.host}/*`);
  }
  return [...origins];
}
