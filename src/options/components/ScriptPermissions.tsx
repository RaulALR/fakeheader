import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserScriptRule } from '../../types/profile';
import { originsForAutomaticScripts } from '../../utils/permissions';

interface PermissionState {
  named: Record<string, boolean>;
  hostsReady: boolean;
  userScriptsAvailable: boolean;
}

export function ScriptPermissions({ scripts }: { scripts: UserScriptRule[] }) {
  const [state, setState] = useState<PermissionState>({
    named: {},
    hostsReady: true,
    userScriptsAvailable: true,
  });
  const [error, setError] = useState('');
  const enabled = useMemo(() => scripts.filter((script) => script.enabled), [scripts]);
  const automatic = useMemo(
    () => enabled.filter((script) => script.execution === 'navigation'),
    [enabled],
  );
  const origins = useMemo(() => originsForAutomaticScripts(automatic), [automatic]);
  const requiredPermissions = useMemo<chrome.runtime.ManifestPermission[]>(
    () => [
      ...(enabled.some((script) => script.kind === 'javascript')
        ? (['userScripts'] as chrome.runtime.ManifestPermission[])
        : []),
      ...(enabled.some((script) => script.kind === 'css')
        ? (['scripting'] as chrome.runtime.ManifestPermission[])
        : []),
      ...(automatic.length ? (['webNavigation'] as chrome.runtime.ManifestPermission[]) : []),
    ],
    [automatic.length, enabled],
  );
  const refresh = useCallback(async () => {
    const granted = await chrome.permissions.getAll();
    const named = Object.fromEntries(
      requiredPermissions.map((permission) => [
        permission,
        granted.permissions?.includes(permission) ?? false,
      ]),
    );
    const hostsReady = !origins.length || (await chrome.permissions.contains({ origins }));
    let userScriptsAvailable = true;
    if (requiredPermissions.includes('userScripts')) {
      try {
        if (!chrome.userScripts || !named.userScripts) throw new Error();
        await chrome.userScripts.getScripts();
      } catch {
        userScriptsAvailable = false;
      }
    }
    setState({ named, hostsReady, userScriptsAvailable });
  }, [origins, requiredPermissions]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const grant = async () => {
    if (!enabled.length) {
      setError('Activa al menos un script para calcular sus permisos.');
      return;
    }
    if (
      origins.length &&
      !window.confirm(
        `Los scripts automáticos solicitan acceso sólo a:\n\n${origins.join('\n')}\n\n¿Continuar?`,
      )
    )
      return;
    const granted = await chrome.permissions.request({
      permissions: requiredPermissions,
      ...(origins.length ? { origins } : {}),
    });
    if (!granted) setError('Chrome no concedió todos los permisos solicitados.');
    else setError('');
    await refresh();
  };
  const statuses = [
    ...requiredPermissions.map((permission) => ({
      label: permission,
      ready: state.named[permission] ?? false,
    })),
    ...(origins.length ? [{ label: `${origins.length} host(s)`, ready: state.hostsReady }] : []),
    ...(requiredPermissions.includes('userScripts')
      ? [{ label: 'Permitir scripts de usuario', ready: state.userScriptsAvailable }]
      : []),
  ];
  return (
    <section className="panel workspace-panel script-permissions-panel">
      <div className="toolbar">
        <div>
          <h2>Preparación de permisos</h2>
          <p className="muted">Estado calculado para los scripts habilitados de este espacio de trabajo.</p>
        </div>
        <div className="actions">
          <button className="button secondary small" onClick={() => void refresh()}>
            Actualizar
          </button>
          <button className="button small" disabled={!enabled.length} onClick={() => void grant()}>
            Conceder pendientes
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {statuses.length ? (
        <div className="permission-readiness-list">
          {statuses.map((status) => (
            <span
              className={`permission-readiness ${status.ready ? 'ready' : 'missing'}`}
              key={status.label}
            >
              {status.ready ? 'OK' : '!'} {status.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="empty">No hay scripts habilitados.</div>
      )}
      {requiredPermissions.includes('userScripts') && !state.userScriptsAvailable && (
        <div className="warning">
          Si el permiso está concedido, activa Permitir scripts de usuario en los detalles de FakeHeader y
          recarga la extensión.
        </div>
      )}
    </section>
  );
}
