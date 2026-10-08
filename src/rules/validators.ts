import type { HeaderProfile, RuleEnvironment } from '../types/profile';
import {
  DOMAIN_TYPES,
  QUERY_OPERATIONS,
  REQUEST_METHODS,
  RESOURCE_TYPES,
  RULE_KINDS,
  RULE_OPERATIONS,
  RULE_TARGETS,
  type HeaderRule,
} from '../types/rule';
import { extractHostPermissionsFromUrlFilter, parseHostTarget } from './host-targets';
import { validateVariableKey } from './variables';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
const APPENDABLE_REQUEST_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'access-control-request-headers',
  'cache-control',
  'connection',
  'content-language',
  'cookie',
  'forwarded',
  'if-match',
  'if-none-match',
  'keep-alive',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
  'want-digest',
  'x-forwarded-for',
]);

export function validateId(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
    ? null
    : 'El ID debe tener de 1 a 128 caracteres alfanuméricos, guiones o guiones bajos.';
}
export function validateHeaderName(value: string): string | null {
  if (!value.trim()) return 'El nombre de la cabecera es obligatorio.';
  if (value.length > 256) return 'El nombre de la cabecera no puede superar 256 caracteres.';
  return HEADER_NAME.test(value) ? null : 'El nombre contiene caracteres no permitidos por HTTP.';
}
export function validateHeaderValue(value: string): string | null {
  if (value.length > 8192) return 'El valor no puede superar 8192 caracteres.';
  return value.includes('\r') || value.includes('\n') || value.includes('\0')
    ? 'El valor no puede contener saltos de línea ni bytes nulos.'
    : null;
}
export function validateUrlFilter(value: string): string | null {
  if (!value) return null;
  if (!/^[\x20-\x7E]+$/.test(value))
    return 'El filtro URL debe contener sólo caracteres ASCII imprimibles.';
  if (value.startsWith('||*')) return 'Chrome no admite filtros URL que empiecen por ||*.';
  return value.length > 2000 ? 'El filtro URL es demasiado largo.' : null;
}
export function normalizeDomain(value: string): string {
  return parseHostTarget(value).host.replace(/^\[|\]$/g, '');
}
export function validateDomain(value: string): string | null {
  try {
    parseHostTarget(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Host no válido.';
  }
}

function validateScope(rule: HeaderRule, errors: string[]): void {
  const filterError = validateUrlFilter(rule.urlFilter ?? '');
  if (filterError) errors.push(filterError);
  if (rule.urlFilter && rule.regexFilter)
    errors.push('Una regla no puede combinar filtro URL y expresión regular.');
  for (const domain of [...(rule.domains ?? []), ...(rule.excludedDomains ?? [])]) {
    const error = validateDomain(domain);
    if (error) errors.push(`${domain}: ${error}`);
  }
  if ((rule.domains?.length ?? 0) > 256 || (rule.excludedDomains?.length ?? 0) > 256)
    errors.push('Una regla no puede tener más de 256 dominios por lista.');
  if (rule.allWebsites && rule.domains?.length)
    errors.push('Todos los sitios no puede combinarse con una lista de dominios.');
  if (!rule.allWebsites && !rule.domains?.length) {
    if (!rule.urlFilter && !rule.regexFilter)
      errors.push('Indica al menos un dominio o activa explícitamente Todos los sitios.');
    else if (rule.urlFilter && !extractHostPermissionsFromUrlFilter(rule.urlFilter))
      errors.push(
        'No se puede extraer un host seguro del filtro URL. Añade dominios o activa Todos los sitios explícitamente.',
      );
    else if (rule.regexFilter)
      errors.push('Las expresiones regulares requieren dominios explícitos o Todos los sitios.');
  }
  for (const domain of [
    ...(rule.initiatorDomains ?? []),
    ...(rule.excludedInitiatorDomains ?? []),
  ]) {
    if (/^https?:\/\//i.test(domain) || domain.startsWith('*.')) {
      errors.push(`${domain}: el iniciador debe ser un hostname sin esquema ni wildcard.`);
      continue;
    }
    try {
      const parsed = parseHostTarget(domain);
      if (parsed.port) errors.push(`${domain}: el iniciador no puede incluir puerto.`);
    } catch (error) {
      errors.push(
        `${domain}: ${error instanceof Error ? error.message : 'Dominio iniciador no válido.'}`,
      );
    }
  }
  if ((rule.initiatorDomains?.length ?? 0) > 256)
    errors.push('Una regla no puede tener más de 256 iniciadores incluidos.');
  if ((rule.excludedInitiatorDomains?.length ?? 0) > 256)
    errors.push('Una regla no puede tener más de 256 iniciadores excluidos.');
}

export function validateRule(rule: HeaderRule): ValidationResult {
  const errors: string[] = [];
  const kind = rule.kind ?? 'headers';
  if (!RULE_KINDS.includes(kind)) errors.push('Tipo de regla no válido.');
  if (rule.name !== undefined && (!rule.name.trim() || rule.name.length > 100))
    errors.push('El nombre de la regla debe tener entre 1 y 100 caracteres.');
  if (
    rule.group !== undefined &&
    (!rule.group.trim() ||
      rule.group !== rule.group.trim() ||
      rule.group.length > 50 ||
      hasControlCharacters(rule.group))
  )
    errors.push('El grupo debe tener entre 1 y 50 caracteres.');
  if ((rule.tags?.length ?? 0) > 12) errors.push('Una regla no puede tener más de 12 etiquetas.');
  const normalizedTags = new Set<string>();
  for (const tag of rule.tags ?? []) {
    if (!tag.trim() || tag !== tag.trim() || tag.length > 32 || hasControlCharacters(tag))
      errors.push('Cada etiqueta debe tener entre 1 y 32 caracteres.');
    const normalized = tag.trim().toLowerCase();
    if (normalizedTags.has(normalized)) errors.push(`Etiqueta duplicada: ${tag}`);
    normalizedTags.add(normalized);
  }
  if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 1))
    errors.push('La prioridad debe ser un entero positivo.');

  if (kind === 'headers') {
    const headerError = validateHeaderName(rule.header ?? '');
    if (headerError) errors.push(headerError);
    if (!RULE_TARGETS.includes(rule.target ?? 'request')) errors.push('Destino no válido.');
    if (!RULE_OPERATIONS.includes(rule.operation ?? 'set')) errors.push('Operación no válida.');
    const operation = rule.operation ?? 'set';
    if (operation !== 'remove') {
      if (rule.value === undefined && !(rule.sensitive && rule.valueRef))
        errors.push('Establecer y añadir requieren un valor.');
      else if (rule.value !== undefined) {
        const error = validateHeaderValue(rule.value);
        if (error) errors.push(error);
      }
    }
    if (
      (rule.target ?? 'request') === 'request' &&
      operation === 'append' &&
      !APPENDABLE_REQUEST_HEADERS.has((rule.header ?? '').toLowerCase())
    )
      errors.push(`Chrome no permite añadir valores en la cabecera de solicitud "${rule.header}".`);
  }
  if (kind === 'redirect') {
    if (!rule.redirectUrl?.trim()) errors.push('La URL de destino es obligatoria.');
    else if (!rule.redirectUrl.includes('{{')) {
      try {
        const url = new URL(rule.redirectUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        errors.push('La redirección debe utilizar una URL HTTP o HTTPS válida.');
      }
    }
  }
  if (kind === 'replace') {
    if (!rule.regexFilter) errors.push('Reemplazar URL necesita una expresión regular de origen.');
    if (!rule.regexSubstitution) errors.push('Reemplazar URL necesita una sustitución.');
    else if (!rule.regexSubstitution.includes('{{')) {
      try {
        const url = new URL(rule.regexSubstitution.replace(/\\[0-9]/g, 'example'));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        errors.push('La sustitución debe producir una URL HTTP o HTTPS válida.');
      }
    }
    if (rule.regexFilter)
      try {
        new RegExp(rule.regexFilter);
      } catch {
        errors.push('La expresión regular no es válida.');
      }
  }
  if (kind === 'query') {
    if (!rule.queryParams?.length) errors.push('Añade al menos un cambio de parámetro de consulta.');
    const keys = new Set<string>();
    for (const item of rule.queryParams ?? []) {
      if (!QUERY_OPERATIONS.includes(item.operation)) errors.push('Operación de consulta no válida.');
      if (!item.key.trim() || item.key.length > 256) errors.push('Clave de consulta no válida.');
      if (keys.has(item.key)) errors.push(`Parámetro de consulta duplicado: ${item.key}`);
      keys.add(item.key);
      if (item.operation === 'set' && item.value === undefined)
        errors.push(`Falta el valor de ${item.key}.`);
      if (item.value !== undefined) {
        const error = validateHeaderValue(item.value);
        if (error) errors.push(error);
      }
      const idError = validateId(item.id);
      if (idError) errors.push(idError);
    }
  }

  validateScope(rule, errors);
  if (rule.resourceTypes?.some((type) => !RESOURCE_TYPES.includes(type)))
    errors.push('Hay tipos de recurso no válidos.');
  if (rule.resourceTypes && !rule.resourceTypes.length)
    errors.push('Selecciona al menos un tipo de recurso incluido.');
  if (rule.excludedResourceTypes?.some((type) => !RESOURCE_TYPES.includes(type)))
    errors.push('Hay tipos de recurso excluidos no válidos.');
  if (rule.excludedResourceTypes && !rule.excludedResourceTypes.length)
    errors.push('Selecciona al menos un tipo de recurso excluido.');
  if (rule.resourceTypes?.length && rule.excludedResourceTypes?.length)
    errors.push('No se pueden combinar tipos de recurso incluidos y excluidos.');
  if (rule.requestMethods?.some((method) => !REQUEST_METHODS.includes(method)))
    errors.push('Hay métodos HTTP no válidos.');
  if (rule.requestMethods && !rule.requestMethods.length)
    errors.push('Selecciona al menos un método HTTP incluido.');
  if (rule.excludedRequestMethods?.some((method) => !REQUEST_METHODS.includes(method)))
    errors.push('Hay métodos HTTP excluidos no válidos.');
  if (rule.excludedRequestMethods && !rule.excludedRequestMethods.length)
    errors.push('Selecciona al menos un método HTTP excluido.');
  if (rule.requestMethods?.length && rule.excludedRequestMethods?.length)
    errors.push('No se pueden combinar métodos HTTP incluidos y excluidos.');
  if (rule.domainType !== undefined && !DOMAIN_TYPES.includes(rule.domainType))
    errors.push('La relación first-party/third-party no es válida.');
  if (rule.isUrlFilterCaseSensitive && !rule.urlFilter && !rule.regexFilter)
    errors.push('La sensibilidad a mayúsculas necesita un filtro URL o regex.');
  const idError = validateId(rule.id);
  if (idError) errors.push(idError);
  return { valid: errors.length === 0, errors };
}

export function validateProfile(profile: HeaderProfile): ValidationResult {
  const errors: string[] = [];
  const idError = validateId(profile.id);
  if (idError) errors.push(idError);
  if (!profile.name.trim() || profile.name.length > 80)
    errors.push('El nombre del perfil debe tener entre 1 y 80 caracteres.');
  if (profile.rules.length > 5000) errors.push('Un perfil no puede contener más de 5000 reglas.');
  const ids = new Set<string>();
  for (const rule of profile.rules) {
    if (ids.has(rule.id)) errors.push(`ID de regla duplicado: ${rule.id}`);
    ids.add(rule.id);
    errors.push(
      ...validateRule(rule).errors.map(
        (error) => `${rule.name || rule.header || 'Regla'}: ${error}`,
      ),
    );
  }
  return { valid: errors.length === 0, errors };
}

export function validateEnvironment(environment: RuleEnvironment): ValidationResult {
  const errors: string[] = [];
  const idError = validateId(environment.id);
  if (idError) errors.push(idError);
  if (!environment.name.trim() || environment.name.length > 80)
    errors.push('El nombre del entorno debe tener entre 1 y 80 caracteres.');
  const keys = new Set<string>();
  for (const variable of environment.variables) {
    const variableIdError = validateId(variable.id);
    if (variableIdError) errors.push(variableIdError);
    const keyError = validateVariableKey(variable.key);
    if (keyError) errors.push(`${variable.key || 'Variable'}: ${keyError}`);
    if (keys.has(variable.key)) errors.push(`Variable duplicada: ${variable.key}`);
    keys.add(variable.key);
    if (variable.value !== undefined) {
      const valueError = validateHeaderValue(variable.value);
      if (valueError) errors.push(`${variable.key}: ${valueError}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
