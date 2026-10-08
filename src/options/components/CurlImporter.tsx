import { useMemo, useState } from 'react';
import { importCurlCommand, type CurlImportResult } from '../../import-export/curl-import';
import type { HeaderRule } from '../../types/rule';
import { maskSensitiveValue } from '../../utils/sensitive';

const EXAMPLE = `curl 'http://localhost:3000/api/users' \\
  -H 'iv-user: caca' \\
  -H 'Authorization: Bearer replace-me'`;

export function CurlImporter({
  workspaceName,
  onImport,
}: {
  workspaceName: string;
  onImport: (rules: HeaderRule[]) => Promise<boolean>;
}) {
  const [command, setCommand] = useState(EXAMPLE);
  const [scope, setScope] = useState<'host' | 'path'>('host');
  const [result, setResult] = useState<CurlImportResult | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const analysis = useMemo(() => ({ command, scope }), [command, scope]);

  const analyze = () => {
    try {
      setResult(importCurlCommand(analysis.command, { scope: analysis.scope }));
      setError('');
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo analizar el comando.');
    }
  };
  const save = async () => {
    if (!result) return;
    setSaving(true);
    const ok = await onImport(result.rules);
    setSaving(false);
    if (ok) setResult(null);
  };

  return (
    <section className="panel workspace-panel curl-importer">
      <div className="curl-security-note">
        <strong>Análisis local</strong>
        <span>
          El comando se interpreta como texto: no se ejecuta, no abre la URL y no importa el cuerpo.
        </span>
      </div>
      <label className="field">
        Comando cURL
        <textarea
          className="curl-input"
          rows={9}
          spellCheck={false}
          value={command}
          onChange={(event) => {
            setCommand(event.target.value);
            setResult(null);
          }}
        />
      </label>
      <div className="curl-controls">
        <label className="field">
          Alcance de las reglas
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as 'host' | 'path');
              setResult(null);
            }}
          >
            <option value="host">Todo el host y puerto</option>
            <option value="path">Sólo esta URL y sus prefijos</option>
          </select>
        </label>
        <button className="button" onClick={analyze}>
          Analizar cURL
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <div className="curl-preview">
          <div className="curl-summary">
            <span className="badge">{result.method ?? 'AUTO'}</span>
            <strong>{result.url}</strong>
            <span>{result.headers.length} cabeceras</span>
          </div>
          {result.headers.map((header) => (
            <div className="curl-header" key={header.name.toLowerCase()}>
              <div>
                <strong>{header.name}</strong>
                {header.sensitive && <span className="badge secret-badge">SECRETO</span>}
              </div>
              <code>
                {header.operation === 'remove'
                  ? 'Eliminar cabecera'
                  : header.sensitive
                    ? maskSensitiveValue(header.value)
                    : header.value || '(valor vacío)'}
              </code>
            </div>
          ))}
          {result.warnings.map((warning) => (
            <div className="curl-warning" key={warning}>
              {warning}
            </div>
          ))}
          <div className="curl-save-row">
            <p className="muted">
              Se añadirán desactivadas a <strong>{workspaceName}</strong>. Revísalas antes de
              activarlas.
            </p>
            <button className="button" disabled={saving} onClick={() => void save()}>
              {saving ? 'Importando...' : `Importar ${result.rules.length} reglas`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
