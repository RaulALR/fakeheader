import type { UserScriptRule } from '../types/profile';
import { DELAY_HTTP_REQUESTS_CODE } from './bundled-code';

export interface UserScriptTemplate {
  id: string;
  title: string;
  description: string;
  script: Omit<UserScriptRule, 'id' | 'profileId'>;
}

export const USER_SCRIPT_TEMPLATES: UserScriptTemplate[] = [
  {
    id: 'development-banner',
    title: 'Aviso de desarrollo',
    description: 'Añade una marca visual fija para evitar confundir un entorno de desarrollo.',
    script: {
      name: 'Aviso de desarrollo',
      enabled: false,
      kind: 'javascript',
      world: 'USER_SCRIPT',
      injectImmediately: true,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `(() => {
  const id = 'fakeheader-development-banner';
  if (document.getElementById(id)) return;
  const banner = document.createElement('div');
  banner.id = id;
  banner.textContent = 'FakeHeader - DESARROLLO';
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '50%', transform: 'translateX(-50%)',
    zIndex: '2147483647', padding: '5px 12px', color: '#fff',
    background: '#b42318', font: '700 12px system-ui', borderRadius: '0 0 8px 8px'
  });
  document.documentElement.appendChild(banner);
})();`,
    },
  },
  {
    id: 'environment-dataset',
    title: 'Exponer nombre del entorno',
    description: 'Publica una variable ENVIRONMENT_NAME como atributo de datos del documento.',
    script: {
      name: 'Exponer nombre del entorno',
      enabled: false,
      kind: 'javascript',
      world: 'USER_SCRIPT',
      injectImmediately: true,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `document.documentElement.dataset.fakeheaderEnvironment = {{JSON:ENVIRONMENT_NAME}};`,
    },
  },
  {
    id: 'layout-outlines',
    title: 'Contornos de maquetación',
    description: 'Dibuja los límites de todos los elementos para depurar maquetaciones.',
    script: {
      name: 'Contornos de maquetación',
      enabled: false,
      kind: 'css',
      world: 'USER_SCRIPT',
      injectImmediately: false,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `* { outline: 1px solid rgb(255 0 120 / 28%) !important; }
html { outline: 3px solid #ff0078 !important; }`,
    },
  },
  {
    id: 'disable-motion',
    title: 'Desactivar animaciones',
    description: 'Desactiva temporalmente transiciones, animaciones y desplazamiento suave.',
    script: {
      name: 'Desactivar animaciones',
      enabled: false,
      kind: 'css',
      world: 'USER_SCRIPT',
      injectImmediately: false,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `*, *::before, *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
  transition-duration: 0.001ms !important;
}`,
    },
  },
  {
    id: 'accent-variable',
    title: 'Variable de color CSS',
    description: 'Expone ACCENT_COLOR como --fakeheader-accent en la página.',
    script: {
      name: 'Variable de color CSS',
      enabled: false,
      kind: 'css',
      world: 'USER_SCRIPT',
      injectImmediately: false,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `:root { --fakeheader-accent: {{ACCENT_COLOR}}; }`,
    },
  },
  {
    id: 'mock-fetch-json',
    title: 'Simular JSON con fetch',
    description: 'Devuelve JSON local para una ruta fetch concreta. Requiere revisar el código MAIN.',
    script: {
      name: 'Simular JSON con fetch',
      enabled: false,
      kind: 'javascript',
      world: 'MAIN',
      injectImmediately: true,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `(() => {
  const installationKey = Symbol.for('fakeheader.mockFetchJson');
  if (window[installationKey]) return;

  const originalFetch = window.fetch.bind(window);
  const endpoint = '/api/example';

  window.fetch = async (input, init) => {
    const requestUrl = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      location.href
    );
    if (requestUrl.origin === location.origin && requestUrl.pathname === endpoint) {
      return new Response(JSON.stringify({ ok: true, source: 'FakeHeader mock' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
    return originalFetch(input, init);
  };

  window[installationKey] = {
    restore() {
      window.fetch = originalFetch;
      delete window[installationKey];
    }
  };
})();`,
    },
  },
  {
    id: 'transform-fetch-json',
    title: 'Transformar JSON de fetch',
    description: 'Modifica una respuesta JSON de fetch sin tocar el resto del tráfico de la página.',
    script: {
      name: 'Transformar JSON de fetch',
      enabled: false,
      kind: 'javascript',
      world: 'MAIN',
      injectImmediately: true,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `(() => {
  const installationKey = Symbol.for('fakeheader.transformFetchJson');
  if (window[installationKey]) return;

  const originalFetch = window.fetch.bind(window);
  const endpoint = '/api/example';

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const requestUrl = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      location.href
    );
    if (requestUrl.origin !== location.origin || requestUrl.pathname !== endpoint) return response;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) return response;
    const body = await response.clone().json();
    const transformed = { ...body, fakeHeaderOverride: true };
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(transformed), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  };

  window[installationKey] = {
    restore() {
      window.fetch = originalFetch;
      delete window[installationKey];
    }
  };
})();`,
    },
  },
  {
    id: 'delay-fetch',
    title: 'Retrasar solicitudes fetch/XHR',
    description: 'Añade latencia artificial a fetch y XHR para probar estados de carga.',
    script: {
      name: 'Retrasar solicitudes fetch/XHR',
      enabled: false,
      kind: 'javascript',
      world: 'MAIN',
      injectImmediately: true,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: DELAY_HTTP_REQUESTS_CODE,
    },
  },
  {
    id: 'transform-fetch-request-json',
    title: 'Transformar JSON de solicitud fetch',
    description: 'Edita el cuerpo JSON de una llamada fetch concreta antes de enviarla.',
    script: {
      name: 'Transformar JSON de solicitud fetch',
      enabled: false,
      kind: 'javascript',
      world: 'MAIN',
      injectImmediately: true,
      execution: 'manual',
      matches: [],
      excludeMatches: [],
      code: `(() => {
  const installationKey = Symbol.for('fakeheader.transformFetchRequestJson');
  if (window[installationKey]) return;

  const originalFetch = window.fetch.bind(window);
  const endpoint = '/api/example';

  window.fetch = async (input, init) => {
    const requestUrl = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      location.href
    );
    if (
      requestUrl.origin !== location.origin ||
      requestUrl.pathname !== endpoint ||
      typeof init?.body !== 'string'
    ) return originalFetch(input, init);

    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      return originalFetch(input, init);
    }
    const transformed = { ...body, fakeHeaderOverride: true };
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return originalFetch(input, { ...init, headers, body: JSON.stringify(transformed) });
  };

  window[installationKey] = {
    restore() {
      window.fetch = originalFetch;
      delete window[installationKey];
    }
  };
})();`,
    },
  },
];
