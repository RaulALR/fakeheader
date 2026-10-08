import type { HeaderRule } from '../types/rule';
import { newId } from '../utils/ids';

export interface RuleTemplate {
  id: string;
  title: string;
  description: string;
  create(): HeaderRule;
}

const base = (name: string): HeaderRule => ({
  id: newId(),
  name,
  enabled: false,
  priority: 1,
  domains: ['localhost'],
});

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'iv-user',
    title: 'iv-user local',
    description: 'Simula el usuario autenticado de una aplicación.',
    create: () => ({
      ...base('iv-user local'),
      kind: 'headers',
      target: 'request',
      operation: 'set',
      header: 'iv-user',
      value: '{{USER}}',
    }),
  },
  {
    id: 'bearer',
    title: 'Token Bearer',
    description: 'Cabecera Authorization efímera para una API de desarrollo.',
    create: () => {
      const id = newId();
      return {
        ...base('Token Bearer de desarrollo'),
        id,
        kind: 'headers',
        target: 'request',
        operation: 'set',
        header: 'Authorization',
        value: '',
        sensitive: true,
        valueRef: id,
      };
    },
  },
  {
    id: 'api-key',
    title: 'Clave de API',
    description: 'Añade X-API-Key sin persistir su valor.',
    create: () => {
      const id = newId();
      return {
        ...base('Clave de API de desarrollo'),
        id,
        kind: 'headers',
        target: 'request',
        operation: 'set',
        header: 'X-API-Key',
        value: '',
        sensitive: true,
        valueRef: id,
      };
    },
  },
  {
    id: 'local-api',
    title: 'API remota -> localhost',
    description: 'Redirige una API remota a un servidor local.',
    create: () => ({
      ...base('Usar API local'),
      kind: 'replace',
      domains: ['api.example.com'],
      regexFilter: '^https://api\\.example\\.com/(.*)$',
      regexSubstitution: 'http://localhost:8080/\\1',
    }),
  },
  {
    id: 'block-analytics',
    title: 'Bloquear analítica',
    description: 'Bloquea servicios de analítica en la pestaña de desarrollo.',
    create: () => ({
      ...base('Bloquear analítica'),
      kind: 'block',
      domains: ['*.google-analytics.com'],
    }),
  },
  {
    id: 'debug-query',
    title: 'Depuración activada',
    description: 'Añade un parámetro de consulta de depuración.',
    create: () => ({
      ...base('Activar parámetro de depuración'),
      kind: 'query',
      queryParams: [{ id: newId(), operation: 'set', key: 'debug', value: 'true' }],
    }),
  },
];
