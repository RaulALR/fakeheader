import type { FakeHeaderSettings } from './profile';

export interface SettingsSnapshot {
  id: string;
  createdAt: number;
  label: string;
  settings: FakeHeaderSettings;
}

export type SettingsHistory = SettingsSnapshot[];

export interface SettingsHistoryResult {
  ok: boolean;
  error?: string;
  history?: SettingsHistory;
}
