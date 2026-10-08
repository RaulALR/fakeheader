import { useRef, useState } from 'react';
import {
  importModHeaderProfiles,
  type ModHeaderImportResult,
} from '../../import-export/modheader-import';
import type { HeaderProfile } from '../../types/profile';

export function ModHeaderImporter({
  onImport,
}: {
  onImport: (profiles: HeaderProfile[]) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ModHeaderImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const readFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('El archivo supera el límite de 5 MB.');
      setPreview(importModHeaderProfiles(await file.text()));
      setError('');
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo importar el archivo.');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const importProfiles = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      if (await onImport(preview.profiles)) {
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
          <h2>Importar perfiles de ModHeader</h2>
          <p className="muted">
            Convierte exportaciones clásicas y ModHeader v2 con secciones en espacios de trabajo independientes.
          </p>
        </div>
        <div className="actions">
          <button className="button secondary" onClick={() => input.current?.click()}>
            Seleccionar JSON de ModHeader
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
        Las cabeceras, cookies, CSP y redirecciones compatibles se crean desactivadas. Los perfiles globales y los
        filtros que no puedan conservarse exactamente se omiten; nunca se concede acceso a todos los sitios
        implícitamente.
      </div>
      {error && <div className="error">{error}</div>}
      {preview && (
        <div className="requestly-import-preview">
          <div className="stats-grid">
            <div>
              <strong>{preview.profiles.length}</strong>
              <span>Espacios nuevos</span>
            </div>
            <div>
              <strong>{preview.importedRules}</strong>
              <span>Reglas convertidas</span>
            </div>
            <div>
              <strong>{preview.skippedItems}</strong>
              <span>Elementos omitidos</span>
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
            <button className="button" disabled={busy} onClick={() => void importProfiles()}>
              {busy
                ? 'Importando...'
                : `Añadir ${preview.profiles.length} espacio${preview.profiles.length === 1 ? '' : 's'}`}
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
