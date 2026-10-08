export type ScriptActivityTrigger = 'manual' | 'navigation' | 'remove-css';

export interface ScriptActivityEntry {
  id: string;
  createdAt: number;
  tabId: number;
  profileId: string;
  scriptIds: string[];
  trigger: ScriptActivityTrigger;
  ok: boolean;
  executed: number;
  removed: number;
  error?: string;
}

export interface ScriptActivityResult {
  ok: boolean;
  error?: string;
  activity?: ScriptActivityEntry[];
}
