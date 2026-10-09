# Importación y exportación

## Configuración de FakeHeader

La configuración completa puede exportarse como JSON. La exportación normal censura valores sensibles. Existe una acción explícita para incluir los valores permitidos; debe utilizarse únicamente en un equipo controlado.

También puede exportarse un solo espacio de trabajo. Al importarlo se regeneran identificadores para evitar colisiones y las reglas quedan desactivadas.

## cURL

El importador analiza el comando como texto. Extrae URL, método y cabeceras compatibles, pero nunca ejecuta el comando. Los cuerpos y opciones que DNR no puede representar se descartan con una advertencia.

## HAR

Puede importarse un HAR local para crear reglas desde cabeceras de solicitud, respuesta o ambas. Se aplican límites de archivo, entradas y reglas. Los cuerpos, binarios, cabeceras protegidas y valores sensibles se omiten.

La exportación del grabador vuelve a sanear URL y cabeceras e incluye los cuerpos de respuesta capturados durante la sesión. Los cuerpos pueden contener información sensible y deben tratarse como datos privados.

## Requestly

Se convierten acciones compatibles de cabeceras, redirección, cancelación, parámetros, agente de usuario y algunos reemplazos. Los retrasos y cuerpos estáticos sencillos pueden convertirse en scripts `MAIN` generados por FakeHeader para envolver `window.fetch`.

No se ejecuta código incluido en la exportación. Las condiciones globales o ambiguas se omiten, y nunca se activa **Todos los sitios** implícitamente. Los resultados quedan desactivados para su revisión.

## ModHeader

Se admiten exportaciones clásicas y el formato v2 compatible. Las cabeceras de solicitud, respuesta, cookies, CSP y redirecciones se convierten cuando su alcance puede representarse con seguridad. Los filtros no equivalentes se informan y se omiten.

## Entornos `.env` y Postman

Los archivos `.env` se interpretan como asignaciones de texto; no se expanden variables ni se ejecuta sintaxis de consola. Las exportaciones de entorno de Postman importan variables habilitadas. Los nombres relacionados con credenciales se marcan como secretos.

La exportación `.env` sustituye los secretos por `[REDACTED]`.

## Revisión posterior

Después de cualquier importación conviene comprobar el dominio, el filtro URL, la operación, los permisos, los valores sensibles, las advertencias y el resultado en el Probador de reglas antes de activar una pestaña.
