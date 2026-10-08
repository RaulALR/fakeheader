import { useCallback, useEffect, useState } from 'react';

const LABELS: Record<string, string> = {
  _execute_action: 'Abrir panel emergente',
  'disable-current-tab': 'Desactivar pestaña actual',
  'disable-everywhere': 'Desactivar en todas las pestañas',
  'open-options': 'Abrir configuración',
};

export function ShortcutManager() {
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  const refresh = useCallback(async () => setCommands(await chrome.commands.getAll()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <section className="panel workspace-panel">
      <div className="toolbar">
        <div>
          <h2>Atajos de teclado</h2>
          <p className="muted">
            Los atajos sólo apagan, abren el panel emergente o muestran Configuración; nunca activan reglas.
          </p>
        </div>
        <button className="button secondary small" onClick={() => void refresh()}>
          Actualizar
        </button>
      </div>
      <div className="permission-list compact-list">
        {commands.map((command) => (
          <div className="permission-row" key={command.name}>
            <div>
              <strong>{LABELS[command.name ?? ''] ?? command.description ?? command.name}</strong>
              <span className={command.shortcut ? 'permission-used' : 'permission-unused'}>
                {command.shortcut || 'SIN ASIGNAR'}
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="muted">
        Chrome permite cambiar estas combinaciones desde chrome://extensions/shortcuts.
      </p>
    </section>
  );
}
