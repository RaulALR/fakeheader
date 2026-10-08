import { useRef, useState } from 'react';
import {
  exportEnvironmentDotenv,
  importEnvironmentText,
  type EnvironmentImportResult,
} from '../../import-export/environment-import';
import type { RuleEnvironment } from '../../types/profile';

function safeFileName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'environment';
}

export function EnvironmentTransfer({
  current,
  onImport,
}: {
  current?: RuleEnvironment;
  onImport: (environment: RuleEnvironment) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<EnvironmentImportResult | null>(null);
  const [error, setError] = useState('');

  const selectFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error('El archivo supera el límite de 512 KB.');
      const result = importEnvironmentText(await file.text(), file.name);
      setPreview(result);
      setError('');
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo importar el entorno.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const download = () => {
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob([exportEnvironmentDotenv(current)], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(current.name)}.env`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel workspace-panel environment-transfer">
      <div>
        <h2>Importar o exportar entorno</h2>
        <p className="muted">
          Admite `.env` y entornos Postman. Tokens, claves y contraseñas se marcan como secretos de
          sesión.
        </p>
      </div>
      <div className="actions">
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".env,.json,.postman_environment.json,application/json,text/plain"
          onChange={(event) => void selectFile(event.target.files?.[0])}
        />
        <button className="button secondary" onClick={() => inputRef.current?.click()}>
          Importar archivo
        </button>
        <button className="button secondary" disabled={!current} onClick={download}>
          Exportar actual como .env
        </button>
      </div>
      {error && <div className="error environment-transfer-message">{error}</div>}
      {preview && (
        <div className="environment-import-preview">
          <label className="field">
            Nombre del entorno
            <input
              value={preview.environment.name}
              maxLength={80}
              onChange={(event) =>
                setPreview({
                  ...preview,
                  environment: { ...preview.environment, name: event.target.value },
                })
              }
            />
          </label>
          <div>
            <strong>{preview.environment.variables.length}</strong>
            <span>variables</span>
          </div>
          <div>
            <strong>
              {preview.environment.variables.filter((variable) => variable.sensitive).length}
            </strong>
            <span>secretos</span>
          </div>
          <div>
            <strong>{preview.skipped}</strong>
            <span>deshabilitadas omitidas</span>
          </div>
          <button
            className="button"
            disabled={!preview.environment.name.trim()}
            onClick={() => {
              onImport(preview.environment);
              setPreview(null);
            }}
          >
            Crear entorno
          </button>
        </div>
      )}
    </section>
  );
}
