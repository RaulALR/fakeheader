import type { HeaderProfile, UserScriptRule } from '../types/profile';
import { permissionPatternsForRule } from '../rules/host-targets';
import { permissionOriginsForScriptPatterns } from '../rules/script-matches';

export function originsForProfiles(profiles: HeaderProfile[]): string[] {
  return [
    ...new Set(
      profiles
        .filter((profile) => profile.enabled)
        .flatMap((profile) =>
          profile.rules.filter((rule) => rule.enabled).flatMap(permissionPatternsForRule),
        ),
    ),
  ];
}
export async function requestHostAccess(profiles: HeaderProfile[]): Promise<boolean> {
  const origins = originsForProfiles(profiles);
  if (!origins.length) return true;
  const includesAll = origins.includes('http://*/*') || origins.includes('https://*/*');
  const warning = includesAll
    ? `Esta configuración puede modificar solicitudes a cualquier sitio mientras FakeHeader esté activo en esta pestaña.\n\nPermisos solicitados:\n${origins.join('\n')}`
    : `FakeHeader necesita permiso para modificar solicitudes a:\n\n${origins.join('\n')}`;
  if (!window.confirm(`${warning}\n\n¿Conceder acceso?`)) return false;
  return chrome.permissions.request({ origins });
}

export function originsForAutomaticScripts(scripts: UserScriptRule[]): string[] {
  return [
    ...new Set(
      scripts
        .filter((script) => script.enabled && script.execution === 'navigation')
        .flatMap((script) => permissionOriginsForScriptPatterns(script.matches)),
    ),
  ];
}

export async function requestAutomaticScriptAccess(scripts: UserScriptRule[]): Promise<boolean> {
  const automatic = scripts.filter((script) => script.enabled && script.execution === 'navigation');
  if (!automatic.length) return true;
  const permissions: chrome.runtime.ManifestPermission[] = [
    'webNavigation',
    ...(automatic.some((script) => script.kind === 'javascript')
      ? (['userScripts'] as chrome.runtime.ManifestPermission[])
      : []),
    ...(automatic.some((script) => script.kind === 'css')
      ? (['scripting'] as chrome.runtime.ManifestPermission[])
      : []),
  ];
  const origins = originsForAutomaticScripts(automatic);
  const request = { permissions, ...(origins.length ? { origins } : {}) };
  if (await chrome.permissions.contains(request)) return true;
  if (
    !window.confirm(
      `La ejecución automática necesita observar navegaciones e insertar código sólo en estos hosts:\n\n${origins.join('\n')}\n\n¿Conceder acceso?`,
    )
  )
    return false;
  return chrome.permissions.request(request);
}
