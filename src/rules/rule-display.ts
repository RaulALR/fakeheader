import type { HeaderRule, RuleKind } from '../types/rule';

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  headers: 'Modificar cabeceras',
  redirect: 'Redirigir solicitud',
  block: 'Bloquear solicitud',
  replace: 'Reemplazar URL',
  query: 'Parámetros de consulta',
};

export function ruleTitle(rule: HeaderRule): string {
  return rule.name || rule.header || RULE_KIND_LABELS[rule.kind ?? 'headers'];
}
