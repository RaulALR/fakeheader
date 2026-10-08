import { useCallback, useEffect, useMemo, useState } from 'react';

interface GrantedPermissions {
  origins: string[];
  permissions: string[];
}

export function PermissionsManager({
  usedOrigins,
  onPermissionRemoved,
}: {
  usedOrigins: string[];
  onPermissionRemoved: (permission?: string) => void;
}) {
  const [granted, setGranted] = useState<GrantedPermissions>({ origins: [], permissions: [] });
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const value = await chrome.permissions.getAll();
    setGranted({
      origins: value.origins ?? [],
      permissions: value.permissions ?? [],
    });
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const used = useMemo(() => new Set(usedOrigins), [usedOrigins]);
  const removeOrigin = async (origin: string) => {
    if (!window.confirm('¿Revocar el acceso a ' + origin + '? Las pestañas activas quedarán desactivadas.'))
      return;
    try {
      const removed = await chrome.permissions.remove({ origins: [origin] });
      if (!removed) throw new Error();
      await refresh();
      onPermissionRemoved();
    } catch {
      setError('Chrome no pudo revocar este permiso.');
    }
  };
  const removeNamed = async (permission: string) => {
    try {
      const removed = await chrome.permissions.remove({
        permissions: [permission as chrome.runtime.ManifestPermission],
      });
      if (!removed) throw new Error();
      await refresh();
      onPermissionRemoved(permission);
    } catch {
      setError('Chrome no pudo revocar el permiso ' + permission + '.');
    }
  };
  const removeUnused = async () => {
    const unused = granted.origins.filter((origin) => !used.has(origin));
    if (!unused.length) return;
    if (!window.confirm('¿Revocar ' + unused.length + ' permisos de host sin uso?')) return;
    try {
      await chrome.permissions.remove({ origins: unused });
      await refresh();
      onPermissionRemoved();
    } catch {
      setError('No se pudieron revocar todos los permisos sin uso.');
    }
  };
  const optionalGranted = granted.permissions.filter((permission) =>
    [
      'webNavigation',
      'alarms',
      'webRequest',
      'userScripts',
      'scripting',
      'declarativeNetRequestFeedback',
    ].includes(permission),
  );
  return (
    <section className="panel workspace-panel">
      <div className="toolbar">
        <div>
          <h2>Permisos concedidos</h2>
          <p className="muted">
            Revoca accesos que ya no utilicen tus reglas. Revocar un permiso apaga todas las
            pestañas por seguridad.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!granted.origins.some((origin) => !used.has(origin))}
          onClick={() => void removeUnused()}
        >
          Revoke unused
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="permission-list">
        {granted.origins.length ? (
          granted.origins.map((origin) => (
            <div className="permission-row" key={origin}>
              <div>
                <strong>{origin}</strong>
                <span className={used.has(origin) ? 'permission-used' : 'permission-unused'}>
                  {used.has(origin) ? 'EN USO' : 'SIN USO'}
                </span>
              </div>
              <button className="button danger small" onClick={() => void removeOrigin(origin)}>
                Revocar
              </button>
            </div>
          ))
        ) : (
          <div className="empty">No hay permisos de host concedidos.</div>
        )}
      </div>
      <h3>Funciones opcionales</h3>
      <div className="permission-list compact-list">
        {optionalGranted.length ? (
          optionalGranted.map((permission) => (
            <div className="permission-row" key={permission}>
              <div>
                <strong>{permission}</strong>
                <span className="permission-used">CONCEDIDO</span>
              </div>
              <button className="button danger small" onClick={() => void removeNamed(permission)}>
                Revocar
              </button>
            </div>
          ))
        ) : (
          <div className="empty">No hay funciones opcionales concedidas.</div>
        )}
      </div>
    </section>
  );
}
