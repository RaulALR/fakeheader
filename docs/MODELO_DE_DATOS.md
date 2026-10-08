# Modelo de datos

## Configuración persistente

La raíz `FakeHeaderSettings` contiene:

- `schemaVersion`: versión del esquema local.
- `profiles`: espacios de trabajo con reglas.
- `environments`: entornos y variables.
- `templates`: plantillas personalizadas.
- `scripts`: scripts JavaScript o CSS.
- `autoActivations`: asociaciones exactas entre origen, espacio y entorno.

Los nombres internos se mantienen estables para poder leer exportaciones anteriores. La interfaz utiliza terminología en castellano sin alterar esas claves.

## Regla HTTP

Una regla incluye identificador, estado, prioridad y alcance. `kind` determina la acción:

| Valor interno | Significado |
| --- | --- |
| `headers` | Modificar cabeceras |
| `redirect` | Redirigir solicitud |
| `block` | Bloquear solicitud |
| `replace` | Reemplazar URL mediante expresión regular |
| `query` | Cambiar parámetros de consulta |

Las operaciones de cabecera son `set`, `append` y `remove`. Estos valores son parte del formato de configuración y no deben traducirse dentro de un JSON exportado.

## Secretos

Una regla o variable sensible conserva en almacenamiento local el identificador de referencia, pero no su valor. El valor real se guarda bajo esa referencia en la sesión. Al hidratar la configuración se combinan ambas capas sólo dentro de un contexto de confianza de la extensión.

Las exportaciones normales eliminan secretos. Incluso una exportación explícita con valores no recupera secretos de plantillas, porque una plantilla nunca debe conservarlos.

## Estado por pestaña

Cada activación registra el identificador de pestaña, espacio, entorno opcional, fecha de caducidad y origen vinculado cuando corresponde. Este estado no forma parte de una exportación y no sobrevive al reinicio del navegador.

## Historial

Antes de confirmar un cambio se guarda una instantánea saneada. El historial está limitado por número de entradas y tamaño. Restaurar una instantánea es otra transacción y, por tanto, también puede deshacerse.

## Reglas DNR materializadas

Los identificadores DNR se generan de nuevo durante cada compilación. No son identificadores de negocio y pueden cambiar. El vínculo entre una regla lógica y su representación instalada sólo se utiliza para diagnóstico durante la sesión.
