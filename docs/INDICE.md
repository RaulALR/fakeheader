# Documentación de FakeHeader

Esta documentación describe el funcionamiento de la extensión, su estructura interna y los criterios para mantenerla y distribuirla.

## Para usuarios

- [Guía de uso](GUIA_DE_USO.md): creación de reglas, activación por pestaña, entornos, scripts y diagnóstico.
- [Importación y exportación](IMPORTACION_Y_EXPORTACION.md): formatos compatibles, límites y comportamiento de seguridad.
- [Seguridad](../SECURITY.md): permisos, secretos, aislamiento y limitaciones conocidas.

## Para desarrollo

- [Arquitectura](ARQUITECTURA.md): componentes, flujo de datos y responsabilidades.
- [Modelo de datos](MODELO_DE_DATOS.md): configuración persistente, estado de sesión y reglas DNR.
- [Desarrollo y entrega](DESARROLLO.md): preparación del entorno, compilación, carga en Chrome y empaquetado.
- [Auditoría de seguridad](../SECURITY_AUDIT.md): controles revisados y riesgos residuales.

## Conceptos fundamentales

Un **espacio de trabajo** agrupa reglas y scripts. Un **entorno** proporciona variables. Una **activación** vincula temporalmente una pestaña con un espacio de trabajo y, opcionalmente, con un entorno. El motor convierte esa combinación en reglas de sesión de Chrome limitadas mediante `tabIds`.

Los identificadores como `request`, `response`, `headers`, `set`, `append`, `remove`, `USER_SCRIPT` o `MAIN` forman parte del modelo interno o de APIs de Chrome. Se conservan en inglés para mantener la compatibilidad de datos, aunque la interfaz y la documentación expliquen su significado en castellano.
