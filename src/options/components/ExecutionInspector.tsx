import { useCallback, useEffect, useState } from 'react';
import type { ExecutionInspectorResult, ExecutionInspectorSnapshot } from '../../types/session';

function expiry(value?: number): string {
  if (!value) return 'Hasta cerrar la pestaña';
  const remaining = Math.max(0, Math.ceil((value - Date.now()) / 60_000));
  return `${new Date(value).toLocaleTimeString()} - ${remaining} min`;
}

export function ExecutionInspector() {
  const [snapshot, setSnapshot] = useState<ExecutionInspectorSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'get-execution-inspector',
      })) as ExecutionInspectorResult | undefined;
      if (!response?.ok || !response.snapshot)
        throw new Error(response?.error ?? 'No se pudo leer el estado de ejecución.');
      setSnapshot(response.snapshot);
      setError('');
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el inspector.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enableDiagnostics = async () => {
    setPermissionBusy(true);
    try {
      const granted = await chrome.permissions.request({
        permissions: [
          'declarativeNetRequestFeedback' as chrome.runtime.ManifestPermission,
        ],
      });
      if (!granted)
        throw new Error('Chrome no concedió el diagnóstico de coincidencias DNR.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo activar el diagnóstico.');
    } finally {
      setPermissionBusy(false);
    }
  };

  const clearActivity = async () => {
    setPermissionBusy(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'clear-dnr-activity',
      })) as { ok?: boolean; error?: string } | undefined;
      if (!response?.ok) throw new Error(response?.error ?? 'No se pudo limpiar la actividad.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo limpiar la actividad.');
    } finally {
      setPermissionBusy(false);
    }
  };

  if (loading && !snapshot)
    return <section className="panel workspace-panel">Leyendo reglas de sesión reales...</section>;
  if (error)
    return (
      <section className="panel workspace-panel">
        <div className="error">{error}</div>
        <button className="button secondary" onClick={() => void refresh()}>
          Reintentar
        </button>
      </section>
    );
  if (!snapshot) return null;
  const healthy = snapshot.tabs.every((tab) => tab.healthy) && !snapshot.orphanRules.length;
  const diagnosticsEnabled = snapshot.grantedPermissions.includes(
    'declarativeNetRequestFeedback',
  );
  const totalMatches = snapshot.ruleActivity.reduce((total, entry) => total + entry.count, 0);

  return (
    <div className="inspector-layout">
      <div className="stats-grid inspector-stats">
        <div>
          <strong>{snapshot.tabs.length}</strong>
          <span>Pestañas activas</span>
        </div>
        <div>
          <strong>{snapshot.totalSessionRules}</strong>
          <span>Reglas de sesión</span>
        </div>
        <div>
          <strong>{snapshot.grantedOrigins.length}</strong>
          <span>Permisos de sitio</span>
        </div>
        <div className={healthy ? '' : 'warning-stat'}>
          <strong>{healthy ? 'OK' : '!'}</strong>
          <span>{healthy ? 'Consistent' : 'Review state'}</span>
        </div>
      </div>
      <section className="panel workspace-panel">
        <div className="toolbar">
          <div>
            <h2>Estado real de Chrome</h2>
            <p className="muted">
              Leído de storage.session, permisos y declarativeNetRequest.getSessionRules().
            </p>
          </div>
          <button className="button secondary" disabled={loading} onClick={() => void refresh()}>
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
        <div className="inspector-diagnostics">
          <div>
            <strong>Actividad real por regla</strong>
            <span className="muted">
              {diagnosticsEnabled
                ? `${totalMatches} coincidencias en esta sesión. Sólo se guardan ID, pestaña, contador y fecha.`
                : 'Diagnóstico opcional para instalaciones locales. No guarda URLs ni cabeceras.'}
            </span>
          </div>
          {diagnosticsEnabled ? (
            <button
              className="button secondary small"
              disabled={permissionBusy || snapshot.ruleActivity.length === 0}
              onClick={() => void clearActivity()}
            >
              Limpiar actividad
            </button>
          ) : (
            <button
              className="button secondary small"
              disabled={permissionBusy}
              onClick={() => void enableDiagnostics()}
            >
              {permissionBusy ? 'Solicitando...' : 'Activar diagnóstico'}
            </button>
          )}
        </div>
        {snapshot.tabs.length ? (
          <div className="inspector-tabs">
            {snapshot.tabs.map((tab) => (
              <article className="inspector-tab" key={tab.tabId}>
                <div className="inspector-tab-heading">
                  <div>
                    <span className={tab.healthy ? 'match-check' : 'state-warning'}>
                      {tab.healthy ? 'CORRECTO' : '!'}
                    </span>
                    <strong>Pestaña {tab.tabId}</strong>
                    <span className="badge">{tab.rules.length} DNR</span>
                  </div>
                  <span className="muted">{expiry(tab.expiresAt)}</span>
                </div>
                <dl className="inspector-meta">
                  <div>
                    <dt>Espacio de trabajo</dt>
                    <dd>{tab.profileName}</dd>
                  </div>
                  <div>
                    <dt>Entorno</dt>
                    <dd>{tab.environmentName ?? 'Sin entorno'}</dd>
                  </div>
                  <div>
                    <dt>Origen vinculado</dt>
                    <dd>{tab.boundOrigin ?? 'No ligado'}</dd>
                  </div>
                </dl>
                {diagnosticsEnabled && (
                  <div className="rule-activity-list">
                    {snapshot.ruleActivity.filter((entry) => entry.tabId === tab.tabId).length ? (
                      snapshot.ruleActivity
                        .filter((entry) => entry.tabId === tab.tabId)
                        .map((entry) => {
                          const label = snapshot.ruleLabels.find(
                            (item) =>
                              item.dnrRuleId === entry.ruleId && item.profileId === tab.profileId,
                          );
                          return (
                            <div key={`${entry.tabId}-${entry.ruleId}`}>
                              <strong>{label?.name ?? `DNR #${entry.ruleId}`}</strong>
                              <code>{label?.kind ?? 'desconocido'} - #{entry.ruleId}</code>
                              <span>{entry.count} hits</span>
                              <time dateTime={new Date(entry.lastMatchedAt).toISOString()}>
                                {new Date(entry.lastMatchedAt).toLocaleTimeString()}
                              </time>
                            </div>
                          );
                        })
                    ) : (
                      <span className="muted">Sin coincidencias registradas para esta pestaña.</span>
                    )}
                  </div>
                )}
                <details>
                  <summary>Ver reglas de sesión censuradas</summary>
                  <pre>{JSON.stringify(tab.rules, null, 2)}</pre>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty large-empty">No hay pestañas activas ni reglas en ejecución.</div>
        )}
        {snapshot.orphanRules.length > 0 && (
          <div className="inspector-warning">
            <strong>{snapshot.orphanRules.length} reglas huérfanas detectadas</strong>
            <span>Usa Desactivar en todas las pestañas para eliminarlas de inmediato.</span>
          </div>
        )}
      </section>
      <section className="panel workspace-panel">
        <h2>Permisos concedidos</h2>
        <div className="permission-chips">
          {[...snapshot.grantedPermissions, ...snapshot.grantedOrigins].map((permission) => (
            <code key={permission}>{permission}</code>
          ))}
          {!snapshot.grantedPermissions.length && !snapshot.grantedOrigins.length && (
            <span className="muted">No hay permisos opcionales concedidos.</span>
          )}
        </div>
      </section>
    </div>
  );
}
