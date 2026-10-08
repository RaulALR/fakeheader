import type { FakeHeaderSettings } from '../types/profile';
import type { HeaderRule } from '../types/rule';
import type { ActiveTabStateMap, SessionSecrets } from '../types/session';
import { isSensitiveHeader } from '../utils/sensitive';
import { normalizeDomain, validateRule } from './validators';
import { environmentValues, resolveVariables } from './variables';

function resolveHttpUrl(value: string, variables: Record<string, string>): string {
  const resolved = resolveVariables(value, variables);
  const url = new URL(resolved);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('La URL resuelta debe utilizar HTTP o HTTPS.');
  return resolved;
}

function conditionForRule(
  rule: HeaderRule,
  tabIds: number[],
): chrome.declarativeNetRequest.RuleCondition {
  const condition: chrome.declarativeNetRequest.RuleCondition = { tabIds };
  if (rule.urlFilter) condition.urlFilter = rule.urlFilter;
  if (rule.regexFilter) condition.regexFilter = rule.regexFilter;
  if (rule.domains?.length) condition.requestDomains = rule.domains.map(normalizeDomain);
  if (rule.excludedDomains?.length)
    condition.excludedRequestDomains = rule.excludedDomains.map(normalizeDomain);
  if (rule.resourceTypes?.length)
    condition.resourceTypes = rule.resourceTypes as chrome.declarativeNetRequest.ResourceType[];
  if (rule.excludedResourceTypes?.length)
    condition.excludedResourceTypes =
      rule.excludedResourceTypes as chrome.declarativeNetRequest.ResourceType[];
  if (rule.requestMethods?.length)
    condition.requestMethods = rule.requestMethods as chrome.declarativeNetRequest.RequestMethod[];
  if (rule.excludedRequestMethods?.length)
    condition.excludedRequestMethods =
      rule.excludedRequestMethods as chrome.declarativeNetRequest.RequestMethod[];
  if (rule.domainType) condition.domainType = rule.domainType;
  if (rule.initiatorDomains?.length)
    condition.initiatorDomains = rule.initiatorDomains.map(normalizeDomain);
  if (rule.excludedInitiatorDomains?.length)
    condition.excludedInitiatorDomains = rule.excludedInitiatorDomains.map(normalizeDomain);
  if (rule.isUrlFilterCaseSensitive)
    condition.isUrlFilterCaseSensitive = rule.isUrlFilterCaseSensitive;
  return condition;
}

export function ruleToDnr(
  rule: HeaderRule,
  numericId: number,
  tabIds: number[],
  secrets: SessionSecrets = {},
  priority = rule.priority ?? 1,
  variables: Record<string, string> = {},
): chrome.declarativeNetRequest.Rule {
  const validation = validateRule(rule);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const kind = rule.kind ?? 'headers';
  const condition = conditionForRule(rule, tabIds);
  let action: chrome.declarativeNetRequest.RuleAction;

  if (kind === 'headers') {
    const header = rule.header ?? '';
    const operation = rule.operation ?? 'set';
    const resolvedValue =
      rule.sensitive || isSensitiveHeader(header)
        ? (secrets[rule.valueRef ?? rule.id] ?? rule.value)
        : rule.value;
    if (operation !== 'remove' && resolvedValue === undefined)
      throw new Error(`Falta el valor temporal para ${header}.`);
    const modification: chrome.declarativeNetRequest.ModifyHeaderInfo = {
      header: header.trim(),
      operation: operation as chrome.declarativeNetRequest.HeaderOperation,
      ...(operation === 'remove'
        ? {}
        : { value: resolveVariables(resolvedValue ?? '', variables) }),
    };
    action = {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      ...(rule.target === 'response'
        ? { responseHeaders: [modification] }
        : { requestHeaders: [modification] }),
    };
  } else if (kind === 'block') {
    action = { type: 'block' as chrome.declarativeNetRequest.RuleActionType };
  } else if (kind === 'redirect') {
    action = {
      type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
      redirect: { url: resolveHttpUrl(rule.redirectUrl ?? '', variables) },
    };
  } else if (kind === 'replace') {
    action = {
      type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
      redirect: {
        regexSubstitution: resolveHttpUrl(rule.regexSubstitution ?? '', variables),
      },
    };
  } else {
    const addOrReplaceParams = (rule.queryParams ?? [])
      .filter((item) => item.operation === 'set')
      .map((item) => ({
        key: item.key,
        value: resolveVariables(item.value ?? '', variables),
      }));
    const removeParams = (rule.queryParams ?? [])
      .filter((item) => item.operation === 'remove')
      .map((item) => item.key);
    action = {
      type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
      redirect: {
        transform: {
          queryTransform: {
            ...(addOrReplaceParams.length ? { addOrReplaceParams } : {}),
            ...(removeParams.length ? { removeParams } : {}),
          },
        },
      },
    };
  }

  return { id: numericId, priority, action, condition };
}

export function compileSessionRules(
  settings: FakeHeaderSettings,
  activeTabs: ActiveTabStateMap,
  secrets: SessionSecrets = {},
): chrome.declarativeNetRequest.Rule[] {
  return compileSessionRuleRecords(settings, activeTabs, secrets).map((item) => item.rule);
}

export interface CompiledSessionRuleRecord {
  rule: chrome.declarativeNetRequest.Rule;
  sourceRuleId: string;
  profileId: string;
}

export function compileSessionRuleRecords(
  settings: FakeHeaderSettings,
  activeTabs: ActiveTabStateMap,
  secrets: SessionSecrets = {},
): CompiledSessionRuleRecord[] {
  const profileMap = new Map(settings.profiles.map((profile) => [profile.id, profile]));
  const environmentMap = new Map(settings.environments.map((item) => [item.id, item]));
  const tabsByContext = new Map<string, number[]>();
  for (const state of Object.values(activeTabs).sort((a, b) => a.tabId - b.tabId)) {
    const profile = profileMap.get(state.profileId);
    if (!profile?.enabled)
      throw new Error(`La pestaña ${state.tabId} referencia un perfil inexistente o desactivado.`);
    if (state.environmentId && !environmentMap.has(state.environmentId))
      throw new Error(`La pestaña ${state.tabId} referencia un entorno inexistente.`);
    const key = `${state.profileId}\0${state.environmentId ?? ''}`;
    tabsByContext.set(key, [...(tabsByContext.get(key) ?? []), state.tabId]);
  }

  const output: CompiledSessionRuleRecord[] = [];
  for (const [key, tabIds] of tabsByContext) {
    const [profileId, environmentId] = key.split('\0');
    const profile = profileMap.get(profileId)!;
    const variables = environmentValues(environmentMap.get(environmentId), secrets);
    for (const sourceRule of profile.rules.filter((item) => item.enabled))
      output.push({
        rule: ruleToDnr(
          sourceRule,
          output.length + 1,
          tabIds,
          secrets,
          sourceRule.priority,
          variables,
        ),
        sourceRuleId: sourceRule.id,
        profileId,
      });
  }
  return output;
}
