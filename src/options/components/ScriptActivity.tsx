import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserScriptRule } from '../../types/profile';
import type { ScriptActivityEntry, ScriptActivityResult } from '../../types/script-activity';

const TRIGGER_LABELS: Record<ScriptActivityEntry['trigger'], string> = {
  manual: 'Manual',
  navigation: 'Navegación',
  'remove-css': 'Retirar CSS',
};

export function ScriptActivity({
  profileId,
  scripts,
}: {
  profileId: string;
  scripts: UserScriptRule[];
}) {
  const [activity, setActivity] = useState<ScriptActivityEntry[]>([]);
  const [error, setError] = useState('');
  const names = useMemo(
    () => new Map(scripts.map((script) => [script.id, script.name])),
    [scripts],
  );
  const refresh = useCallback(async () => {
    const response = (await chrome.runtime.sendMessage({
      type: 'get-script-activity',
    })) as ScriptActivityResult | undefined;
    if (!response?.ok) {
      setError(response?.error ?? 'No se pudo leer la actividad de scripts.');
      return;
    }
    setError('');
    setActivity(
      (response.activity ?? []).filter((entry) => entry.profileId === profileId).slice(0, 20),
    );
  }, [profileId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const clear = async () => {
    if (!window.confirm('¿Vaciar la actividad de scripts de este espacio de trabajo?')) return;
    const response = (await chrome.runtime.sendMessage({
      type: 'clear-script-activity',
      profileId,
    })) as ScriptActivityResult | undefined;
    if (!response?.ok) {
      setError(response?.error ?? 'No se pudo limpiar la actividad.');
      return;
    }
    await refresh();
  };
  return (
    <section className="panel workspace-panel script-activity-panel">
      <div className="toolbar">
        <div>
          <h2>Actividad de scripts</h2>
          <p className="muted">
            Historial de sesión sin código, URLs, resultados ni contenido de la página.
          </p>
        </div>
        <div className="actions">
          <button className="button secondary small" onClick={() => void refresh()}>
          Actualizar
          </button>
          <button
            className="button danger small"
            disabled={!activity.length}
            onClick={() => void clear()}
          >
            Clear
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {activity.length ? (
        <div className="script-activity-list">
          {activity.map((entry) => (
            <div className="script-activity-row" key={entry.id}>
              <span className={`activity-status ${entry.ok ? 'ok' : 'failed'}`}>
                {entry.ok ? 'OK' : 'ERROR'}
              </span>
              <div>
                <strong>
                  {TRIGGER_LABELS[entry.trigger]} - Pestaña {entry.tabId}
                </strong>
                <span className="muted">
                  {entry.scriptIds.map((id) => names.get(id) ?? 'Script eliminado').join(', ') ||
                    'Sin scripts'}
                </span>
                {entry.error && <span className="activity-error">{entry.error}</span>}
              </div>
              <time dateTime={new Date(entry.createdAt).toISOString()}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">Todavía no hay ejecuciones registradas en esta sesión.</div>
      )}
    </section>
  );
}
