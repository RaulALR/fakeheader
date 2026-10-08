import { DNR_ACTIVITY_KEY, MAX_DNR_ACTIVITY_ENTRIES } from '../config';
import type { DnrRuleActivityEntry } from '../types/dnr-activity';

function parseEntry(value: unknown): DnrRuleActivityEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  if (
    !Number.isInteger(entry.ruleId) ||
    (entry.ruleId as number) <= 0 ||
    !Number.isInteger(entry.tabId) ||
    (entry.tabId as number) < 0 ||
    !Number.isInteger(entry.count) ||
    (entry.count as number) <= 0 ||
    typeof entry.lastMatchedAt !== 'number' ||
    !Number.isFinite(entry.lastMatchedAt) ||
    entry.lastMatchedAt <= 0
  )
    return null;
  return {
    ruleId: entry.ruleId as number,
    tabId: entry.tabId as number,
    count: entry.count as number,
    lastMatchedAt: entry.lastMatchedAt,
  };
}

async function readActivity(): Promise<DnrRuleActivityEntry[]> {
  const stored = await chrome.storage.session.get(DNR_ACTIVITY_KEY);
  const raw = stored[DNR_ACTIVITY_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_DNR_ACTIVITY_ENTRIES)
    .map(parseEntry)
    .filter((entry): entry is DnrRuleActivityEntry => entry !== null);
}

let activityQueue: Promise<void> = Promise.resolve();

function enqueueActivity(operation: () => Promise<void>): Promise<void> {
  const result = activityQueue.then(operation, operation);
  activityQueue = result.catch(() => undefined);
  return result;
}

export async function getDnrActivity(): Promise<DnrRuleActivityEntry[]> {
  await flushPendingMatches();
  await activityQueue;
  return readActivity();
}

export function clearDnrActivity(): Promise<void> {
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
  pendingMatches.clear();
  return enqueueActivity(() => chrome.storage.session.remove(DNR_ACTIVITY_KEY));
}

async function recordMatches(batch: DnrRuleActivityEntry[]): Promise<void> {
  const entries = await readActivity();
  for (const match of batch) {
    const existing = entries.find(
      (entry) => entry.ruleId === match.ruleId && entry.tabId === match.tabId,
    );
    if (existing) {
      existing.count += match.count;
      existing.lastMatchedAt = Math.max(existing.lastMatchedAt, match.lastMatchedAt);
    } else {
      entries.unshift(match);
    }
  }
  entries.sort((first, second) => second.lastMatchedAt - first.lastMatchedAt);
  await chrome.storage.session.set({
    [DNR_ACTIVITY_KEY]: entries.slice(0, MAX_DNR_ACTIVITY_ENTRIES),
  });
}

const pendingMatches = new Map<string, DnrRuleActivityEntry>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function flushPendingMatches(): Promise<void> {
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!pendingMatches.size) return activityQueue;
  const batch = [...pendingMatches.values()];
  pendingMatches.clear();
  return enqueueActivity(() => recordMatches(batch));
}

function queueMatch(info: chrome.declarativeNetRequest.MatchedRuleInfoDebug): void {
  if (info.rule.rulesetId !== chrome.declarativeNetRequest.SESSION_RULESET_ID) return;
  const tabId = info.request.tabId;
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const key = `${tabId}:${info.rule.ruleId}`;
  const existing = pendingMatches.get(key);
  pendingMatches.set(key, {
    ruleId: info.rule.ruleId,
    tabId,
    count: (existing?.count ?? 0) + 1,
    lastMatchedAt: Date.now(),
  });
  if (flushTimer === undefined)
    flushTimer = setTimeout(() => void flushPendingMatches().catch(() => undefined), 250);
}

export function registerDnrActivityListener(): void {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(queueMatch);
}
