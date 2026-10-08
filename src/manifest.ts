import { APP_NAME } from './config';

export const extensionManifest = {
  manifest_version: 3,
  name: APP_NAME,
  short_name: APP_NAME,
  description: 'Herramientas HTTP locales con activación segura por pestaña.',
  version: '1.0.0',
  minimum_chrome_version: '135',
  permissions: ['storage', 'declarativeNetRequestWithHostAccess', 'activeTab'],
  optional_permissions: [
    'webNavigation',
    'alarms',
    'webRequest',
    'userScripts',
    'scripting',
    'declarativeNetRequestFeedback',
  ],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  background: {
    service_worker: 'service-worker.js',
    type: 'module',
  },
  action: {
    default_title: APP_NAME,
    default_popup: 'popup.html',
  },
  commands: {
    _execute_action: {
      suggested_key: {
        default: 'Alt+Shift+F',
        mac: 'Command+Shift+F',
      },
      description: 'Abrir el panel emergente de FakeHeader.',
    },
    'disable-current-tab': {
      suggested_key: {
        default: 'Alt+Shift+D',
        mac: 'Command+Shift+D',
      },
      description: 'Desactivar FakeHeader en la pestaña actual.',
    },
    'disable-everywhere': {
      description: 'Desactivar FakeHeader en todas las pestañas.',
    },
    'open-options': {
      description: 'Abrir la configuración de FakeHeader.',
    },
  },
  options_page: 'options.html',
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  },
} as const;
