# Guía de uso

## Crear una regla de cabecera

1. Abre la configuración y entra en **Reglas HTTP**.
2. Selecciona un espacio de trabajo o crea uno nuevo.
3. Pulsa **Crear regla** y elige **Modificar cabeceras**.
4. Selecciona solicitud o respuesta, la operación y el nombre de cabecera.
5. Añade como mínimo un dominio. Utiliza **Todos los sitios** únicamente si el alcance global es imprescindible.
6. Guarda la regla y actívala cuando esté revisada.

Para enviar `iv-user: caca` a una aplicación local, configura una cabecera de solicitud con operación **Establecer**, nombre `iv-user`, valor `caca` y dominio `localhost` o el origen concreto que utilice la aplicación.

## Activar una pestaña

Abre el panel emergente desde el icono de FakeHeader, elige el espacio de trabajo y el entorno, y pulsa **Activar en esta pestaña**. El indicador de la extensión cambia para esa pestaña y Chrome instala reglas de sesión limitadas a su identificador.

La activación puede durar hasta cerrar la pestaña o caducar a los 5, 30 o 60 minutos. También puede configurarse el apagado al cambiar de origen. **Desactivar en todas las pestañas** elimina inmediatamente todas las activaciones y reglas de sesión administradas por FakeHeader.

## Alcance de una regla

El alcance combina dominios, filtro URL o expresión regular, métodos HTTP, tipos de recurso, dominio iniciador, relación con el sitio y sensibilidad a mayúsculas. Los dominios determinan los permisos solicitados a Chrome. Un filtro del que no pueda extraerse un dominio seguro no concede acceso global automáticamente.

## Tipos de regla

- **Modificar cabeceras** establece, añade o elimina cabeceras.
- **Redirigir solicitud** envía una URL coincidente a un destino HTTP o HTTPS.
- **Bloquear solicitud** impide que el recurso se cargue.
- **Reemplazar URL** aplica una expresión regular y una sustitución.
- **Parámetros de consulta** establece o elimina parámetros de la URL.

## Entornos y variables

Los entornos permiten reutilizar reglas entre instalaciones locales, desarrollo y preproducción. En valores de reglas puede utilizarse `{{VARIABLE}}`. En JavaScript se utiliza `{{JSON:VARIABLE}}` para insertar el valor como una cadena JSON segura.

Las variables marcadas como secretas no se escriben en `storage.local`. Permanecen en `storage.session` y deben introducirse de nuevo después de reiniciar Chrome.

## Scripts de usuario

Cada espacio puede contener JavaScript o CSS. El modo manual se ejecuta desde el panel emergente. El modo automático se ejecuta tras una navegación compatible si la pestaña está activada y dispone de permisos.

El mundo `USER_SCRIPT` está aislado de la página y es el valor recomendado. `MAIN` comparte el contexto JavaScript del sitio y debe reservarse para casos que necesiten modificar APIs como `window.fetch`.

## Grabador de tráfico

El grabador observa solicitudes de una pestaña activada. Conserva metadatos, tiempos, cabeceras saneadas y los cuerpos completos disponibles de `fetch` y `XMLHttpRequest` durante la sesión de Chrome. Las respuestas binarias se almacenan en base64 y pueden descargarse. Puede exportar HAR o convertir cabeceras observadas en reglas desactivadas.

La captura completa utiliza el depurador de red integrado de Chrome. DevTools debe permanecer cerrado en la pestaña mientras se graba; si se abre, Chrome desconecta el grabador y FakeHeader muestra el error en la sesión.

## Diagnóstico

El **Probador de reglas** evalúa una URL hipotética sin realizar ninguna solicitud. El **Inspector de ejecución** consulta las reglas de sesión reales, permisos, pestañas activas y coincidencias registradas. Si el estado parece incoherente, utiliza el apagado global, comprueba los permisos del sitio y vuelve a activar la pestaña.
