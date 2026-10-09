import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RECORDER_KEY } from '../../config';
import { exportRecorderHar } from '../../recorder/har';
import { rulesFromHar } from '../../recorder/har-import';
import { rulesFromTrafficEntry } from '../../recorder/rule-import';
import type { RecorderResult, RecorderState, TrafficEntry } from '../../types/recorder';
import type { HeaderRule } from '../../types/rule';

interface OperationResult {
  ok?: boolean;
  error?: string;
}

const EMPTY_STATE: RecorderState = { tabs: {} };
type StatusFilter =
  | 'all'
  | 'success'
  | 'redirect'
  | 'client-error'
  | 'server-error'
  | 'network-error';

function matchesStatus(entry: TrafficEntry, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'network-error') return Boolean(entry.error);
  if (entry.error || entry.statusCode === undefined) return false;
  if (filter === 'success') return entry.statusCode >= 200 && entry.statusCode < 300;
  if (filter === 'redirect') return entry.statusCode >= 300 && entry.statusCode < 400;
  if (filter === 'client-error') return entry.statusCode >= 400 && entry.statusCode < 500;
  return entry.statusCode >= 500;
}

export function TrafficRecorder({
  onCreateRules,
}: {
  onCreateRules: (rules: HeaderRule[]) => Promise<boolean>;
}) {
  const [state, setState] = useState<RecorderState>(EMPTY_STATE);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [harTarget, setHarTarget] = useState<'request' | 'response' | 'both'>('request');
  const [query, setQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const response = (await chrome.runtime.sendMessage({
      type: 'get-recorder-state',
    })) as RecorderResult | undefined;
    if (version !== refreshVersion.current) return;
    if (!response?.ok) return setError(response?.error ?? 'No se pudo leer el grabador.');
    setState(response.state ?? EMPTY_STATE);
    setError('');
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    let storageTimer: number | undefined;
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'session' && changes[RECORDER_KEY]) {
        if (storageTimer !== undefined) window.clearTimeout(storageTimer);
        storageTimer = window.setTimeout(() => void refresh(), 100);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      window.clearInterval(timer);
      if (storageTimer !== undefined) window.clearTimeout(storageTimer);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [refresh]);
  const sessions = useMemo(
    () => Object.values(state.tabs).sort((first, second) => second.startedAt - first.startedAt),
    [state],
  );
  const totalEntries = sessions.reduce((sum, session) => sum + session.entries.length, 0);
  const methods = useMemo(
    () =>
      [...new Set(sessions.flatMap((session) => session.entries.map((entry) => entry.method)))].sort(),
    [sessions],
  );
  const resourceTypes = useMemo(
    () =>
      [...new Set(sessions.flatMap((session) => session.entries.map((entry) => entry.type)))].sort(),
    [sessions],
  );
  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return Object.fromEntries(
      sessions.map((session) => [
        String(session.tabId),
        session.entries.filter(
          (entry) =>
            (methodFilter === 'all' || entry.method === methodFilter) &&
            (typeFilter === 'all' || entry.type === typeFilter) &&
            matchesStatus(entry, statusFilter) &&
            (!needle ||
              entry.url.toLowerCase().includes(needle) ||
              entry.method.toLowerCase().includes(needle) ||
              entry.type.toLowerCase().includes(needle) ||
              entry.error?.toLowerCase().includes(needle)),
        ),
      ]),
    ) as Record<string, TrafficEntry[]>;
  }, [methodFilter, query, sessions, statusFilter, typeFilter]);
  const visibleTotal = Object.values(visibleEntries).reduce(
    (sum, entries) => sum + entries.length,
    0,
  );
  const filtersActive =
    Boolean(query.trim()) ||
    methodFilter !== 'all' ||
    typeFilter !== 'all' ||
    statusFilter !== 'all';

  const stop = async (tabId: number) => {
    const response = (await chrome.runtime.sendMessage({
      type: 'stop-recording',
      tabId,
    })) as OperationResult | undefined;
    if (!response?.ok) setError(response?.error ?? 'No se pudo detener la grabación.');
    await refresh();
  };
  const clear = async (tabId?: number) => {
    if (
      !window.confirm(
        tabId === undefined ? '¿Borrar todas las capturas locales?' : '¿Borrar esta captura?',
      )
    )
      return;
    const response = (await chrome.runtime.sendMessage({
      type: 'clear-recordings',
      ...(tabId === undefined ? {} : { tabId }),
    })) as OperationResult | undefined;
    if (!response?.ok) setError(response?.error ?? 'No se pudo borrar la captura.');
    await refresh();
  };
  const exportHar = (tabId?: number, filtered = false) => {
    try {
      const exportState: RecorderState = filtered
        ? {
            tabs: Object.fromEntries(
              sessions.map((session) => [
                String(session.tabId),
                { ...session, entries: visibleEntries[String(session.tabId)] ?? [] },
              ]),
            ),
          }
        : state;
      const blob = new Blob([exportRecorderHar(exportState, tabId)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `fakeheader-${tabId === undefined ? 'all' : `tab-${tabId}`}-${Date.now()}.har`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo generar el HAR local.');
    }
  };
  const copyResponse = async (entry: TrafficEntry) => {
    if (entry.responseBody === undefined) return;
    try {
      await navigator.clipboard.writeText(entry.responseBody);
      setNotice('Respuesta copiada al portapapeles.');
      window.setTimeout(() => setNotice(''), 1800);
    } catch {
      setError('No se pudo copiar la respuesta.');
    }
  };
  const downloadResponse = (entry: TrafficEntry) => {
    if (entry.responseBody === undefined) return;
    try {
      let blob: Blob;
      if (entry.responseBodyEncoding === 'base64') {
        const binary = window.atob(entry.responseBody);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1)
          bytes[index] = binary.charCodeAt(index);
        blob = new Blob([bytes], { type: entry.responseMimeType || 'application/octet-stream' });
      } else {
        blob = new Blob([entry.responseBody], {
          type: entry.responseMimeType || 'text/plain;charset=utf-8',
        });
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `fakeheader-response-${entry.startedAt}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar la respuesta.');
    }
  };
  const createRules = async (entry: TrafficEntry, target: 'request' | 'response') => {
    const imported = rulesFromTrafficEntry(entry, target);
    if (!imported.rules.length) {
      setError('Esta captura no contiene cabeceras seguras que puedan convertirse en reglas.');
      return;
    }
    const names = imported.rules.map((rule) => rule.header).join('\n');
    if (
      !window.confirm(
        `Se crearán ${imported.rules.length} reglas desactivadas para ${imported.host}:\n\n${names}\n\n${imported.skipped} cabeceras sensibles, protegidas, duplicadas o no válidas se omitirán.`,
      )
    )
      return;
    if (!(await onCreateRules(imported.rules))) return;
    setError('');
    setNotice(`${imported.rules.length} reglas creadas en el espacio de trabajo actual, todas desactivadas.`);
    window.setTimeout(() => setNotice(''), 2500);
  };
  const importHar = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('El HAR supera el límite local de 5 MB.');
      const imported = rulesFromHar(await file.text(), harTarget);
      if (!imported.rules.length)
        throw new Error('El HAR no contiene cabeceras seguras que puedan convertirse en reglas.');
      const truncated = imported.truncated ? '\nLa importación se ha limitado por tamaño.' : '';
      if (
        !window.confirm(
          `HAR: ${imported.entriesRead} entradas válidas.\nSe crearán ${imported.rules.length} reglas desactivadas y se omitirán ${imported.skipped} elementos.${truncated}\n\n¿Importar en el espacio de trabajo actual?`,
        )
      )
        return;
      if (!(await onCreateRules(imported.rules))) return;
      setError('');
      setNotice(`${imported.rules.length} reglas HAR creadas desactivadas.`);
      window.setTimeout(() => setNotice(''), 2500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo importar el HAR.');
    }
  };

  return (
    <>
      <section className="panel workspace-panel">
        <div className="toolbar">
          <div>
            <h2>Capturas por pestaña</h2>
            <p className="muted">
              {sessions.length} sesiones - {totalEntries} peticiones. Inicia la captura desde el
              panel emergente de la pestaña objetivo.
            </p>
          </div>
          <div className="actions">
            <select
              value={harTarget}
              onChange={(event) =>
                setHarTarget(event.target.value as 'request' | 'response' | 'both')
              }
              aria-label="Cabeceras que se importarán del HAR"
            >
              <option value="request">Cabeceras de solicitud HAR</option>
              <option value="response">Cabeceras de respuesta HAR</option>
              <option value="both">Solicitud y respuesta HAR</option>
            </select>
            <label className="button secondary small file-button">
              Importar HAR
              <input
                type="file"
                accept=".har,application/json"
                onChange={(event) => {
                  void importHar(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            <button
              className="button secondary small"
              disabled={!totalEntries}
              onClick={() => exportHar()}
            >
              Exportar todo como HAR
            </button>
            <button
              className="button danger small"
              disabled={!sessions.length}
              onClick={() => void clear()}
            >
              Borrar todo
            </button>
          </div>
        </div>
        <div className="notice">
          Las respuestas completas de fetch y XHR permanecen en la sesión de Chrome y pueden contener datos
          sensibles. Las cookies, la autorización y los parámetros de consulta sensibles de las cabeceras se
          sustituyen por [REDACTED]. DevTools debe permanecer cerrado en la pestaña grabada.
        </div>
        <div className="recorder-filters">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar URL, error, método o tipo..."
            aria-label="Buscar en la captura"
          />
          <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
            <option value="all">Todos los métodos</option>
            {methods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">Todos los recursos</option>
            {resourceTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="all">Todos los estados</option>
            <option value="success">2xx Correctas</option>
            <option value="redirect">3xx Redirecciones</option>
            <option value="client-error">4xx Errores de cliente</option>
            <option value="server-error">5xx Errores de servidor</option>
            <option value="network-error">Errores de red</option>
          </select>
          <span className="muted">
            {visibleTotal} de {totalEntries}
          </span>
          <button
            className="button secondary small"
            disabled={!filtersActive}
            onClick={() => {
              setQuery('');
              setMethodFilter('all');
              setTypeFilter('all');
              setStatusFilter('all');
            }}
          >
            Limpiar filtros
          </button>
          <button
            className="button secondary small"
            disabled={!filtersActive || !visibleTotal}
            onClick={() => exportHar(undefined, true)}
          >
            Exportar filtrado
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
      </section>
      {sessions.length ? (
        sessions.map((session) => (
          <section className="panel workspace-panel recorder-session" key={session.tabId}>
            <div className="toolbar">
              <div>
                <h2>Pestaña {session.tabId}</h2>
                <p className="muted">
                  {session.active ? 'Grabando' : 'Detenida'} -{' '}
                  {(visibleEntries[String(session.tabId)] ?? []).length} de {session.entries.length}{' '}
                  peticiones -{' '}
                  {new Date(session.startedAt).toLocaleString()}
                </p>
              </div>
              <div className="actions">
                {session.active && (
                  <button className="button danger small" onClick={() => void stop(session.tabId)}>
                    Detener
                  </button>
                )}
                <button
                  className="button secondary small"
                  disabled={!session.entries.length}
                  onClick={() => exportHar(session.tabId)}
                >
                  Exportar HAR
                </button>
                <button className="button danger small" onClick={() => void clear(session.tabId)}>
                  Borrar
                </button>
              </div>
            </div>
            {session.captureError && <div className="error">{session.captureError}</div>}
            <div className="recorder-entries">
              {[...(visibleEntries[String(session.tabId)] ?? [])].reverse().map((entry) => (
                <details className="recorder-entry" key={`${entry.requestId}-${entry.startedAt}`}>
                  <summary>
                    <span className="recorder-method">{entry.method}</span>
                    <span className={entry.error ? 'recorder-status failed' : 'recorder-status'}>
                      {entry.error ?? entry.statusCode ?? '...'}
                    </span>
                    <span className="recorder-url">{entry.url}</span>
                    <span className="muted">{Math.round(entry.durationMs ?? 0)} ms</span>
                  </summary>
                  <div className="recorder-detail">
                    <p>
                      <strong>Tipo:</strong> {entry.type}
                      {entry.ip ? ` - IP: ${entry.ip}` : ''}
                      {entry.fromCache ? ' - cache' : ''}
                    </p>
                    <div className="actions recorder-import-actions">
                      <button
                        className="button secondary small"
                        disabled={!entry.requestHeaders?.length}
                        onClick={() => void createRules(entry, 'request')}
                      >
                        Crear reglas de cabeceras de solicitud
                      </button>
                      <button
                        className="button secondary small"
                        disabled={!entry.responseHeaders?.length}
                        onClick={() => void createRules(entry, 'response')}
                      >
                        Crear reglas de cabeceras de respuesta
                      </button>
                    </div>
                    <div className="recorder-headers">
                      <div>
                        <strong>Cabeceras de solicitud</strong>
                        {(entry.requestHeaders ?? []).map((header, index) => (
                          <code key={`${header.name}-${index}`}>
                            {header.name}: {header.value}
                          </code>
                        ))}
                      </div>
                      <div>
                        <strong>Cabeceras de respuesta</strong>
                        {(entry.responseHeaders ?? []).map((header, index) => (
                          <code key={`${header.name}-${index}`}>
                            {header.name}: {header.value}
                          </code>
                        ))}
                      </div>
                    </div>
                    <div className="recorder-response-body">
                      <div className="toolbar">
                        <div>
                          <strong>Respuesta completa</strong>
                          <p className="muted">
                            {entry.responseMimeType || 'Tipo desconocido'}
                            {entry.responseBodySize !== undefined
                              ? ` - ${entry.responseBodySize.toLocaleString()} bytes`
                              : ''}
                            {entry.responseBodyEncoding === 'base64' ? ' - binaria' : ''}
                          </p>
                        </div>
                        {entry.responseBody !== undefined && (
                          <div className="actions">
                            {entry.responseBodyEncoding !== 'base64' && (
                              <button
                                className="button secondary small"
                                onClick={() => void copyResponse(entry)}
                              >
                                Copiar
                              </button>
                            )}
                            <button
                              className="button secondary small"
                              onClick={() => downloadResponse(entry)}
                            >
                              Descargar
                            </button>
                          </div>
                        )}
                      </div>
                      {entry.responseBodyError && (
                        <div className="error">{entry.responseBodyError}</div>
                      )}
                      {entry.responseBodyTruncated && (
                        <div className="error">
                          La respuesta supera el límite de sesión y se muestra parcialmente.
                        </div>
                      )}
                      {entry.responseBody !== undefined ? (
                        entry.responseBodyEncoding === 'base64' ? (
                          <div className="empty">Respuesta binaria disponible para descarga.</div>
                        ) : (
                          <pre>{entry.responseBody}</pre>
                        )
                      ) : (
                        !entry.responseBodyError && (
                          <div className="empty">
                            Esta petición no fue originada por fetch/XHR o terminó antes de capturar su cuerpo.
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </details>
              ))}
              {!(visibleEntries[String(session.tabId)] ?? []).length && (
                <div className="empty">No hay peticiones que coincidan con los filtros.</div>
              )}
            </div>
          </section>
        ))
      ) : (
        <div className="empty large-empty">
          No hay capturas. Abre el panel emergente en una pestaña y pulsa Iniciar grabación.
        </div>
      )}
    </>
  );
}
