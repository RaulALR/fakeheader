import { useMemo, useState } from 'react';
import { ruleToDnr } from '../../rules/converters';
import { parseHostTarget } from '../../rules/host-targets';
import { ruleTitle } from '../../rules/rule-display';
import { environmentValues } from '../../rules/variables';
import type { FakeHeaderSettings } from '../../types/profile';
import {
  REQUEST_METHODS,
  RESOURCE_TYPES,
  type DomainType,
  type HeaderRule,
  type RequestMethod,
  type ResourceType,
} from '../../types/rule';
import { isSensitiveHeader } from '../../utils/sensitive';

function domainMatches(rule: HeaderRule, hostname: string): boolean {
  const excluded = (rule.excludedDomains ?? []).some((value) => {
    const host = parseHostTarget(value).host.replace(/^\[|\]$/g, '');
    return hostname === host || hostname.endsWith('.' + host);
  });
  if (excluded) return false;
  if (rule.allWebsites) return true;
  if (!rule.domains?.length) return true;
  return rule.domains.some((value) => {
    const parsed = parseHostTarget(value);
    const host = parsed.host.replace(/^\[|\]$/g, '');
    return hostname === host || hostname.endsWith('.' + host);
  });
}

function urlFilterMatches(filter: string, url: string, caseSensitive = false): boolean {
  if (!filter) return true;
  const source = caseSensitive ? url : url.toLowerCase();
  const normalizedFilter = caseSensitive ? filter : filter.toLowerCase();
  if (filter.startsWith('||')) {
    const value = normalizedFilter.slice(2).replace(/\^.*$/, '');
    return source.includes(value);
  }
  if (filter.startsWith('|'))
    return source.startsWith(normalizedFilter.slice(1).replace(/\*+$/, ''));
  const escaped = normalizedFilter
    .split('*')
    .map((part) => part.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&'))
    .join('.*');
  try {
    return new RegExp(escaped).test(source);
  } catch {
    return false;
  }
}

function hostListMatches(values: string[] | undefined, hostname: string): boolean {
  return Boolean(
    values?.some((value) => {
      const host = parseHostTarget(value).host.replace(/^\[|\]$/g, '');
      return hostname === host || hostname.endsWith('.' + host);
    }),
  );
}

function ruleMatches(
  rule: HeaderRule,
  url: URL,
  resourceType: ResourceType,
  method: RequestMethod,
  initiatorHostname: string,
  domainType: DomainType,
): boolean {
  if (!rule.enabled) return false;
  if (rule.resourceTypes?.length && !rule.resourceTypes.includes(resourceType)) return false;
  if (rule.excludedResourceTypes?.includes(resourceType)) return false;
  if (rule.requestMethods?.length && !rule.requestMethods.includes(method)) return false;
  if (rule.excludedRequestMethods?.includes(method)) return false;
  if (rule.domainType && rule.domainType !== domainType) return false;
  if (rule.initiatorDomains?.length && !hostListMatches(rule.initiatorDomains, initiatorHostname))
    return false;
  if (hostListMatches(rule.excludedInitiatorDomains, initiatorHostname)) return false;
  if (!domainMatches(rule, url.hostname)) return false;
  if (rule.regexFilter) {
    try {
      if (!new RegExp(rule.regexFilter, rule.isUrlFilterCaseSensitive ? '' : 'i').test(url.href))
        return false;
    } catch {
      return false;
    }
  }
  return (
    !rule.urlFilter || urlFilterMatches(rule.urlFilter, url.href, rule.isUrlFilterCaseSensitive)
  );
}

function previewRule(
  rule: HeaderRule,
  index: number,
  variables: Record<string, string>,
  sensitiveValues: string[],
): string {
  const dnr = ruleToDnr(rule, index + 1, [999], {}, rule.priority, variables);
  return JSON.stringify(
    dnr,
    (key, value: unknown) => {
      if (
        typeof value === 'string' &&
        sensitiveValues.some((secret) => secret && value.includes(secret))
      )
        return sensitiveValues.reduce(
          (output, secret) => (secret ? output.replaceAll(secret, '[REDACTED]') : output),
          value,
        );
      if (key === 'value' && (rule.sensitive || isSensitiveHeader(rule.header ?? '')))
        return '[REDACTED]';
      return value;
    },
    2,
  );
}

export function RuleTester({ settings }: { settings: FakeHeaderSettings }) {
  const [profileId, setProfileId] = useState(settings.profiles[0]?.id ?? '');
  const [environmentId, setEnvironmentId] = useState(settings.environments[0]?.id ?? '');
  const [url, setUrl] = useState('http://localhost:8080/api/users');
  const [resourceType, setResourceType] = useState<ResourceType>('xmlhttprequest');
  const [method, setMethod] = useState<RequestMethod>('get');
  const [initiator, setInitiator] = useState('localhost');
  const [domainType, setDomainType] = useState<DomainType>('firstParty');
  const [executed, setExecuted] = useState(false);
  const profile = settings.profiles.find((item) => item.id === profileId);
  const environment = settings.environments.find((item) => item.id === environmentId);
  const variables = useMemo(() => environmentValues(environment, {}), [environment]);
  const sensitiveValues = useMemo(
    () =>
      environment?.variables
        .filter((variable) => variable.sensitive && variable.value)
        .map((variable) => variable.value!) ?? [],
    [environment],
  );
  let parsedUrl: URL | null = null;
  try {
    const candidate = new URL(url);
    parsedUrl = ['http:', 'https:'].includes(candidate.protocol) ? candidate : null;
  } catch {
    parsedUrl = null;
  }
  const matches =
    executed && parsedUrl
      ? (profile?.rules ?? []).filter((rule) =>
          ruleMatches(rule, parsedUrl!, resourceType, method, initiator, domainType),
        )
      : [];
  return (
    <section className="panel workspace-panel">
      <div className="toolbar">
        <div>
          <h2>Probador de reglas</h2>
          <p className="muted">
            Evalúa localmente una URL. No realiza ninguna petición ni instala reglas temporales.
          </p>
        </div>
        <span className="badge safe-badge">SIN RED</span>
      </div>
      <div className="tester-grid">
        <label className="field">
          Espacio de trabajo
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            {settings.profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Entorno
          <select value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
            <option value="">Sin entorno</option>
            {settings.environments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field tester-url">
          URL hipotética
          <input value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="field">
          Tipo de recurso
          <select
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value as ResourceType)}
          >
            {RESOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Método HTTP
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as RequestMethod)}
          >
            {REQUEST_METHODS.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Dominio iniciador
          <input value={initiator} onChange={(event) => setInitiator(event.target.value)} />
        </label>
        <label className="field">
          Relación con la página
          <select
            value={domainType}
            onChange={(event) => setDomainType(event.target.value as DomainType)}
          >
            <option value="firstParty">Del mismo sitio</option>
            <option value="thirdParty">De terceros</option>
          </select>
        </label>
      </div>
      <button className="button" disabled={!parsedUrl} onClick={() => setExecuted(true)}>
          Probar reglas
      </button>
      {!parsedUrl && <div className="error">Introduce una URL HTTP/HTTPS válida.</div>}
      {executed && parsedUrl && (
        <div className="tester-results">
          <div className="tester-summary">
            <strong>{matches.length}</strong>
            <span>reglas coinciden con esta solicitud</span>
          </div>
          {matches.length ? (
            matches.map((rule, index) => {
              let preview = '';
              let previewError = '';
              try {
                preview = previewRule(rule, index, variables, sensitiveValues);
              } catch (error) {
                previewError = error instanceof Error ? error.message : 'No se pudo compilar.';
              }
              return (
                <article className="tester-result" key={rule.id}>
                  <div>
                    <span className="match-check">VÁLIDA</span>
                    <strong>{ruleTitle(rule)}</strong>
                    <span className="badge">{rule.kind ?? 'headers'}</span>
                  </div>
                  {previewError ? (
                    <div className="error">{previewError}</div>
                  ) : (
                    <details>
                      <summary>Ver DNR censurado</summary>
                      <pre>{preview}</pre>
                    </details>
                  )}
                </article>
              );
            })
          ) : (
            <div className="empty">Ninguna regla activa coincide con esta solicitud.</div>
          )}
        </div>
      )}
    </section>
  );
}
