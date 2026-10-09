import { useEffect, useMemo, useState } from 'react';
import { APP_NAME } from '../config';
import { findRuleConflicts } from '../rules/conflicts';
import { createSavedRuleTemplate, instantiateSavedRuleTemplate } from '../rules/custom-templates';
import { ruleTitle } from '../rules/rule-display';
import { isValidScriptMatchPattern } from '../rules/script-matches';
import { USER_SCRIPT_TEMPLATES } from '../scripts/templates';
import { RULE_TEMPLATES } from '../rules/templates';
import type {
  AutoActivation,
  HeaderProfile,
  RuleEnvironment,
  SavedRuleTemplate,
  UserScriptRule,
} from '../types/profile';
import type { HeaderRule, RuleKind } from '../types/rule';
import { useSettings } from '../ui/use-settings';
import { newId } from '../utils/ids';
import {
  originsForAutomaticScripts,
  originsForProfiles,
  requestAutomaticScriptAccess,
} from '../utils/permissions';
import { EnvironmentEditor } from './components/EnvironmentEditor';
import { EnvironmentTransfer } from './components/EnvironmentTransfer';
import { CurlImporter } from './components/CurlImporter';
import { ExecutionInspector } from './components/ExecutionInspector';
import { ImportExport } from './components/ImportExport';
import { MapLocalWizard } from './components/MapLocalWizard';
import { ModHeaderImporter } from './components/ModHeaderImporter';
import { PermissionsManager } from './components/PermissionsManager';
import { RuleEditor } from './components/RuleEditor';
import { RequestlyImporter } from './components/RequestlyImporter';
import { RuleTester } from './components/RuleTester';
import { SettingsHistory } from './components/SettingsHistory';
import { ShortcutManager } from './components/ShortcutManager';
import { ScriptManager } from './components/ScriptManager';
import { ScriptActivity } from './components/ScriptActivity';
import { ScriptPermissions } from './components/ScriptPermissions';
import { TemplateLibrary } from './components/TemplateLibrary';
import { TrafficRecorder } from './components/TrafficRecorder';

type View =
  | 'rules'
  | 'environments'
  | 'templates'
  | 'tester'
  | 'inspector'
  | 'curl'
  | 'safety'
  | 'history'
  | 'recorder'
  | 'scripts'
  | 'import';
const SEARCH_TYPE_LABELS = {
  workspace: 'ESPACIO',
  rule: 'REGLA',
  script: 'SCRIPT',
  template: 'PLANTILLA',
} as const;
const ALL_GROUPS = '__all_groups__';
const UNGROUPED = '__ungrouped__';
const RULE_TYPES: Array<{ kind: RuleKind; icon: string; title: string; description: string }> = [
  {
    kind: 'headers',
    icon: 'H',
    title: 'Modificar cabeceras',
    description: 'Establece, añade o elimina cabeceras.',
  },
  {
    kind: 'redirect',
    icon: '->',
    title: 'Redirigir solicitud',
    description: 'Envía una URL a otro destino.',
  },
  {
    kind: 'block',
    icon: 'X',
    title: 'Bloquear solicitud',
    description: 'Cancela recursos o endpoints.',
  },
  {
    kind: 'replace',
    icon: 'R',
    title: 'Reemplazar URL',
    description: 'Reescribe URLs mediante regex.',
  },
  {
    kind: 'query',
    icon: '?',
    title: 'Parámetros de consulta',
    description: 'Añade, cambia o elimina parámetros.',
  },
];

function blankRule(kind: RuleKind): HeaderRule {
  const common: HeaderRule = {
    id: newId(),
    name: 'Nueva regla ' + RULE_TYPES.find((item) => item.kind === kind)?.title,
    kind,
    enabled: false,
    priority: 1,
    domains: ['localhost'],
  };
  if (kind === 'headers')
    return {
      ...common,
      target: 'request',
      operation: 'set',
      header: 'X-FakeHeader-Prueba',
      value: '',
    };
  if (kind === 'redirect') return { ...common, redirectUrl: 'http://localhost:3000/' };
  if (kind === 'replace')
    return {
      ...common,
      regexFilter: '^https://api\\.example\\.com/(.*)$',
      regexSubstitution: 'http://localhost:8080/\\1',
    };
  if (kind === 'query')
    return {
      ...common,
      queryParams: [{ id: newId(), operation: 'set', key: 'debug', value: 'true' }],
    };
  return common;
}

export default function App() {
  const { settings, error, notice, setError, commit, reload } = useSettings();
  const [view, setView] = useState<View>('rules');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState(ALL_GROUPS);
  const [bulkGroupName, setBulkGroupName] = useState('');
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [showTypes, setShowTypes] = useState(false);
  const [activationOrigin, setActivationOrigin] = useState('http://localhost:3000');
  const [activationProfileId, setActivationProfileId] = useState('');
  const [activationEnvironmentId, setActivationEnvironmentId] = useState('');
  const selected = useMemo(
    () =>
      settings?.profiles.find((profile) => profile.id === selectedProfileId) ??
      settings?.profiles[0],
    [settings, selectedProfileId],
  );
  const selectedEnvironment = useMemo(
    () =>
      settings?.environments.find((item) => item.id === selectedEnvironmentId) ??
      settings?.environments[0],
    [settings, selectedEnvironmentId],
  );
  useEffect(() => setProfileName(selected?.name ?? ''), [selected?.id, selected?.name]);
  useEffect(() => {
    if (!activationProfileId && selected) setActivationProfileId(selected.id);
  }, [activationProfileId, selected]);
  useEffect(() => {
    setGroupFilter(ALL_GROUPS);
    setBulkGroupName('');
    setSelectedRuleIds([]);
  }, [selected?.id]);
  const groups = useMemo(
    () =>
      [...new Set((selected?.rules ?? []).map((rule) => rule.group?.trim()).filter(Boolean))].sort(
        (first, second) => first!.localeCompare(second!),
      ) as string[],
    [selected],
  );
  const filteredRules = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (selected?.rules ?? []).filter((rule) => {
      if (groupFilter === UNGROUPED && rule.group) return false;
      if (groupFilter !== ALL_GROUPS && groupFilter !== UNGROUPED && rule.group !== groupFilter)
        return false;
      if (!needle) return true;
      return [
        ruleTitle(rule),
        rule.kind ?? 'headers',
        rule.header ?? '',
        rule.group ?? '',
        ...(rule.tags ?? []),
        ...(rule.domains ?? []),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [groupFilter, search, selected]);
  const conflicts = useMemo(() => findRuleConflicts(selected?.rules ?? []), [selected]);
  const bulkRuleIds = useMemo(
    () =>
      new Set(
        selectedRuleIds.length
          ? (selected?.rules ?? [])
              .filter((rule) => selectedRuleIds.includes(rule.id))
              .map((rule) => rule.id)
          : filteredRules.map((rule) => rule.id),
      ),
    [filteredRules, selected, selectedRuleIds],
  );
  const selectedScripts = useMemo(
    () => settings?.scripts.filter((script) => script.profileId === selected?.id) ?? [],
    [selected?.id, settings?.scripts],
  );
  const globalResults = useMemo(() => {
    const needle = globalSearch.trim().toLowerCase();
    if (needle.length < 2 || !settings) return [];
    const results: Array<{
      id: string;
      type: 'workspace' | 'rule' | 'script' | 'template';
      title: string;
      detail: string;
      profileId?: string;
    }> = [];
    for (const profile of settings.profiles) {
      if (profile.name.toLowerCase().includes(needle))
        results.push({
          id: profile.id,
          type: 'workspace',
          title: profile.name,
          detail: `${profile.rules.length} reglas`,
          profileId: profile.id,
        });
      for (const rule of profile.rules) {
        const values = [
          ruleTitle(rule),
          rule.header ?? '',
          rule.group ?? '',
          ...(rule.tags ?? []),
          ...(rule.domains ?? []),
        ];
        if (values.some((value) => value.toLowerCase().includes(needle)))
          results.push({
            id: rule.id,
            type: 'rule',
            title: ruleTitle(rule),
            detail: profile.name,
            profileId: profile.id,
          });
      }
      for (const script of settings.scripts.filter((item) => item.profileId === profile.id))
        if (
          [script.name, script.kind, ...script.matches].some((value) =>
            value.toLowerCase().includes(needle),
          )
        )
          results.push({
            id: script.id,
            type: 'script',
            title: script.name,
            detail: profile.name,
            profileId: profile.id,
          });
    }
    for (const template of settings.templates)
      if (
        [template.name, template.description ?? '', ruleTitle(template.rule)].some((value) =>
          value.toLowerCase().includes(needle),
        )
      )
        results.push({
          id: template.id,
          type: 'template',
          title: template.name,
          detail: template.description ?? 'Plantilla personalizada',
        });
    return results.slice(0, 40);
  }, [globalSearch, settings]);

  const openGlobalResult = (result: (typeof globalResults)[number]) => {
    if (result.profileId) setSelectedProfileId(result.profileId);
    if (result.type === 'rule') {
      setSearch(result.title);
      setView('rules');
    } else if (result.type === 'script') setView('scripts');
    else if (result.type === 'template') setView('templates');
    else setView('rules');
    setGlobalSearch('');
  };

  if (!settings || !selected)
    return (
      <main className="panel" style={{ margin: 30 }}>
        Cargando...{error && <div className="error">{error}</div>}
      </main>
    );

  const replaceProfile = (profile: HeaderProfile, permissions = true) =>
    commit(
      {
        ...settings,
        profiles: settings.profiles.map((item) => (item.id === profile.id ? profile : item)),
      },
      permissions,
    );
  const createProfile = () => {
    const profile: HeaderProfile = {
      id: newId(),
      name: 'Espacio de trabajo ' + (settings.profiles.length + 1),
      enabled: true,
      rules: [],
    };
    void commit({ ...settings, profiles: [...settings.profiles, profile] }, false).then((ok) => {
      if (ok) setSelectedProfileId(profile.id);
    });
  };
  const duplicateProfile = () => {
    const profile: HeaderProfile = {
      ...selected,
      id: newId(),
      name: selected.name + ' (copia)',
      rules: selected.rules.map((rule) => ({
        ...rule,
        id: newId(),
        valueRef: rule.sensitive ? newId() : undefined,
        queryParams: rule.queryParams?.map((item) => ({ ...item, id: newId() })),
        enabled: false,
      })),
    };
    const scripts = settings.scripts
      .filter((script) => script.profileId === selected.id)
      .map((script) => ({ ...script, id: newId(), profileId: profile.id, enabled: false }));
    void commit(
      {
        ...settings,
        profiles: [...settings.profiles, profile],
        scripts: [...settings.scripts, ...scripts],
      },
      false,
    ).then((ok) => {
      if (ok) setSelectedProfileId(profile.id);
    });
  };
  const removeProfile = () => {
    if (settings.profiles.length === 1) return setError('Debe existir al menos un perfil.');
    if (!window.confirm('¿Eliminar el espacio de trabajo "' + selected.name + '"?')) return;
    const profiles = settings.profiles.filter((profile) => profile.id !== selected.id);
    void commit(
      {
        ...settings,
        profiles,
        autoActivations: settings.autoActivations.filter(
          (activation) => activation.profileId !== selected.id,
        ),
        scripts: settings.scripts.filter((script) => script.profileId !== selected.id),
      },
      false,
    ).then((ok) => {
      if (ok) setSelectedProfileId(profiles[0].id);
    });
  };
  const saveRule = (rule: HeaderRule) =>
    void replaceProfile({
      ...selected,
      rules: selected.rules.map((item) => (item.id === rule.id ? rule : item)),
    });
  const duplicateRule = (rule: HeaderRule) => {
    const duplicate: HeaderRule = {
      ...rule,
      id: newId(),
      name: ruleTitle(rule) + ' (copia)',
      enabled: false,
      pinned: false,
      valueRef: rule.sensitive ? newId() : undefined,
      queryParams: rule.queryParams?.map((item) => ({ ...item, id: newId() })),
    };
    void replaceProfile({ ...selected, rules: [...selected.rules, duplicate] }, false);
  };
  const reorderRule = (ruleId: string, direction: -1 | 1) => {
    const index = selected.rules.findIndex((rule) => rule.id === ruleId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= selected.rules.length) return;
    const rules = [...selected.rules];
    [rules[index], rules[target]] = [rules[target], rules[index]];
    void replaceProfile({ ...selected, rules }, false);
  };
  const transferRule = (rule: HeaderRule, destinationId: string, mode: 'copy' | 'move') => {
    const destination = settings.profiles.find((profile) => profile.id === destinationId);
    if (!destination || destination.id === selected.id) return;
    const id = mode === 'copy' ? newId() : rule.id;
    const transferred: HeaderRule = {
      ...rule,
      id,
      enabled: false,
      ...(rule.sensitive ? { valueRef: mode === 'copy' ? id : rule.valueRef } : {}),
      queryParams:
        mode === 'copy'
          ? rule.queryParams?.map((item) => ({ ...item, id: newId() }))
          : rule.queryParams,
    };
    void commit(
      {
        ...settings,
        profiles: settings.profiles.map((profile) => {
          if (profile.id === selected.id && mode === 'move')
            return { ...profile, rules: profile.rules.filter((item) => item.id !== rule.id) };
          if (profile.id === destination.id)
            return { ...profile, rules: [...profile.rules, transferred] };
          return profile;
        }),
      },
      false,
    );
  };
  const addRule = (kind: RuleKind) => {
    setShowTypes(false);
    const rule = blankRule(kind);
    if (groupFilter !== ALL_GROUPS && groupFilter !== UNGROUPED) rule.group = groupFilter;
    void replaceProfile({ ...selected, rules: [...selected.rules, rule] }, false);
  };
  const addTemplate = (templateId: string) => {
    const template = RULE_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setShowTypes(false);
    const rule = template.create();
    if (groupFilter !== ALL_GROUPS && groupFilter !== UNGROUPED) rule.group = groupFilter;
    void replaceProfile({ ...selected, rules: [...selected.rules, rule] }, false);
  };
  const addMapLocalRule = (rule: HeaderRule) => {
    setShowTypes(false);
    if (groupFilter !== ALL_GROUPS && groupFilter !== UNGROUPED) rule.group = groupFilter;
    void replaceProfile({ ...selected, rules: [...selected.rules, rule] }, false);
  };
  const saveAsTemplate = (rule: HeaderRule) => {
    const name = window.prompt('Nombre de la plantilla:', ruleTitle(rule));
    if (name === null) return;
    const normalized = name.trim();
    if (!normalized || normalized.length > 80) {
      setError('El nombre de la plantilla debe tener entre 1 y 80 caracteres.');
      return;
    }
    const template = createSavedRuleTemplate(rule, normalized);
    void commit({ ...settings, templates: [...settings.templates, template] }, false);
  };
  const addFromSavedTemplate = (template: SavedRuleTemplate) => {
    const rule = instantiateSavedRuleTemplate(template);
    if (groupFilter !== ALL_GROUPS && groupFilter !== UNGROUPED) rule.group = groupFilter;
    void replaceProfile({ ...selected, rules: [...selected.rules, rule] }, false).then((ok) => {
      if (ok) setView('rules');
    });
  };
  const deleteSavedTemplate = (template: SavedRuleTemplate) => {
    if (!window.confirm(`¿Eliminar la plantilla "${template.name}"?`)) return;
    void commit(
      {
        ...settings,
        templates: settings.templates.filter((item) => item.id !== template.id),
      },
      false,
    );
  };
  const bulkSetEnabled = (enabled: boolean) => {
    if (!bulkRuleIds.size) return;
    void replaceProfile(
      {
        ...selected,
        rules: selected.rules.map((rule) =>
          bulkRuleIds.has(rule.id) ? { ...rule, enabled } : rule,
        ),
      },
      enabled,
    );
  };
  const assignFilteredGroup = (forcedGroup?: string) => {
    if (!bulkRuleIds.size) return;
    const group = (forcedGroup === undefined ? bulkGroupName : forcedGroup).trim();
    void replaceProfile(
      {
        ...selected,
        rules: selected.rules.map((rule) =>
          bulkRuleIds.has(rule.id) ? { ...rule, group: group || undefined } : rule,
        ),
      },
      false,
    ).then((ok) => {
      if (ok) setBulkGroupName('');
    });
  };
  const deleteBulkRules = () => {
    if (!bulkRuleIds.size || !window.confirm(`¿Eliminar ${bulkRuleIds.size} reglas?`)) return;
    void replaceProfile(
      {
        ...selected,
        rules: selected.rules.filter((rule) => !bulkRuleIds.has(rule.id)),
      },
      false,
    ).then((ok) => {
      if (ok) setSelectedRuleIds([]);
    });
  };
  const toggleRuleSelection = (ruleId: string, selectedValue: boolean) =>
    setSelectedRuleIds((current) =>
      selectedValue ? [...new Set([...current, ruleId])] : current.filter((id) => id !== ruleId),
    );
  const setAutoDisableOnNavigation = async (enabled: boolean) => {
    if (enabled) {
      const granted = await chrome.permissions.request({ permissions: ['webNavigation'] });
      if (!granted) {
        setError('Se necesita webNavigation para detectar cambios de origen.');
        return;
      }
    }
    await commit(
      {
        ...settings,
        safety: { ...settings.safety, autoDisableOnNavigation: enabled },
      },
      false,
    );
  };
  const ensureNavigationPermission = async () => {
    if (await chrome.permissions.contains({ permissions: ['webNavigation'] })) return true;
    const granted = await chrome.permissions.request({ permissions: ['webNavigation'] });
    if (!granted) setError('Se necesita webNavigation para activar perfiles al navegar.');
    return granted;
  };
  const addAutoActivation = async () => {
    let origin: string;
    try {
      const url = new URL(activationOrigin.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== activationOrigin.trim())
        throw new Error();
      origin = url.origin;
    } catch {
      setError('Introduce un origen HTTP(S) exacto, por ejemplo http://localhost:3000.');
      return;
    }
    if (settings.autoActivations.some((item) => item.origin === origin)) {
      setError('Ese origen ya tiene una activación automática.');
      return;
    }
    if (!(await ensureNavigationPermission())) return;
    const activation: AutoActivation = {
      id: newId(),
      enabled: true,
      origin,
      profileId: activationProfileId || selected.id,
      ...(activationEnvironmentId ? { environmentId: activationEnvironmentId } : {}),
      durationMinutes: 0,
    };
    void commit({ ...settings, autoActivations: [...settings.autoActivations, activation] }, true);
  };
  const updateAutoActivation = async (activation: AutoActivation) => {
    if (activation.enabled && !(await ensureNavigationPermission())) return;
    void commit(
      {
        ...settings,
        autoActivations: settings.autoActivations.map((item) =>
          item.id === activation.id ? activation : item,
        ),
      },
      activation.enabled,
    );
  };
  const removeAutoActivation = (id: string) =>
    void commit(
      { ...settings, autoActivations: settings.autoActivations.filter((item) => item.id !== id) },
      false,
    );
  const saveEnvironment = (environment: RuleEnvironment) =>
    void commit(
      {
        ...settings,
        environments: settings.environments.map((item) =>
          item.id === environment.id ? environment : item,
        ),
      },
      false,
    );
  const createEnvironment = () => {
    const environment: RuleEnvironment = {
      id: newId(),
      name: 'Entorno ' + (settings.environments.length + 1),
      variables: [],
    };
    void commit({ ...settings, environments: [...settings.environments, environment] }, false).then(
      (ok) => {
        if (ok) setSelectedEnvironmentId(environment.id);
      },
    );
  };
  const importEnvironment = (environment: RuleEnvironment) => {
    if (settings.environments.length >= 100) {
      setError('FakeHeader admite hasta 100 entornos.');
      return;
    }
    void commit(
      { ...settings, environments: [...settings.environments, environment] },
      false,
    ).then((ok) => {
      if (ok) setSelectedEnvironmentId(environment.id);
    });
  };
  const removeEnvironment = () => {
    if (!selectedEnvironment) return;
    if (!window.confirm('¿Eliminar el entorno "' + selectedEnvironment.name + '"?')) return;
    const environments = settings.environments.filter((item) => item.id !== selectedEnvironment.id);
    void commit(
      {
        ...settings,
        environments,
        autoActivations: settings.autoActivations.map((activation) =>
          activation.environmentId === selectedEnvironment.id
            ? { ...activation, environmentId: undefined }
            : activation,
        ),
      },
      false,
    ).then((ok) => {
      if (ok) setSelectedEnvironmentId(environments[0]?.id ?? '');
    });
  };
  const killSwitch = async () => {
    if (!window.confirm('¿Desactivar FakeHeader en todas las pestañas inmediatamente?')) return;
    const result = (await chrome.runtime.sendMessage({ type: 'disable-everywhere' })) as {
      ok?: boolean;
      error?: string;
    };
    if (!result?.ok) setError(result?.error ?? 'No se pudo completar el apagado de emergencia.');
  };
  const createScript = (templateId?: string) => {
    const template = USER_SCRIPT_TEMPLATES.find((item) => item.id === templateId);
    const script: UserScriptRule = template
      ? {
          ...template.script,
          id: newId(),
          profileId: selected.id,
          matches: [...template.script.matches],
          excludeMatches: [...template.script.excludeMatches],
        }
      : {
          id: newId(),
          profileId: selected.id,
      name: 'Nuevo script',
          enabled: false,
          kind: 'javascript',
          world: 'USER_SCRIPT',
          injectImmediately: false,
          execution: 'manual',
          matches: [],
          excludeMatches: [],
      code: "console.log('Script de usuario de FakeHeader');",
        };
    void commit({ ...settings, scripts: [...settings.scripts, script] }, false);
  };
  const saveScript = async (script: UserScriptRule) => {
    if (
      [...script.matches, ...script.excludeMatches].some(
        (pattern) => !isValidScriptMatchPattern(pattern),
      )
    ) {
      setError('Hay un match pattern no válido. Usa, por ejemplo, http://localhost/*.');
      return;
    }
    if (script.execution === 'navigation' && !script.matches.length) {
      setError('La ejecución automática necesita al menos un match pattern permitido.');
      return;
    }
    if (!(await requestAutomaticScriptAccess([script]))) {
      setError('No se concedieron los permisos necesarios para la ejecución automática.');
      return;
    }
    await commit(
      {
        ...settings,
        scripts: settings.scripts.map((item) => (item.id === script.id ? script : item)),
      },
      false,
    );
  };
  const deleteScript = (script: UserScriptRule) => {
    if (!window.confirm(`¿Eliminar el script "${script.name}"?`)) return;
    void commit(
      { ...settings, scripts: settings.scripts.filter((item) => item.id !== script.id) },
      false,
    );
  };

  return (
    <div className="options-shell">
      <header className="requestly-topbar">
        <div className="brand">
          <span className="mark">F</span>
          <div>
            <h1>{APP_NAME}</h1>
            <div className="subtitle">Herramientas HTTP locales para desarrollo</div>
          </div>
        </div>
        <div className="actions">
          <input
            className="global-search-input"
            value={globalSearch}
            onChange={(event) => setGlobalSearch(event.target.value)}
            placeholder="Buscar en FakeHeader..."
            aria-label="Búsqueda global"
          />
          <span className="badge safe-badge">SÓLO LOCAL</span>
          <button className="button danger small" onClick={() => void killSwitch()}>
            Desactivar en todas las pestañas
          </button>
        </div>
      </header>
      <div className="requestly-layout">
        <aside className="workspace-sidebar">
          <nav className="main-nav">
            <button className={view === 'rules' ? 'active' : ''} onClick={() => setView('rules')}>
              <span>HTTP</span> Reglas HTTP
            </button>
            <button
              className={view === 'environments' ? 'active' : ''}
              onClick={() => setView('environments')}
            >
              <span>{'{ }'}</span> Entornos
            </button>
            <button
              className={view === 'templates' ? 'active' : ''}
              onClick={() => setView('templates')}
            >
              <span>PLT</span> Plantillas
            </button>
            <button className={view === 'tester' ? 'active' : ''} onClick={() => setView('tester')}>
              <span>PRUEBA</span> Probador de reglas
            </button>
            <button
              className={view === 'inspector' ? 'active' : ''}
              onClick={() => setView('inspector')}
            >
              <span>EJEC</span> Inspector de ejecución
            </button>
            <button className={view === 'curl' ? 'active' : ''} onClick={() => setView('curl')}>
              <span>&gt;_</span> Importar cURL
            </button>
            <button className={view === 'safety' ? 'active' : ''} onClick={() => setView('safety')}>
              <span>SEG</span> Seguridad y permisos
            </button>
            <button
              className={view === 'history' ? 'active' : ''}
              onClick={() => setView('history')}
            >
              <span>DESH</span> Historial y deshacer
            </button>
            <button
              className={view === 'recorder' ? 'active' : ''}
              onClick={() => setView('recorder')}
            >
              <span>GRAB</span> Grabador de tráfico
            </button>
            <button
              className={view === 'scripts' ? 'active' : ''}
              onClick={() => setView('scripts')}
            >
              <span>JS</span> Scripts de usuario
            </button>
            <button className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}>
              <span>E/S</span> Importar y exportar
            </button>
          </nav>
          <div className="sidebar-section-title">
            <span>ESPACIOS DE TRABAJO</span>
            <button className="icon-button" title="Nuevo espacio de trabajo" onClick={createProfile}>
              +
            </button>
          </div>
          <div className="sidebar-list">
            {settings.profiles.map((profile) => (
              <button
                key={profile.id}
                className={'profile-item ' + (profile.id === selected.id ? 'active' : '')}
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  setView('rules');
                }}
              >
                <span>{profile.name}</span>
                  <small
                    title={`${profile.rules.filter((rule) => rule.enabled).length} reglas activas de ${profile.rules.length}`}
                  >
                    {profile.rules.filter((rule) => rule.enabled).length}/{profile.rules.length}
                  </small>
              </button>
            ))}
          </div>
          <div className="sidebar-security">
            <strong>Seguridad por pestaña</strong>
            <span>Las reglas sólo se ejecutan en pestañas activadas explícitamente.</span>
          </div>
        </aside>

        <main className="workspace-content">
          {error && <div className="error sticky-message">{error}</div>}
          {notice && <div className="notice sticky-message">{notice}</div>}
          {globalSearch.trim().length >= 2 && (
            <section className="panel workspace-panel global-search-results">
              <div className="toolbar">
                <div>
                  <span className="eyebrow">BÚSQUEDA GLOBAL</span>
                  <h1>Resultados para "{globalSearch.trim()}"</h1>
                </div>
                <button className="button secondary small" onClick={() => setGlobalSearch('')}>
                  Cerrar
                </button>
              </div>
              {globalResults.length ? (
                globalResults.map((result) => (
                  <button
                    className="global-search-result"
                    key={`${result.type}-${result.id}`}
                    onClick={() => openGlobalResult(result)}
                  >
                    <span className="badge">{SEARCH_TYPE_LABELS[result.type]}</span>
                    <strong>{result.title}</strong>
                    <small>{result.detail}</small>
                  </button>
                ))
              ) : (
                <div className="empty">No hay coincidencias.</div>
              )}
            </section>
          )}
          {globalSearch.trim().length < 2 && view === 'rules' && (
            <>
              <div className="workspace-heading">
                <div>
                    <span className="eyebrow">REGLAS HTTP / {selected.name.toUpperCase()}</span>
                  <h1>Intercepta y modifica tráfico local</h1>
                  <p className="muted">
                    Cabeceras, redirecciones, bloqueos y transformaciones limitadas por pestaña.
                  </p>
                </div>
                <button className="button create-rule-button" onClick={() => setShowTypes(true)}>
                + Crear regla
                </button>
              </div>
              <div className="stats-grid">
                <div>
                  <strong>{selected.rules.length}</strong>
                <span>Reglas totales</span>
                </div>
                <div>
                  <strong>{selected.rules.filter((rule) => rule.enabled).length}</strong>
                <span>Activadas</span>
                </div>
                <div>
                  <strong>
                    {new Set(selected.rules.flatMap((rule) => rule.domains ?? [])).size}
                  </strong>
                  <span>Dominios</span>
                </div>
                <div className={conflicts.length ? 'warning-stat' : ''}>
                  <strong>{conflicts.length}</strong>
                <span>Conflictos</span>
                </div>
              </div>
              <section className="panel workspace-panel profile-settings">
                <div className="toolbar">
                  <span className="inline-field profile-name-field">
                    <input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                    />
                    <button
                      className="button small"
                      onClick={() => void replaceProfile({ ...selected, name: profileName }, false)}
                    >
                      Guardar
                    </button>
                  </span>
                  <div className="actions">
                    <label className="switch" title="Activar espacio de trabajo">
                      <input
                        type="checkbox"
                        checked={selected.enabled}
                        onChange={(event) =>
                          void replaceProfile({ ...selected, enabled: event.target.checked })
                        }
                      />
                      <span className="slider" />
                    </label>
                    <button className="button secondary small" onClick={duplicateProfile}>
                    Duplicar espacio
                    </button>
                    <button className="button danger small" onClick={removeProfile}>
                      Eliminar
                    </button>
                  </div>
                </div>
              </section>
              {conflicts.length > 0 && (
                <section className="conflict-panel">
                  <strong>Posibles conflictos</strong>
                  {conflicts.map((conflict) => (
                    <span key={conflict.ruleIds.join('-')}>{conflict.message}</span>
                  ))}
                </section>
              )}
              <section className="panel workspace-panel">
                <div className="rules-toolbar">
                  <select
                    className="group-filter"
                    value={groupFilter}
                    onChange={(event) => setGroupFilter(event.target.value)}
                    aria-label="Filtrar por grupo"
                  >
                    <option value={ALL_GROUPS}>Todos los grupos</option>
                    <option value={UNGROUPED}>Sin grupo</option>
                    {groups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                  <input
                    className="search-input"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar reglas, cabeceras o hosts..."
                  />
                  <span className="muted">{filteredRules.length} resultados</span>
                </div>
                <div className="bulk-toolbar">
                  <span className="muted">
                    {selectedRuleIds.length
                      ? `${selectedRuleIds.length} seleccionadas`
                      : 'Acciones sobre los resultados visibles'}
                  </span>
                  <div className="actions">
                    <button
                      className="button secondary small"
                      disabled={!filteredRules.length}
                      onClick={() => setSelectedRuleIds(filteredRules.map((rule) => rule.id))}
                    >
                      Seleccionar visibles
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!selectedRuleIds.length}
                      onClick={() => setSelectedRuleIds([])}
                    >
                      Limpiar selección
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!bulkRuleIds.size}
                      onClick={() => bulkSetEnabled(true)}
                    >
                      Activar todos
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!bulkRuleIds.size}
                      onClick={() => bulkSetEnabled(false)}
                    >
                      Desactivar todos
                    </button>
                  </div>
                  <span className="inline-field bulk-group-field">
                    <input
                      value={bulkGroupName}
                      maxLength={50}
                      onChange={(event) => setBulkGroupName(event.target.value)}
                      placeholder="Asignar grupo..."
                    />
                    <button
                      className="button secondary small"
                      disabled={!bulkRuleIds.size || !bulkGroupName.trim()}
                      onClick={() => assignFilteredGroup()}
                    >
                      Asignar
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!bulkRuleIds.size}
                      onClick={() => assignFilteredGroup('')}
                    >
                      Quitar grupo
                    </button>
                  </span>
                  <button
                    className="button danger small"
                    disabled={!bulkRuleIds.size}
                    onClick={deleteBulkRules}
                  >
                    Eliminar
                  </button>
                </div>
                {showTypes && (
                  <div className="rule-type-picker">
                    <div className="toolbar">
                      <div>
                        <strong>Selecciona un tipo de regla</strong>
                        <div className="muted">Todas se compilan como reglas de sesión DNR.</div>
                      </div>
                      <button className="icon-button" onClick={() => setShowTypes(false)}>
                        X
                      </button>
                    </div>
                    <div className="rule-type-grid">
                      {RULE_TYPES.map((item) => (
                        <button
                          key={item.kind}
                          className={'rule-type-card kind-' + item.kind}
                          onClick={() => addRule(item.kind)}
                        >
                          <span className="rule-type-icon">{item.icon}</span>
                          <strong>{item.title}</strong>
                          <small>{item.description}</small>
                        </button>
                      ))}
                    </div>
                    <h3 className="template-heading">Plantillas rápidas</h3>
                    <div className="template-grid">
                      {RULE_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          className="template-card"
                          onClick={() => addTemplate(template.id)}
                        >
                          <strong>{template.title}</strong>
                          <small>{template.description}</small>
                        </button>
                      ))}
                    </div>
                    <MapLocalWizard onCreate={addMapLocalRule} />
                    {settings.templates.length > 0 && (
                      <>
                        <h3 className="template-heading">Mis plantillas</h3>
                        <div className="template-grid">
                          {settings.templates.map((template) => (
                            <button
                              key={template.id}
                              className="template-card"
                              onClick={() => {
                                setShowTypes(false);
                                addFromSavedTemplate(template);
                              }}
                            >
                              <strong>{template.name}</strong>
                              <small>{template.description ?? 'Plantilla personalizada'}</small>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {filteredRules.length ? (
                  filteredRules.map((rule) => {
                    const index = selected.rules.findIndex((item) => item.id === rule.id);
                    return (
                      <RuleEditor
                        key={rule.id}
                        rule={rule}
                        onSave={saveRule}
                        onSaveAsTemplate={saveAsTemplate}
                        onDuplicate={() => duplicateRule(rule)}
                        onMoveUp={() => reorderRule(rule.id, -1)}
                        onMoveDown={() => reorderRule(rule.id, 1)}
                        canMoveUp={index > 0}
                        canMoveDown={index >= 0 && index < selected.rules.length - 1}
                        destinations={settings.profiles
                          .filter((profile) => profile.id !== selected.id)
                          .map((profile) => ({ id: profile.id, name: profile.name }))}
                        onTransfer={(profileId, mode) => transferRule(rule, profileId, mode)}
                        selected={selectedRuleIds.includes(rule.id)}
                        onSelectedChange={(value) => toggleRuleSelection(rule.id, value)}
                        onDelete={() =>
                          void replaceProfile(
                            {
                              ...selected,
                              rules: selected.rules.filter((item) => item.id !== rule.id),
                            },
                            false,
                          )
                        }
                      />
                    );
                  })
                ) : (
                  <div className="empty">No hay reglas que coincidan. Crea una para empezar.</div>
                )}
              </section>
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'environments' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">ENTORNOS</span>
                  <h1>Variables para cada entorno</h1>
                  <p className="muted">Cambia entre Local, Desarrollo o Preproducción desde el popup.</p>
                </div>
                <button className="button" onClick={createEnvironment}>
                  + Nuevo entorno
                </button>
              </div>
              <EnvironmentTransfer current={selectedEnvironment} onImport={importEnvironment} />
              {settings.environments.length > 0 ? (
                <div className="environment-layout">
                  <aside className="panel environment-list">
                    {settings.environments.map((environment) => (
                      <button
                        key={environment.id}
                        className={environment.id === selectedEnvironment?.id ? 'active' : ''}
                        onClick={() => setSelectedEnvironmentId(environment.id)}
                      >
                        <span>{environment.name}</span>
                        <small>{environment.variables.length}</small>
                      </button>
                    ))}
                  </aside>
                  {selectedEnvironment && (
                    <EnvironmentEditor
                      environment={selectedEnvironment}
                      onSave={saveEnvironment}
                      onDelete={removeEnvironment}
                    />
                  )}
                </div>
              ) : (
                <div className="empty large-empty">
                  No hay entornos. Crea uno para utilizar variables.
                </div>
              )}
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'templates' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">BIBLIOTECA DE PLANTILLAS</span>
                  <h1>Reglas reutilizables</h1>
                  <p className="muted">
                    Crea reglas desactivadas a partir de presets locales sin copiar secretos.
                  </p>
                </div>
              </div>
              <section className="panel workspace-panel">
                <h2>Plantillas incluidas</h2>
                <div className="template-grid">
                  {RULE_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      className="template-card"
                      onClick={() => {
                        addTemplate(template.id);
                        setView('rules');
                      }}
                    >
                      <strong>{template.title}</strong>
                      <small>{template.description}</small>
                    </button>
                  ))}
                </div>
              </section>
              <h2 className="section-heading">Mis plantillas</h2>
              <TemplateLibrary
                templates={settings.templates}
                onUse={addFromSavedTemplate}
                onDelete={deleteSavedTemplate}
              />
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'tester' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">PROBADOR DE REGLAS</span>
                  <h1>Comprueba una configuración sin enviar tráfico</h1>
                  <p className="muted">
                    Previsualización local de coincidencias y DNR con secretos censurados.
                  </p>
                </div>
              </div>
              <RuleTester settings={settings} />
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'inspector' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">INSPECTOR DE EJECUCIÓN</span>
                  <h1>Comprueba qué está ejecutando Chrome</h1>
                  <p className="muted">
                    Estado real por pestaña, reglas DNR instaladas y permisos concedidos.
                  </p>
                </div>
              </div>
              <ExecutionInspector />
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'curl' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">IMPORTAR CURL</span>
                  <h1>Convierte un cURL en reglas de cabecera</h1>
                  <p className="muted">
                    Reutiliza las cabeceras de DevTools sin ejecutar el comando ni enviar tráfico.
                  </p>
                </div>
              </div>
              <CurlImporter
                workspaceName={selected.name}
                onImport={(rules) =>
                  replaceProfile({ ...selected, rules: [...selected.rules, ...rules] }, false)
                }
              />
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'safety' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">SEGURIDAD</span>
                  <h1>Caducidad, navegación y mínimo privilegio</h1>
                  <p className="muted">
                    La caducidad se elige en el panel emergente. Aquí controlas navegación y permisos.
                  </p>
                </div>
              </div>
              <section className="panel workspace-panel">
                <div className="safety-setting">
                  <div>
                    <strong>Desactivar cuando la pestaña cambie de origen</strong>
                    <p className="muted">
                      Conserva la activación al recargar el mismo origen, pero apaga FakeHeader al navegar a
                      otro. Requiere el permiso opcional webNavigation.
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.safety.autoDisableOnNavigation}
                      onChange={(event) => void setAutoDisableOnNavigation(event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              </section>
              <section className="panel workspace-panel">
                <div>
                  <h2>Activación automática por origen</h2>
                  <p className="muted">
                    Activa un espacio de trabajo sólo al entrar en un origen exacto. Al salir, una activación
                    automática siempre se apaga.
                  </p>
                </div>
                <div className="auto-activation-form">
                  <input
                    value={activationOrigin}
                    onChange={(event) => setActivationOrigin(event.target.value)}
                    placeholder="http://localhost:3000"
                    aria-label="Origen exacto"
                  />
                  <select
                    value={activationProfileId || selected.id}
                    onChange={(event) => setActivationProfileId(event.target.value)}
                    aria-label="Espacio de trabajo"
                  >
                    {settings.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={activationEnvironmentId}
                    onChange={(event) => setActivationEnvironmentId(event.target.value)}
                    aria-label="Entorno"
                  >
                    <option value="">Sin entorno</option>
                    {settings.environments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.name}
                      </option>
                    ))}
                  </select>
                  <button className="button" onClick={() => void addAutoActivation()}>
                    Añadir origen
                  </button>
                </div>
                <div className="permission-list">
                  {settings.autoActivations.length ? (
                    settings.autoActivations.map((activation) => (
                      <div className="permission-row auto-activation-row" key={activation.id}>
                        <div>
                          <strong>{activation.origin}</strong>
                          <span className="muted">
                            {
                              settings.profiles.find(
                                (profile) => profile.id === activation.profileId,
                              )?.name
                            }
                            {activation.environmentId
                              ? ` - ${settings.environments.find((environment) => environment.id === activation.environmentId)?.name}`
                              : ''}
                          </span>
                        </div>
                        <div className="actions">
                          <label className="switch" title="Activar automatismo">
                            <input
                              type="checkbox"
                              checked={activation.enabled}
                              onChange={(event) =>
                                void updateAutoActivation({
                                  ...activation,
                                  enabled: event.target.checked,
                                })
                              }
                            />
                            <span className="slider" />
                          </label>
                          <button
                            className="button danger small"
                            onClick={() => removeAutoActivation(activation.id)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty">No hay orígenes configurados.</div>
                  )}
                </div>
              </section>
              <PermissionsManager
                usedOrigins={[
                  ...new Set([
                    ...originsForProfiles(settings.profiles),
                    ...originsForAutomaticScripts(settings.scripts),
                  ]),
                ]}
                onPermissionRemoved={(permission) => {
                  if (
                    permission === 'webNavigation' &&
                    (settings.safety.autoDisableOnNavigation ||
                      settings.autoActivations.some((activation) => activation.enabled))
                  )
                    void commit(
                      {
                        ...settings,
                        safety: { ...settings.safety, autoDisableOnNavigation: false },
                        autoActivations: settings.autoActivations.map((activation) => ({
                          ...activation,
                          enabled: false,
                        })),
                      },
                      false,
                    );
                }}
              />
              <ShortcutManager />
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'history' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">HISTORIAL LOCAL</span>
                  <h1>Deshacer y restaurar configuraciones</h1>
                  <p className="muted">
                    Historial limitado, local y sin valores sensibles persistentes.
                  </p>
                </div>
              </div>
              <SettingsHistory onRestored={reload} />
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'recorder' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">GRABADOR DE TRÁFICO LOCAL</span>
                  <h1>Inspecciona y exporta peticiones</h1>
                  <p className="muted">
                    Captura local por pestaña con respuestas completas de fetch/XHR y exportación HAR.
                  </p>
                </div>
              </div>
              <TrafficRecorder
                onCreateRules={(rules) =>
                  replaceProfile({ ...selected, rules: [...selected.rules, ...rules] }, false)
                }
              />
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'scripts' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">SCRIPTS DE USUARIO / {selected.name.toUpperCase()}</span>
                  <h1>Ejecuta JavaScript en la pestaña actual</h1>
                  <p className="muted">
                    Scripts locales bajo demanda, aislados por defecto y asociados al espacio de trabajo.
                  </p>
                </div>
              </div>
              <ScriptManager
                scripts={selectedScripts}
                onCreate={createScript}
                onSave={saveScript}
                onDelete={deleteScript}
              />
              <ScriptPermissions scripts={selectedScripts} />
              <ScriptActivity profileId={selected.id} scripts={selectedScripts} />
            </>
          )}

          {globalSearch.trim().length < 2 && view === 'import' && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">PORTABILIDAD</span>
                  <h1>Importar y exportar</h1>
                  <p className="muted">
                    La exportación normal siempre censura reglas y variables sensibles.
                  </p>
                </div>
              </div>
              <section className="panel workspace-panel">
                <ImportExport
                  settings={settings}
                  selectedProfileId={selected.id}
                  onImport={(value) => {
                    setSelectedProfileId('');
                    void commit(value).then((ok) => {
                      if (ok) window.alert('Configuración importada de forma segura.');
                    });
                  }}
                  onError={setError}
                  onImportWorkspace={(value) => {
                    const importedProfile = value.profiles[value.profiles.length - 1];
                    void commit(value, false).then((ok) => {
                      if (ok && importedProfile) {
                        setSelectedProfileId(importedProfile.id);
                        setView('rules');
                      }
                    });
                  }}
                />
              </section>
              <RequestlyImporter
                workspaceName={selected.name}
                environmentName={selectedEnvironment?.name ?? 'Cuerpos de Requestly'}
                onImport={(rules, scripts, payloadVariables) => {
                  if (selected.rules.length + rules.length > 5000) {
                    setError('El espacio de trabajo superaría el límite de 5000 reglas.');
                    return Promise.resolve(false);
                  }
                  if (settings.scripts.length + scripts.length > 100) {
                    setError('La configuración superaría el límite de 100 scripts.');
                    return Promise.resolve(false);
                  }
                  const payloadEnvironment: RuleEnvironment = selectedEnvironment ?? {
                    id: newId(),
                    name: 'Cuerpos de Requestly',
                    variables: [],
                  };
                  if (payloadEnvironment.variables.length + payloadVariables.length > 500) {
                    setError('El entorno superaría el límite de 500 variables.');
                    return Promise.resolve(false);
                  }
                  const environments = payloadVariables.length
                    ? selectedEnvironment
                      ? settings.environments.map((environment) =>
                          environment.id === selectedEnvironment.id
                            ? {
                                ...environment,
                                variables: [...environment.variables, ...payloadVariables],
                              }
                            : environment,
                        )
                      : [
                          ...settings.environments,
                          { ...payloadEnvironment, variables: payloadVariables },
                        ]
                    : settings.environments;
                  return commit(
                    {
                      ...settings,
                      environments,
                      profiles: settings.profiles.map((profile) =>
                        profile.id === selected.id
                          ? { ...profile, rules: [...profile.rules, ...rules] }
                          : profile,
                      ),
                      scripts: [
                        ...settings.scripts,
                        ...scripts.map((script) => ({ ...script, profileId: selected.id })),
                      ],
                    },
                    false,
                  ).then((ok) => {
                    if (ok && payloadVariables.length)
                      setSelectedEnvironmentId(payloadEnvironment.id);
                    return ok;
                  });
                }}
              />
              <ModHeaderImporter
                onImport={(profiles) => {
                  if (settings.profiles.length + profiles.length > 100) {
                    setError('La configuración superaría el límite de 100 espacios de trabajo.');
                    return Promise.resolve(false);
                  }
                  const firstProfile = profiles[0];
                  return commit(
                    { ...settings, profiles: [...settings.profiles, ...profiles] },
                    false,
                  ).then((ok) => {
                    if (ok && firstProfile) {
                      setSelectedProfileId(firstProfile.id);
                      setView('rules');
                    }
                    return ok;
                  });
                }}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
