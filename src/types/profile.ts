import type { HeaderRule } from './rule';

export interface EnvironmentVariable {
  id: string;
  key: string;
  value?: string;
  sensitive?: boolean;
  valueRef?: string;
}

export interface RuleEnvironment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
}

export interface HeaderProfile {
  id: string;
  name: string;
  enabled: boolean;
  rules: HeaderRule[];
}

export interface SavedRuleTemplate {
  id: string;
  name: string;
  description?: string;
  rule: HeaderRule;
}

export interface AutoActivation {
  id: string;
  enabled: boolean;
  origin: string;
  profileId: string;
  environmentId?: string;
  durationMinutes?: number;
}

export interface UserScriptRule {
  id: string;
  profileId: string;
  name: string;
  enabled: boolean;
  kind: 'javascript' | 'css';
  code: string;
  world: 'USER_SCRIPT' | 'MAIN';
  injectImmediately: boolean;
  execution: 'manual' | 'navigation';
  matches: string[];
  excludeMatches: string[];
}

export interface FakeHeaderSettings {
  schemaVersion: number;
  profiles: HeaderProfile[];
  environments: RuleEnvironment[];
  templates: SavedRuleTemplate[];
  autoActivations: AutoActivation[];
  scripts: UserScriptRule[];
  safety: {
    autoDisableOnNavigation: boolean;
  };
}
