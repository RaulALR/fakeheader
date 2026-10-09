import { LEGACY_STORAGE_KEY, STORAGE_KEY, TAB_ALARM_PREFIX } from '../config';
import { clearScriptActivity, getActiveTabs, getScriptActivity } from '../storage/storage';
import {
  clearRecordings,
  ensureResponseCapture,
  getRecorderState,
  migrateReplacedRecording,
  recordResponseCapture,
  registerDebuggerCaptureListeners,
  registerTrafficRecorderListeners,
  startRecording,
  stopAllRecordings,
  stopRecording,
} from './traffic-recorder';
import { executeNavigationScripts, executeProfileScripts, removeProfileCss } from './script-engine';
import { clearDnrActivity, registerDnrActivityListener } from './dnr-activity';
import {
  activateTab,
  applySettingsTransaction,
  clearConfigurationHistory,
  deleteConfigurationSnapshot,
  deactivateTab,
  disableEverywhere,
  enqueueOperation,
  getExecutionInspector,
  getConfigurationHistory,
  getTabExecutionState,
  migrateReplacedTab,
  reconcileStoredConfiguration,
  handleCommittedNavigation,
  restoreConfigurationSnapshot,
  removeClosedTab,
  type OperationResult,
} from './rule-engine';

try {
  registerTrafficRecorderListeners();
  registerDebuggerCaptureListeners();
} catch {}

try {
  registerDnrActivityListener();
} catch {}

async function initialise(removeLegacy: boolean): Promise<void> {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (removeLegacy) {
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    if (dynamicRules.length)
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: dynamicRules.map((rule) => rule.id),
        addRules: [],
      });
  }
  await disableEverywhere();
}

function runSafely(operation: () => Promise<unknown>): void {
  void enqueueOperation(operation).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  runSafely(() => initialise(true));
});
chrome.runtime.onStartup.addListener(() => {
  runSafely(() => initialise(false));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) runSafely(reconcileStoredConfiguration);
});

chrome.permissions.onRemoved.addListener((permissions) => {
  runSafely(disableEverywhere);
  if (
    permissions.permissions?.some((permission) =>
      ['webRequest', 'scripting', 'webNavigation'].includes(permission),
    )
  )
    void stopAllRecordings().catch(() => undefined);
});

chrome.webNavigation?.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const responseCapture = ensureResponseCapture(details.tabId);
  runSafely(async () => {
    const navigation = await handleCommittedNavigation(details.tabId, details.url);
    await Promise.allSettled([
      responseCapture,
      ...(navigation.ok ? [executeNavigationScripts(details.tabId, details.url)] : []),
    ]);
    return navigation;
  });
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(TAB_ALARM_PREFIX)) return;
  const tabId = Number(alarm.name.slice(TAB_ALARM_PREFIX.length));
  if (Number.isInteger(tabId) && tabId >= 0) runSafely(() => deactivateTab(tabId));
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  void clearRecordings(tabId).catch(() => undefined);
  runSafely(async () => {
    const active = await getActiveTabs();
    if (active[String(tabId)]) await deactivateTab(tabId);
    else await chrome.action.setBadgeText({ tabId, text: '' });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runSafely(() => removeClosedTab(tabId));
  void stopRecording(tabId).catch(() => undefined);
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  runSafely(async () => {
    const migration = await migrateReplacedTab(addedTabId, removedTabId);
    await migrateReplacedRecording(addedTabId, removedTabId);
    if (!migration.ok) return migration;
    const tab = await chrome.tabs.get(addedTabId).catch(() => undefined);
    if (tab?.url) {
      await Promise.allSettled([
        executeNavigationScripts(addedTabId, tab.url),
        ensureResponseCapture(addedTabId),
      ]);
    }
    return migration;
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-options') {
    void chrome.runtime.openOptionsPage();
    return;
  }
  if (command === 'disable-current-tab' && tab?.id !== undefined) {
    runSafely(() => deactivateTab(tab.id!));
    return;
  }
  if (command === 'disable-everywhere') runSafely(disableEverywhere);
});

interface RuntimeMessage {
  type: string;
  tabId?: number;
  profileId?: string;
  environmentId?: string;
  durationMinutes?: number;
  settings?: unknown;
  snapshotId?: string;
  label?: string;
  scriptId?: string;
  captureToken?: string;
  responseCapture?: unknown;
}

function parseMessage(value: unknown): RuntimeMessage | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    typeof value.type !== 'string'
  )
    return null;
  const record = value as Record<string, unknown>;
  return {
    type: value.type,
    ...(Number.isInteger(record.tabId) ? { tabId: record.tabId as number } : {}),
    ...(typeof record.profileId === 'string' ? { profileId: record.profileId } : {}),
    ...(typeof record.environmentId === 'string' ? { environmentId: record.environmentId } : {}),
    ...(typeof record.durationMinutes === 'number' &&
    Number.isFinite(record.durationMinutes) &&
    record.durationMinutes >= 0
      ? { durationMinutes: record.durationMinutes }
      : {}),
    ...('settings' in record ? { settings: record.settings } : {}),
    ...(typeof record.snapshotId === 'string' ? { snapshotId: record.snapshotId } : {}),
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
    ...(typeof record.scriptId === 'string' ? { scriptId: record.scriptId } : {}),
    ...(typeof record.captureToken === 'string' ? { captureToken: record.captureToken } : {}),
    ...('responseCapture' in record ? { responseCapture: record.responseCapture } : {}),
  };
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const message = parseMessage(raw);
  if (!message) return false;
  let operation: Promise<OperationResult> | null = null;
  if (message.type === 'apply-settings')
    operation = enqueueOperation(() => applySettingsTransaction(message.settings, message.label));
  if (
    (message.type === 'activate-tab' || message.type === 'change-tab-profile') &&
    message.tabId !== undefined &&
    message.profileId
  )
    operation = enqueueOperation(() =>
      activateTab(
        message.tabId!,
        message.profileId!,
        message.environmentId,
        message.durationMinutes,
      ),
    );
  if (message.type === 'deactivate-tab' && message.tabId !== undefined)
    operation = enqueueOperation(() => deactivateTab(message.tabId!));
  if (message.type === 'get-tab-state' && message.tabId !== undefined)
    operation = enqueueOperation(() => getTabExecutionState(message.tabId!));
  if (message.type === 'get-execution-inspector')
    operation = enqueueOperation(getExecutionInspector);
  if (message.type === 'get-recorder-state') operation = getRecorderState();
  if (message.type === 'start-recording' && message.tabId !== undefined)
    operation = enqueueOperation(() => startRecording(message.tabId!));
  if (message.type === 'stop-recording' && message.tabId !== undefined)
    operation = enqueueOperation(() => stopRecording(message.tabId!));
  if (message.type === 'clear-recordings')
    operation = enqueueOperation(() => clearRecordings(message.tabId));
  if (
    message.type === 'record-response-body' &&
    sender.tab?.id !== undefined &&
    message.responseCapture !== undefined
  )
    operation = recordResponseCapture(sender.tab.id, message.captureToken, message.responseCapture);
  if (message.type === 'get-script-activity')
    operation = enqueueOperation(async () => ({ ok: true, activity: await getScriptActivity() }));
  if (message.type === 'clear-script-activity')
    operation = enqueueOperation(async () => {
      await clearScriptActivity(message.tabId, message.profileId);
      return { ok: true };
    });
  if (message.type === 'clear-dnr-activity')
    operation = enqueueOperation(async () => {
      await clearDnrActivity();
      return { ok: true };
    });
  if (
    message.type === 'execute-profile-scripts' &&
    message.tabId !== undefined &&
    message.profileId
  )
    operation = enqueueOperation(() =>
      executeProfileScripts(
        message.tabId!,
        message.profileId!,
        message.scriptId,
        message.environmentId,
      ),
    );
  if (message.type === 'remove-profile-css' && message.tabId !== undefined && message.profileId)
    operation = enqueueOperation(() =>
      removeProfileCss(message.tabId!, message.profileId!, message.scriptId, message.environmentId),
    );
  if (message.type === 'get-settings-history')
    operation = enqueueOperation(getConfigurationHistory);
  if (message.type === 'restore-settings-snapshot' && message.snapshotId)
    operation = enqueueOperation(() => restoreConfigurationSnapshot(message.snapshotId!));
  if (message.type === 'delete-settings-snapshot' && message.snapshotId)
    operation = enqueueOperation(() => deleteConfigurationSnapshot(message.snapshotId!));
  if (message.type === 'clear-settings-history')
    operation = enqueueOperation(clearConfigurationHistory);
  if (message.type === 'disable-everywhere')
    operation = enqueueOperation(async () => {
      await disableEverywhere();
      return { ok: true };
    });
  if (!operation) return false;
  void operation.then(sendResponse, () =>
    sendResponse({ ok: false, error: 'Error interno; FakeHeader ha fallado cerrado.' }),
  );
  return true;
});
