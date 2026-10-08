import { parseHostTarget } from '../rules/host-targets';
import { validateProfile, validateRule } from '../rules/validators';
import type { HeaderProfile } from '../types/profile';
import type { HeaderRule, RequestMethod, ResourceType } from '../types/rule';
import { newId } from '../utils/ids';
import { isSensitiveHeader } from '../utils/sensitive';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_PROFILES = 100;
const MAX_ITEMS_PER_LIST = 5000;
const MAX_IMPORTED_RULES = 5000;

type JsonRecord = Record<string, unknown>;
type RuleScope = Pick<
  HeaderRule,
  | 'domains'
  | 'urlFilter'
  | 'resourceTypes'
  | 'excludedResourceTypes'
  | 'requestMethods'
  | 'excludedRequestMethods'
>;
type FilterConditions = Pick<
  RuleScope,
  'resourceTypes' | 'excludedResourceTypes' | 'requestMethods' | 'excludedRequestMethods'
>;

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

export interface ModHeaderImportResult {
  profiles: HeaderProfile[];
  inputProfiles: number;
  importedRules: number;
  skippedProfiles: number;
  skippedItems: number;
  sensitiveValues: number;
  warnings: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function profileRecords(value: unknown): JsonRecord[] {
  const candidate = isRecord(value) && Array.isArray(value.profiles) ? value.profiles : value;
  if (Array.isArray(candidate)) {
    if (candidate.length > MAX_PROFILES || !candidate.every(isRecord))
      throw new Error('La lista de perfiles de ModHeader no tiene una estructura válida.');
    return candidate;
  }
  if (
    isRecord(candidate) &&
    (Array.isArray(candidate.headers) || Array.isArray(candidate.respHeaders) || isRecord(candidate.sections))
  )
    return [candidate];
  throw new Error('No se encontró una lista compatible de perfiles ModHeader.');
}

function limitedRecords(value: unknown, label: string): JsonRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_LIST || !value.every(isRecord))
    throw new Error(`${label} no tiene una estructura válida.`);
  return value;
}

function pushWarning(warnings: string[], warning: string): void {
  if (warnings.length < 30 && !warnings.includes(warning)) warnings.push(warning);
}

function cleanName(value: unknown, fallback: string, maximum: number): string {
  return (typeof value === 'string' && value.trim() ? value.trim() : fallback).slice(0, maximum);
}

function safeScope(pattern: string): RuleScope | null {
  const value = pattern.trim();
  if (!value || value.length > 2000 || !/^[\x20-\x7e]+$/.test(value)) return null;

  const schemeMatch = /^(https?|\*):\/\/(\*\.)?(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d+))?(?:[/?#*]|$)/i.exec(
    value,
  );
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const wildcard = Boolean(schemeMatch[2]);
    const host = schemeMatch[3].toLowerCase();
    const port = schemeMatch[4] ? `:${schemeMatch[4]}` : '';
    const target = wildcard
      ? `*.${host}`
      : scheme === '*'
        ? `${host}${port}`
        : `${scheme}://${host}${port}`;
    try {
      parseHostTarget(target);
      return { domains: [target], urlFilter: value };
    } catch {
      return null;
    }
  }

  const anchorMatch = /^\|\|([^/^*|]+)(?:\^|\/|\||$)/.exec(value);
  if (anchorMatch) {
    try {
      parseHostTarget(anchorMatch[1]);
      return { domains: [anchorMatch[1].toLowerCase()], urlFilter: value };
    } catch {
      return null;
    }
  }

  const bareMatch = /^(\*\.)?([a-z0-9.-]+|\[[0-9a-f:.]+\])(?::(\d+))?(?:[/*]|$)/i.exec(value);
  if (!bareMatch) return null;
  const target = `${bareMatch[1] ?? ''}${bareMatch[2]}${bareMatch[3] ? `:${bareMatch[3]}` : ''}`;
  try {
    parseHostTarget(target);
    return { domains: [target.toLowerCase()], urlFilter: value };
  } catch {
    return null;
  }
}

function classicScopesForProfile(
  profile: JsonRecord,
  profileName: string,
  warnings: string[],
): RuleScope[] {
  const filters = limitedRecords(profile.filters, `${profileName}: filters`);
  const scopes: RuleScope[] = [];
  for (const filter of filters) {
    if (filter.enabled === false) continue;
    if (filter.exclude === true || filter.excluded === true) {
      pushWarning(
        warnings,
        `${profileName}: no se importó porque contiene un filtro de exclusión no representable.`,
      );
      return [];
    }
    const type = typeof filter.type === 'string' ? filter.type.toLowerCase() : '';
    const pattern =
      typeof filter.urlPattern === 'string'
        ? filter.urlPattern
        : typeof filter.value === 'string' && (!type || type.includes('url'))
          ? filter.value
          : '';
    if (!pattern || (type && !type.includes('url'))) {
      pushWarning(
        warnings,
        `${profileName}: no se importó porque contiene un filtro que no es de URL.`,
      );
      return [];
    }
    const scope = safeScope(pattern);
    if (!scope) {
      pushWarning(warnings, `${profileName}: no se pudo deducir un host seguro de "${pattern.slice(0, 80)}".`);
      continue;
    }
    if (!scopes.some((item) => JSON.stringify(item) === JSON.stringify(scope))) scopes.push(scope);
  }
  return scopes;
}

interface ModernFilterResult {
  scopes: RuleScope[];
  conditions: FilterConditions;
  unsafe: boolean;
  hasUrlIncludes: boolean;
}

function modernFiltersForProfile(
  profile: JsonRecord,
  profileName: string,
  warnings: string[],
): ModernFilterResult {
  const filters = limitedRecords(profile.filters, `${profileName}: filters`);
  const urlScopes: RuleScope[] = [];
  const resources = { include: [] as ResourceType[], exclude: [] as ResourceType[] };
  const methods = { include: [] as RequestMethod[], exclude: [] as RequestMethod[] };
  let unsafe = false;
  let hasUrlIncludes = false;

  for (const filter of filters) {
    if (filter.enabled === false) continue;
    const type = typeof filter.type === 'string' ? filter.type.toLowerCase() : '';
    const mode = filter.mode === 'exclude' ? 'exclude' : filter.mode === 'include' ? 'include' : '';
    const value = typeof filter.value === 'string' ? filter.value.trim() : '';
    if (!type || !mode || !value) {
      unsafe = true;
      pushWarning(warnings, `${profileName}: contiene un filtro moderno mal formado.`);
      continue;
    }
    if (type === 'tab') {
      unsafe = true;
      pushWarning(
        warnings,
        `${profileName}: su filtro por pestaña no puede trasladarse entre sesiones de Chrome.`,
      );
      continue;
    }
    if (type === 'regex' || ((type === 'url' || type === 'regex') && mode === 'exclude')) {
      unsafe = true;
      pushWarning(
        warnings,
        `${profileName}: contiene un filtro URL regex o de exclusión que no se puede preservar exactamente.`,
      );
      continue;
    }
    if (type === 'url') {
      hasUrlIncludes = true;
      const scope = safeScope(value);
      if (!scope) {
        unsafe = true;
        pushWarning(
          warnings,
          `${profileName}: no se pudo deducir un host seguro de "${value.slice(0, 80)}".`,
        );
      } else if (!urlScopes.some((item) => JSON.stringify(item) === JSON.stringify(scope))) {
        urlScopes.push(scope);
      }
      continue;
    }
    if (type === 'resource') {
      const normalized = value.toLowerCase().replace(/-/g, '_') as ResourceType;
      if (!RESOURCE_TYPES.has(normalized)) {
        unsafe = true;
        pushWarning(warnings, `${profileName}: tipo de recurso no compatible: ${value}.`);
      } else resources[mode].push(normalized);
      continue;
    }
    if (type === 'method') {
      const normalized = value.toLowerCase() as RequestMethod;
      if (!REQUEST_METHODS.has(normalized)) {
        unsafe = true;
        pushWarning(warnings, `${profileName}: método HTTP no compatible: ${value}.`);
      } else methods[mode].push(normalized);
      continue;
    }
    unsafe = true;
    pushWarning(warnings, `${profileName}: tipo de filtro moderno desconocido: ${type}.`);
  }

  const conditions: FilterConditions = {
    ...(resources.include.length
      ? { resourceTypes: [...new Set(resources.include)] }
      : resources.exclude.length
        ? { excludedResourceTypes: [...new Set(resources.exclude)] }
        : {}),
    ...(methods.include.length
      ? { requestMethods: [...new Set(methods.include)] }
      : methods.exclude.length
        ? { excludedRequestMethods: [...new Set(methods.exclude)] }
        : {}),
  };
  return {
    scopes: urlScopes.map((scope) => ({ ...scope, ...conditions })),
    conditions,
    unsafe,
    hasUrlIncludes,
  };
}

function convertHeader(
  item: JsonRecord,
  target: 'request' | 'response',
  profileName: string,
  scope: RuleScope,
): HeaderRule | null {
  if (typeof item.name !== 'string' || !item.name.trim()) return null;
  const header = item.name.trim();
  const operationName =
    typeof item.operation === 'string'
      ? item.operation.toLowerCase()
      : typeof item.type === 'string'
        ? item.type.toLowerCase()
        : 'set';
  const operation = ['remove', 'delete'].includes(operationName)
    ? 'remove'
    : operationName === 'append'
      ? 'append'
      : 'set';
  const id = newId();
  const sensitive = isSensitiveHeader(header);
  const rule: HeaderRule = {
    id,
    name: `${profileName} - ${target} ${header}`.slice(0, 100),
    enabled: false,
    priority: 1,
    tags: ['modheader'],
    kind: 'headers',
    target,
    operation,
    header,
    ...scope,
    ...(operation === 'remove'
      ? {}
      : { value: typeof item.value === 'string' ? item.value : '' }),
    ...(sensitive ? { sensitive: true, valueRef: id } : {}),
  };
  return validateRule(rule).valid ? rule : null;
}

function sectionRules(source: JsonRecord, sectionName: string, profileName: string): JsonRecord[] {
  if (!isRecord(source.sections)) return [];
  const section = source.sections[sectionName];
  if (section === undefined) return [];
  if (!isRecord(section)) throw new Error(`${profileName}: sección ${sectionName} no válida.`);
  return limitedRecords(section.rules, `${profileName}: ${sectionName}.rules`);
}

function modernItemCount(source: JsonRecord, profileName: string): number {
  return ['request', 'response', 'cookie', 'redirect', 'csp'].reduce(
    (total, section) => total + sectionRules(source, section, profileName).length,
    0,
  );
}

function hostWidePattern(pattern: string): boolean {
  const value = pattern.trim();
  return (
    /^(?:https?|\*):\/\/(?:\*\.)?(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d+)?\/?\*?$/i.test(
      value,
    ) || /^\|\|[^/^*|]+\^?$/.test(value)
  );
}

function convertRedirect(
  item: JsonRecord,
  profileName: string,
  filters: ModernFilterResult,
): HeaderRule[] {
  if (typeof item.name !== 'string' || typeof item.value !== 'string') return [];
  const destination = item.value;
  const sourceScope = safeScope(item.name);
  if (!sourceScope) return [];
  let scopes: RuleScope[];
  if (!filters.hasUrlIncludes) scopes = [{ ...sourceScope, ...filters.conditions }];
  else if (filters.scopes.every((scope) => hostWidePattern(scope.urlFilter ?? '')))
    scopes = filters.scopes.map((scope) => ({ ...scope, urlFilter: sourceScope.urlFilter }));
  else return [];

  return scopes
    .map((scope): HeaderRule => ({
      id: newId(),
      name: `${profileName} - redirect ${item.name}`.slice(0, 100),
      enabled: false,
      priority: 1,
      tags: ['modheader'],
      kind: 'redirect',
      redirectUrl: destination,
      ...scope,
    }))
    .filter((rule) => validateRule(rule).valid);
}

function convertModernProfile(
  source: JsonRecord,
  index: number,
  warnings: string[],
): { profile: HeaderProfile | null; skippedItems: number } {
  const name = cleanName(source.name, `ModHeader ${index + 1}`, 80);
  const totalItems = modernItemCount(source, name);
  const filters = modernFiltersForProfile(source, name, warnings);
  if (filters.unsafe) return { profile: null, skippedItems: totalItems };

  const rules: HeaderRule[] = [];
  let skippedItems = 0;
  const add = (rule: HeaderRule | null) => {
    if (rule) rules.push(rule);
    else skippedItems += 1;
  };

  const headerSections = [
    ['request', 'request'],
    ['response', 'response'],
  ] as const;
  for (const [sectionName, target] of headerSections)
    for (const item of sectionRules(source, sectionName, name)) {
      if (!filters.scopes.length) {
        skippedItems += 1;
        continue;
      }
      for (const scope of filters.scopes) add(convertHeader(item, target, name, scope));
    }

  for (const item of sectionRules(source, 'cookie', name)) {
    if (!filters.scopes.length || typeof item.name !== 'string' || typeof item.value !== 'string') {
      skippedItems += 1;
      continue;
    }
    for (const scope of filters.scopes)
      add(
        convertHeader(
          { name: 'Cookie', value: `${item.name.trim()}=${item.value}`, operation: 'append' },
          'request',
          `${name} - cookie ${item.name.trim()}`,
          scope,
        ),
      );
  }

  const cspItems = sectionRules(source, 'csp', name);
  if (cspItems.length) {
    const directives = cspItems
      .filter((item) => typeof item.name === 'string' && typeof item.value === 'string')
      .map((item) => `${String(item.name).trim()} ${String(item.value).trim()}`.trim())
      .filter(Boolean);
    if (!filters.scopes.length || directives.length !== cspItems.length) skippedItems += cspItems.length;
    else
      for (const scope of filters.scopes)
        add(
          convertHeader(
            { name: 'Content-Security-Policy', value: directives.join('; ') },
            'response',
            `${name} - CSP`,
            scope,
          ),
        );
  }

  for (const item of sectionRules(source, 'redirect', name)) {
    const converted = convertRedirect(item, name, filters);
    if (!converted.length) {
      skippedItems += 1;
      pushWarning(
        warnings,
        `${name}: un redirect se omitió porque sus filtros URL no podían combinarse exactamente.`,
      );
    } else rules.push(...converted);
  }

  if (!filters.scopes.length) {
    const scopedItems =
      sectionRules(source, 'request', name).length +
      sectionRules(source, 'response', name).length +
      sectionRules(source, 'cookie', name).length +
      sectionRules(source, 'csp', name).length;
    if (scopedItems)
      pushWarning(
        warnings,
        `${name}: ${scopedItems} modificaciones globales se omitieron por no tener un filtro URL seguro.`,
      );
  }

  if (!rules.length) return { profile: null, skippedItems };
  if (rules.length > MAX_IMPORTED_RULES)
    throw new Error(`El perfil ${name} supera ${MAX_IMPORTED_RULES} reglas convertidas.`);
  const profile: HeaderProfile = { id: newId(), name, enabled: true, rules };
  const validation = validateProfile(profile);
  if (!validation.valid) {
    pushWarning(warnings, `${name}: ${validation.errors[0]}`);
    return { profile: null, skippedItems: skippedItems + rules.length };
  }
  return { profile, skippedItems };
}

function convertProfile(
  source: JsonRecord,
  index: number,
  warnings: string[],
): { profile: HeaderProfile | null; skippedItems: number } {
  if (isRecord(source.sections)) return convertModernProfile(source, index, warnings);
  const name = cleanName(source.title ?? source.name, `ModHeader ${index + 1}`, 80);
  const requestHeaders = limitedRecords(source.headers, `${name}: headers`);
  const responseHeaders = limitedRecords(source.respHeaders, `${name}: respHeaders`);
  const scopes = classicScopesForProfile(source, name, warnings);
  let skippedItems = 0;

  if (!scopes.length) {
    const items = requestHeaders.length + responseHeaders.length;
    if (items)
      pushWarning(
        warnings,
        `${name}: sus ${items} cabeceras se omitieron porque el perfil es global o no tiene un filtro URL seguro.`,
      );
    return { profile: null, skippedItems: items };
  }

  const rules: HeaderRule[] = [];
  for (const [items, target] of [
    [requestHeaders, 'request'],
    [responseHeaders, 'response'],
  ] as const)
    for (const item of items) {
      for (const scope of scopes) {
        const rule = convertHeader(item, target, name, scope);
        if (rule) rules.push(rule);
        else skippedItems += 1;
        if (rules.length > MAX_IMPORTED_RULES)
          throw new Error(`El perfil ${name} supera ${MAX_IMPORTED_RULES} reglas convertidas.`);
      }
    }

  const unsupported = ['urlReplacements', 'cookies', 'alwaysOn'];
  for (const key of unsupported)
    if (Array.isArray(source[key]) && source[key].length) {
      skippedItems += source[key].length;
      pushWarning(warnings, `${name}: ${key} no se importa en este formato compatible.`);
    }

  if (!rules.length) return { profile: null, skippedItems };
  const profile: HeaderProfile = { id: newId(), name, enabled: true, rules };
  const validation = validateProfile(profile);
  if (!validation.valid) {
    pushWarning(warnings, `${name}: ${validation.errors[0]}`);
    return { profile: null, skippedItems: skippedItems + rules.length };
  }
  return { profile, skippedItems };
}

export function importModHeaderProfiles(text: string): ModHeaderImportResult {
  if (!text || text.length > MAX_FILE_SIZE)
    throw new Error('El archivo debe contener entre 1 byte y 5 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo de ModHeader no contiene JSON válido.');
  }

  const input = profileRecords(parsed);
  const profiles: HeaderProfile[] = [];
  const warnings: string[] = [];
  let skippedProfiles = 0;
  let skippedItems = 0;
  let importedRules = 0;
  for (const [index, source] of input.entries()) {
    const converted = convertProfile(source, index, warnings);
    skippedItems += converted.skippedItems;
    if (!converted.profile) {
      skippedProfiles += 1;
      continue;
    }
    importedRules += converted.profile.rules.length;
    if (importedRules > MAX_IMPORTED_RULES)
      throw new Error(`La importación supera ${MAX_IMPORTED_RULES} reglas convertidas.`);
    profiles.push(converted.profile);
  }
  if (!profiles.length)
    throw new Error('No se encontraron perfiles ModHeader compatibles con un filtro URL seguro.');
  return {
    profiles,
    inputProfiles: input.length,
    importedRules,
    skippedProfiles,
    skippedItems,
    sensitiveValues: profiles.flatMap((profile) => profile.rules).filter((rule) => rule.sensitive)
      .length,
    warnings,
  };
}
