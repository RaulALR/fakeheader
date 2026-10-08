import { REQUEST_METHODS, type HeaderRule, type RequestMethod } from '../types/rule';
import { newId } from '../utils/ids';
import { isSensitiveHeader } from '../utils/sensitive';
import { validateHeaderName, validateHeaderValue } from '../rules/validators';

const MAX_COMMAND_LENGTH = 50_000;
const MAX_TOKENS = 1_000;

const OPTIONS_WITH_VALUE = new Set([
  '-d',
  '--data',
  '--data-ascii',
  '--data-binary',
  '--data-raw',
  '--data-urlencode',
  '-F',
  '--form',
  '--form-string',
  '-o',
  '--output',
  '-x',
  '--proxy',
  '--proxy-user',
  '--resolve',
  '--connect-to',
  '--cacert',
  '--cert',
  '--key',
  '-u',
  '--user',
  '-w',
  '--write-out',
  '--max-time',
  '--connect-timeout',
]);

export interface CurlHeaderPreview {
  name: string;
  value: string;
  sensitive: boolean;
  operation: 'set' | 'remove';
}

export interface CurlImportResult {
  url: string;
  method?: string;
  headers: CurlHeaderPreview[];
  rules: HeaderRule[];
  warnings: string[];
}

export interface CurlImportOptions {
  scope?: 'host' | 'path';
  createId?: () => string;
}

function tokenize(command: string): string[] {
  const normalized = command
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .trim();
  if (!normalized) throw new Error('Pega un comando cURL.');
  if (normalized.length > MAX_COMMAND_LENGTH)
    throw new Error('El comando cURL es demasiado largo.');

  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const push = () => {
    if (!current) return;
    tokens.push(current);
    current = '';
    if (tokens.length > MAX_TOKENS) throw new Error('El comando contiene demasiados argumentos.');
  };

  for (const character of normalized) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      push();
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  if (quote) throw new Error('El comando contiene una comilla sin cerrar.');
  push();
  return tokens;
}

function httpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseHeader(value: string): CurlHeaderPreview {
  const separator = value.indexOf(':');
  const emptySeparator = separator < 0 ? value.indexOf(';') : -1;
  const index = separator >= 0 ? separator : emptySeparator;
  if (index <= 0) throw new Error('Header cURL inválido. Usa el formato "Nombre: valor".');
  const name = value.slice(0, index).trim();
  const headerValue = value.slice(index + 1).trim();
  const nameError = validateHeaderName(name);
  if (nameError) throw new Error(`${name}: ${nameError}`);
  const valueError = validateHeaderValue(headerValue);
  if (valueError) throw new Error(`${name}: ${valueError}`);
  return {
    name,
    value: headerValue,
    sensitive: isSensitiveHeader(name),
    operation: separator >= 0 && !headerValue ? 'remove' : 'set',
  };
}

function optionValue(token: string, longName: string): string | null {
  const prefix = `${longName}=`;
  return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

export function importCurlCommand(
  command: string,
  options: CurlImportOptions = {},
): CurlImportResult {
  const tokens = tokenize(command);
  const executable = tokens
    .shift()
    ?.replace(/^.*[\\/]/, '')
    .toLowerCase();
  if (executable !== 'curl' && executable !== 'curl.exe')
    throw new Error('El texto debe comenzar por curl o curl.exe.');

  let explicitUrl: URL | null = null;
  let method: string | undefined;
  let bodyImpliesPost = false;
  const urlCandidates: URL[] = [];
  const headers: CurlHeaderPreview[] = [];
  const warnings = new Set<string>();

  const addHeader = (raw: string) => headers.push(parseHeader(raw));
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = () => {
      const value = tokens[index + 1];
      if (value === undefined) throw new Error(`Falta el valor de ${token}.`);
      index += 1;
      return value;
    };

    if (token === '-H' || token === '--header') addHeader(next());
    else if (token.startsWith('--header=')) addHeader(optionValue(token, '--header') ?? '');
    else if (token === '-A' || token === '--user-agent') addHeader(`User-Agent: ${next()}`);
    else if (token.startsWith('--user-agent='))
      addHeader(`User-Agent: ${optionValue(token, '--user-agent') ?? ''}`);
    else if (token === '-e' || token === '--referer') addHeader(`Referer: ${next()}`);
    else if (token.startsWith('--referer='))
      addHeader(`Referer: ${optionValue(token, '--referer') ?? ''}`);
    else if (token === '-b' || token === '--cookie') addHeader(`Cookie: ${next()}`);
    else if (token.startsWith('--cookie='))
      addHeader(`Cookie: ${optionValue(token, '--cookie') ?? ''}`);
    else if (token === '--oauth2-bearer') addHeader(`Authorization: Bearer ${next()}`);
    else if (token.startsWith('--oauth2-bearer='))
      addHeader(`Authorization: Bearer ${optionValue(token, '--oauth2-bearer') ?? ''}`);
    else if (token === '-X' || token === '--request') method = next().toUpperCase();
    else if (token.startsWith('--request='))
      method = (optionValue(token, '--request') ?? '').toUpperCase();
    else if (token === '-I' || token === '--head') method = 'HEAD';
    else if (token === '--url') {
      explicitUrl = httpUrl(next());
      if (!explicitUrl) throw new Error('--url debe contener una URL HTTP o HTTPS válida.');
    } else if (token.startsWith('--url=')) {
      explicitUrl = httpUrl(optionValue(token, '--url') ?? '');
      if (!explicitUrl) throw new Error('--url debe contener una URL HTTP o HTTPS válida.');
    } else if (token === '-u' || token === '--user' || token.startsWith('--user=')) {
      if (!token.includes('=')) next();
      warnings.add('Las credenciales Basic/Digest de --user no se importan.');
    } else if (OPTIONS_WITH_VALUE.has(token)) {
      next();
      if (
        token.startsWith('-d') ||
        token.startsWith('--data') ||
        token.startsWith('-F') ||
        token.startsWith('--form')
      ) {
        bodyImpliesPost = true;
        warnings.add('El cuerpo de la solicitud no se importa: DNR no permite modificarlo.');
      }
    } else if ([...OPTIONS_WITH_VALUE].some((name) => token.startsWith(`${name}=`))) {
      if (token.startsWith('--data') || token.startsWith('--form')) {
        bodyImpliesPost = true;
        warnings.add('El cuerpo de la solicitud no se importa: DNR no permite modificarlo.');
      }
    } else if (!token.startsWith('-')) {
      const candidate = httpUrl(token);
      if (candidate) urlCandidates.push(candidate);
    }
  }

  const url = explicitUrl ?? urlCandidates.at(-1) ?? null;
  if (!url) throw new Error('No se encontró una URL HTTP o HTTPS en el comando.');
  if (!headers.length) throw new Error('El comando no contiene cabeceras importables.');
  const resolvedMethod = (method ?? (bodyImpliesPost ? 'POST' : 'GET')).toUpperCase();
  const normalizedMethod = resolvedMethod.toLowerCase();
  const requestMethod = REQUEST_METHODS.includes(normalizedMethod as RequestMethod)
    ? (normalizedMethod as RequestMethod)
    : 'other';
  if (requestMethod === 'other' && normalizedMethod !== 'other')
    warnings.add(`El método ${resolvedMethod} se importó como el método DNR "other".`);

  const uniqueHeaders = new Map<string, CurlHeaderPreview>();
  for (const header of headers) {
    const key = header.name.toLowerCase();
    if (uniqueHeaders.has(key)) warnings.add(`Se conservó el último valor de ${header.name}.`);
    uniqueHeaders.set(key, header);
  }

  const importedHeaders = [...uniqueHeaders.values()];
  const createId = options.createId ?? newId;
  const scope = options.scope ?? 'host';
  const urlFilter = scope === 'path' ? `|${url.origin}${url.pathname}${url.search}` : undefined;
  const rules = importedHeaders.map<HeaderRule>((header) => {
    const id = createId();
    return {
      id,
      name: `cURL - ${header.name}`,
      group: 'cURL importado',
      tags: ['curl'],
      kind: 'headers',
      enabled: false,
      priority: 1,
      target: 'request',
      operation: header.operation,
      header: header.name,
      ...(header.operation === 'set' ? { value: header.value } : {}),
      ...(header.sensitive ? { sensitive: true, valueRef: id } : {}),
      domains: [url.origin],
      requestMethods: [requestMethod],
      ...(urlFilter ? { urlFilter } : {}),
    };
  });

  return {
    url: url.toString(),
    method: resolvedMethod,
    headers: importedHeaders,
    rules,
    warnings: [...warnings],
  };
}
