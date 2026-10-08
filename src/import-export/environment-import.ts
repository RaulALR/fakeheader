import type { EnvironmentVariable, RuleEnvironment } from '../types/profile';
import { newId } from '../utils/ids';
import { isSensitiveTrafficHeader } from '../utils/sensitive';
import { validateEnvironment } from '../rules/validators';

const MAX_ENVIRONMENT_TEXT = 512 * 1024;
const MAX_VARIABLES = 500;

export interface EnvironmentImportResult {
  environment: RuleEnvironment;
  format: 'dotenv' | 'postman';
  skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function variable(key: string, value: string, forcedSensitive = false): EnvironmentVariable {
  const id = newId();
  const sensitive = forcedSensitive || isSensitiveTrafficHeader(key);
  return {
    id,
    key,
    value,
    ...(sensitive ? { sensitive: true, valueRef: id } : {}),
  };
}

function finish(
  name: string,
  variables: EnvironmentVariable[],
  format: EnvironmentImportResult['format'],
  skipped: number,
): EnvironmentImportResult {
  if (!variables.length) throw new Error('El archivo no contiene variables importables.');
  if (variables.length > MAX_VARIABLES)
    throw new Error(`Un entorno importado admite hasta ${MAX_VARIABLES} variables.`);
  const environment: RuleEnvironment = {
    id: newId(),
    name: name.trim().slice(0, 80) || 'Entorno importado',
    variables,
  };
  const validation = validateEnvironment(environment);
  if (!validation.valid) throw new Error(validation.errors[0]);
  return { environment, format, skipped };
}

function dotenvValue(raw: string, lineNumber: number): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2)
      throw new Error(`Comillas sin cerrar en la línea ${lineNumber}.`);
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2)
      throw new Error(`Comillas sin cerrar en la línea ${lineNumber}.`);
    try {
      return JSON.parse(value) as string;
    } catch {
      throw new Error(`Valor entre comillas no válido en la línea ${lineNumber}.`);
    }
  }
  return value.replace(/\s+#.*$/, '').trimEnd();
}

function parseDotenv(text: string, name: string): EnvironmentImportResult {
  const variables: EnvironmentVariable[] = [];
  const keys = new Set<string>();
  const skipped = 0;
  for (const [index, original] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    let line = original.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trimStart();
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Falta "=" en la línea ${index + 1}.`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
      throw new Error(`Nombre de variable no válido en la línea ${index + 1}.`);
    if (keys.has(key)) throw new Error(`Variable duplicada: ${key}.`);
    keys.add(key);
    variables.push(variable(key, dotenvValue(line.slice(separator + 1), index + 1)));
  }
  return finish(name, variables, 'dotenv', skipped);
}

function parsePostman(text: string, fallbackName: string): EnvironmentImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El JSON de Postman no es válido.');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.values))
    throw new Error('No parece una exportación de entorno de Postman.');
  if (parsed.values.length > MAX_VARIABLES)
    throw new Error(`Un entorno importado admite hasta ${MAX_VARIABLES} variables.`);
  const variables: EnvironmentVariable[] = [];
  const keys = new Set<string>();
  let skipped = 0;
  for (const item of parsed.values) {
    if (!isRecord(item) || typeof item.key !== 'string' || typeof item.value !== 'string')
      throw new Error('El entorno de Postman contiene una variable no válida.');
    if (item.enabled === false) {
      skipped += 1;
      continue;
    }
    const key = item.key.trim();
    if (keys.has(key)) throw new Error(`Variable duplicada: ${key}.`);
    keys.add(key);
    variables.push(variable(key, item.value, item.type === 'secret'));
  }
  return finish(
    typeof parsed.name === 'string' ? parsed.name : fallbackName,
    variables,
    'postman',
    skipped,
  );
}

export function importEnvironmentText(text: string, fileName: string): EnvironmentImportResult {
  if (!text || text.length > MAX_ENVIRONMENT_TEXT)
    throw new Error('El archivo debe contener entre 1 byte y 512 KB.');
  const fallbackName = fileName
    .replace(/\.postman_environment\.json$/i, '')
    .replace(/\.(env|json)$/i, '')
    .trim();
  return text.trimStart().startsWith('{')
    ? parsePostman(text, fallbackName)
    : parseDotenv(text, fallbackName);
}

function quoteDotenv(value: string): string {
  return /^[A-Za-z0-9_./:@-]*$/.test(value) ? value : JSON.stringify(value);
}

export function exportEnvironmentDotenv(environment: RuleEnvironment): string {
  const lines: string[] = [];
  for (const item of environment.variables)
    lines.push(`${item.key}=${item.sensitive ? '[REDACTED]' : quoteDotenv(item.value ?? '')}`);
  return `${lines.join('\n')}\n`;
}
