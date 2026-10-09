import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE_KEY } from '../config';
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
  const reloadVersion = useRef(0);

  const reload = useCallback(async () => {
    const version = ++reloadVersion.current;
    try {
      const next = await getSettings();
      if (version !== reloadVersion.current) return;
      setSettings(next);
      setError('');
    } catch {
      if (version !== reloadVersion.current) return;
      setError('No se pudo leer la configuración. FakeHeader permanece cerrado.');
    }
  }, []);
  useEffect(() => {
    void reload();
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes[STORAGE_KEY]) void reload();
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
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
