import {
  ACTIVE_TABS_KEY,
  HISTORY_KEY,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_SNAPSHOTS,
  SCHEMA_VERSION,
  SECRETS_KEY,
  SCRIPT_ACTIVITY_KEY,
  STORAGE_KEY,
} from '../config';
import type { SettingsHistory, SettingsSnapshot } from '../types/history';
import type { FakeHeaderSettings, HeaderProfile } from '../types/profile';
import type { ActiveTabStateMap, SessionSecrets } from '../types/session';
import type { ScriptActivityEntry } from '../types/script-activity';
import { newId } from '../utils/ids';
import { isSensitiveHeader } from '../utils/sensitive';
import {
  parseActiveTabs,
  parseHistory,
  parseScriptActivity,
  parseSecrets,
  parseSettings,
} from './parsers';

export interface SettingsReadResult {
  settings: FakeHeaderSettings;
  valid: boolean;
}

export function createDefaultSettings(stable = false): FakeHeaderSettings {
  const profileId = stable ? 'safe-development' : newId();
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles: [{ id: profileId, name: 'Desarrollo', enabled: true, rules: [] }],
    templates: [],
    autoActivations: [],
    scripts: [],
    environments: [
      {
        id: stable ? 'safe-local' : newId(),
        name: 'Local',
        variables: [],
      },
    ],
    safety: { autoDisableOnNavigation: false },
  };
}

export function safeSettingsFromStorage(raw: unknown): SettingsReadResult {
  try {
    return { settings: parseSettings(raw), valid: true };
  } catch {
    return { settings: createDefaultSettings(true), valid: false };
  }
}

export async function readSettings(): Promise<SettingsReadResult> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw: unknown = result[STORAGE_KEY];
  if (raw === undefined) {
    const initial = createDefaultSettings();
    await chrome.storage.local.set({ [STORAGE_KEY]: initial });
    return { settings: initial, valid: true };
  }
  return safeSettingsFromStorage(raw);
}

export async function getSettings(): Promise<FakeHeaderSettings> {
  const { settings } = await readSettings();
  return hydrateSettings(settings, await getSessionSecrets());
}

export function sanitizeSettingsForLocal(settings: FakeHeaderSettings): FakeHeaderSettings {
  const parsed = parseSettings(settings);
  return {
    ...parsed,
    profiles: parsed.profiles.map((profile) => ({
      ...profile,
      rules: profile.rules.map((rule) => {
        if (!(rule.sensitive || isSensitiveHeader(rule.header ?? ''))) {
          const { sensitive: _sensitive, valueRef: _valueRef, ...plain } = rule;
          return plain;
        }
        const { value: _value, ...withoutValue } = rule;
        return { ...withoutValue, sensitive: true, valueRef: rule.valueRef ?? rule.id };
      }),
    })),
    environments: parsed.environments.map((environment) => ({
      ...environment,
      variables: environment.variables.map((variable) => {
        if (!variable.sensitive) {
          const { sensitive: _sensitive, valueRef: _valueRef, ...plain } = variable;
          return plain;
        }
        const { value: _value, ...withoutValue } = variable;
        return {
          ...withoutValue,
          sensitive: true,
          valueRef: variable.valueRef ?? variable.id,
        };
      }),
    })),
  };
}

export function collectSessionSecrets(
  settings: FakeHeaderSettings,
  existing: SessionSecrets = {},
): SessionSecrets {
  const output: SessionSecrets = {};
  for (const profile of settings.profiles)
    for (const rule of profile.rules) {
      if (!(rule.sensitive || isSensitiveHeader(rule.header ?? '')) || rule.operation === 'remove')
        continue;
      const reference = rule.valueRef ?? rule.id;
      const value = rule.value ?? existing[reference];
      if (value !== undefined) output[reference] = value;
    }
  for (const environment of settings.environments)
    for (const variable of environment.variables) {
      if (!variable.sensitive) continue;
      const reference = variable.valueRef ?? variable.id;
      const value = variable.value ?? existing[reference];
      if (value !== undefined) output[reference] = value;
    }
  return output;
}

export function hydrateSettings(
  settings: FakeHeaderSettings,
  secrets: SessionSecrets,
): FakeHeaderSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => ({
      ...profile,
      rules: profile.rules.map((rule) =>
        rule.sensitive || isSensitiveHeader(rule.header ?? '')
          ? {
              ...rule,
              sensitive: true,
              valueRef: rule.valueRef ?? rule.id,
              ...(secrets[rule.valueRef ?? rule.id] !== undefined
                ? { value: secrets[rule.valueRef ?? rule.id] }
                : {}),
            }
          : rule,
      ),
    })),
    environments: settings.environments.map((environment) => ({
      ...environment,
      variables: environment.variables.map((variable) =>
        variable.sensitive
          ? {
              ...variable,
              valueRef: variable.valueRef ?? variable.id,
              ...(secrets[variable.valueRef ?? variable.id] !== undefined
                ? { value: secrets[variable.valueRef ?? variable.id] }
                : {}),
            }
          : variable,
      ),
    })),
  };
}

export async function writePersistentSettings(settings: FakeHeaderSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: sanitizeSettingsForLocal(settings) });
}
export async function getSettingsHistory(): Promise<SettingsHistory> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  try {
    return parseHistory(result[HISTORY_KEY]);
  } catch {
    return [];
  }
}
export async function writeSettingsHistory(history: SettingsHistory): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_KEY]: parseHistory(history) });
}
export function withHistorySnapshot(
  history: SettingsHistory,
  snapshot: SettingsSnapshot,
): SettingsHistory {
  const output = [snapshot, ...history.filter((item) => item.id !== snapshot.id)].slice(
    0,
    MAX_HISTORY_SNAPSHOTS,
  );
  while (
    output.length &&
    new TextEncoder().encode(JSON.stringify(output)).byteLength > MAX_HISTORY_BYTES
  )
    output.pop();
  return output;
}
export async function getActiveTabs(): Promise<ActiveTabStateMap> {
  const result = await chrome.storage.session.get(ACTIVE_TABS_KEY);
  return parseActiveTabs(result[ACTIVE_TABS_KEY]);
}
export async function writeActiveTabs(value: ActiveTabStateMap): Promise<void> {
  await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: value });
}
export async function getSessionSecrets(): Promise<SessionSecrets> {
  const result = await chrome.storage.session.get(SECRETS_KEY);
  return parseSecrets(result[SECRETS_KEY]);
}
export async function writeSessionSecrets(value: SessionSecrets): Promise<void> {
  await chrome.storage.session.set({ [SECRETS_KEY]: value });
}
export async function getScriptActivity(): Promise<ScriptActivityEntry[]> {
  const result = await chrome.storage.session.get(SCRIPT_ACTIVITY_KEY);
  try {
    return parseScriptActivity(result[SCRIPT_ACTIVITY_KEY]);
  } catch {
    await chrome.storage.session.remove(SCRIPT_ACTIVITY_KEY);
    return [];
  }
}
export async function writeScriptActivity(value: ScriptActivityEntry[]): Promise<void> {
  await chrome.storage.session.set({ [SCRIPT_ACTIVITY_KEY]: parseScriptActivity(value) });
}
export async function clearScriptActivity(tabId?: number, profileId?: string): Promise<void> {
  if (tabId === undefined && profileId === undefined) {
    await chrome.storage.session.remove(SCRIPT_ACTIVITY_KEY);
    return;
  }
  const activity = await getScriptActivity();
  await writeScriptActivity(
    activity.filter(
      (entry) =>
        !(
          (tabId === undefined || entry.tabId === tabId) &&
          (profileId === undefined || entry.profileId === profileId)
        ),
    ),
  );
}
export async function getProfiles(): Promise<HeaderProfile[]> {
  return (await getSettings()).profiles;
}
