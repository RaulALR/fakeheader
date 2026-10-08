import { useCallback, useEffect, useState } from 'react';
import type { FakeHeaderSettings } from '../types/profile';
import { getActiveTabs, getSettings } from '../storage/storage';
import { requestHostAccess } from '../utils/permissions';
import { validateEnvironment, validateProfile } from '../rules/validators';

interface RuntimeResult {
  ok?: boolean;
  error?: string;
}

export function useSettings() {
  const [settings, setSettings] = useState<FakeHeaderSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    try {
      setSettings(await getSettings());
      setError('');
    } catch {
      setError('No se pudo leer la configuración. FakeHeader permanece cerrado.');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const commit = useCallback(
    async (next: FakeHeaderSettings, requestPermissions = true) => {
      const errors = [
        ...next.profiles.flatMap((profile) => validateProfile(profile).errors),
        ...next.environments.flatMap((environment) => validateEnvironment(environment).errors),
      ];
      if (errors.length) {
        setError(errors[0]);
        return false;
      }
      try {
        if (requestPermissions) {
          const activeTabs = await getActiveTabs();
          const activeProfileIds = new Set(Object.values(activeTabs).map((tab) => tab.profileId));
          for (const activation of next.autoActivations)
            if (activation.enabled) activeProfileIds.add(activation.profileId);
          const activeProfiles = next.profiles.filter((profile) =>
            activeProfileIds.has(profile.id),
          );
          if (!(await requestHostAccess(activeProfiles))) {
            setError('No se concedieron los permisos. No se guardó ningún cambio.');
            return false;
          }
        }
        const response = (await chrome.runtime.sendMessage({
          type: 'apply-settings',
          settings: next,
        })) as RuntimeResult | undefined;
        if (!response?.ok) {
          setError(response?.error ?? 'Chrome rechazó la configuración.');
          return false;
        }
        await reload();
        setNotice('Cambios aplicados.');
        window.setTimeout(() => setNotice(''), 1800);
        return true;
      } catch {
        setError('No se pudo completar la transacción. El estado anterior permanece activo.');
        return false;
      }
    },
    [reload],
  );
  return { settings, error, notice, setError, commit, reload };
}
