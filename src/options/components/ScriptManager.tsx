import { useEffect, useState } from 'react';
import type { UserScriptRule } from '../../types/profile';
import { USER_SCRIPT_TEMPLATES } from '../../scripts/templates';

function parsePatterns(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ScriptCard({
  script,
  onSave,
  onDelete,
}: {
  script: UserScriptRule;
  onSave: (script: UserScriptRule) => void;
  onDelete: (script: UserScriptRule) => void;
}) {
  const [draft, setDraft] = useState(script);
  const [matchesText, setMatchesText] = useState(script.matches.join('\n'));
  const [excludeMatchesText, setExcludeMatchesText] = useState(script.excludeMatches.join('\n'));
  useEffect(() => {
    setDraft(script);
    setMatchesText(script.matches.join('\n'));
    setExcludeMatchesText(script.excludeMatches.join('\n'));
  }, [script]);
  return (
    <section className="panel workspace-panel script-card">
      <div className="toolbar">
        <input
          className="script-name"
          value={draft.name}
          maxLength={80}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          aria-label="Nombre del script"
        />
        <div className="actions">
          <label className="switch" title="Script habilitado">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            <span className="slider" />
          </label>
          <button className="button" onClick={() => onSave(draft)}>
            Guardar
          </button>
          <button className="button danger" onClick={() => onDelete(script)}>
            Eliminar
          </button>
        </div>
      </div>
      <div className="script-options">
        <label className="field">
          Tipo
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: event.target.value as UserScriptRule['kind'] })
            }
          >
            <option value="javascript">JavaScript</option>
            <option value="css">CSS</option>
          </select>
        </label>
        <label className="field">
          Execution
          <select
            value={draft.execution}
            onChange={(event) =>
              setDraft({
                ...draft,
                execution: event.target.value as UserScriptRule['execution'],
              })
            }
          >
            <option value="manual">Manual desde el panel emergente</option>
            <option value="navigation">Automática al navegar</option>
          </select>
        </label>
        {draft.kind === 'javascript' && (
          <label className="field">
            Execution world
            <select
              value={draft.world}
              onChange={(event) =>
                setDraft({ ...draft, world: event.target.value as UserScriptRule['world'] })
              }
            >
              <option value="USER_SCRIPT">USER_SCRIPT (aislado)</option>
              <option value="MAIN">MAIN (contexto de la página)</option>
            </select>
          </label>
        )}
        {draft.kind === 'javascript' && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.injectImmediately}
              onChange={(event) => setDraft({ ...draft, injectImmediately: event.target.checked })}
            />
            Inyectar sin esperar a que termine de cargar
          </label>
        )}
      </div>
      {draft.execution === 'navigation' && (
        <div className="script-match-grid">
          <label className="field">
            URL patterns permitidos
            <textarea
              value={matchesText}
              onChange={(event) => {
                setMatchesText(event.target.value);
                setDraft({ ...draft, matches: parsePatterns(event.target.value) });
              }}
              placeholder={'http://localhost/*\nhttps://*.example.com/*'}
              spellCheck={false}
            />
          </label>
          <label className="field">
            URL patterns excluidos
            <textarea
              value={excludeMatchesText}
              onChange={(event) => {
                setExcludeMatchesText(event.target.value);
                setDraft({ ...draft, excludeMatches: parsePatterns(event.target.value) });
              }}
              placeholder="https://example.com/admin/*"
              spellCheck={false}
            />
          </label>
          <p className="muted script-match-help">
            Usa patrones de coincidencia HTTP(S). Sólo se ejecutará si la pestaña está activada con este espacio de trabajo.
            Al habilitarlo o modificarlo, recarga la página para aplicarlo a la siguiente navegación.
          </p>
        </div>
      )}
      {draft.kind === 'javascript' && draft.world === 'MAIN' && (
        <div className="warning">
          MAIN comparte el entorno JavaScript de la web. La página puede observar o interferir con
          el script.
        </div>
      )}
      <label className="field">
        {draft.kind === 'css' ? 'CSS' : 'JavaScript'}
        <textarea
          className="script-editor"
          value={draft.code}
          maxLength={100_000}
          spellCheck={false}
          onChange={(event) => setDraft({ ...draft, code: event.target.value })}
        />
      </label>
      <p className="muted">
        El código se guarda localmente. No incluyas tokens, contraseñas ni credenciales.
      </p>
      <p className="muted">
        Variables: usa <code>{draft.kind === 'css' ? '{{VARIABLE}}' : '{{JSON:VARIABLE}}'}</code>.
        En JavaScript se inserta como string JSON para evitar romper el código.
      </p>
    </section>
  );
}

export function ScriptManager({
  scripts,
  onCreate,
  onSave,
  onDelete,
}: {
  scripts: UserScriptRule[];
  onCreate: (templateId?: string) => void;
  onSave: (script: UserScriptRule) => void;
  onDelete: (script: UserScriptRule) => void;
}) {
  return (
    <>
      <section className="panel workspace-panel">
        <div className="toolbar">
          <div>
            <h2>Scripts del espacio de trabajo</h2>
            <p className="muted">
              Ejecución manual o automática, siempre limitada a una pestaña activada con este espacio de trabajo.
            </p>
          </div>
          <button className="button" onClick={() => onCreate()}>
            + Nuevo script
          </button>
        </div>
        <div className="notice">
          JavaScript requiere Chrome 135+ y la opción Permitir scripts de usuario. La ejecución automática solicita
          webNavigation y acceso sólo a los hosts configurados.
        </div>
      </section>
      <section className="panel workspace-panel script-template-panel">
        <div>
          <h2>Preajustes locales</h2>
          <p className="muted">Crean scripts desactivados para que puedas revisarlos antes de usarlos.</p>
        </div>
        <div className="template-grid">
          {USER_SCRIPT_TEMPLATES.map((template) => (
            <button
              className="template-card"
              key={template.id}
              onClick={() => onCreate(template.id)}
            >
              <strong>{template.title}</strong>
              <small>{template.description}</small>
            </button>
          ))}
        </div>
      </section>
      {scripts.length ? (
        scripts.map((script) => (
          <ScriptCard key={script.id} script={script} onSave={onSave} onDelete={onDelete} />
        ))
      ) : (
        <div className="empty large-empty">Este espacio de trabajo no tiene scripts.</div>
      )}
    </>
  );
}
