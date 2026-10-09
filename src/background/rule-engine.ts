import { MAX_SESSION_RULES, TAB_ALARM_PREFIX } from '../config';
import { compileSessionRuleRecords, compileSessionRules } from '../rules/converters';
import { ruleTitle } from '../rules/rule-display';
import type { FakeHeaderSettings } from '../types/profile';
import type { SettingsHistoryResult } from '../types/history';
import type {
  ActiveTabStateMap,
  ExecutionInspectorResult,
  ExecutionInspectorSnapshot,
  SessionSecrets,
} from '../types/session';
import {
  collectSessionSecrets,
  getActiveTabs,
  getSettingsHistory,
  getSessionSecrets,
  readSettings,
  sanitizeSettingsForLocal,
  writeActiveTabs,
  writePersistentSettings,
  writeSettingsHistory,
  writeSessionSecrets,
  withHistorySnapshot,
} from '../storage/storage';
import { parseSettings } from '../storage/parsers';
import { originsForProfiles } from '../utils/permissions';
import { isSensitiveHeader } from '../utils/sensitive';
import { newId } from '../utils/ids';
import { clearDnrActivity, getDnrActivity } from './dnr-activity';

export interface OperationResult {
  ok: boolean;
  error?: string;
}

export interface TabExecutionResult extends OperationResult {
  enabled?: boolean;
  profileId?: string;
  environmentId?: string;
  expiresAt?: number;
}

export interface TabTransitionDependencies {
  getRules(): Promise<chrome.declarativeNetRequest.Rule[]>;
  updateRules(
    removeRuleIds: number[],
    addRules: chrome.declarativeNetRequest.Rule[],
  ): Promise<void>;
  writeTabs(tabs: ActiveTabStateMap): Promise<void>;
  setBadge(tabId: number, enabled: boolean): Promise<void>;
  emergencyDisable(): Promise<void>;
}

const chromeDependencies: TabTransitionDependencies = {
  getRules: () => chrome.declarativeNetRequest.getSessionRules(),
  updateRules: (removeRuleIds, addRules) =>
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules }),
  writeTabs: writeActiveTabs,
  setBadge: async (tabId, enabled) => {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#4f46e5' });
    await chrome.action.setBadgeText({ tabId, text: enabled ? 'SÍ' : '' });
  },
  emergencyDisable: async () => {
    await disableEverywhere();
  },
};

export function withoutTab(activeTabs: ActiveTabStateMap, tabId: number): ActiveTabStateMap {
  const next = { ...activeTabs };
  delete next[String(tabId)];
  return next;
}

function alarmName(tabId: number): string {
  return `${TAB_ALARM_PREFIX}${tabId}`;
}

async function hasAlarmsPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ['alarms'] });
}

async function syncTabAlarm(tabId: number, expiresAt?: number): Promise<void> {
  if (!(await hasAlarmsPermission())) {
    if (expiresAt) throw new Error('Falta el permiso alarms.');
    return;
  }
  await chrome.alarms.clear(alarmName(tabId));
  if (expiresAt) await chrome.alarms.create(alarmName(tabId), { when: expiresAt });
}

async function clearFakeHeaderAlarms(): Promise<void> {
  if (!(await hasAlarmsPermission())) return;
  const alarms = await chrome.alarms.getAll();
  await Promise.all(
    alarms
      .filter((alarm) => alarm.name.startsWith(TAB_ALARM_PREFIX))
      .map((alarm) => chrome.alarms.clear(alarm.name)),
  );
}

async function currentTabOrigin(tabId: number): Promise<string | undefined> {
  if (!(await chrome.permissions.contains({ permissions: ['webNavigation'] }))) return undefined;
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!frame?.url) return undefined;
  try {
    const url = new URL(frame.url);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function activeProfileHasFeatures(settings: FakeHeaderSettings, profileId: string): boolean {
  const profile = settings.profiles.find((item) => item.id === profileId && item.enabled);
  return Boolean(
    profile &&
    (profile.rules.some((rule) => rule.enabled) ||
      settings.scripts.some((script) => script.profileId === profileId && script.enabled)),
  );
}

export function activationProfileError(
  settings: FakeHeaderSettings,
  profileId: string,
): string | null {
  const profile = settings.profiles.find((item) => item.id === profileId);
  if (!profile) return 'El perfil seleccionado no existe.';
  if (!profile.enabled) return 'El perfil seleccionado está desactivado.';
  if (activeProfileHasFeatures(settings, profileId)) return null;
  const hasInactiveFeatures =
    profile.rules.length > 0 || settings.scripts.some((script) => script.profileId === profileId);
  return hasInactiveFeatures
    ? 'El perfil tiene reglas o scripts, pero todos están desactivados. Activa al menos uno.'
    : 'El perfil no tiene reglas ni scripts. Crea al menos uno antes de activar la pestaña.';
}

function activeProfileHasDnrRules(settings: FakeHeaderSettings, profileId: string): boolean {
  return Boolean(
    settings.profiles
      .find((profile) => profile.id === profileId && profile.enabled)
      ?.rules.some((rule) => rule.enabled),
  );
}

async function hasRequiredHostAccess(
  settings: FakeHeaderSettings,
  activeTabs: ActiveTabStateMap,
): Promise<boolean> {
  const profileIds = new Set(Object.values(activeTabs).map((state) => state.profileId));
  for (const activation of settings.autoActivations)
    if (activation.enabled) profileIds.add(activation.profileId);
  const origins = originsForProfiles(
    settings.profiles.filter((profile) => profileIds.has(profile.id)),
  );
  return origins.length === 0 || chrome.permissions.contains({ origins });
}

async function hasRequiredSafetyAccess(settings: FakeHeaderSettings): Promise<boolean> {
  return (
    (!settings.safety.autoDisableOnNavigation &&
      !settings.autoActivations.some((activation) => activation.enabled)) ||
    chrome.permissions.contains({ permissions: ['webNavigation'] })
  );
}

async function replaceRules(
  rules: chrome.declarativeNetRequest.Rule[],
  dependencies = chromeDependencies,
): Promise<void> {
  if (rules.length > MAX_SESSION_RULES)
    throw new Error(`FakeHeader admite hasta ${MAX_SESSION_RULES} reglas de sesión activas.`);
  const existing = await dependencies.getRules();
  if (dependencies === chromeDependencies) await clearDnrActivity().catch(() => undefined);
  await dependencies.updateRules(
    existing.map((rule) => rule.id),
    rules,
  );
  if (dependencies === chromeDependencies) await clearDnrActivity().catch(() => undefined);
}

export async function commitTabTransition(
  tabId: number,
  nextTabs: ActiveTabStateMap,
  settings: FakeHeaderSettings,
  secrets: SessionSecrets,
  dependencies: TabTransitionDependencies = chromeDependencies,
): Promise<OperationResult> {
  try {
    const rules = compileSessionRules(settings, nextTabs, secrets);
    await replaceRules(rules, dependencies);
    await dependencies.writeTabs(nextTabs);
    await dependencies.setBadge(tabId, Boolean(nextTabs[String(tabId)]));
    return { ok: true };
  } catch {
    const closedTabs = withoutTab(nextTabs, tabId);
    try {
      await replaceRules(compileSessionRules(settings, closedTabs, secrets), dependencies);
      await dependencies.writeTabs(closedTabs);
      await dependencies.setBadge(tabId, false);
    } catch {
      await dependencies.emergencyDisable();
    }
    return {
      ok: false,
      error: 'Chrome rechazó la actualización. La pestaña se ha dejado desactivada por seguridad.',
    };
  }
}

export async function activateTab(
  tabId: number,
  profileId: string,
  environmentId?: string,
  durationMinutes?: number,
  context?: { boundOrigin: string; autoActivationId: string },
): Promise<OperationResult> {
  const read = await readSettings();
  if (!read.valid) {
    await disableEverywhere();
    return {
      ok: false,
      error: 'El storage local está corrupto. FakeHeader permanece desactivado.',
    };
  }
  const profileError = activationProfileError(read.settings, profileId);
  if (profileError) return { ok: false, error: profileError };
  if (environmentId && !read.settings.environments.some((item) => item.id === environmentId))
    return { ok: false, error: 'El entorno seleccionado no existe.' };
  if (!(await hasRequiredSafetyAccess(read.settings)))
    return {
      ok: false,
      error: 'Falta el permiso webNavigation requerido por la protección de navegación.',
    };
  const [activeTabs, secrets] = await Promise.all([getActiveTabs(), getSessionSecrets()]);
  const previous = activeTabs[String(tabId)];
  const expiresAt =
    durationMinutes === undefined
      ? previous?.expiresAt
      : durationMinutes > 0
        ? Date.now() + durationMinutes * 60_000
        : undefined;
  const boundOrigin = context?.boundOrigin
    ? context.boundOrigin
    : read.settings.safety.autoDisableOnNavigation
      ? (previous?.boundOrigin ?? (await currentTabOrigin(tabId)))
      : undefined;
  const nextTabs = {
    ...activeTabs,
    [String(tabId)]: {
      tabId,
      profileId,
      ...(environmentId ? { environmentId } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(boundOrigin ? { boundOrigin } : {}),
      ...(context?.autoActivationId ? { autoActivationId: context.autoActivationId } : {}),
    },
  };
  if (!(await hasRequiredHostAccess(read.settings, nextTabs))) {
    return {
      ok: false,
      error: 'Faltan permisos de host. La pestaña permanece en su estado anterior.',
    };
  }
  const result = await commitTabTransition(tabId, nextTabs, read.settings, secrets);
  if (!result.ok) return result;
  try {
    await syncTabAlarm(tabId, expiresAt);
    return result;
  } catch {
    try {
      await deactivateTab(tabId);
    } catch {
      await disableEverywhere();
    }
    return {
      ok: false,
      error: 'No se pudo programar la caducidad. La pestaña se ha dejado desactivada.',
    };
  }
}

export async function handleCommittedNavigation(
  tabId: number,
  urlValue: string,
): Promise<OperationResult> {
  const [read, activeTabs] = await Promise.all([readSettings(), getActiveTabs()]);
  if (!read.valid) {
    await disableEverywhere();
    return { ok: false, error: 'Storage corrupto; FakeHeader se ha desactivado.' };
  }
  const state = activeTabs[String(tabId)];
  let origin: string | undefined;
  try {
    const url = new URL(urlValue);
    if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin;
  } catch {}
  const activation = origin
    ? read.settings.autoActivations.find((item) => item.enabled && item.origin === origin)
    : undefined;
  if (activation && origin) {
    if (
      state?.autoActivationId === activation.id &&
      state.profileId === activation.profileId &&
      state.environmentId === activation.environmentId &&
      state.boundOrigin === origin &&
      (!state.expiresAt || state.expiresAt > Date.now())
    )
      return { ok: true };
    if (state) {
      const disabled = await deactivateTab(tabId);
      if (!disabled.ok) return disabled;
    }
    return activateTab(
      tabId,
      activation.profileId,
      activation.environmentId,
      activation.durationMinutes ?? 0,
      { boundOrigin: origin, autoActivationId: activation.id },
    );
  }
  if (
    state?.autoActivationId ||
    (state && read.settings.safety.autoDisableOnNavigation && state.boundOrigin !== origin)
  )
    return deactivateTab(tabId);
  return { ok: true };
}

export async function deactivateTab(tabId: number): Promise<OperationResult> {
  const [read, activeTabs, secrets] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    getSessionSecrets(),
  ]);
  if (!read.valid) {
    await disableEverywhere();
    return { ok: false, error: 'Storage corrupto; se han desactivado todas las pestañas.' };
  }
  const result = await commitTabTransition(
    tabId,
    withoutTab(activeTabs, tabId),
    read.settings,
    secrets,
  );
  if (result.ok) await syncTabAlarm(tabId);
  return result;
}

export async function migrateReplacedTab(
  addedTabId: number,
  removedTabId: number,
): Promise<OperationResult> {
  const [read, activeTabs, secrets] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    getSessionSecrets(),
  ]);
  if (!read.valid) {
    await disableEverywhere();
    return { ok: false, error: 'Storage corrupto; se han desactivado todas las pestañas.' };
  }
  const previous = activeTabs[String(removedTabId)];
  const cleanTabs = withoutTab(withoutTab(activeTabs, removedTabId), addedTabId);
  const nextTabs = previous
    ? {
        ...cleanTabs,
        [String(addedTabId)]: { ...previous, tabId: addedTabId },
      }
    : cleanTabs;
  const result = await commitTabTransition(
    addedTabId,
    nextTabs,
    read.settings,
    secrets,
  );
  if (!result.ok) return result;
  try {
    await syncTabAlarm(removedTabId);
    await syncTabAlarm(addedTabId, previous?.expiresAt);
    return result;
  } catch {
    if (previous) await deactivateTab(addedTabId);
    return {
      ok: false,
      error: 'No se pudo migrar la caducidad a la pestaña sustituta.',
    };
  }
}

export async function getTabExecutionState(tabId: number): Promise<TabExecutionResult> {
  const [read, activeTabs, rules] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    chrome.declarativeNetRequest.getSessionRules(),
  ]);
  if (!read.valid) {
    await disableEverywhere();
    return { ok: false, enabled: false, error: 'Storage corrupto; FakeHeader se ha desactivado.' };
  }
  const state = activeTabs[String(tabId)];
  if (state?.expiresAt && state.expiresAt <= Date.now()) {
    await deactivateTab(tabId);
    return { ok: true, enabled: false };
  }
  const hasRules = rules.some((rule) => rule.condition.tabIds?.includes(tabId));
  const expectsRules = state ? activeProfileHasDnrRules(read.settings, state.profileId) : false;
  if ((state && expectsRules && !hasRules) || (!state && hasRules)) {
    // DNR and storage are updated through separate Chrome APIs, so a worker restart or a
    // partially completed update can leave them briefly out of sync. Reading status must never
    // destroy the durable tab selection: rebuild the derived DNR rules from storage instead.
    try {
      await reconcileStoredConfiguration();
    } catch {
      return {
        ok: false,
        enabled: Boolean(state) && (hasRules || !expectsRules),
        profileId: state?.profileId,
        environmentId: state?.environmentId,
        expiresAt: state?.expiresAt,
        error: 'No se pudo verificar el estado de la pestaña. Se conserva la activación anterior.',
      };
    }
    const [reconciledTabs, reconciledRules] = await Promise.all([
      getActiveTabs(),
      chrome.declarativeNetRequest.getSessionRules(),
    ]);
    const reconciled = reconciledTabs[String(tabId)];
    const reconciledExpectsRules = reconciled
      ? activeProfileHasDnrRules(read.settings, reconciled.profileId)
      : false;
    const reconciledHasRules = reconciledRules.some((rule) =>
      rule.condition.tabIds?.includes(tabId),
    );
    return {
      ok: true,
      enabled: Boolean(reconciled) && (reconciledHasRules || !reconciledExpectsRules),
      profileId: reconciled?.profileId,
      environmentId: reconciled?.environmentId,
      expiresAt: reconciled?.expiresAt,
    };
  }
  return {
    ok: true,
    enabled: Boolean(state) && (hasRules || !expectsRules),
    profileId: state?.profileId,
    environmentId: state?.environmentId,
    expiresAt: state?.expiresAt,
  };
}

function redactRuntimeValue(value: string, secrets: string[]): string {
  return secrets.reduce(
    (output, secret) =>
      secret && output.includes(secret) ? output.replaceAll(secret, '[REDACTED]') : output,
    value,
  );
}

function sanitizeRuntimeRule(
  rule: chrome.declarativeNetRequest.Rule,
  secrets: string[],
): chrome.declarativeNetRequest.Rule {
  const safe = JSON.parse(JSON.stringify(rule)) as chrome.declarativeNetRequest.Rule;
  for (const header of [
    ...(safe.action.requestHeaders ?? []),
    ...(safe.action.responseHeaders ?? []),
  ]) {
    if (header.value === undefined) continue;
    header.value =
      isSensitiveHeader(header.header) ||
      secrets.some((secret) => secret && header.value?.includes(secret))
        ? '[REDACTED]'
        : header.value;
  }
  const redirect = safe.action.redirect;
  if (redirect?.url) redirect.url = redactRuntimeValue(redirect.url, secrets);
  if (redirect?.regexSubstitution)
    redirect.regexSubstitution = redactRuntimeValue(redirect.regexSubstitution, secrets);
  for (const parameter of redirect?.transform?.queryTransform?.addOrReplaceParams ?? [])
    parameter.value = redactRuntimeValue(parameter.value, secrets);
  return safe;
}

export async function getExecutionInspector(): Promise<ExecutionInspectorResult> {
  const [read, activeTabs, runtimeRules, sessionSecrets, permissions, ruleActivity] =
    await Promise.all([
    readSettings(),
    getActiveTabs(),
    chrome.declarativeNetRequest.getSessionRules(),
    getSessionSecrets(),
    chrome.permissions.getAll(),
    getDnrActivity(),
  ]);
  if (!read.valid) {
    await disableEverywhere();
    return { ok: false, error: 'Storage corrupto; FakeHeader se ha desactivado.' };
  }
  const secretValues = Object.values(sessionSecrets);
  const rules = runtimeRules.map((rule) => sanitizeRuntimeRule(rule, secretValues));
  let expectedRules: chrome.declarativeNetRequest.Rule[] = [];
  let ruleLabels: ExecutionInspectorSnapshot['ruleLabels'] = [];
  try {
    const records = compileSessionRuleRecords(read.settings, activeTabs, sessionSecrets);
    expectedRules = records.map((record) => sanitizeRuntimeRule(record.rule, secretValues));
    ruleLabels = records.map((record) => {
      const source = read.settings.profiles
        .find((profile) => profile.id === record.profileId)
        ?.rules.find((rule) => rule.id === record.sourceRuleId);
      return {
        dnrRuleId: record.rule.id,
        sourceRuleId: record.sourceRuleId,
        profileId: record.profileId,
        name: source ? ruleTitle(source) : 'Regla no disponible',
        kind: source?.kind ?? 'headers',
      };
    });
  } catch {}
  const activeTabIds = new Set(Object.values(activeTabs).map((state) => state.tabId));
  const tabs = Object.values(activeTabs)
    .sort((first, second) => first.tabId - second.tabId)
    .map((state) => {
      const profile = read.settings.profiles.find((item) => item.id === state.profileId);
      const environment = read.settings.environments.find(
        (item) => item.id === state.environmentId,
      );
      const tabRules = rules.filter((rule) => rule.condition.tabIds?.includes(state.tabId));
      const expectedTabRules = expectedRules.filter((rule) =>
        rule.condition.tabIds?.includes(state.tabId),
      );
      return {
        ...state,
        profileName: profile?.name ?? 'Perfil inexistente',
        ...(environment ? { environmentName: environment.name } : {}),
        healthy: Boolean(
          profile?.enabled &&
          activeProfileHasFeatures(read.settings, state.profileId) &&
          JSON.stringify(tabRules) === JSON.stringify(expectedTabRules),
        ),
        rules: tabRules,
      };
    });
  return {
    ok: true,
    snapshot: {
      generatedAt: Date.now(),
      totalSessionRules: rules.length,
      tabs,
      orphanRules: rules.filter((rule) => {
        const tabIds = rule.condition.tabIds ?? [];
        return !tabIds.length || tabIds.some((tabId) => !activeTabIds.has(tabId));
      }),
      grantedOrigins: [...(permissions.origins ?? [])].sort(),
      grantedPermissions: [...(permissions.permissions ?? [])].sort(),
      ruleActivity,
      ruleLabels,
    },
  };
}

export async function removeClosedTab(tabId: number): Promise<void> {
  const [read, activeTabs, secrets] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    getSessionSecrets(),
  ]);
  if (!activeTabs[String(tabId)]) {
    await syncTabAlarm(tabId);
    return;
  }
  if (!read.valid) {
    await disableEverywhere();
    return;
  }
  const nextTabs = withoutTab(activeTabs, tabId);
  try {
    await replaceRules(compileSessionRules(read.settings, nextTabs, secrets));
    await writeActiveTabs(nextTabs);
    await syncTabAlarm(tabId);
  } catch {
    await disableEverywhere();
  }
}

async function syncBadges(activeTabs: ActiveTabStateMap): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [
            chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#4f46e5' }),
            chrome.action.setBadgeText({
              tabId: tab.id,
              text: activeTabs[String(tab.id)] ? 'SÍ' : '',
            }),
          ],
    ),
  );
}

export async function disableEverywhere(): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: [],
  });
  await clearDnrActivity().catch(() => undefined);
  let stateError: unknown;
  try {
    await writeActiveTabs({});
  } catch (error) {
    stateError = error;
  }
  await syncBadges({});
  await clearFakeHeaderAlarms();
  if (stateError) throw stateError;
}

function sanitizedActiveTabs(
  settings: FakeHeaderSettings,
  activeTabs: ActiveTabStateMap,
  secrets: SessionSecrets,
): ActiveTabStateMap {
  const output: ActiveTabStateMap = {};
  for (const state of Object.values(activeTabs)) {
    if (state.expiresAt && state.expiresAt <= Date.now()) continue;
    const profile = settings.profiles.find((item) => item.id === state.profileId && item.enabled);
    if (!profile || !activeProfileHasFeatures(settings, profile.id)) continue;
    if (
      state.environmentId &&
      !settings.environments.some((item) => item.id === state.environmentId)
    )
      continue;
    try {
      compileSessionRules(settings, { [String(state.tabId)]: state }, secrets);
      output[String(state.tabId)] = state;
    } catch {}
  }
  return output;
}

export async function reconcileStoredConfiguration(): Promise<void> {
  const [read, activeTabs, secrets] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    getSessionSecrets(),
  ]);
  if (!read.valid) {
    await disableEverywhere();
    return;
  }
  const safeTabs = sanitizedActiveTabs(read.settings, activeTabs, secrets);
  await replaceRules(compileSessionRules(read.settings, safeTabs, secrets));
  await writeActiveTabs(safeTabs);
  await syncBadges(safeTabs);
}

function describeSettingsChange(
  previous: FakeHeaderSettings,
  next: FakeHeaderSettings,
  supplied?: string,
): string {
  const clean = supplied?.trim().slice(0, 100);
  if (clean) return clean;
  if (JSON.stringify(previous.autoActivations) !== JSON.stringify(next.autoActivations))
    return 'Activación automática actualizada';
  if (JSON.stringify(previous.profiles) !== JSON.stringify(next.profiles))
      return 'Espacios de trabajo y reglas actualizados';
  if (JSON.stringify(previous.environments) !== JSON.stringify(next.environments))
    return 'Entornos actualizados';
  if (JSON.stringify(previous.templates) !== JSON.stringify(next.templates))
    return 'Plantillas actualizadas';
  if (JSON.stringify(previous.scripts) !== JSON.stringify(next.scripts))
      return 'Scripts de usuario actualizados';
  return 'Configuración actualizada';
}

export async function applySettingsTransaction(
  input: unknown,
  label?: string,
): Promise<OperationResult> {
  let next: FakeHeaderSettings;
  try {
    next = parseSettings(input);
  } catch {
    return { ok: false, error: 'La configuración contiene datos no válidos.' };
  }
  const [oldRead, oldTabs, oldSecrets, oldRules, oldHistory] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    getSessionSecrets(),
    chrome.declarativeNetRequest.getSessionRules(),
    getSettingsHistory(),
  ]);
  const baseTabs = oldRead.valid ? oldTabs : {};
  const nextSecrets = collectSessionSecrets(next, oldSecrets);
  const persistent = sanitizeSettingsForLocal(next);
  const safeTabs = sanitizedActiveTabs(persistent, baseTabs, nextSecrets);
  const changed = oldRead.valid && JSON.stringify(oldRead.settings) !== JSON.stringify(persistent);
  const nextHistory = changed
    ? withHistorySnapshot(oldHistory, {
        id: newId(),
        createdAt: Date.now(),
        label: describeSettingsChange(oldRead.settings, persistent, label),
        settings: sanitizeSettingsForLocal(oldRead.settings),
      })
    : oldHistory;
  try {
    if (!(await hasRequiredHostAccess(persistent, safeTabs))) {
      throw new Error('Missing host permissions');
    }
    if (!(await hasRequiredSafetyAccess(persistent))) throw new Error('Missing safety permission');
    await writeSessionSecrets(nextSecrets);
    await replaceRules(compileSessionRules(persistent, safeTabs, nextSecrets));
    await writeActiveTabs(safeTabs);
    await writePersistentSettings(persistent);
    if (changed) await writeSettingsHistory(nextHistory);
    await syncBadges(safeTabs);
    return { ok: true };
  } catch {
    try {
      const current = await chrome.declarativeNetRequest.getSessionRules();
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: current.map((rule) => rule.id),
        addRules: oldRules,
      });
      await writeSessionSecrets(oldSecrets);
      await writeActiveTabs(baseTabs);
      if (oldRead.valid) await writePersistentSettings(oldRead.settings);
      await writeSettingsHistory(oldHistory);
      await syncBadges(baseTabs);
    } catch {
      await disableEverywhere();
    }
    return {
      ok: false,
      error: 'No se pudieron aplicar los cambios. Se restauró el estado anterior de forma segura.',
    };
  }
}

export async function getConfigurationHistory(): Promise<SettingsHistoryResult> {
  return { ok: true, history: await getSettingsHistory() };
}

export async function restoreConfigurationSnapshot(snapshotId: string): Promise<OperationResult> {
  const snapshot = (await getSettingsHistory()).find((item) => item.id === snapshotId);
  if (!snapshot) return { ok: false, error: 'El snapshot ya no existe.' };
  return applySettingsTransaction(snapshot.settings, `Restaurado: ${snapshot.label}`);
}

export async function deleteConfigurationSnapshot(snapshotId: string): Promise<OperationResult> {
  const history = await getSettingsHistory();
  await writeSettingsHistory(history.filter((item) => item.id !== snapshotId));
  return { ok: true };
}

export async function clearConfigurationHistory(): Promise<OperationResult> {
  await writeSettingsHistory([]);
  return { ok: true };
}

let operationQueue: Promise<void> = Promise.resolve();
export function enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
