import { SCHEMA_VERSION } from '../config';
import type { FakeHeaderSettings } from '../types/profile';
import { isSensitiveHeader } from '../utils/sensitive';
import { newId } from '../utils/ids';
import { referencedVariables as referencedVariableNames } from '../rules/variables';
import { parseSettings } from '../storage/parsers';

export function importConfiguration(json: string): FakeHeaderSettings {
  if (json.length > 2_000_000) throw new Error('El archivo supera el límite de 2 MB.');
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }
  return parseSettings(data);
}

export function exportConfiguration(
  settings: FakeHeaderSettings,
  includeSensitive = false,
): string {
  const clean: FakeHeaderSettings = {
    schemaVersion: SCHEMA_VERSION,
    safety: { ...settings.safety },
    autoActivations: settings.autoActivations.map((activation) => ({ ...activation })),
    scripts: settings.scripts.map((script) => ({ ...script })),
    templates: settings.templates.map((template) => {
      const sensitive = template.rule.sensitive || isSensitiveHeader(template.rule.header ?? '');
      const { value: _value, ...withoutValue } = template.rule;
      return {
        ...template,
        rule: {
          ...(sensitive ? withoutValue : template.rule),
          enabled: false,
          pinned: false,
          ...(sensitive
            ? {
                sensitive: true,
                valueRef: template.rule.valueRef ?? template.rule.id,
              }
            : {}),
        },
      };
    }),
    profiles: settings.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      enabled: profile.enabled,
      rules: profile.rules.map((rule) => {
        const sensitive = rule.sensitive || isSensitiveHeader(rule.header ?? '');
        return {
          ...rule,
          ...(sensitive && rule.operation !== 'remove'
            ? { value: includeSensitive ? (rule.value ?? '[REDACTED]') : '[REDACTED]' }
            : {}),
          ...(sensitive ? { sensitive: true, valueRef: rule.valueRef ?? rule.id } : {}),
        };
      }),
    })),
    environments: settings.environments.map((environment) => ({
      ...environment,
      variables: environment.variables.map((variable) => ({
        ...variable,
        ...(variable.sensitive
          ? {
              value: includeSensitive ? (variable.value ?? '[REDACTED]') : '[REDACTED]',
              sensitive: true,
              valueRef: variable.valueRef ?? variable.id,
            }
          : {}),
      })),
    })),
  };
  return JSON.stringify(clean, null, 2);
}

function collectReferencedVariables(settings: FakeHeaderSettings, profileId: string): Set<string> {
  const profile = settings.profiles.find((item) => item.id === profileId);
  const values = (profile?.rules ?? []).flatMap((rule) => [
    rule.value ?? '',
    rule.redirectUrl ?? '',
    rule.regexSubstitution ?? '',
    ...(rule.queryParams ?? []).map((item) => item.value ?? ''),
  ]);
  const scripts = settings.scripts
    .filter((script) => script.profileId === profileId)
    .map((script) => script.code);
  return new Set([...values, ...scripts].flatMap(referencedVariableNames));
}

export function exportWorkspaceConfiguration(
  settings: FakeHeaderSettings,
  profileId: string,
  includeSensitive = false,
): string {
  const profile = settings.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('El espacio de trabajo seleccionado no existe.');
  const variableKeys = collectReferencedVariables(settings, profileId);
  const subset: FakeHeaderSettings = {
    schemaVersion: SCHEMA_VERSION,
    profiles: [profile],
    environments: settings.environments
      .map((environment) => ({
        ...environment,
        variables: environment.variables.filter((variable) => variableKeys.has(variable.key)),
      }))
      .filter((environment) => environment.variables.length),
    templates: [],
    autoActivations: [],
    scripts: settings.scripts.filter((script) => script.profileId === profileId),
    safety: { autoDisableOnNavigation: false },
  };
  return exportConfiguration(subset, includeSensitive);
}

export function mergeWorkspaceConfiguration(
  current: FakeHeaderSettings,
  imported: FakeHeaderSettings,
): FakeHeaderSettings {
  if (imported.profiles.length !== 1)
    throw new Error('El archivo debe contener exactamente un espacio de trabajo.');
  const source = imported.profiles[0];
  const profileId = newId();
  const environments = imported.environments.map((environment) => {
    const environmentId = newId();
    return {
      ...environment,
      id: environmentId,
      name: `${environment.name} (importado)`,
      variables: environment.variables.map((variable) => {
        const id = newId();
        return {
          ...variable,
          id,
          ...(variable.sensitive ? { valueRef: id } : { valueRef: undefined }),
        };
      }),
    };
  });
  const profile = {
    ...source,
    id: profileId,
    name: `${source.name} (importado)`,
    enabled: true,
    rules: source.rules.map((rule) => {
      const id = newId();
      return {
        ...rule,
        id,
        enabled: false,
        ...(rule.sensitive ? { valueRef: id } : { valueRef: undefined }),
        queryParams: rule.queryParams?.map((item) => ({ ...item, id: newId() })),
      };
    }),
  };
  return {
    ...current,
    profiles: [...current.profiles, profile],
    environments: [...current.environments, ...environments],
    scripts: [
      ...current.scripts,
      ...imported.scripts
        .filter((script) => script.profileId === source.id)
        .map((script) => ({ ...script, id: newId(), profileId, enabled: false })),
    ],
  };
}
