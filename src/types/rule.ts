export const RULE_TARGETS = ['request', 'response'] as const;
export const RULE_OPERATIONS = ['set', 'append', 'remove'] as const;
export const RULE_KINDS = ['headers', 'redirect', 'block', 'replace', 'query'] as const;
export const QUERY_OPERATIONS = ['set', 'remove'] as const;
export const REQUEST_METHODS = [
  'connect',
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'other',
] as const;
export const DOMAIN_TYPES = ['firstParty', 'thirdParty'] as const;
export const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as const;

export type RuleTarget = (typeof RULE_TARGETS)[number];
export type RuleOperation = (typeof RULE_OPERATIONS)[number];
export type RuleKind = (typeof RULE_KINDS)[number];
export type QueryOperation = (typeof QUERY_OPERATIONS)[number];
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type RequestMethod = (typeof REQUEST_METHODS)[number];
export type DomainType = (typeof DOMAIN_TYPES)[number];

export interface QueryParameterChange {
  id: string;
  operation: QueryOperation;
  key: string;
  value?: string;
}

export interface HeaderRule {
  id: string;
  enabled: boolean;
  name?: string;
  group?: string;
  tags?: string[];
  pinned?: boolean;
  kind?: RuleKind;
  priority?: number;
  target?: RuleTarget;
  operation?: RuleOperation;
  header?: string;
  value?: string;
  sensitive?: boolean;
  valueRef?: string;
  urlFilter?: string;
  domains?: string[];
  excludedDomains?: string[];
  resourceTypes?: ResourceType[];
  excludedResourceTypes?: ResourceType[];
  requestMethods?: RequestMethod[];
  excludedRequestMethods?: RequestMethod[];
  domainType?: DomainType;
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  isUrlFilterCaseSensitive?: boolean;
  allWebsites?: boolean;
  redirectUrl?: string;
  regexFilter?: string;
  regexSubstitution?: string;
  queryParams?: QueryParameterChange[];
}
