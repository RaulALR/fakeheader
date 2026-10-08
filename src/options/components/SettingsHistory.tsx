import { useCallback, useEffect, useState } from 'react';
import type { SettingsHistory as History, SettingsHistoryResult } from '../../types/history';

interface Result {
  ok?: boolean;
  error?: string;
}

export function SettingsHistory({ onRestored }: { onRestored: () => Promise<void> }) {
  const [history, setHistory] = useState<History>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = (await chrome.runtime.sendMessage({
      type: 'get-settings-history',
    })) as SettingsHistoryResult | undefined;
    if (!response?.ok) {
      setError(response?.error ?? 'No se pudo leer el historial.');
      return;
    }
    setHistory(response.history ?? []);
    setError('');
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const restore = async (id: string) => {
    if (
      !window.confirm('¿Restaurar esta configuración? El estado actual se guardará para deshacer.')
    )
      return;
    setBusy(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'restore-settings-snapshot',
        snapshotId: id,
      })) as Result | undefined;
      if (!response?.ok) throw new Error(response?.error);
      await onRestored();
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message ? reason.message : 'No se pudo restaurar.',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const response = (await chrome.runtime.sendMessage({
      type: 'delete-settings-snapshot',
      snapshotId: id,
    })) as Result | undefined;
    if (!response?.ok) return setError(response?.error ?? 'No se pudo eliminar el snapshot.');
    await refresh();
  };

  const clear = async () => {
    if (!window.confirm('¿Vaciar todo el historial local? Esta acción no se puede deshacer.'))
      return;
    const response = (await chrome.runtime.sendMessage({
      type: 'clear-settings-history',
    })) as Result | undefined;
    if (!response?.ok) return setError(response?.error ?? 'No se pudo vaciar el historial.');
    await refresh();
  };

  return (
    <section className="panel workspace-panel">
      <div className="toolbar">
        <div>
          <h2>Instantáneas locales</h2>
          <p className="muted">
            Se conservan hasta 20 estados anteriores. Los secretos de sesión nunca se incluyen.
          </p>
        </div>
        <button
          className="button danger small"
          disabled={!history.length || busy}
          onClick={() => void clear()}
        >
          Vaciar historial
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="permission-list history-list">
        {history.length ? (
          history.map((snapshot, index) => {
            const ruleCount = snapshot.settings.profiles.reduce(
              (sum, profile) => sum + profile.rules.length,
              0,
            );
            return (
              <div className="permission-row history-row" key={snapshot.id}>
                <div>
                  <strong>{index === 0 ? `Deshacer: ${snapshot.label}` : snapshot.label}</strong>
                  <span className="muted">
                    {new Date(snapshot.createdAt).toLocaleString()} -{' '}
                    {snapshot.settings.profiles.length} espacios - {ruleCount} reglas
                  </span>
                </div>
                <div className="actions">
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => void restore(snapshot.id)}
                  >
                    Restaurar
                  </button>
                  <button
                    className="button danger small"
                    disabled={busy}
                    onClick={() => void remove(snapshot.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty">El historial aparecerá después del siguiente cambio.</div>
        )}
      </div>
    </section>
  );
}
