import { useRef, useState } from 'react';
import {
  importRequestlyRules,
  type RequestlyImportResult,
} from '../../import-export/requestly-import';
import type { HeaderRule } from '../../types/rule';
import type { EnvironmentVariable, UserScriptRule } from '../../types/profile';

export function RequestlyImporter({
  workspaceName,
  environmentName,
  onImport,
}: {
  workspaceName: string;
  environmentName: string;
  onImport: (
    rules: HeaderRule[],
    scripts: Array<Omit<UserScriptRule, 'profileId'>>,
    payloadVariables: EnvironmentVariable[],
  ) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<RequestlyImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const readFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('El archivo supera el límite de 5 MB.');
      setPreview(importRequestlyRules(await file.text()));
      setError('');
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo importar el archivo.');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const importRules = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      if (await onImport(preview.rules, preview.scripts, preview.payloadVariables)) {
        setPreview(null);
        setError('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel workspace-panel requestly-importer">
      <div className="toolbar">
        <div>
          <h2>Importar reglas de Requestly</h2>
          <p className="muted">
            Convierte cabeceras, redirecciones, cancelaciones, parámetros de consulta, agentes de usuario, retardos y cuerpos estáticos al
            espacio de trabajo <strong>{workspaceName}</strong>.
          </p>
        </div>
        <div className="actions">
          <button className="button secondary" onClick={() => input.current?.click()}>
            Seleccionar JSON de Requestly
          </button>
          <input
            ref={input}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
        </div>
      </div>
      <div className="notice">
        Todo se crea desactivado. No se activa el acceso a todos los sitios automáticamente y los secretos importados
        sólo permanecen en la sesión actual.
      </div>
      {preview?.payloadVariables.length ? (
        <div className="warning">
          Los {preview.payloadVariables.length} cuerpos se guardarán como secretos efímeros del
          entorno <strong>{environmentName}</strong>; desaparecerán al cerrar Chrome.
        </div>
      ) : null}
      {error && <div className="error">{error}</div>}
      {preview && (
        <div className="requestly-import-preview">
          <div className="stats-grid">
            <div>
              <strong>{preview.rules.length}</strong>
              <span>Reglas convertidas</span>
            </div>
            <div>
              <strong>{preview.scripts.length}</strong>
              <span>Scripts fetch</span>
            </div>
            <div>
              <strong>{preview.payloadVariables.length}</strong>
              <span>Cuerpos efímeros</span>
            </div>
            <div>
              <strong>{preview.skippedRules}</strong>
              <span>Reglas omitidas</span>
            </div>
            <div>
              <strong>{preview.skippedPairs}</strong>
              <span>Pares omitidos</span>
            </div>
            <div>
              <strong>{preview.sensitiveValues}</strong>
              <span>Secretos efímeros</span>
            </div>
          </div>
          {preview.warnings.length > 0 && (
            <details>
              <summary>Ver advertencias de conversión ({preview.warnings.length})</summary>
              <ul>
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="actions">
            <button className="button" disabled={busy} onClick={() => void importRules()}>
              {busy
                ? 'Importando...'
                : `Añadir ${preview.rules.length} reglas y ${preview.scripts.length} scripts desactivados`}
            </button>
            <button className="button secondary" disabled={busy} onClick={() => setPreview(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
