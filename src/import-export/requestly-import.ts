import { parseHostTarget } from '../rules/host-targets';
import { validateRule } from '../rules/validators';
import type { EnvironmentVariable, UserScriptRule } from '../types/profile';
import type { HeaderRule, QueryParameterChange, RequestMethod, ResourceType } from '../types/rule';
import { newId } from '../utils/ids';
import { isSensitiveHeader } from '../utils/sensitive';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_OBJECTS = 1500;
const MAX_IMPORTED_RULES = 2500;
const MAX_IMPORTED_SCRIPTS = 50;
const RESOURCE_TYPES = new Set<ResourceType>([
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
]);
const REQUEST_METHODS = new Set<RequestMethod>([
  'connect',
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'other',
]);

export interface RequestlyImportResult {
  rules: HeaderRule[];
  scripts: Array<Omit<UserScriptRule, 'profileId'>>;
  payloadVariables: EnvironmentVariable[];
  inputRules: number;
  skippedRules: number;
  skippedPairs: number;
  sensitiveValues: number;
  warnings: string[];
}

type JsonRecord = Record<string, unknown>;
type RuleScope = Pick<
  HeaderRule,
  'domains' | 'urlFilter' | 'regexFilter' | 'resourceTypes' | 'requestMethods' | 'isUrlFilterCaseSensitive'
>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown, maximum: number, label: string): JsonRecord[] {
  if (!Array.isArray(value) || value.length > maximum || !value.every(isRecord))
    throw new Error(`${label} no tiene una estructura válida.`);
  return value;
}

function exportedObjects(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return records(value, MAX_OBJECTS, 'La exportación de Requestly');
  if (!isRecord(value)) throw new Error('La exportación de Requestly debe ser un array JSON.');
  for (const key of ['rules', 'data', 'records'])
    if (Array.isArray(value[key])) return records(value[key], MAX_OBJECTS, 'La exportación');
  throw new Error('No se encontró una lista de reglas en el JSON.');
}

function hostTargetFromSource(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^\^/, '')
    .replace(/\\\//g, '/')
    .replace(/\\\./g, '.');
  const urlHost = /^(https?):\/\/(\*\.)?(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d+))?/i.exec(cleaned);
  if (urlHost) {
    const host = `${urlHost[2] ?? ''}${urlHost[3]}`;
    if (urlHost[2]) return host.toLowerCase();
    return `${urlHost[1].toLowerCase()}://${host.toLowerCase()}${urlHost[4] ? `:${urlHost[4]}` : ''}`;
  }
  const possibleHost = cleaned.replace(/^\*+|\*+$/g, '');
  try {
    parseHostTarget(possibleHost);
    return possibleHost.toLowerCase();
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function filtersFromSource(source: JsonRecord): Pick<RuleScope, 'resourceTypes' | 'requestMethods'> {
  const raw = source.filters;
  const filters = isRecord(raw)
    ? raw
    : Array.isArray(raw)
      ? Object.assign({}, ...raw.filter(isRecord))
      : {};
  const resourceTypes = stringList(filters.resourceType ?? filters.resourceTypes)
    .map((value) => value.toLowerCase().replace(/-/g, '_'))
    .filter((value): value is ResourceType => RESOURCE_TYPES.has(value as ResourceType));
  const requestMethods = stringList(filters.requestMethod ?? filters.requestMethods)
    .map((value) => value.toLowerCase())
    .filter((value): value is RequestMethod => REQUEST_METHODS.has(value as RequestMethod));
  return {
    ...(resourceTypes.length ? { resourceTypes: [...new Set(resourceTypes)] } : {}),
    ...(requestMethods.length ? { requestMethods: [...new Set(requestMethods)] } : {}),
  };
}

function scopeFromSource(value: unknown): RuleScope | null {
  if (!isRecord(value)) return null;
  const key = typeof value.key === 'string' ? value.key.toLowerCase() : '';
  const operator = typeof value.operator === 'string' ? value.operator.toLowerCase() : '';
  const sourceValue = typeof value.value === 'string' ? value.value.trim() : '';
  if (!sourceValue) return null;
  const filters = filtersFromSource(value);

  if (key === 'host') {
    const host = hostTargetFromSource(sourceValue);
    if (!host) return null;
    return { domains: [host], ...filters };
  }
  if (key !== 'url') return null;
  const host = hostTargetFromSource(sourceValue);
  if (!host) return null;
  const domains = [host];
  if (operator === 'matches')
    return { domains, regexFilter: sourceValue, ...filters };
  if (operator === 'equals')
    return {
      domains,
      urlFilter: `|${sourceValue}|`,
      isUrlFilterCaseSensitive: true,
      ...filters,
    };
  if (operator === 'contains' || operator === 'wildcard_matches')
    return { domains, urlFilter: sourceValue, ...filters };
  return null;
}

function ruleName(base: string, suffix: string): string {
  const clean = base.trim() || 'Regla de Requestly importada';
  return `${clean}${suffix ? ` - ${suffix}` : ''}`.slice(0, 100);
}

function baseRule(
  source: JsonRecord,
  scope: RuleScope,
  groupNames: Map<string, string>,
  suffix: string,
): HeaderRule {
  const groupId = typeof source.groupId === 'string' ? source.groupId : '';
  const group = groupNames.get(groupId);
  return {
    id: newId(),
    name: ruleName(typeof source.name === 'string' ? source.name : '', suffix),
    enabled: false,
    priority: 1,
    tags: ['requestly'],
    ...(group ? { group: group.slice(0, 50) } : {}),
    ...scope,
  };
}

function headerModification(
  owner: JsonRecord,
  scope: RuleScope,
  groupNames: Map<string, string>,
  target: 'request' | 'response',
  modification: JsonRecord,
): HeaderRule | null {
  if (typeof modification.header !== 'string' || typeof modification.type !== 'string') return null;
  const operationName = modification.type.toLowerCase();
  const operation = operationName === 'remove' ? 'remove' : operationName === 'add' || operationName === 'modify' ? 'set' : null;
  if (!operation) return null;
  const id = newId();
  const sensitive = isSensitiveHeader(modification.header);
  return {
    ...baseRule(
      owner,
      scope,
      groupNames,
      `${target === 'request' ? 'solicitud' : 'respuesta'} ${modification.header}`,
    ),
    id,
    kind: 'headers',
    target,
    operation,
    header: modification.header,
    ...(operation === 'remove'
      ? {}
      : typeof modification.value === 'string'
        ? { value: modification.value }
        : { value: '' }),
    ...(sensitive ? { sensitive: true, valueRef: id } : {}),
  };
}

function headerRules(
  owner: JsonRecord,
  pair: JsonRecord,
  scope: RuleScope,
  groups: Map<string, string>,
): HeaderRule[] {
  const modifications = pair.modifications;
  const output: HeaderRule[] = [];
  const append = (target: 'request' | 'response', value: unknown) => {
    const items = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
    for (const item of items)
      if (isRecord(item)) {
        const converted = headerModification(owner, scope, groups, target, item);
        if (converted) output.push(converted);
      }
  };
  const appendContainer = (container: JsonRecord) => {
    append('request', container.Request ?? container.request);
    append('response', container.Response ?? container.response);
  };

  if (isRecord(modifications)) appendContainer(modifications);
  else if (Array.isArray(modifications))
    for (const entry of modifications) {
      if (!isRecord(entry)) continue;
      if (
        entry.Request !== undefined ||
        entry.request !== undefined ||
        entry.Response !== undefined ||
        entry.response !== undefined
      ) {
        appendContainer(entry);
        continue;
      }
      const targetName = String(entry.target ?? entry.headerType ?? entry.requestOrResponse).toLowerCase();
      if (['request', 'requestheader', 'request_header'].includes(targetName))
        append('request', entry);
      else if (['response', 'responseheader', 'response_header'].includes(targetName))
        append('response', entry);
    }
  return output;
}

function queryRule(
  owner: JsonRecord,
  pair: JsonRecord,
  scope: RuleScope,
  groups: Map<string, string>,
): HeaderRule | null {
  if (!Array.isArray(pair.modifications)) return null;
  const queryParams: QueryParameterChange[] = [];
  for (const item of pair.modifications) {
    if (!isRecord(item) || typeof item.param !== 'string' || typeof item.type !== 'string') continue;
    const type = item.type.toLowerCase();
    if (type === 'remove all') continue;
    if (type === 'remove')
      queryParams.push({ id: newId(), operation: 'remove', key: item.param });
    else if ((type === 'add' || type === 'modify') && typeof item.value === 'string')
      queryParams.push({ id: newId(), operation: 'set', key: item.param, value: item.value });
  }
  if (!queryParams.length) return null;
  return { ...baseRule(owner, scope, groups, 'query'), kind: 'query', queryParams };
}

function convertPair(
  owner: JsonRecord,
  pair: JsonRecord,
  groupNames: Map<string, string>,
): HeaderRule[] {
  const ruleType = typeof owner.ruleType === 'string' ? owner.ruleType.toLowerCase() : '';
  const scope = scopeFromSource(pair.source);
  if (!scope) return [];
  if (ruleType === 'headers') return headerRules(owner, pair, scope, groupNames);
  if (ruleType === 'queryparam') {
    const rule = queryRule(owner, pair, scope, groupNames);
    return rule ? [rule] : [];
  }
  if (ruleType === 'cancel')
    return [{ ...baseRule(owner, scope, groupNames, 'block'), kind: 'block' }];
  if (ruleType === 'useragent' && typeof pair.userAgent === 'string')
    return [
      {
        ...baseRule(owner, scope, groupNames, 'User-Agent'),
        kind: 'headers',
        target: 'request',
        operation: 'set',
        header: 'User-Agent',
        value: pair.userAgent,
      },
    ];
  if (ruleType === 'redirect' && typeof pair.destination === 'string')
    return [
      {
        ...baseRule(owner, scope, groupNames, 'redirección'),
        kind: 'redirect',
        redirectUrl: pair.destination,
      },
    ];
  if (
    ruleType === 'replace' &&
    isRecord(pair.source) &&
    String(pair.source.operator).toLowerCase() === 'equals' &&
    typeof pair.source.value === 'string' &&
    typeof pair.from === 'string' &&
    typeof pair.to === 'string' &&
    pair.source.value.includes(pair.from)
  )
    return [
      {
        ...baseRule(owner, scope, groupNames, 'reemplazo'),
        kind: 'redirect',
        redirectUrl: pair.source.value.replace(pair.from, pair.to),
      },
    ];
  return [];
}

interface FetchMatcher {
  key: 'url' | 'host' | 'path';
  operator: 'equals' | 'contains' | 'wildcard_matches';
  value: string;
}

function fetchMatcher(value: unknown): FetchMatcher | null {
  if (!isRecord(value)) return null;
  const key = typeof value.key === 'string' ? value.key.toLowerCase() : '';
  const operator = typeof value.operator === 'string' ? value.operator.toLowerCase() : '';
  const sourceValue = typeof value.value === 'string' ? value.value.trim() : '';
  if (
    !['url', 'host', 'path'].includes(key) ||
    !['equals', 'contains', 'wildcard_matches'].includes(operator) ||
    !sourceValue ||
    sourceValue.length > 2000
  )
    return null;
  return { key, operator, value: sourceValue } as FetchMatcher;
}

function matcherRuntime(matcher: FetchMatcher): string {
  return `const source = ${JSON.stringify(matcher)};
  const regexCharacters = new Set(['.', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\\\']);
  const wildcardMatches = (candidate, pattern) => {
    const escaped = [...pattern]
      .map((character) => character === '*' ? '.*' : regexCharacters.has(character) ? '\\\\' + character : character)
      .join('');
    return new RegExp('^' + escaped + '$').test(candidate);
  };
  const matches = (url) => {
    let candidate = url.href;
    if (source.key === 'host') candidate = url.host;
    else if (source.key === 'path') candidate = url.pathname + url.search;
    if (source.operator === 'equals') return candidate === source.value;
    if (source.operator === 'contains') return candidate.includes(source.value);
    return wildcardMatches(candidate, source.value);
  };`;
}

function scriptName(owner: JsonRecord, operation: string): string {
  return `Requestly ${operation} - ${typeof owner.name === 'string' ? owner.name : 'Regla importada'}`.slice(
    0,
    80,
  );
}

function delayScript(
  owner: JsonRecord,
  pair: JsonRecord,
): Omit<UserScriptRule, 'profileId'> | null {
  if (!Number.isInteger(pair.delay) || (pair.delay as number) < 0 || (pair.delay as number) > 600_000)
    return null;
  const matcher = fetchMatcher(pair.source);
  if (!matcher) return null;

  const id = newId();
  const delay = pair.delay as number;
  return {
    id,
    name: scriptName(owner, 'delay'),
    enabled: false,
    kind: 'javascript',
    world: 'MAIN',
    injectImmediately: true,
    execution: 'manual',
    matches: [],
    excludeMatches: [],
    code: `(() => {
  const installationKey = Symbol.for(${JSON.stringify(`fakeheader.requestlyDelay.${id}`)});
  if (window[installationKey]) return;

  const originalFetch = window.fetch.bind(window);
  ${matcherRuntime(matcher)}
  const delayMilliseconds = ${delay};

  window.fetch = async (input, init) => {
    const requestUrl = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      location.href
    );
    if (matches(requestUrl)) {
      await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    }
    return originalFetch(input, init);
  };

  window[installationKey] = {
    restore() {
      window.fetch = originalFetch;
      delete window[installationKey];
    }
  };
})();`,
  };
}

interface StaticBodyConversion {
  script: Omit<UserScriptRule, 'profileId'>;
  variable: EnvironmentVariable;
}

function staticBodyScript(
  owner: JsonRecord,
  pair: JsonRecord,
  target: 'request' | 'response',
): StaticBodyConversion | null {
  const definition = target === 'response' && isRecord(pair.response) ? pair.response : pair;
  if (
    String(definition.type).toLowerCase() !== 'static' ||
    typeof definition.value !== 'string' ||
    definition.value.length > 64 * 1024
  )
    return null;
  const matcher = fetchMatcher(pair.source);
  if (!matcher) return null;
  const serveWithoutRequest = target === 'response' && definition.serveWithoutRequest === true;
  const rawStatus = definition.statusCode ?? definition.status;
  const statusCode =
    typeof rawStatus === 'number' && Number.isInteger(rawStatus) && rawStatus >= 200 && rawStatus <= 599
      ? rawStatus
      : undefined;
  const contentType = (() => {
    try {
      JSON.parse(definition.value as string);
      return 'application/json; charset=utf-8';
    } catch {
      return 'text/plain; charset=utf-8';
    }
  })();
  const id = newId();
  const variableId = newId();
  const variableKey = `REQUESTLY_${target.toUpperCase()}_BODY_${variableId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24).toUpperCase()}`;
  const variable: EnvironmentVariable = {
    id: variableId,
    key: variableKey,
    value: definition.value,
    sensitive: true,
    valueRef: variableId,
  };
  const requestHandler = `const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!matches(requestUrl) || !init || method === 'GET' || method === 'HEAD') {
      return originalFetch(input, init);
    }
    return originalFetch(input, { ...init, body: staticBody });`;
  const responseHandler = serveWithoutRequest
    ? `if (!matches(requestUrl)) return originalFetch(input, init);
    return new Response(staticBody, {
      status: ${statusCode ?? 200},
      headers: { 'Content-Type': ${JSON.stringify(contentType)} }
    });`
    : `const response = await originalFetch(input, init);
    if (!matches(requestUrl) || response.type === 'opaque' || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(staticBody, {
      status: ${statusCode ?? 'response.status'},
      statusText: ${statusCode ? "''" : 'response.statusText'},
      headers
    });`;
  return {
    variable,
    script: {
      id,
      name: scriptName(owner, `${target === 'request' ? 'solicitud' : 'respuesta'} - cuerpo`),
      enabled: false,
      kind: 'javascript',
      world: 'MAIN',
      injectImmediately: true,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `(() => {
  const installationKey = Symbol.for(${JSON.stringify(`fakeheader.requestlyBody.${id}`)});
  if (window[installationKey]) return;

  const originalFetch = window.fetch.bind(window);
  ${matcherRuntime(matcher)}
  const staticBody = {{JSON:${variableKey}}};

  window.fetch = async (input, init) => {
    const requestUrl = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      location.href
    );
    ${target === 'request' ? requestHandler : responseHandler}
  };

  window[installationKey] = {
    restore() {
      window.fetch = originalFetch;
      delete window[installationKey];
    }
  };
})();`,
    },
  };
}

function pushWarning(warnings: string[], value: string): void {
  if (warnings.length < 20 && !warnings.includes(value)) warnings.push(value);
}

export function importRequestlyRules(text: string): RequestlyImportResult {
  if (!text || text.length > MAX_FILE_SIZE)
    throw new Error('El archivo debe contener entre 1 byte y 5 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo de Requestly no contiene JSON válido.');
  }
  const objects = exportedObjects(parsed);
  const groupNames = new Map<string, string>();
  for (const item of objects)
    if (
      item.objectType === 'group' &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      item.name.trim()
    )
      groupNames.set(item.id, item.name.trim());

  const output: HeaderRule[] = [];
  const scripts: Array<Omit<UserScriptRule, 'profileId'>> = [];
  const payloadVariables: EnvironmentVariable[] = [];
  const warnings: string[] = [];
  let inputRules = 0;
  let skippedRules = 0;
  let skippedPairs = 0;
  for (const item of objects) {
    if (item.objectType === 'group') continue;
    if (item.objectType !== 'rule' && typeof item.ruleType !== 'string') continue;
    inputRules += 1;
    if (!Array.isArray(item.pairs) || item.pairs.length > 100 || !item.pairs.every(isRecord)) {
      skippedRules += 1;
      pushWarning(warnings, `${String(item.name ?? 'Regla')}: estructura de pairs no válida.`);
      continue;
    }
    const before = output.length;
    const scriptsBefore = scripts.length;
    for (const pair of item.pairs as JsonRecord[]) {
      if (String(item.ruleType).toLowerCase() === 'delay') {
        const script = delayScript(item, pair);
        if (!script) skippedPairs += 1;
        else {
          if (scripts.length >= MAX_IMPORTED_SCRIPTS)
            throw new Error(`La importación supera ${MAX_IMPORTED_SCRIPTS} scripts convertidos.`);
          scripts.push(script);
        }
        continue;
      }
      if (['request', 'response'].includes(String(item.ruleType).toLowerCase())) {
        const conversion = staticBodyScript(
          item,
          pair,
          String(item.ruleType).toLowerCase() as 'request' | 'response',
        );
        if (!conversion) skippedPairs += 1;
        else {
          if (scripts.length >= MAX_IMPORTED_SCRIPTS)
            throw new Error(`La importación supera ${MAX_IMPORTED_SCRIPTS} scripts convertidos.`);
          scripts.push(conversion.script);
          payloadVariables.push(conversion.variable);
        }
        continue;
      }
      const converted = convertPair(item, pair, groupNames);
      if (!converted.length) skippedPairs += 1;
      for (const rule of converted) {
        const validation = validateRule(rule);
        if (!validation.valid) {
          skippedPairs += 1;
          pushWarning(warnings, `${String(item.name ?? 'Regla')}: ${validation.errors[0]}`);
          continue;
        }
        if (output.length >= MAX_IMPORTED_RULES)
          throw new Error(`La importación supera ${MAX_IMPORTED_RULES} reglas convertidas.`);
        output.push(rule);
      }
    }
    if (output.length === before && scripts.length === scriptsBefore) {
      skippedRules += 1;
      pushWarning(
        warnings,
        `${String(item.name ?? 'Regla')}: tipo o condición no representable de forma segura.`,
      );
    }
  }
  if (!output.length && !scripts.length)
    throw new Error('No se encontraron reglas Requestly compatibles y seguras.');
  return {
    rules: output,
    scripts,
    payloadVariables,
    inputRules,
    skippedRules,
    skippedPairs,
    sensitiveValues: output.filter((rule) => rule.sensitive).length,
    warnings,
  };
}
