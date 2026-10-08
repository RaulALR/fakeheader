import type { DnrRuleActivityEntry } from './dnr-activity';
import type { RuleKind } from './rule';

export interface ActiveTabState {
  tabId: number;
  profileId: string;
  environmentId?: string;
  expiresAt?: number;
  boundOrigin?: string;
  autoActivationId?: string;
}

export type ActiveTabStateMap = Record<string, ActiveTabState>;
export type SessionSecrets = Record<string, string>;

export interface ExecutionInspectorTab extends ActiveTabState {
  profileName: string;
  environmentName?: string;
  healthy: boolean;
  rules: chrome.declarativeNetRequest.Rule[];
}

export interface ExecutionInspectorSnapshot {
  generatedAt: number;
  totalSessionRules: number;
  tabs: ExecutionInspectorTab[];
  orphanRules: chrome.declarativeNetRequest.Rule[];
  grantedOrigins: string[];
  grantedPermissions: string[];
  ruleActivity: DnrRuleActivityEntry[];
  ruleLabels: Array<{
    dnrRuleId: number;
    sourceRuleId: string;
    profileId: string;
    name: string;
    kind: RuleKind;
  }>;
}

export interface ExecutionInspectorResult {
  ok: boolean;
  error?: string;
  snapshot?: ExecutionInspectorSnapshot;
}
