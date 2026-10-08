import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeHeaderSettings } from '../types/profile';
import type { ActiveTabStateMap } from '../types/session';
import {
  applySettingsTransaction,
  commitTabTransition,
  getExecutionInspector,
  handleCommittedNavigation,
  withoutTab,
  type TabTransitionDependencies,
} from './rule-engine';
import { compileSessionRules } from '../rules/converters';
import { parseSettings } from '../storage/parsers';

const settings: FakeHeaderSettings = {
  schemaVersion: 6,
  templates: [],
  autoActivations: [],
  scripts: [],
  environments: [],
  safety: { autoDisableOnNavigation: false },
  profiles: [
    {
      id: 'dev',
      name: 'Dev',
      enabled: true,
      rules: [
        {
          id: 'rule',
          enabled: true,
          target: 'request',
          operation: 'set',
          header: 'X-Test',
          value: 'hello',
          domains: ['localhost'],
        },
      ],
    },
  ],
};

describe('tab lifecycle and fail-closed transitions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('closing an active tab removes its compiled rules', () => {
    const active: ActiveTabStateMap = {
      '1': { tabId: 1, profileId: 'dev' },
      '2': { tabId: 2, profileId: 'dev' },
    };
    const remaining = withoutTab(active, 1);
    expect(compileSessionRules(settings, remaining)[0].condition.tabIds).toEqual([2]);
  });

  it('leaves a newly created tab OFF by default', () => {
    expect(compileSessionRules(settings, {})).toEqual([]);
  });

  it('auto-activates only on the configured exact origin and turns off when leaving', async () => {
    const automatic: FakeHeaderSettings = {
      ...settings,
      autoActivations: [
        {
          id: 'auto-local',
          enabled: true,
          origin: 'http://localhost:3000',
          profileId: 'dev',
        },
      ],
    };
    let tabs: ActiveTabStateMap = {};
    let rules: chrome.declarativeNetRequest.Rule[] = [];
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn(async () => ({ fakeHeaderSettings: automatic })) },
        session: {
          get: vi.fn(async (key: string) =>
            key === 'fakeHeaderActiveTabs'
              ? { fakeHeaderActiveTabs: tabs }
              : { fakeHeaderSecrets: {} },
          ),
          set: vi.fn(async (value: Record<string, unknown>) => {
            if ('fakeHeaderActiveTabs' in value)
              tabs = value.fakeHeaderActiveTabs as ActiveTabStateMap;
          }),
        },
      },
      permissions: {
        contains: vi.fn(async (value: { permissions?: string[] }) =>
          value.permissions?.includes('alarms') ? false : true,
        ),
      },
      declarativeNetRequest: {
        getSessionRules: vi.fn(async () => rules),
        updateSessionRules: vi.fn(
          async (value: { addRules: chrome.declarativeNetRequest.Rule[] }) => {
            rules = value.addRules;
          },
        ),
      },
      action: {
        setBadgeBackgroundColor: vi.fn(async () => undefined),
        setBadgeText: vi.fn(async () => undefined),
      },
    });

    expect((await handleCommittedNavigation(4, 'http://localhost:3000/app')).ok).toBe(true);
    expect(tabs['4']).toMatchObject({
      profileId: 'dev',
      boundOrigin: 'http://localhost:3000',
      autoActivationId: 'auto-local',
    });
    expect(rules[0].condition.tabIds).toEqual([4]);

    expect((await handleCommittedNavigation(4, 'http://localhost:4000/')).ok).toBe(true);
    expect(tabs).toEqual({});
    expect(rules).toEqual([]);
  });

  it('turns the target tab OFF and clears its badge when DNR rejects activation', async () => {
    let updateAttempt = 0;
    let storedTabs: ActiveTabStateMap = { '1': { tabId: 1, profileId: 'dev' } };
    let badge = true;
    const dependencies: TabTransitionDependencies = {
      getRules: vi.fn().mockResolvedValue([]),
      updateRules: vi.fn(async () => {
        updateAttempt += 1;
        if (updateAttempt === 1) throw new Error('DNR failure');
      }),
      writeTabs: vi.fn(async (tabs) => {
        storedTabs = tabs;
      }),
      setBadge: vi.fn(async (_tabId, enabled) => {
        badge = enabled;
      }),
      emergencyDisable: vi.fn(async () => undefined),
    };
    const result = await commitTabTransition(1, storedTabs, settings, {}, dependencies);
    expect(result.ok).toBe(false);
    expect(storedTabs).toEqual({});
    expect(badge).toBe(false);
    expect(dependencies.emergencyDisable).not.toHaveBeenCalled();
  });

  it('rolls session data and persistent settings back when a configuration DNR update fails', async () => {
    const oldSettings = settings;
    const nextSettings: FakeHeaderSettings = {
      ...settings,
      profiles: settings.profiles.map((profile) => ({
        ...profile,
        rules: profile.rules.map((rule) => ({ ...rule, value: 'new-value' })),
      })),
    };
    const activeTabs: ActiveTabStateMap = { '7': { tabId: 7, profileId: 'dev' } };
    const oldRules = compileSessionRules(oldSettings, activeTabs);
    const localSet = vi.fn(async () => undefined);
    const sessionSet = vi.fn(async () => undefined);
    const updateSessionRules = vi
      .fn()
      .mockRejectedValueOnce(new Error('DNR failure'))
      .mockResolvedValueOnce(undefined);

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ fakeHeaderSettings: oldSettings })),
          set: localSet,
        },
        session: {
          get: vi.fn(async (key: string) =>
            key === 'fakeHeaderActiveTabs'
              ? { fakeHeaderActiveTabs: activeTabs }
              : { fakeHeaderSecrets: {} },
          ),
          set: sessionSet,
        },
      },
      declarativeNetRequest: {
        getSessionRules: vi.fn(async () => oldRules),
        updateSessionRules,
      },
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query: vi.fn(async () => []) },
      action: {
        setBadgeBackgroundColor: vi.fn(async () => undefined),
        setBadgeText: vi.fn(async () => undefined),
      },
    });

    const result = await applySettingsTransaction(nextSettings);

    expect(result.ok).toBe(false);
    expect(updateSessionRules).toHaveBeenCalledTimes(2);
    expect(updateSessionRules.mock.calls[1]?.[0].addRules).toEqual(oldRules);
    expect(localSet).toHaveBeenCalledWith({ fakeHeaderSettings: parseSettings(oldSettings) });
    expect(JSON.stringify(localSet.mock.calls)).not.toContain('new-value');
    expect(sessionSet).toHaveBeenCalledWith({ fakeHeaderActiveTabs: activeTabs });
  });

  it('redacts sensitive values from the real execution inspector', async () => {
    const authSettings: FakeHeaderSettings = {
      ...settings,
      profiles: [
        {
          ...settings.profiles[0],
          rules: [
            {
              id: 'auth',
              enabled: true,
              target: 'request',
              operation: 'set',
              header: 'Authorization',
              sensitive: true,
              valueRef: 'auth',
              domains: ['localhost'],
            },
          ],
        },
      ],
    };
    const activeTabs = { '3': { tabId: 3, profileId: 'dev' } };
    const rules = compileSessionRules(authSettings, activeTabs, {
      auth: 'Bearer inspector-secret',
    });
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn(async () => ({ fakeHeaderSettings: authSettings })) },
        session: {
          get: vi.fn(async (key: string) =>
            key === 'fakeHeaderActiveTabs'
              ? { fakeHeaderActiveTabs: activeTabs }
              : { fakeHeaderSecrets: { auth: 'Bearer inspector-secret' } },
          ),
        },
      },
      declarativeNetRequest: { getSessionRules: vi.fn(async () => rules) },
      permissions: { getAll: vi.fn(async () => ({ origins: ['http://localhost/*'] })) },
    });
    const result = await getExecutionInspector();
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain('inspector-secret');
    expect(result.snapshot?.tabs[0]).toMatchObject({ tabId: 3, healthy: true });
  });
});
