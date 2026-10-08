import { useEffect, useState } from 'react';
import type { RuleEnvironment } from '../../types/profile';
import { newId } from '../../utils/ids';

export function EnvironmentEditor({
  environment,
  onSave,
  onDelete,
}: {
  environment: RuleEnvironment;
  onSave: (environment: RuleEnvironment) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(environment);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  useEffect(() => setDraft(environment), [environment]);
  return (
    <div className="panel workspace-panel">
      <div className="toolbar">
        <div>
          <h2>{environment.name}</h2>
          <span className="muted">
            Usa variables como {'{{API_HOST}}'} en valores, redirecciones y parámetros de consulta.
          </span>
        </div>
        <button className="button danger small" onClick={onDelete}>
          Eliminar entorno
        </button>
      </div>
      <label className="field environment-name">
        Nombre
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <div className="variables-table">
        <div className="variables-head">
          <span>Variable</span>
          <span>Valor local</span>
          <span>Secreto</span>
          <span />
        </div>
        {draft.variables.map((variable) => (
          <div className="variable-row" key={variable.id}>
            <input
              value={variable.key}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  variables: current.variables.map((item) =>
                    item.id === variable.id ? { ...item, key: event.target.value } : item,
                  ),
                }))
              }
              placeholder="API_HOST"
            />
            <span className="inline-field">
              <input
                type={variable.sensitive && !revealed[variable.id] ? 'password' : 'text'}
                value={variable.value ?? ''}
                autoComplete="off"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    variables: current.variables.map((item) =>
                      item.id === variable.id ? { ...item, value: event.target.value } : item,
                    ),
                  }))
                }
                placeholder={variable.sensitive ? 'Sólo esta sesión' : 'localhost:8080'}
              />
              {variable.sensitive && (
                <button
                  className="button secondary small"
                  onClick={() =>
                    setRevealed((current) => ({
                      ...current,
                      [variable.id]: !current[variable.id],
                    }))
                  }
                >
                  {revealed[variable.id] ? 'Ocultar' : 'Ver'}
                </button>
              )}
            </span>
            <label className="center-check">
              <input
                type="checkbox"
                checked={Boolean(variable.sensitive)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    variables: current.variables.map((item) =>
                      item.id === variable.id
                        ? {
                            ...item,
                            sensitive: event.target.checked,
                            ...(event.target.checked
                              ? { valueRef: item.valueRef ?? newId() }
                              : { valueRef: undefined }),
                          }
                        : item,
                    ),
                  }))
                }
              />
            </label>
            <button
              className="icon-button danger-text"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  variables: current.variables.filter((item) => item.id !== variable.id),
                }))
              }
            >
              X
            </button>
          </div>
        ))}
      </div>
      <div className="actions">
        <button
          className="button secondary"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              variables: [
                ...current.variables,
                { id: newId(), key: '', value: '', sensitive: false },
              ],
            }))
          }
        >
          + Variable
        </button>
        <button className="button" onClick={() => onSave(draft)}>
          Guardar entorno
        </button>
      </div>
    </div>
  );
}
