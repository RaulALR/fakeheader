# Desarrollo y entrega

## Requisitos

- Node.js compatible con las dependencias declaradas.
- npm.
- Chrome 135 o posterior.

## Comandos

```text
npm install
npm run dev
npm run lint
npm run build
```

`npm run dev` inicia Vite. `npm run lint` comprueba el código estáticamente. `npm run build` ejecuta TypeScript y genera la extensión en `dist`.

El proyecto conserva comandos de pruebas automatizadas, pero su ejecución debe decidirse según el flujo de trabajo de la entrega.

## Estructura

```text
src/background       trabajador de servicio y motores
src/import-export    conversores de formatos externos
src/options          configuración completa
src/popup            panel de la pestaña actual
src/recorder         HAR y conversión de capturas
src/rules            validación y compilación DNR
src/scripts          plantillas de scripts
src/storage          persistencia, análisis e hidratación
src/types            contratos de datos
src/ui               elementos compartidos
src/utils            utilidades generales
docs                 documentación del proyecto
```

## Carga local

Después de compilar, carga `dist` como extensión descomprimida desde `chrome://extensions`. Cuando cambie el trabajador de servicio o el manifiesto, recarga la extensión. Cuando sólo cambie una interfaz, vuelve a abrirla después de compilar.

## Criterios para cambios

- Mantener los permisos obligatorios al mínimo.
- Declarar como opcional cualquier capacidad que no sea imprescindible.
- Validar todo dato importado o leído de almacenamiento.
- Crear desactivados los elementos procedentes de archivos o plantillas.
- No persistir valores sensibles.
- No introducir recursos, scripts ni comunicaciones remotas.
- Conservar el aislamiento por `tabIds`.
- Mantener la interfaz y los mensajes visibles en castellano.

## Preparación de una versión

1. Actualizar la versión en `package.json`, `package-lock.json`, manifiesto y exportador HAR.
2. Revisar que no haya caracteres dañados ni textos visibles sin traducir.
3. Ejecutar el análisis estático y la compilación.
4. Comprobar el `manifest.json` generado.
5. Comprimir el contenido de `dist` con `manifest.json` en la raíz.
6. Calcular y conservar la suma SHA-256 del paquete.
7. Cargar el resultado descomprimido en Chrome y revisar manualmente los flujos afectados.

Las claves privadas, certificados o archivos de trabajo locales no deben incluirse en el archivo distribuible.
