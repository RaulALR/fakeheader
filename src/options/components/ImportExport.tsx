import { useRef } from 'react';
import type { FakeHeaderSettings } from '../../types/profile';
import {
  exportConfiguration,
  exportWorkspaceConfiguration,
  importConfiguration,
  mergeWorkspaceConfiguration,
} from '../../import-export/config-io';

function download(json: string, suffix = '') {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `fakeheader-config${suffix}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ImportExport({
  settings,
  onImport,
  onError,
  selectedProfileId,
  onImportWorkspace,
}: {
  settings: FakeHeaderSettings;
  onImport: (settings: FakeHeaderSettings) => void;
  onError: (message: string) => void;
  selectedProfileId: string;
  onImportWorkspace: (settings: FakeHeaderSettings) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const workspaceInput = useRef<HTMLInputElement>(null);
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      onImport(importConfiguration(await file.text()));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo importar el archivo.');
    }
    if (input.current) input.current.value = '';
  };
  const importWorkspaceFile = async (file?: File) => {
    if (!file) return;
    try {
      const imported = importConfiguration(await file.text());
      onImportWorkspace(mergeWorkspaceConfiguration(settings, imported));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo importar el espacio de trabajo.');
    }
    if (workspaceInput.current) workspaceInput.current.value = '';
  };
  const exportSecrets = () => {
    if (
      window.confirm(
        'Advertencia: el archivo contendrá tokens, cookies y otros valores sensibles en texto claro. Guárdalo en un lugar seguro. ¿Continuar?',
      )
    )
      download(exportConfiguration(settings, true), '-with-secrets');
  };
  const exportWorkspaceSecrets = () => {
    if (
      window.confirm(
        'El espacio de trabajo exportado contendrá sus credenciales sensibles en texto claro. ¿Continuar?',
      )
    )
      download(
        exportWorkspaceConfiguration(settings, selectedProfileId, true),
        '-espacio-con-secretos',
      );
  };
  return (
    <div className="import-export-groups">
      <div>
        <h3>Configuración completa</h3>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => download(exportConfiguration(settings))}
          >
            Exportar (secretos censurados)
          </button>
          <button className="button danger" onClick={exportSecrets}>
            Exportar con valores sensibles
          </button>
          <button className="button secondary" onClick={() => input.current?.click()}>
            Importar JSON
          </button>
          <input
            ref={input}
            className="file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      </div>
      <div>
        <h3>Espacio de trabajo actual</h3>
        <p className="muted">
          Incluye sus reglas, scripts y variables referenciadas. Las automatizaciones no se copian.
        </p>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() =>
              download(exportWorkspaceConfiguration(settings, selectedProfileId), '-espacio')
            }
          >
            Exportar espacio
          </button>
          <button className="button danger" onClick={exportWorkspaceSecrets}>
            Espacio con secretos
          </button>
          <button className="button secondary" onClick={() => workspaceInput.current?.click()}>
            Importar espacio
          </button>
          <input
            ref={workspaceInput}
            className="file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importWorkspaceFile(event.target.files?.[0])}
          />
        </div>
      </div>
    </div>
  );
}
