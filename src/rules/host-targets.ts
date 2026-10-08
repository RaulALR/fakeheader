export type HostScheme = 'http' | 'https';

export interface ParsedHostTarget {
  host: string;
  port?: string;
  schemes: HostScheme[];
  includeSubdomains: boolean;
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function validIpv4(value: string): boolean {
  return IPV4.test(value) && value.split('.').every((part) => Number(part) <= 255);
}

export function isIpHost(host: string): boolean {
  return validIpv4(host) || /^\[[0-9a-f:.]+\]$/i.test(host);
}

export function parseHostTarget(input: string): ParsedHostTarget {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) throw new Error('El host no puede estar vacío.');
  const hasScheme = /^https?:\/\//.test(trimmed);
  const includeSubdomains = !hasScheme && trimmed.startsWith('*.');
  const value = includeSubdomains ? trimmed.slice(2) : trimmed;
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `http://${value}`);
  } catch {
    throw new Error('Host no válido. Usa localhost, una IP o un dominio.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('El host sólo puede incluir esquema, hostname y puerto opcional.');
  }
  const host = url.hostname.toLowerCase();
  if (
    !host ||
    (!isIpHost(host) &&
      host !== 'localhost' &&
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        host,
      ))
  ) {
    throw new Error('Hostname no válido; usa ASCII o punycode.');
  }
  if (includeSubdomains && (host === 'localhost' || isIpHost(host)))
    throw new Error('localhost e IPs no admiten wildcard de subdominio.');
  return {
    host,
    ...(url.port ? { port: url.port } : {}),
    schemes: hasScheme ? [url.protocol.slice(0, -1) as HostScheme] : ['http', 'https'],
    includeSubdomains,
  };
}

export function hostPermissionPatterns(target: ParsedHostTarget): string[] {
  const permissionHost = target.includeSubdomains ? `*.${target.host}` : target.host;
  const port = target.port ? `:${target.port}` : '';
  return target.schemes.map((scheme) => `${scheme}://${permissionHost}${port}/*`);
}

export function extractHostPermissionsFromUrlFilter(filter: string): string[] | null {
  const value = filter.trim();
  const domainAnchor = /^\|\|([^/^*|]+)(?:\^|\/|\||$)/.exec(value);
  if (domainAnchor) {
    try {
      const parsed = parseHostTarget(domainAnchor[1]);
      return hostPermissionPatterns({
        ...parsed,
        includeSubdomains: parsed.host !== 'localhost' && !isIpHost(parsed.host),
      });
    } catch {
      return null;
    }
  }
  const urlMatch = /^\|?(https?):\/\/(\[[0-9a-f:.]+\]|[^/:*|^]+)(?::(\d+))?(?:[/*^|]|$)/i.exec(
    value,
  );
  if (!urlMatch) return null;
  const target = `${urlMatch[1]}://${urlMatch[2]}${urlMatch[3] ? `:${urlMatch[3]}` : ''}`;
  try {
    return hostPermissionPatterns(parseHostTarget(target));
  } catch {
    return null;
  }
}

export function permissionPatternsForRule(rule: {
  domains?: string[];
  urlFilter?: string;
  allWebsites?: boolean;
}): string[] {
  if (rule.allWebsites) return ['http://*/*', 'https://*/*'];
  if (rule.domains?.length)
    return [
      ...new Set(rule.domains.flatMap((domain) => hostPermissionPatterns(parseHostTarget(domain)))),
    ];
  if (rule.urlFilter) return extractHostPermissionsFromUrlFilter(rule.urlFilter) ?? [];
  return [];
}
