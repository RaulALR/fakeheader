import { useState } from 'react';
import type { HeaderRule } from '../../types/rule';
import { newId } from '../../utils/ids';

function parseBaseUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} debe ser una URL HTTP(S) absoluta.`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(`${label} no puede incluir credenciales, query ni fragmento.`);
  return url;
}

function basePrefix(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}/`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function MapLocalWizard({ onCreate }: { onCreate: (rule: HeaderRule) => void }) {
  const [remoteBase, setRemoteBase] = useState('https://api.example.com/api/');
  const [localBase, setLocalBase] = useState('http://localhost:8080/');
  const [error, setError] = useState('');

  const create = () => {
    try {
      const remote = parseBaseUrl(remoteBase, 'El origen remoto');
      const local = parseBaseUrl(localBase, 'El destino local');
      if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname))
        throw new Error('La redirección local sólo acepta localhost, 127.0.0.1 o [::1] como destino.');
      const remotePrefix = basePrefix(remote);
      const localPrefix = basePrefix(local);
      onCreate({
        id: newId(),
        name: `Map ${remote.host} to ${local.host}`,
        enabled: false,
        kind: 'replace',
        priority: 1,
        tags: ['map-local'],
        domains: [remote.origin],
        regexFilter: `^${escapeRegex(remotePrefix)}(.*)$`,
        regexSubstitution: `${localPrefix}\\1`,
      });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la regla de redirección local.');
    }
  };

  return (
    <div className="map-local-wizard">
      <div>
        <strong>Redirección local</strong>
        <span className="muted">
          Conserva el sufijo de la ruta y redirige la API remota a un servidor local.
        </span>
      </div>
      <label className="field">
        Base remota
        <input
          value={remoteBase}
          onChange={(event) => setRemoteBase(event.target.value)}
          placeholder="https://api.example.com/api/"
          spellCheck={false}
        />
      </label>
      <span className="map-local-arrow">-&gt;</span>
      <label className="field">
        Base local
        <input
          value={localBase}
          onChange={(event) => setLocalBase(event.target.value)}
          placeholder="http://localhost:8080/"
          spellCheck={false}
        />
      </label>
      <button className="button small" onClick={create}>
        Crear desactivada
      </button>
      {error && <div className="error map-local-error">{error}</div>}
    </div>
  );
}
