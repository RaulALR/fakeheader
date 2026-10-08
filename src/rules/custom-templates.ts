import type { SavedRuleTemplate } from '../types/profile';
import type { HeaderRule } from '../types/rule';
import { newId } from '../utils/ids';
import { isSensitiveHeader } from '../utils/sensitive';
import { ruleTitle } from './rule-display';

function safeTemplateRule(rule: HeaderRule): HeaderRule {
  const id = newId();
  const sensitive = Boolean(rule.sensitive || isSensitiveHeader(rule.header ?? ''));
  const { value: _value, valueRef: _valueRef, ...withoutSecret } = rule;
  return {
    ...withoutSecret,
    id,
    enabled: false,
    pinned: false,
    ...(sensitive && rule.operation !== 'remove'
      ? { sensitive: true, valueRef: id }
      : rule.operation !== 'remove' && rule.value !== undefined
        ? { value: rule.value }
        : {}),
    queryParams: rule.queryParams?.map((item) => ({ ...item, id: newId() })),
  };
}

export function createSavedRuleTemplate(rule: HeaderRule, name: string): SavedRuleTemplate {
  return {
    id: newId(),
    name: name.trim(),
    description: `Creada desde ${ruleTitle(rule)}.`,
    rule: safeTemplateRule(rule),
  };
}

export function instantiateSavedRuleTemplate(template: SavedRuleTemplate): HeaderRule {
  return safeTemplateRule(template.rule);
}
