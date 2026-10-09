import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVE_TABS_KEY, APP_NAME, RECORDER_KEY, SCRIPT_ACTIVITY_KEY } from '../config';
import type { HeaderRule } from '../types/rule';
import type { RecorderResult } from '../types/recorder';
import type { ScriptActivityEntry, ScriptActivityResult } from '../types/script-activity';
import { newId } from '../utils/ids';
import {
  originsForProfiles,
  requestAutomaticScriptAccess,
  requestHostAccess,
} from '../utils/permissions';
import { isSensitiveHeader } from '../utils/sensitive';
import { SensitiveValue } from '../ui/SensitiveValue';
import { useSettings } from '../ui/use-settings';

interface RuntimeResult {
  ok?: boolean;
  error?: string;
  enabled?: boolean;
  profileId?: string;
  environmentId?: string;
  expiresAt?: number;
}
interface ScriptExecutionResult {
  ok?: boolean;
  error?: string;
  executed?: number;
  removed?: number;
}
function displayRuleName(rule: HeaderRule): string {
  return rule.name || rule.header || (rule.kind ?? 'headers');
}
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch" title={label}>
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="slider" />
    </label>
  );
}

export default function App() {
  const { settings, error, notice, setError, commit, reload } = useSettings();
  const [tabId, setTabId] = useState<number>();
  const [tabStateLoaded, setTabStateLoaded] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [expiresAt, setExpiresAt] = useState<number>();
  const [adding, setAdding] = useState(false);
  const [header, setHeader] = useState('X-FakeHeader-Test');
  const [value, setValue] = useState('hello');
  const [domain, setDomain] = useState('localhost');
  const [quickSecretRevealed, setQuickSecretRevealed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedRequests, setRecordedRequests] = useState(0);
  const [recorderCaptureError, setRecorderCaptureError] = useState('');
  const [scriptNotice, setScriptNotice] = useState('');
  const [lastScriptActivity, setLastScriptActivity] = useState<ScriptActivityEntry>();
  const tabRefreshVersion = useRef(0);
  const recorderRefreshVersion = useRef(0);
  const scriptRefreshVersion = useRef(0);
  const refreshScriptActivity = useCallback(async (currentTabId: number) => {
    const version = ++scriptRefreshVersion.current;
    const response = (await chrome.runtime.sendMessage({
      type: 'get-script-activity',
    })) as ScriptActivityResult | undefined;
    if (version !== scriptRefreshVersion.current) return;
    setLastScriptActivity(
      response?.ok ? response.activity?.find((entry) => entry.tabId === currentTabId) : undefined,
    );
  }, []);
  const refreshRecorder = useCallback(async (currentTabId: number) => {
    const version = ++recorderRefreshVersion.current;
    const response = (await chrome.runtime.sendMessage({
      type: 'get-recorder-state',
    })) as RecorderResult | undefined;
    if (version !== recorderRefreshVersion.current) return;
    const session = response?.state?.tabs[String(currentTabId)];
    setRecording(Boolean(session?.active));
    setRecordedRequests(session?.entries.length ?? 0);
    setRecorderCaptureError(session?.captureError ?? '');
  }, []);
  const refreshTabState = useCallback(async () => {
    const version = ++tabRefreshVersion.current;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id === undefined || version !== tabRefreshVersion.current) return;
    const execution = (await chrome.runtime.sendMessage({
      type: 'get-tab-state',
      tabId: tab.id,
    })) as RuntimeResult;
    if (version !== tabRefreshVersion.current) return;
    setTabId(tab.id);
    const profileId = execution.enabled ? (execution.profileId ?? '') : '';
    setActiveProfileId(profileId);
    setSelectedProfileId((current) => profileId || current);
    if (execution.enabled) setSelectedEnvironmentId(execution.environmentId ?? '');
    setTabStateLoaded(true);
    setExpiresAt(execution.expiresAt);
    await Promise.all([refreshRecorder(tab.id), refreshScriptActivity(tab.id)]);
  }, [refreshRecorder, refreshScriptActivity]);
  useEffect(() => {
    void refreshTabState();
  }, [refreshTabState]);
  useEffect(() => {
    if (tabId === undefined) return;
    let tabTimer: number | undefined;
    let recorderTimer: number | undefined;
    let scriptTimer: number | undefined;
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'session') return;
      if (changes[ACTIVE_TABS_KEY]) {
        if (tabTimer !== undefined) window.clearTimeout(tabTimer);
        tabTimer = window.setTimeout(() => void refreshTabState(), 50);
      }
      if (changes[RECORDER_KEY]) {
        if (recorderTimer !== undefined) window.clearTimeout(recorderTimer);
        recorderTimer = window.setTimeout(() => void refreshRecorder(tabId), 100);
      }
      if (changes[SCRIPT_ACTIVITY_KEY]) {
        if (scriptTimer !== undefined) window.clearTimeout(scriptTimer);
        scriptTimer = window.setTimeout(() => void refreshScriptActivity(tabId), 50);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      if (tabTimer !== undefined) window.clearTimeout(tabTimer);
      if (recorderTimer !== undefined) window.clearTimeout(recorderTimer);
      if (scriptTimer !== undefined) window.clearTimeout(scriptTimer);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [refreshRecorder, refreshScriptActivity, refreshTabState, tabId]);
  const profile = useMemo(
    () =>
      settings?.profiles.find((item) => item.id === (activeProfileId || selectedProfileId)) ??
      settings?.profiles.find((item) => item.enabled),
    [settings, activeProfileId, selectedProfileId],
  );
  const orderedRules = useMemo(
    () =>
      [...(profile?.rules ?? [])].sort(
        (first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned)),
      ),
    [profile],
  );
  const totalRuleCount = profile?.rules.length ?? 0;
  const enabledRuleCount = profile?.rules.filter((rule) => rule.enabled).length ?? 0;
  const environmentNeedsSecret = (environmentId: string) =>
    settings?.environments
      .find((item) => item.id === environmentId)
      ?.variables.some((variable) => variable.sensitive && variable.value === undefined) ?? false;
  useEffect(() => {
    if (profile && !selectedProfileId) setSelectedProfileId(profile.id);
  }, [profile, selectedProfileId]);
  useEffect(() => {
    if (tabStateLoaded && !activeProfileId && !selectedEnvironmentId && settings?.environments[0])
      setSelectedEnvironmentId(settings.environments[0].id);
  }, [activeProfileId, selectedEnvironmentId, settings, tabStateLoaded]);
  if (!settings || tabId === undefined)
    return (
      <main className="popup">
        <p className="muted">Cargando pestaña actual...</p>
        {error && <p className="error">{error}</p>}
      </main>
    );
  const enabledHere = Boolean(activeProfileId);
  const sendTabAction = async (
    type: 'activate-tab' | 'change-tab-profile' | 'deactivate-tab',
    profileId?: string,
    environmentId?: string,
    requestedDuration?: number,
  ) => {
    const response = (await chrome.runtime.sendMessage({
      type,
      tabId,
      ...(profileId ? { profileId } : {}),
      ...(environmentId ? { environmentId } : {}),
      ...(requestedDuration !== undefined ? { durationMinutes: requestedDuration } : {}),
    })) as RuntimeResult | undefined;
    if (!response?.ok) {
      setError(response?.error ?? 'La operación falló de forma segura.');
      return;
    }
    setError('');
    await Promise.all([refreshTabState(), reload()]);
  };
  const enable = async () => {
    if (!profile) {
      setError('No hay un perfil activo disponible.');
      return;
    }
    if (selectedEnvironmentId && environmentNeedsSecret(selectedEnvironmentId)) {
      setError('El entorno necesita valores secretos para esta sesión. Añádelos en Configuración.');
      return;
    }
    if (
      profile.rules.some(
        (rule) =>
          rule.enabled &&
          (rule.kind ?? 'headers') === 'headers' &&
          rule.sensitive &&
          rule.operation !== 'remove' &&
          rule.value === undefined,
      )
    ) {
      setError('Este perfil necesita valores secretos para esta sesión. Añádelos en Configuración.');
      return;
    }
    if (
      !(await requestAutomaticScriptAccess(
        settings.scripts.filter((script) => script.profileId === profile.id),
      )) ||
      !(await requestHostAccess([profile]))
    )
      return;
    if (durationMinutes > 0) {
      const granted = await chrome.permissions.request({ permissions: ['alarms'] });
      if (!granted) {
        setError('Se necesita el permiso alarms para activar una caducidad fiable.');
        return;
      }
    }
    await sendTabAction(
      'activate-tab',
      profile.id,
      selectedEnvironmentId || undefined,
      durationMinutes,
    );
  };
  const selectProfile = async (profileId: string) => {
    setSelectedProfileId(profileId);
    if (!enabledHere) return;
    const next = settings.profiles.find((item) => item.id === profileId);
    if (
      next?.rules.some(
        (rule) =>
          rule.enabled &&
          (rule.kind ?? 'headers') === 'headers' &&
          rule.sensitive &&
          rule.operation !== 'remove' &&
          rule.value === undefined,
      )
    ) {
      setError('Ese perfil necesita valores secretos para esta sesión. Añádelos en Configuración.');
      return;
    }
    if (
      !next ||
      !(await requestAutomaticScriptAccess(
        settings.scripts.filter((script) => script.profileId === next.id),
      )) ||
      !(await requestHostAccess([next]))
    )
      return;
    await sendTabAction('change-tab-profile', profileId, selectedEnvironmentId || undefined);
  };
  const selectEnvironment = async (environmentId: string) => {
    setSelectedEnvironmentId(environmentId);
    if (environmentNeedsSecret(environmentId)) {
      setError('Ese entorno necesita valores secretos para esta sesión. Añádelos en Configuración.');
      return;
    }
    if (enabledHere && profile)
      await sendTabAction('change-tab-profile', profile.id, environmentId || undefined);
  };
  const updateRule = (id: string, enabled: boolean) => {
    if (!profile) return;
    void commit({
      ...settings,
      profiles: settings.profiles.map((item) =>
        item.id === profile.id
          ? {
              ...item,
              rules: item.rules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)),
            }
          : item,
      ),
    }).then((saved) => {
      if (saved) void refreshTabState();
    });
  };
  const addRule = () => {
    if (!profile) return;
    const rule: HeaderRule = {
      id: newId(),
      enabled: true,
      target: 'request',
      operation: 'set',
      header: header.trim(),
      value,
      pinned: true,
      ...(isSensitiveHeader(header) ? { sensitive: true, valueRef: newId() } : {}),
      domains: [domain.trim()],
    };
    void commit({
      ...settings,
      profiles: settings.profiles.map((item) =>
        item.id === profile.id ? { ...item, rules: [...item.rules, rule] } : item,
      ),
    }).then((saved) => {
      if (saved) {
        setAdding(false);
        void refreshTabState();
      }
    });
  };
  const toggleRecording = async () => {
    if (!recording) {
      const recorderOrigins = profile ? originsForProfiles([profile]) : [];
      if (
        !window.confirm(
          `FakeHeader conectará el depurador de red de Chrome a esta pestaña para capturar las respuestas completas. Los cuerpos pueden contener datos personales o secretos y se conservarán únicamente durante la sesión. DevTools debe permanecer cerrado mientras se graba.\n\nHosts solicitados:\n${recorderOrigins.length ? recorderOrigins.join('\n') : 'Ninguno nuevo; sólo la pestaña actual.'}\n\n¿Empezar?`,
        )
      )
        return;
      const granted = await chrome.permissions.request({
        permissions: ['webRequest', 'scripting', 'webNavigation'],
        ...(recorderOrigins.length ? { origins: recorderOrigins } : {}),
      });
      if (!granted) {
        setError(
          'Se necesitan los permisos webRequest, scripting y webNavigation para capturar respuestas completas.',
        );
        return;
      }
    }
    const response = (await chrome.runtime.sendMessage({
      type: recording ? 'stop-recording' : 'start-recording',
      tabId,
    })) as RecorderResult | undefined;
    if (!response?.ok) {
      setError(response?.error ?? 'No se pudo cambiar el estado del grabador.');
      return;
    }
    setError('');
    await refreshRecorder(tabId);
  };
  const runScripts = async (scriptId?: string) => {
    if (!profile) return;
    const scripts = settings.scripts.filter(
      (script) =>
        script.profileId === profile.id &&
        script.enabled &&
        (scriptId === undefined || script.id === scriptId),
    );
    if (!scripts.length) {
      setError('No hay scripts habilitados para ejecutar.');
      return;
    }
    const permissions: chrome.runtime.ManifestPermission[] = [
      ...(scripts.some((script) => script.kind === 'javascript')
        ? (['userScripts'] as chrome.runtime.ManifestPermission[])
        : []),
      ...(scripts.some((script) => script.kind === 'css')
        ? (['scripting'] as chrome.runtime.ManifestPermission[])
        : []),
    ];
    const granted = await chrome.permissions.request({ permissions });
    if (!granted) {
      setError('Se necesitan permisos opcionales para ejecutar estos scripts.');
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'execute-profile-scripts',
      tabId,
      profileId: profile.id,
      ...(selectedEnvironmentId ? { environmentId: selectedEnvironmentId } : {}),
      ...(scriptId ? { scriptId } : {}),
    })) as ScriptExecutionResult | undefined;
    if (!response?.ok) {
      setError(response?.error ?? 'Chrome rechazó la ejecución del script.');
      return;
    }
    setError('');
    setScriptNotice(`${response.executed ?? 0} scripts ejecutados.`);
    await refreshScriptActivity(tabId);
    window.setTimeout(() => setScriptNotice(''), 1800);
  };
  const removeCss = async (scriptId?: string) => {
    if (!profile) return;
    const granted = await chrome.permissions.request({ permissions: ['scripting'] });
    if (!granted) {
      setError('Se necesita el permiso scripting para retirar CSS.');
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'remove-profile-css',
      tabId,
      profileId: profile.id,
      ...(selectedEnvironmentId ? { environmentId: selectedEnvironmentId } : {}),
      ...(scriptId ? { scriptId } : {}),
    })) as ScriptExecutionResult | undefined;
    if (!response?.ok) {
      setError(response?.error ?? 'No se pudo retirar el CSS.');
      return;
    }
    setError('');
    setScriptNotice(`${response.removed ?? 0} estilos retirados.`);
    await refreshScriptActivity(tabId);
    window.setTimeout(() => setScriptNotice(''), 1800);
  };
  return (
    <main className="popup">
      <header className="app-header">
        <div className="brand">
          <span className="mark">F</span>
          <div>
            <h1>{APP_NAME}</h1>
            <div className="subtitle">Pestaña actual</div>
          </div>
        </div>
        <span className={`tab-status ${enabledHere ? 'on' : 'off'}`}>
          {enabledHere ? 'ACTIVO' : 'INACTIVO'}
        </span>
      </header>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {scriptNotice && <div className="notice">{scriptNotice}</div>}
      <label className="field">
        Perfil
        <select
          value={profile?.id ?? ''}
          onChange={(event) => void selectProfile(event.target.value)}
        >
          {settings.profiles
            .filter((item) => item.enabled)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      {settings.environments.length > 0 && (
        <label className="field" style={{ marginTop: 10 }}>
          Entorno
          <select
            value={selectedEnvironmentId}
            onChange={(event) => void selectEnvironment(event.target.value)}
          >
            <option value="">Sin entorno</option>
            {settings.environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="current-tab-action">
        <strong>{enabledHere ? 'Activado en esta pestaña' : 'Desactivado en esta pestaña'}</strong>
        <span className="muted">
          Reglas activas: {enabledRuleCount} de {totalRuleCount}
        </span>
        {enabledHere && expiresAt && (
          <span className="muted">Caduca: {new Date(expiresAt).toLocaleTimeString()}</span>
        )}
        {enabledHere ? (
          <button className="button danger" onClick={() => void sendTabAction('deactivate-tab')}>
            Desactivar en esta pestaña
          </button>
        ) : (
          <button className="button" onClick={() => void enable()}>
            Activar en esta pestaña
          </button>
        )}
      </div>
      <label className="field activation-duration">
        Duración de la activación
        <select
          value={durationMinutes}
          disabled={enabledHere}
          onChange={(event) => setDurationMinutes(Number(event.target.value))}
        >
          <option value={0}>Hasta cerrar esta pestaña</option>
          <option value={5}>5 minutos</option>
          <option value={30}>30 minutos</option>
          <option value={60}>1 hora</option>
        </select>
      </label>
      <div className="current-tab-action recorder-popup-card">
        <strong>{recording ? 'Grabando esta pestaña' : 'Grabador de tráfico'}</strong>
        <span className="muted">
          {recordedRequests} solicitudes - cabeceras censuradas - respuestas completas
        </span>
        {recorderCaptureError && <span className="activity-error">{recorderCaptureError}</span>}
        <button
          className={recording ? 'button danger' : 'button secondary'}
          onClick={() => void toggleRecording()}
        >
          {recording ? 'Detener grabación' : 'Iniciar grabación'}
        </button>
      </div>
      {settings.scripts.some((script) => script.profileId === profile?.id) && (
        <div className="current-tab-action recorder-popup-card">
          <strong>Scripts de usuario</strong>
          <span className="muted">
            {
              settings.scripts.filter(
                (script) => script.profileId === profile?.id && script.enabled,
              ).length
            }{' '}
            activados
          </span>
          {lastScriptActivity && lastScriptActivity.profileId === profile?.id && (
            <span className={lastScriptActivity.ok ? 'muted' : 'activity-error'}>
              Última actividad: {lastScriptActivity.trigger} -{' '}
              {lastScriptActivity.ok ? 'OK' : 'ERROR'} -{' '}
              {new Date(lastScriptActivity.createdAt).toLocaleTimeString()}
            </span>
          )}
          <button
            className="button secondary"
            disabled={
              !settings.scripts.some((script) => script.profileId === profile?.id && script.enabled)
            }
            onClick={() => void runScripts()}
          >
            Ejecutar scripts activados
          </button>
          <div className="popup-script-list">
            {settings.scripts
              .filter((script) => script.profileId === profile?.id)
              .map((script) => (
                <div className="popup-script-row" key={script.id}>
                  <button
                    className="button secondary small"
                    disabled={!script.enabled}
                    onClick={() => void runScripts(script.id)}
                  >
                    {script.kind === 'css' ? 'CSS: ' : 'JS: '}
                    {script.name}
                    {script.execution === 'navigation' ? ' (auto)' : ''}
                  </button>
                  {script.kind === 'css' && (
                    <button
                      className="button secondary small"
                      onClick={() => void removeCss(script.id)}
                      title="Retirar este CSS de la página actual"
                    >
                      Retirar
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
      <h3>Reglas del perfil</h3>
      <div className="rule-list">
        {orderedRules.length ? (
          orderedRules.map((rule) => (
            <div className={'rule-row ' + (rule.pinned ? 'pinned-rule' : '')} key={rule.id}>
              <Toggle
                checked={rule.enabled}
                label={`Activar ${displayRuleName(rule)}`}
                onChange={(enabled) => updateRule(rule.id, enabled)}
              />
              <div>
                <div className="rule-title">
                  {rule.pinned ? 'Fijada - ' : ''}
                  {displayRuleName(rule)}
                </div>
                {(rule.kind ?? 'headers') === 'headers' ? (
                  <SensitiveValue
                    header={rule.header ?? ''}
                    value={rule.operation === 'remove' ? '(eliminar)' : rule.value}
                    sensitive={rule.sensitive}
                  />
                ) : (
                  <span className="value-preview">{rule.kind}</span>
                )}
                {rule.group && <span className="popup-rule-group">{rule.group}</span>}
              </div>
              <span className="badge">{rule.kind ?? rule.target}</span>
            </div>
          ))
        ) : (
          <div className="empty">Este perfil aún no tiene reglas.</div>
        )}
      </div>
      {adding ? (
        <div className="quick-add">
          <label className="field">
            Cabecera
            <input value={header} onChange={(event) => setHeader(event.target.value)} />
          </label>
          <label className="field">
            Valor
            <span style={{ display: 'flex', gap: 6 }}>
              <input
                type={isSensitiveHeader(header) && !quickSecretRevealed ? 'password' : 'text'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                autoComplete="off"
              />
              {isSensitiveHeader(header) && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setQuickSecretRevealed((current) => !current)}
                >
                  {quickSecretRevealed ? 'Ocultar' : 'Ver'}
                </button>
              )}
            </span>
          </label>
          <label className="field">
            Host
            <input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="localhost"
            />
          </label>
          <div className="actions">
            <button className="button small" onClick={addRule}>
              Guardar regla
            </button>
            <button className="button secondary small" onClick={() => setAdding(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          className="button secondary"
          style={{ width: '100%', marginTop: 12 }}
          onClick={() => setAdding(true)}
        >
          + Añadir cabecera
        </button>
      )}
      <footer className="popup-footer">
        <button className="button secondary" onClick={() => chrome.runtime.openOptionsPage()}>
          Configuración
        </button>
      </footer>
    </main>
  );
}
