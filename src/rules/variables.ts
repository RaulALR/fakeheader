import type { RuleEnvironment } from '../types/profile';
import type { SessionSecrets } from '../types/session';

const VARIABLE_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const JSON_VARIABLE_PATTERN = /\{\{JSON:([A-Za-z][A-Za-z0-9_]*)\}\}/g;

export function validateVariableKey(value: string): string | null {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
    ? null
    : 'La variable debe comenzar por una letra y contener sólo letras, números o guiones bajos.';
}

export function environmentValues(
  environment: RuleEnvironment | undefined,
  secrets: SessionSecrets,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const variable of environment?.variables ?? []) {
    const value = variable.sensitive
      ? (secrets[variable.valueRef ?? variable.id] ?? variable.value)
      : variable.value;
    if (value !== undefined) output[variable.key] = value;
  }
  return output;
}

export function resolveVariables(value: string, variables: Record<string, string>): string {
  return value.replace(VARIABLE_PATTERN, (_match, key: string) => {
    if (!(key in variables)) throw new Error(`Falta un valor para la variable {{${key}}}.`);
    return variables[key];
  });
}

export function referencedVariables(value: string): string[] {
  return [
    ...[...value.matchAll(VARIABLE_PATTERN)].map((match) => match[1]),
    ...[...value.matchAll(JSON_VARIABLE_PATTERN)].map((match) => match[1]),
  ];
}

export function resolveScriptVariables(
  code: string,
  kind: 'javascript' | 'css',
  variables: Record<string, string>,
): string {
  if (kind === 'css') return resolveVariables(code, variables);
  return code.replace(JSON_VARIABLE_PATTERN, (_match, key: string) => {
    if (!(key in variables)) throw new Error(`Falta un valor para la variable {{JSON:${key}}}.`);
    return JSON.stringify(variables[key]);
  });
}
