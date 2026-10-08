# FakeHeader

FakeHeader es una extensión de Chrome orientada al desarrollo que permite modificar tráfico HTTP, redirigir solicitudes, bloquear recursos, gestionar entornos y ejecutar utilidades locales desde una interfaz aislada por pestaña.

La extensión utiliza Manifest V3 y `declarativeNetRequest`. Una pestaña nueva siempre comienza desactivada y ninguna regla se instala hasta que el usuario activa expresamente FakeHeader en ella.

## Funciones principales

- Modificación de cabeceras de solicitud y respuesta.
- Redirección, bloqueo y reemplazo de URL.
- Gestión de parámetros de consulta.
- Espacios de trabajo, grupos, etiquetas, prioridades y plantillas.
- Entornos con variables normales y secretos efímeros.
- Scripts JavaScript o CSS manuales y automáticos.
- Grabador de tráfico local y exportación HAR saneada.
- Probador de reglas sin tráfico de red.
- Inspector de las reglas de sesión instaladas realmente en Chrome.
- Importación de cURL, HAR, Requestly, ModHeader, Postman y `.env`.
- Historial local, restauración y apagado global inmediato.

FakeHeader no incorpora servidor, telemetría, analítica, rastreadores ni código remoto.

## Instalación para desarrollo

Requisitos: Node.js, npm y Chrome 135 o posterior.

```text
npm install
npm run build
```

Después:

1. Abre `chrome://extensions`.
2. Activa el modo de desarrollador.
3. Pulsa **Cargar descomprimida**.
4. Selecciona la carpeta `dist` del proyecto.

Durante el desarrollo puede ejecutarse `npm run dev`. Para validar una entrega se usan `npm run lint` y `npm run build`.

## Uso básico

1. Abre la configuración de FakeHeader.
2. Crea o selecciona un espacio de trabajo.
3. Añade una regla y limita su alcance a los sitios necesarios.
4. Abre la aplicación que vas a probar.
5. Desde el panel emergente, selecciona el espacio y activa FakeHeader para esa pestaña.
6. Desactívalo al terminar o utiliza el apagado global.

## Documentación

- [Índice de documentación](docs/INDICE.md)
- [Guía de uso](docs/GUIA_DE_USO.md)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Desarrollo y entrega](docs/DESARROLLO.md)
- [Modelo de datos](docs/MODELO_DE_DATOS.md)
- [Importadores y exportadores](docs/IMPORTACION_Y_EXPORTACION.md)

## Principios del proyecto

- Activación explícita y aislada por pestaña.
- Permisos opcionales solicitados sólo cuando una función los necesita.
- Reglas importadas o creadas desde plantillas inicialmente desactivadas.
- Secretos fuera del almacenamiento persistente.
- Operaciones locales y sin comunicaciones propias de la extensión.
- Configuración validada antes de llegar al motor de reglas.

## Licencia

Este repositorio no declara actualmente una licencia de distribución. Antes de publicarlo o redistribuirlo debe añadirse la licencia elegida por el propietario.
