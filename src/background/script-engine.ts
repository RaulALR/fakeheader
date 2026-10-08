import { scriptMatchesUrl } from '../rules/script-matches';
import { environmentValues, resolveScriptVariables } from '../rules/variables';
import { MAX_SCRIPT_ACTIVITY } from '../config';
import {
  getActiveTabs,
  getScriptActivity,
  getSessionSecrets,
  readSettings,
  writeScriptActivity,
} from '../storage/storage';
import type { UserScriptRule } from '../types/profile';
import type { FakeHeaderSettings } from '../types/profile';
import type { SessionSecrets } from '../types/session';
import type { ScriptActivityTrigger } from '../types/script-activity';
import { newId } from '../utils/ids';

export interface ScriptExecutionResult {
  ok: boolean;
  error?: string;
  executed?: number;
  removed?: number;
}

async function recordActivity(
  tabId: number,
  profileId: string,
  scripts: UserScriptRule[],
  trigger: ScriptActivityTrigger,
  result: ScriptExecutionResult,
): Promise<void> {
  try {
    const current = await getScriptActivity();
    await writeScriptActivity(
      [
        {
          id: newId(),
          createdAt: Date.now(),
          tabId,
          profileId,
          scriptIds: scripts.map((script) => script.id),
          trigger,
          ok: result.ok,
          executed: result.executed ?? 0,
          removed: result.removed ?? 0,
          ...(result.error ? { error: result.error.slice(0, 240) } : {}),
        },
        ...current,
      ].slice(0, MAX_SCRIPT_ACTIVITY),
    );
  } catch {}
}

async function hasExecutionPermissions(scripts: UserScriptRule[]): Promise<boolean> {
  const required: chrome.runtime.ManifestPermission[] = [
    ...(scripts.some((script) => script.kind === 'javascript')
      ? (['userScripts'] as chrome.runtime.ManifestPermission[])
      : []),
    ...(scripts.some((script) => script.kind === 'css')
      ? (['scripting'] as chrome.runtime.ManifestPermission[])
      : []),
  ];
  return !required.length || chrome.permissions.contains({ permissions: required });
}

async function executeScripts(
  tabId: number,
  scripts: UserScriptRule[],
  variables: Record<string, string>,
): Promise<ScriptExecutionResult> {
  if (!scripts.length) return { ok: true, executed: 0 };
  if (!(await hasExecutionPermissions(scripts)))
    return { ok: false, error: 'Faltan permisos opcionales para ejecutar estos scripts.' };
  if (scripts.some((script) => script.kind === 'javascript') && !chrome.userScripts)
    return {
      ok: false,
      error: 'Activa Permitir scripts de usuario en los detalles de FakeHeader y recarga la extensión.',
    };
  let prepared: Array<{ script: UserScriptRule; code: string }>;
  try {
    prepared = scripts.map((script) => ({
      script,
      code: resolveScriptVariables(script.code, script.kind, variables),
    }));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudieron resolver las variables.',
    };
  }
  try {
    if (scripts.some((script) => script.kind === 'javascript'))
      await chrome.userScripts.getScripts();
    for (const { script, code } of prepared) {
      if (script.kind === 'css')
        await chrome.scripting.insertCSS({
          target: { tabId, allFrames: false },
          css: code,
          origin: 'USER',
        });
      else
        await chrome.userScripts.execute({
          target: { tabId, allFrames: false },
          js: [{ code: `${code}\n;void 0;` }],
          world: script.world,
          injectImmediately: script.injectImmediately,
        });
    }
    return { ok: true, executed: scripts.length };
  } catch {
    return {
      ok: false,
      error: 'Chrome rechazó la ejecución. Comprueba el acceso al sitio y Permitir scripts de usuario.',
    };
  }
}

function variablesForEnvironment(
  settings: FakeHeaderSettings,
  environmentId: string | undefined,
  secrets: SessionSecrets,
): Record<string, string> {
  return environmentValues(
    settings.environments.find((environment) => environment.id === environmentId),
    secrets,
  );
}

export async function executeProfileScripts(
  tabId: number,
  profileId: string,
  scriptId?: string,
  environmentId?: string,
): Promise<ScriptExecutionResult> {
  const [read, activeTabs, secrets] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    getSessionSecrets(),
  ]);
  if (!read.valid) return { ok: false, error: 'La configuración local no es válida.' };
  if (!read.settings.profiles.some((profile) => profile.id === profileId && profile.enabled))
    return { ok: false, error: 'El espacio de trabajo no existe o está desactivado.' };
  const scripts = read.settings.scripts.filter(
    (script) =>
      script.profileId === profileId &&
      script.enabled &&
      (scriptId === undefined || script.id === scriptId),
  );
  const active = activeTabs[String(tabId)];
  const selectedEnvironmentId =
    active?.profileId === profileId ? active.environmentId : environmentId;
  const result = scripts.length
    ? await executeScripts(
        tabId,
        scripts,
        variablesForEnvironment(read.settings, selectedEnvironmentId, secrets),
      )
    : { ok: false, error: 'No hay scripts habilitados para ejecutar.' };
  await recordActivity(tabId, profileId, scripts, 'manual', result);
  return result;
}

export async function executeNavigationScripts(
  tabId: number,
  url: string,
): Promise<ScriptExecutionResult> {
  const [read, activeTabs, secrets] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    getSessionSecrets(),
  ]);
  if (!read.valid) return { ok: false, error: 'La configuración local no es válida.' };
  const active = activeTabs[String(tabId)];
  if (!active) return { ok: true, executed: 0 };
  const scripts = read.settings.scripts.filter(
    (script) =>
      script.profileId === active.profileId &&
      script.enabled &&
      script.execution === 'navigation' &&
      scriptMatchesUrl(script.matches, script.excludeMatches, url),
  );
  if (!scripts.length) return { ok: true, executed: 0 };
  const result = await executeScripts(
    tabId,
    scripts,
    variablesForEnvironment(read.settings, active.environmentId, secrets),
  );
  await recordActivity(tabId, active.profileId, scripts, 'navigation', result);
  return result;
}

export async function removeProfileCss(
  tabId: number,
  profileId: string,
  scriptId?: string,
  environmentId?: string,
): Promise<ScriptExecutionResult> {
  const [read, activeTabs, secrets] = await Promise.all([
    readSettings(),
    getActiveTabs(),
    getSessionSecrets(),
  ]);
  if (!read.valid) return { ok: false, error: 'La configuración local no es válida.' };
  const scripts = read.settings.scripts.filter(
    (script) =>
      script.profileId === profileId &&
      script.kind === 'css' &&
      (scriptId === undefined || script.id === scriptId),
  );
  if (!scripts.length) return { ok: false, error: 'No hay CSS que retirar.' };
  let result: ScriptExecutionResult;
  if (!(await chrome.permissions.contains({ permissions: ['scripting'] }))) {
    result = { ok: false, error: 'Falta el permiso scripting para retirar el CSS.' };
    await recordActivity(tabId, profileId, scripts, 'remove-css', result);
    return result;
  }
  const active = activeTabs[String(tabId)];
  const selectedEnvironmentId =
    active?.profileId === profileId ? active.environmentId : environmentId;
  const variables = variablesForEnvironment(read.settings, selectedEnvironmentId, secrets);
  try {
    for (const script of scripts)
      await chrome.scripting.removeCSS({
        target: { tabId, allFrames: false },
        css: resolveScriptVariables(script.code, script.kind, variables),
        origin: 'USER',
      });
    result = { ok: true, removed: scripts.length };
  } catch {
    result = { ok: false, error: 'Chrome no pudo retirar el CSS de esta página.' };
  }
  await recordActivity(tabId, profileId, scripts, 'remove-css', result);
  return result;
}
