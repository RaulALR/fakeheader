import { MAX_HISTORY_SNAPSHOTS, MAX_SCRIPT_ACTIVITY, SCHEMA_VERSION } from '../config';
import {
  validateEnvironment,
  validateId,
  validateProfile,
  validateRule,
} from '../rules/validators';
import type {
  EnvironmentVariable,
  AutoActivation,
  FakeHeaderSettings,
  HeaderProfile,
  RuleEnvironment,
  SavedRuleTemplate,
  UserScriptRule,
} from '../types/profile';
import type { SettingsHistory, SettingsSnapshot } from '../types/history';
import {
  DOMAIN_TYPES,
  QUERY_OPERATIONS,
  REQUEST_METHODS,
  RESOURCE_TYPES,
  RULE_KINDS,
  RULE_OPERATIONS,
  RULE_TARGETS,
  type DomainType,
  type HeaderRule,
  type QueryParameterChange,
  type RequestMethod,
  type ResourceType,
  type RuleKind,
  type RuleOperation,
  type RuleTarget,
} from '../types/rule';
import type { ActiveTabStateMap, SessionSecrets } from '../types/session';
import type { ScriptActivityEntry } from '../types/script-activity';
import { isSensitiveHeader } from '../utils/sensitive';
import { isValidScriptMatchPattern } from '../rules/script-matches';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error(`${field} debe ser una lista de strings.`);
  return value;
}
function isHttpOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}
function parseQueryChange(value: unknown): QueryParameterChange {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.operation !== 'string' ||
    !QUERY_OPERATIONS.includes(value.operation as QueryParameterChange['operation']) ||
    typeof value.key !== 'string'
  )
    throw new Error('Cambio de parámetro de consulta inválido.');
  return {
    id: value.id,
    operation: value.operation as QueryParameterChange['operation'],
    key: value.key,
    ...(typeof value.value === 'string' ? { value: value.value } : {}),
  };
}

export function parseRule(value: unknown): HeaderRule {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.enabled !== 'boolean')
    throw new Error('Una regla contiene campos obligatorios inválidos.');
  if (
    value.kind !== undefined &&
    (typeof value.kind !== 'string' || !RULE_KINDS.includes(value.kind as RuleKind))
  )
    throw new Error('Tipo de regla inválido.');
  const kind: RuleKind = value.kind === undefined ? 'headers' : (value.kind as RuleKind);
  const resourceTypes = stringArray(value.resourceTypes, 'resourceTypes');
  if (resourceTypes?.some((type) => !RESOURCE_TYPES.includes(type as ResourceType)))
    throw new Error('Tipo de recurso inválido.');
  const excludedResourceTypes = stringArray(value.excludedResourceTypes, 'excludedResourceTypes');
  if (excludedResourceTypes?.some((type) => !RESOURCE_TYPES.includes(type as ResourceType)))
    throw new Error('Tipo de recurso excluido inválido.');
  const requestMethods = stringArray(value.requestMethods, 'requestMethods');
  if (requestMethods?.some((method) => !REQUEST_METHODS.includes(method as RequestMethod)))
    throw new Error('Método HTTP inválido.');
  const excludedRequestMethods = stringArray(
    value.excludedRequestMethods,
    'excludedRequestMethods',
  );
  if (excludedRequestMethods?.some((method) => !REQUEST_METHODS.includes(method as RequestMethod)))
    throw new Error('Método HTTP excluido inválido.');
  if (
    value.domainType !== undefined &&
    (typeof value.domainType !== 'string' || !DOMAIN_TYPES.includes(value.domainType as DomainType))
  )
    throw new Error('Relación first-party/third-party inválida.');
  const target = typeof value.target === 'string' ? value.target : 'request';
  const operation = typeof value.operation === 'string' ? value.operation : 'set';
  const header = typeof value.header === 'string' ? value.header : '';
  if (
    kind === 'headers' &&
    (!RULE_TARGETS.includes(target as RuleTarget) ||
      !RULE_OPERATIONS.includes(operation as RuleOperation))
  )
    throw new Error('Destino u operación inválidos.');
  const sensitive = kind === 'headers' && (isSensitiveHeader(header) || value.sensitive === true);
  const importedValue = typeof value.value === 'string' ? value.value : undefined;
  const redactedSecret = sensitive && importedValue === '[REDACTED]';
  const valueRef =
    sensitive && typeof value.valueRef === 'string' && !validateId(value.valueRef)
      ? value.valueRef
      : value.id;
  const queryParams = Array.isArray(value.queryParams)
    ? value.queryParams.map(parseQueryChange)
    : undefined;
  const rule: HeaderRule = {
    id: value.id,
    enabled: redactedSecret ? false : value.enabled,
    kind,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.group === 'string' ? { group: value.group } : {}),
    ...(stringArray(value.tags, 'tags') ? { tags: stringArray(value.tags, 'tags') } : {}),
    ...(value.pinned === true ? { pinned: true } : {}),
    ...(Number.isInteger(value.priority) ? { priority: value.priority as number } : {}),
    ...(kind === 'headers'
      ? {
          target: target as RuleTarget,
          operation: operation as RuleOperation,
          header,
        }
      : {}),
    ...(importedValue !== undefined && !redactedSecret ? { value: importedValue } : {}),
    ...(sensitive ? { sensitive: true, valueRef } : {}),
    ...(typeof value.urlFilter === 'string' ? { urlFilter: value.urlFilter } : {}),
    ...(typeof value.regexFilter === 'string' ? { regexFilter: value.regexFilter } : {}),
    ...(typeof value.regexSubstitution === 'string'
      ? { regexSubstitution: value.regexSubstitution }
      : {}),
    ...(typeof value.redirectUrl === 'string' ? { redirectUrl: value.redirectUrl } : {}),
    ...(stringArray(value.domains, 'domains')
      ? { domains: stringArray(value.domains, 'domains') }
      : {}),
    ...(stringArray(value.excludedDomains, 'excludedDomains')
      ? { excludedDomains: stringArray(value.excludedDomains, 'excludedDomains') }
      : {}),
    ...(resourceTypes ? { resourceTypes: resourceTypes as ResourceType[] } : {}),
    ...(excludedResourceTypes
      ? { excludedResourceTypes: excludedResourceTypes as ResourceType[] }
      : {}),
    ...(requestMethods ? { requestMethods: requestMethods as RequestMethod[] } : {}),
    ...(excludedRequestMethods
      ? { excludedRequestMethods: excludedRequestMethods as RequestMethod[] }
      : {}),
    ...(typeof value.domainType === 'string' ? { domainType: value.domainType as DomainType } : {}),
    ...(stringArray(value.initiatorDomains, 'initiatorDomains')
      ? { initiatorDomains: stringArray(value.initiatorDomains, 'initiatorDomains') }
      : {}),
    ...(stringArray(value.excludedInitiatorDomains, 'excludedInitiatorDomains')
      ? {
          excludedInitiatorDomains: stringArray(
            value.excludedInitiatorDomains,
            'excludedInitiatorDomains',
          ),
        }
      : {}),
    ...(value.isUrlFilterCaseSensitive === true ? { isUrlFilterCaseSensitive: true } : {}),
    ...(value.allWebsites === true ? { allWebsites: true } : {}),
    ...(queryParams ? { queryParams } : {}),
  };
  return rule;
}

function validTemplateText(value: string, maxLength: number): boolean {
  return (
    Boolean(value.trim()) &&
    value === value.trim() &&
    value.length <= maxLength &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function parseSavedTemplate(value: unknown): SavedRuleTemplate {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !validTemplateText(value.name, 80) ||
    (value.description !== undefined &&
      (typeof value.description !== 'string' || value.description.length > 240)) ||
    !('rule' in value)
  )
    throw new Error('Plantilla personalizada inválida.');
  const parsedRule = parseRule(value.rule);
  const sensitive = parsedRule.sensitive || isSensitiveHeader(parsedRule.header ?? '');
  const { value: _value, ...withoutValue } = parsedRule;
  const rule: HeaderRule = {
    ...(sensitive ? withoutValue : parsedRule),
    enabled: false,
    pinned: false,
    ...(sensitive ? { sensitive: true, valueRef: parsedRule.valueRef ?? parsedRule.id } : {}),
  };
  const validation = validateRule(rule);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return {
    id: value.id,
    name: value.name,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    rule,
  };
}

export function parseProfile(value: unknown): HeaderProfile {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.rules)
  )
    throw new Error('Perfil inválido.');
  const profile: HeaderProfile = {
    id: value.id,
    name: value.name,
    enabled: value.enabled,
    rules: value.rules.map(parseRule),
  };
  const validation = validateProfile(profile);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return profile;
}

function parseVariable(value: unknown): EnvironmentVariable {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.key !== 'string')
    throw new Error('Variable inválida.');
  const sensitive = value.sensitive === true;
  const importedValue = typeof value.value === 'string' ? value.value : undefined;
  const redacted = sensitive && importedValue === '[REDACTED]';
  return {
    id: value.id,
    key: value.key,
    ...(importedValue !== undefined && !redacted ? { value: importedValue } : {}),
    ...(sensitive
      ? {
          sensitive: true,
          valueRef:
            typeof value.valueRef === 'string' && !validateId(value.valueRef)
              ? value.valueRef
              : value.id,
        }
      : {}),
  };
}

function parseEnvironment(value: unknown): RuleEnvironment {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.variables)
  )
    throw new Error('Entorno inválido.');
  const environment: RuleEnvironment = {
    id: value.id,
    name: value.name,
    variables: value.variables.map(parseVariable),
  };
  const validation = validateEnvironment(environment);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return environment;
}

function parseAutoActivation(value: unknown): AutoActivation {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    validateId(value.id) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.origin !== 'string' ||
    typeof value.profileId !== 'string' ||
    validateId(value.profileId)
  )
    throw new Error('Activación automática inválida.');
  if (!isHttpOrigin(value.origin))
    throw new Error('La activación automática requiere un origen HTTP(S) exacto.');
  if (
    value.environmentId !== undefined &&
    (typeof value.environmentId !== 'string' || validateId(value.environmentId))
  )
    throw new Error('El entorno de activación automática no es válido.');
  if (
    value.durationMinutes !== undefined &&
    (!Number.isInteger(value.durationMinutes) ||
      (value.durationMinutes as number) < 0 ||
      (value.durationMinutes as number) > 1440)
  )
    throw new Error('La duración automática debe estar entre 0 y 1440 minutos.');
  return {
    id: value.id,
    enabled: value.enabled,
    origin: value.origin,
    profileId: value.profileId,
    ...(typeof value.environmentId === 'string' ? { environmentId: value.environmentId } : {}),
    ...(typeof value.durationMinutes === 'number'
      ? { durationMinutes: value.durationMinutes }
      : {}),
  };
}

function parseUserScript(value: unknown): UserScriptRule {
  const matches = isRecord(value) ? stringArray(value.matches, 'matches') : undefined;
  const excludeMatches = isRecord(value)
    ? stringArray(value.excludeMatches, 'excludeMatches')
    : undefined;
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    validateId(value.id) ||
    typeof value.profileId !== 'string' ||
    validateId(value.profileId) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 80 ||
    typeof value.enabled !== 'boolean' ||
    (value.kind !== undefined && !['javascript', 'css'].includes(String(value.kind))) ||
    typeof value.code !== 'string' ||
    !value.code.trim() ||
    value.code.length > 100_000 ||
    !['USER_SCRIPT', 'MAIN'].includes(String(value.world)) ||
    typeof value.injectImmediately !== 'boolean' ||
    (value.execution !== undefined &&
      !['manual', 'navigation'].includes(String(value.execution))) ||
    (matches?.length ?? 0) > 20 ||
    (excludeMatches?.length ?? 0) > 20 ||
    matches?.some((pattern) => !isValidScriptMatchPattern(pattern)) ||
    excludeMatches?.some((pattern) => !isValidScriptMatchPattern(pattern)) ||
    (value.execution === 'navigation' && !matches?.length)
  )
    throw new Error('Script de usuario inválido.');
  return {
    id: value.id,
    profileId: value.profileId,
    name: value.name.trim(),
    enabled: value.enabled,
    kind: value.kind === 'css' ? 'css' : 'javascript',
    code: value.code,
    world: value.world as UserScriptRule['world'],
    injectImmediately: value.injectImmediately,
    execution: value.execution === 'navigation' ? 'navigation' : 'manual',
    matches: matches ?? [],
    excludeMatches: excludeMatches ?? [],
  };
}

export function parseSettings(value: unknown): FakeHeaderSettings {
  if (
    !isRecord(value) ||
    ![2, 3, 4, 5, 6, 7, SCHEMA_VERSION].includes(value.schemaVersion as number) ||
    !Array.isArray(value.profiles)
  )
    throw new Error('La configuración no tiene la estructura o versión esperada.');
  if (!value.profiles.length || value.profiles.length > 100)
    throw new Error('Debe haber entre 1 y 100 perfiles.');
  const profiles = value.profiles.map(parseProfile);
  const environments =
    value.schemaVersion === 2
      ? []
      : Array.isArray(value.environments)
        ? value.environments.map(parseEnvironment)
        : [];
  if (profiles.reduce((sum, profile) => sum + profile.rules.length, 0) > 5000)
    throw new Error('La configuración supera 5000 reglas.');
  if (environments.length > 100) throw new Error('La configuración supera 100 entornos.');
  const templates =
    [5, 6, SCHEMA_VERSION].includes(value.schemaVersion as number) && Array.isArray(value.templates)
      ? value.templates.map(parseSavedTemplate)
      : [];
  if (templates.length > 100) throw new Error('La configuración supera 100 plantillas.');
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new Error('Hay IDs duplicados.');
    ids.add(profile.id);
    for (const rule of profile.rules) {
      if (ids.has(rule.id)) throw new Error('Los IDs de regla deben ser únicos globalmente.');
      ids.add(rule.id);
    }
  }
  for (const environment of environments) {
    if (ids.has(environment.id)) throw new Error('Hay IDs duplicados.');
    ids.add(environment.id);
    for (const variable of environment.variables) {
      if (ids.has(variable.id)) throw new Error('Los IDs de variable deben ser únicos.');
      ids.add(variable.id);
    }
  }
  for (const template of templates) {
    if (ids.has(template.id) || ids.has(template.rule.id))
      throw new Error('Hay IDs de plantilla duplicados.');
    ids.add(template.id);
    ids.add(template.rule.id);
  }
  const autoActivations =
    (value.schemaVersion === 6 || value.schemaVersion === SCHEMA_VERSION) &&
    Array.isArray(value.autoActivations)
      ? value.autoActivations.map(parseAutoActivation)
      : [];
  if (autoActivations.length > 100)
    throw new Error('La configuración supera 100 activaciones automáticas.');
  const activationIds = new Set<string>();
  const activationOrigins = new Set<string>();
  for (const activation of autoActivations) {
    if (activationIds.has(activation.id)) throw new Error('Hay IDs de activación duplicados.');
    if (activationOrigins.has(activation.origin))
      throw new Error('Cada origen sólo puede tener una activación automática.');
    if (!profiles.some((profile) => profile.id === activation.profileId))
      throw new Error('Una activación automática referencia un perfil inexistente.');
    if (
      activation.environmentId &&
      !environments.some((environment) => environment.id === activation.environmentId)
    )
      throw new Error('Una activación automática referencia un entorno inexistente.');
    activationIds.add(activation.id);
    activationOrigins.add(activation.origin);
  }
  const scripts =
    (value.schemaVersion === 7 || value.schemaVersion === SCHEMA_VERSION) &&
    Array.isArray(value.scripts)
      ? value.scripts.map(parseUserScript)
      : [];
  if (scripts.length > 100) throw new Error('La configuración supera 100 scripts.');
  for (const script of scripts) {
    if (ids.has(script.id)) throw new Error('Hay IDs de script duplicados.');
    if (!profiles.some((profile) => profile.id === script.profileId))
      throw new Error('Un script referencia un perfil inexistente.');
    ids.add(script.id);
  }
  const safety =
    isRecord(value.safety) && typeof value.safety.autoDisableOnNavigation === 'boolean'
      ? { autoDisableOnNavigation: value.safety.autoDisableOnNavigation }
      : { autoDisableOnNavigation: false };
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles,
    environments,
    templates,
    autoActivations,
    scripts,
    safety,
  };
}

function parseScriptActivityEntry(value: unknown): ScriptActivityEntry {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    validateId(value.id) ||
    !Number.isFinite(value.createdAt) ||
    !Number.isInteger(value.tabId) ||
    (value.tabId as number) < 0 ||
    typeof value.profileId !== 'string' ||
    validateId(value.profileId) ||
    !Array.isArray(value.scriptIds) ||
    value.scriptIds.length > 100 ||
    !value.scriptIds.every((id) => typeof id === 'string' && !validateId(id)) ||
    !['manual', 'navigation', 'remove-css'].includes(String(value.trigger)) ||
    typeof value.ok !== 'boolean' ||
    !Number.isInteger(value.executed) ||
    (value.executed as number) < 0 ||
    !Number.isInteger(value.removed) ||
    (value.removed as number) < 0 ||
    (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 240))
  )
    throw new Error('Actividad de scripts inválida.');
  return {
    id: value.id,
    createdAt: value.createdAt as number,
    tabId: value.tabId as number,
    profileId: value.profileId,
    scriptIds: [...value.scriptIds] as string[],
    trigger: value.trigger as ScriptActivityEntry['trigger'],
    ok: value.ok,
    executed: value.executed as number,
    removed: value.removed as number,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

export function parseScriptActivity(value: unknown): ScriptActivityEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SCRIPT_ACTIVITY)
    throw new Error('Historial de scripts inválido.');
  return value.map(parseScriptActivityEntry);
}

function parseSnapshot(value: unknown): SettingsSnapshot {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    validateId(value.id) ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt <= 0 ||
    typeof value.label !== 'string' ||
    !value.label.trim() ||
    value.label.length > 100
  )
    throw new Error('Instantánea inválida.');
  const parsed = parseSettings(value.settings);
  const settings: FakeHeaderSettings = {
    ...parsed,
    profiles: parsed.profiles.map((profile) => ({
      ...profile,
      rules: profile.rules.map((rule) => {
        if (!(rule.sensitive || isSensitiveHeader(rule.header ?? ''))) return rule;
        const { value: _value, ...withoutValue } = rule;
        return { ...withoutValue, sensitive: true, valueRef: rule.valueRef ?? rule.id };
      }),
    })),
    environments: parsed.environments.map((environment) => ({
      ...environment,
      variables: environment.variables.map((variable) => {
        if (!variable.sensitive) return variable;
        const { value: _value, ...withoutValue } = variable;
        return { ...withoutValue, sensitive: true, valueRef: variable.valueRef ?? variable.id };
      }),
    })),
  };
  return {
    id: value.id,
    createdAt: value.createdAt,
    label: value.label,
    settings,
  };
}

export function parseHistory(value: unknown): SettingsHistory {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HISTORY_SNAPSHOTS)
    throw new Error('Historial inválido.');
  const history = value.map(parseSnapshot);
  if (new Set(history.map((item) => item.id)).size !== history.length)
    throw new Error('El historial contiene IDs duplicados.');
  return history.sort((first, second) => second.createdAt - first.createdAt);
}

export function parseActiveTabs(value: unknown): ActiveTabStateMap {
  if (!isRecord(value)) return {};
  const output: ActiveTabStateMap = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !isRecord(entry) ||
      !Number.isInteger(entry.tabId) ||
      (entry.tabId as number) < 0 ||
      typeof entry.profileId !== 'string' ||
      validateId(entry.profileId) ||
      (entry.environmentId !== undefined &&
        (typeof entry.environmentId !== 'string' || validateId(entry.environmentId))) ||
      (entry.expiresAt !== undefined &&
        (typeof entry.expiresAt !== 'number' ||
          !Number.isFinite(entry.expiresAt) ||
          entry.expiresAt <= 0)) ||
      (entry.boundOrigin !== undefined && !isHttpOrigin(entry.boundOrigin)) ||
      (entry.autoActivationId !== undefined &&
        (typeof entry.autoActivationId !== 'string' || validateId(entry.autoActivationId))) ||
      String(entry.tabId) !== key
    )
      continue;
    output[key] = {
      tabId: entry.tabId as number,
      profileId: entry.profileId,
      ...(typeof entry.environmentId === 'string' ? { environmentId: entry.environmentId } : {}),
      ...(typeof entry.expiresAt === 'number' ? { expiresAt: entry.expiresAt } : {}),
      ...(typeof entry.boundOrigin === 'string' ? { boundOrigin: entry.boundOrigin } : {}),
      ...(typeof entry.autoActivationId === 'string'
        ? { autoActivationId: entry.autoActivationId }
        : {}),
    };
  }
  return output;
}

export function parseSecrets(value: unknown): SessionSecrets {
  if (!isRecord(value)) return {};
  const output: SessionSecrets = {};
  for (const [key, secret] of Object.entries(value))
    if (!validateId(key) && typeof secret === 'string' && secret.length <= 8192)
      output[key] = secret;
  return output;
}
