import type { HeaderRule } from '../types/rule';

export interface RuleConflict {
  ruleIds: string[];
  message: string;
}

function scopeKey(rule: HeaderRule): string {
  return JSON.stringify({
    domains: [...(rule.domains ?? [])].sort(),
    allWebsites: Boolean(rule.allWebsites),
    urlFilter: rule.urlFilter ?? '',
    regexFilter: rule.regexFilter ?? '',
    resources: [...(rule.resourceTypes ?? [])].sort(),
    excludedResources: [...(rule.excludedResourceTypes ?? [])].sort(),
    methods: [...(rule.requestMethods ?? [])].sort(),
    excludedMethods: [...(rule.excludedRequestMethods ?? [])].sort(),
    domainType: rule.domainType ?? '',
    initiators: [...(rule.initiatorDomains ?? [])].sort(),
    excludedInitiators: [...(rule.excludedInitiatorDomains ?? [])].sort(),
    caseSensitive: Boolean(rule.isUrlFilterCaseSensitive),
  });
}

export function findRuleConflicts(rules: HeaderRule[]): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const active = rules.filter((rule) => rule.enabled);
  for (let index = 0; index < active.length; index += 1) {
    const first = active[index];
    for (const second of active.slice(index + 1)) {
      if (scopeKey(first) !== scopeKey(second)) continue;
      const firstKind = first.kind ?? 'headers';
      const secondKind = second.kind ?? 'headers';
      if (
        firstKind === 'headers' &&
        secondKind === 'headers' &&
        (first.target ?? 'request') === (second.target ?? 'request') &&
        first.header?.toLowerCase() === second.header?.toLowerCase()
      )
        conflicts.push({
          ruleIds: [first.id, second.id],
          message: `${first.name || first.header} y ${second.name || second.header} modifican la misma cabecera con el mismo alcance.`,
        });
      if (
        ['redirect', 'replace', 'query'].includes(firstKind) &&
        ['redirect', 'replace', 'query'].includes(secondKind)
      )
        conflicts.push({
          ruleIds: [first.id, second.id],
          message: `${first.name || firstKind} y ${second.name || secondKind} pueden competir por la misma redirección.`,
        });
    }
  }
  return conflicts;
}
