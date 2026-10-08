# Arquitectura

## Visión general

FakeHeader es una extensión Manifest V3 compuesta por dos interfaces React, un trabajador de servicio y varios módulos de validación, conversión y almacenamiento.

```text
Panel emergente y configuración
              |
              v
       Mensajes internos
              |
              v
     Trabajador de servicio
       |       |       |
       v       v       v
 almacenamiento  motor DNR  scripts y grabador
       |               |
       v               v
 configuración      pestaña activa
```

## Interfaces

`src/popup` contiene la operación rápida sobre la pestaña actual: activación, selección de entorno, caducidad, grabación y ejecución de scripts.

`src/options` contiene la administración completa: reglas, entornos, plantillas, importadores, permisos, historial, scripts y herramientas de diagnóstico. Los componentes especializados están en `src/options/components`.

Ambas interfaces leen una copia hidratada de la configuración y solicitan cambios mediante mensajes internos. No modifican directamente las reglas DNR.

## Trabajador de servicio

`src/background/service-worker.ts` recibe mensajes, reacciona a navegación, cierre de pestañas, alarmas y cambios de permisos, y delega las operaciones.

`src/background/rule-engine.ts` coordina las transacciones de configuración. Valida el estado, prepara reglas, actualiza Chrome y persiste únicamente cuando la transición es válida. Ante un error restaura el estado anterior o aplica el apagado global.

`src/background/script-engine.ts` ejecuta JavaScript y CSS mediante las APIs opcionales de Chrome. `src/background/traffic-recorder.ts` gestiona capturas por pestaña. `src/background/dnr-activity.ts` conserva contadores de coincidencia sin almacenar URL ni contenido.

## Reglas

`src/rules` contiene validadores, conversores DNR, detección de conflictos, alcance por dominio, sustitución de variables y plantillas. Las funciones de esta capa no dependen de React.

Las reglas activas se agrupan por combinación de espacio de trabajo y entorno. El conversor produce reglas de sesión con `condition.tabIds`, por lo que una misma definición lógica puede materializarse para varias pestañas sin convertirse en una regla global.

## Persistencia

La configuración normal vive en `chrome.storage.local`. Activaciones, secretos, capturas y actividad viven en `chrome.storage.session`. Las reglas instaladas usan `declarativeNetRequest.updateSessionRules` y desaparecen con la sesión del navegador.

Todos los datos leídos pasan por `src/storage/parsers.ts`. El análisis reconstruye objetos permitidos y rechaza esquemas, tipos o límites no válidos. Los valores desconocidos no se propagan al motor.

## Importación y exportación

`src/import-export` convierte formatos externos a estructuras internas desactivadas. `src/recorder` contiene la conversión HAR y la creación de reglas desde capturas. Ningún importador ejecuta el archivo recibido ni realiza solicitudes de red.

## Compilación

Vite genera el manifiesto y los dos puntos de entrada HTML. TypeScript comprueba el proyecto antes de crear `dist`. El resultado no incluye mapas de fuentes ni recursos remotos.
