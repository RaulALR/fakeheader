import { useEffect, useState } from 'react';
import {
  REQUEST_METHODS,
  RESOURCE_TYPES,
  type HeaderRule,
  type RequestMethod,
  type ResourceType,
} from '../../types/rule';
import { RULE_KIND_LABELS, ruleTitle } from '../../rules/rule-display';
import { newId } from '../../utils/ids';
import { isSensitiveHeader } from '../../utils/sensitive';

function lines(value?: string[]): string {
  return value?.join('\n') ?? '';
}
function parseLines(value: string): string[] | undefined {
  const result = value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return result.length ? result : undefined;
}
export function RuleEditor({
  rule,
  onSave,
  onSaveAsTemplate,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  destinations,
  onTransfer,
  selected,
  onSelectedChange,
}: {
  rule: HeaderRule;
  onSave: (rule: HeaderRule) => void;
  onSaveAsTemplate: (rule: HeaderRule) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  destinations: Array<{ id: string; name: string }>;
  onTransfer: (profileId: string, mode: 'copy' | 'move') => void;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const [draft, setDraft] = useState(rule);
  const [open, setOpen] = useState(Boolean(rule.name?.startsWith('Nueva regla')));
  const [revealed, setRevealed] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? '');
  useEffect(() => setDraft(rule), [rule]);
  useEffect(() => {
    if (!destinations.some((item) => item.id === destinationId))
      setDestinationId(destinations[0]?.id ?? '');
  }, [destinationId, destinations]);
  const set = <K extends keyof HeaderRule>(key: K, value: HeaderRule[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggleResource = (type: ResourceType) => {
    const key = draft.excludedResourceTypes ? 'excludedResourceTypes' : 'resourceTypes';
    const current = draft[key] ?? [];
    set(key, current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  };
  const toggleMethod = (method: RequestMethod) => {
    const key = draft.excludedRequestMethods ? 'excludedRequestMethods' : 'requestMethods';
    const current = draft[key] ?? [];
    set(
      key,
      current.includes(method) ? current.filter((item) => item !== method) : [...current, method],
    );
  };
  const kind = draft.kind ?? 'headers';
  const header = draft.header ?? '';
  const sensitive = Boolean(draft.sensitive || isSensitiveHeader(header));
  const methodMode = draft.requestMethods
    ? 'include'
    : draft.excludedRequestMethods
      ? 'exclude'
      : 'all';
  const resourceMode = draft.resourceTypes
    ? 'include'
    : draft.excludedResourceTypes
      ? 'exclude'
      : 'all';

  return (
    <article className={'rule-card rule-kind-' + kind}>
      <div className="rule-card-header">
        <input
          className="rule-selection"
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(event.target.checked)}
          aria-label={`Seleccionar ${ruleTitle(rule)}`}
        />
        <label className="switch">
          <input
            aria-label={'Activar ' + ruleTitle(rule)}
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) => onSave({ ...rule, enabled: event.target.checked })}
          />
          <span className="slider" />
        </label>
        <div className="rule-card-title">
          <strong>
            {rule.pinned ? 'Fijada - ' : ''}
            {ruleTitle(rule)}
          </strong>
          <div className="muted">
            {RULE_KIND_LABELS[rule.kind ?? 'headers']} -{' '}
            {rule.allWebsites
              ? 'ALL WEBSITES'
              : rule.domains?.length
                ? rule.domains.join(', ')
                : 'filtro URL'}
            {rule.group ? ` - ${rule.group}` : ''}
          </div>
          {rule.tags?.length ? (
            <div className="rule-tags">
              {rule.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          ) : null}
        </div>
        <span className={'badge kind-' + (rule.kind ?? 'headers')}>
          {RULE_KIND_LABELS[rule.kind ?? 'headers']}
        </span>
        <button
          className="icon-button"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          title="Subir regla"
        >
          Subir
        </button>
        <button
          className="icon-button"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          title="Bajar regla"
        >
          Bajar
        </button>
        <button className="button secondary small" onClick={() => setOpen((value) => !value)}>
          {open ? 'Cerrar' : 'Editar'}
        </button>
      </div>
      {open && (
        <div className="rule-form">
          <div className="grid-2">
            <label className="field">
              Nombre
              <input
                value={draft.name ?? ''}
                onChange={(event) => set('name', event.target.value)}
                placeholder={RULE_KIND_LABELS[kind]}
              />
            </label>
            <label className="field">
              Prioridad
              <input
                type="number"
                min={1}
                value={draft.priority ?? 1}
                onChange={(event) => set('priority', Number(event.target.value) || 1)}
              />
            </label>
          </div>
          <div className="grid-2 rule-organization">
            <label className="field">
              Grupo
              <input
                value={draft.group ?? ''}
                onChange={(event) => set('group', event.target.value || undefined)}
                placeholder="Autenticación"
                maxLength={50}
              />
            </label>
            <label className="field">
              Etiquetas
              <input
                value={draft.tags?.join(', ') ?? ''}
                onChange={(event) => set('tags', parseLines(event.target.value))}
                placeholder="local, auth, debug"
              />
            </label>
          </div>
          <label className="chip standalone-chip pin-rule">
            <input
              type="checkbox"
              checked={draft.pinned ?? false}
              onChange={(event) => set('pinned', event.target.checked || undefined)}
            />
            Fijar esta regla al principio del panel emergente
          </label>

          {kind === 'headers' && (
            <>
              <div className="grid-2">
                <label className="field">
              Destino
                  <select
                    value={draft.target ?? 'request'}
                    onChange={(event) =>
                      set('target', event.target.value as NonNullable<HeaderRule['target']>)
                    }
                  >
                    <option value="request">Solicitud</option>
                    <option value="response">Respuesta</option>
                  </select>
                </label>
                <label className="field">
                  Operación
                  <select
                    value={draft.operation ?? 'set'}
                    onChange={(event) =>
                      set('operation', event.target.value as NonNullable<HeaderRule['operation']>)
                    }
                  >
                    <option value="set">Establecer</option>
                    <option value="append">Añadir</option>
                    <option value="remove">Eliminar</option>
                  </select>
                </label>
              </div>
              <div className="grid-2">
                <label className="field">
              Nombre de la cabecera
                  <input
                    value={header}
                    onChange={(event) => {
                      const nextHeader = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        header: nextHeader,
                        sensitive: current.sensitive || isSensitiveHeader(nextHeader),
                      }));
                    }}
                    placeholder="iv-user"
                  />
                </label>
                {(draft.operation ?? 'set') !== 'remove' && (
                  <label className="field">
                    Valor <span className="muted">Admite {'{{VARIABLE}}'}.</span>
                    <span className="inline-field">
                      <input
                        type={sensitive && !revealed ? 'password' : 'text'}
                        value={draft.value ?? ''}
                        onChange={(event) => set('value', event.target.value)}
                        autoComplete="off"
                        placeholder={sensitive ? 'Valor disponible durante esta sesión' : 'caca'}
                      />
                      {sensitive && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => setRevealed((value) => !value)}
                        >
                          {revealed ? 'Ocultar' : 'Ver'}
                        </button>
                      )}
                    </span>
                  </label>
                )}
              </div>
              <label className="chip standalone-chip">
                <input
                  type="checkbox"
                  checked={sensitive}
                  onChange={(event) =>
                    set('sensitive', event.target.checked || isSensitiveHeader(header))
                  }
                  disabled={isSensitiveHeader(header)}
                />
                Guardar el valor únicamente durante la sesión
              </label>
            </>
          )}

          {kind === 'redirect' && (
            <label className="field">
              URL de destino <span className="muted">Admite {'{{VARIABLE}}'}.</span>
              <input
                value={draft.redirectUrl ?? ''}
                onChange={(event) => set('redirectUrl', event.target.value)}
                placeholder="http://localhost:3000/api"
              />
            </label>
          )}

          {kind === 'block' && (
            <div className="info-box">
              Chrome cancelará las solicitudes que coincidan con este alcance únicamente en las
              pestañas donde el perfil esté activado.
            </div>
          )}

          {kind === 'replace' && (
            <div className="grid-2">
              <label className="field">
                Regex de URL origen
                <input
                  value={draft.regexFilter ?? ''}
                  onChange={(event) => set('regexFilter', event.target.value)}
                  placeholder="^https://api\\.example\\.com/(.*)$"
                />
              </label>
              <label className="field">
                Sustitución
                <input
                  value={draft.regexSubstitution ?? ''}
                  onChange={(event) => set('regexSubstitution', event.target.value)}
                  placeholder={'http://localhost:8080/\\1'}
                />
              </label>
            </div>
          )}

          {kind === 'query' && (
            <div className="query-editor">
              <div className="toolbar compact">
                <strong>Parámetros de consulta</strong>
                <button
                  className="button secondary small"
                  onClick={() =>
                    set('queryParams', [
                      ...(draft.queryParams ?? []),
                      { id: newId(), operation: 'set', key: '', value: '' },
                    ])
                  }
                >
                  + Añadir
                </button>
              </div>
              {(draft.queryParams ?? []).map((parameter) => (
                <div className="query-row" key={parameter.id}>
                  <select
                    value={parameter.operation}
                    onChange={(event) =>
                      set(
                        'queryParams',
                        draft.queryParams?.map((item) =>
                          item.id === parameter.id
                            ? { ...item, operation: event.target.value as 'set' | 'remove' }
                            : item,
                        ),
                      )
                    }
                  >
                        <option value="set">Establecer</option>
                        <option value="remove">Eliminar</option>
                  </select>
                  <input
                    value={parameter.key}
                    onChange={(event) =>
                      set(
                        'queryParams',
                        draft.queryParams?.map((item) =>
                          item.id === parameter.id ? { ...item, key: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="debug"
                  />
                  <input
                    disabled={parameter.operation === 'remove'}
                    value={parameter.value ?? ''}
                    onChange={(event) =>
                      set(
                        'queryParams',
                        draft.queryParams?.map((item) =>
                          item.id === parameter.id ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="true o {{VARIABLE}}"
                  />
                  <button
                    className="icon-button danger-text"
                    title="Eliminar parámetro"
                    onClick={() =>
                      set(
                        'queryParams',
                        draft.queryParams?.filter((item) => item.id !== parameter.id),
                      )
                    }
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          )}

          {kind !== 'replace' && (
            <label className="field">
              Filtro URL <span className="muted">Opcional, por ejemplo ||example.com/api/</span>
              <input
                value={draft.urlFilter ?? ''}
                onChange={(event) => set('urlFilter', event.target.value || undefined)}
                placeholder="||example.com/api/"
              />
            </label>
          )}

          <div className="grid-2">
            <label className="field">
              Dominios de destino
              <span className="muted">Uno por línea. Estos hosts determinan el permiso.</span>
              <textarea
                rows={3}
                value={lines(draft.domains)}
                disabled={draft.allWebsites}
                onChange={(event) => set('domains', parseLines(event.target.value))}
                placeholder={'http://localhost:8080\nhttps://api.example.com'}
              />
            </label>
            <label className="field">
              Dominios excluidos
              <textarea
                rows={3}
                value={lines(draft.excludedDomains)}
                onChange={(event) => set('excludedDomains', parseLines(event.target.value))}
              />
            </label>
          </div>
          <label className="all-websites">
            <input
              type="checkbox"
              checked={draft.allWebsites ?? false}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  allWebsites: event.target.checked,
                  ...(event.target.checked ? { domains: undefined } : {}),
                }))
              }
            />
            <span>
              <strong>Todos los sitios</strong>
              <small>Esta regla podrá actuar sobre cualquier web de la pestaña activada.</small>
            </span>
          </label>

          <button className="advanced-toggle" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? 'Ocultar condiciones avanzadas' : 'Condiciones avanzadas'}
          </button>
          {advanced && (
            <div className="advanced-conditions">
              <div className="condition-block">
                <label className="field compact-field">
                  Métodos HTTP
                  <select
                    value={methodMode}
                    onChange={(event) => {
                      const mode = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        requestMethods: mode === 'include' ? [] : undefined,
                        excludedRequestMethods: mode === 'exclude' ? [] : undefined,
                      }));
                    }}
                  >
                    <option value="all">Todos los métodos</option>
                    <option value="include">Sólo seleccionados</option>
                    <option value="exclude">Todos excepto seleccionados</option>
                  </select>
                </label>
                {methodMode !== 'all' && (
                  <span className="resource-types">
                    {REQUEST_METHODS.map((method) => (
                      <label className="chip" key={method}>
                        <input
                          type="checkbox"
                          checked={
                            (methodMode === 'include'
                              ? draft.requestMethods
                              : draft.excludedRequestMethods
                            )?.includes(method) ?? false
                          }
                          onChange={() => toggleMethod(method)}
                        />
                        {method.toUpperCase()}
                      </label>
                    ))}
                  </span>
                )}
              </div>

              <div className="condition-block">
                <label className="field compact-field">
                  Tipos de recurso
                  <select
                    value={resourceMode}
                    onChange={(event) => {
                      const mode = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        resourceTypes: mode === 'include' ? [] : undefined,
                        excludedResourceTypes: mode === 'exclude' ? [] : undefined,
                      }));
                    }}
                  >
                    <option value="all">Todos los recursos</option>
                    <option value="include">Sólo seleccionados</option>
                    <option value="exclude">Todos excepto seleccionados</option>
                  </select>
                </label>
                {resourceMode !== 'all' && (
                  <span className="resource-types">
                    {RESOURCE_TYPES.map((type) => (
                      <label className="chip" key={type}>
                        <input
                          type="checkbox"
                          checked={
                            (resourceMode === 'include'
                              ? draft.resourceTypes
                              : draft.excludedResourceTypes
                            )?.includes(type) ?? false
                          }
                          onChange={() => toggleResource(type)}
                        />
                        {type}
                      </label>
                    ))}
                  </span>
                )}
              </div>

              <div className="grid-2">
                <label className="field">
                  Relación con la página
                  <select
                    value={draft.domainType ?? ''}
                    onChange={(event) =>
                      set(
                        'domainType',
                        (event.target.value || undefined) as HeaderRule['domainType'],
                      )
                    }
                  >
                    <option value="">Mismo sitio y terceros</option>
                    <option value="firstParty">Sólo del mismo sitio</option>
                    <option value="thirdParty">Sólo de terceros</option>
                  </select>
                </label>
                <label className="chip standalone-chip condition-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.isUrlFilterCaseSensitive ?? false}
                    disabled={!draft.urlFilter && !draft.regexFilter}
                    onChange={(event) =>
                      set('isUrlFilterCaseSensitive', event.target.checked || undefined)
                    }
                  />
                  Filtro URL sensible a mayúsculas
                </label>
              </div>

              <div className="grid-2">
                <label className="field">
                  Dominios iniciadores
                  <span className="muted">La página que origina la petición, sin esquema.</span>
                  <textarea
                    rows={3}
                    value={lines(draft.initiatorDomains)}
                    onChange={(event) => set('initiatorDomains', parseLines(event.target.value))}
                    placeholder="app.example.com"
                  />
                </label>
                <label className="field">
                  Iniciadores excluidos
                  <span className="muted">Tienen prioridad sobre los incluidos.</span>
                  <textarea
                    rows={3}
                    value={lines(draft.excludedInitiatorDomains)}
                    onChange={(event) =>
                      set('excludedInitiatorDomains', parseLines(event.target.value))
                    }
                    placeholder="admin.example.com"
                  />
                </label>
              </div>
            </div>
          )}
          <div className="actions rule-actions">
            <button className="button" onClick={() => onSave({ ...draft, sensitive })}>
              Guardar regla
            </button>
            <button
              className="button secondary"
              onClick={() => onSaveAsTemplate({ ...draft, sensitive })}
            >
              Guardar como plantilla
            </button>
            <button className="button secondary" onClick={onDuplicate}>
              Duplicar
            </button>
            {destinations.length > 0 && (
              <>
                <select
                  value={destinationId}
                  onChange={(event) => setDestinationId(event.target.value)}
                  aria-label="Espacio de trabajo de destino"
                >
                  {destinations.map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.name}
                    </option>
                  ))}
                </select>
                <button
                  className="button secondary"
                  disabled={!destinationId}
                  onClick={() => onTransfer(destinationId, 'copy')}
                >
                  Copiar a
                </button>
                <button
                  className="button secondary"
                  disabled={!destinationId}
                  onClick={() => onTransfer(destinationId, 'move')}
                >
                  Mover a
                </button>
              </>
            )}
            <button className="button danger" onClick={onDelete}>
              Eliminar
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
