# ARES v0.1

Asistente de voz y chat con aspecto de Jarvis. Funciona como página web instalable (PWA), se edita desde Spck y se publica gratis en GitHub Pages.

## Qué hace hoy

**Herramientas locales** (funcionan sin ningún modelo de IA):
- Hora y fecha
- Dólar oficial y conversiones, con la tasa traída de `ve.dolarapi.com` (se guarda 30 min)
- Calculadora segura (`calcula 15% de 240`, `cuánto es 12 por 8`)
- Notas (`anota comprar harina`, `mis notas`)
- Temporizador (`pon un temporizador de 5 minutos`; solo avisa con la app abierta)

**Cerebro opcional:** si conectas un proxy (ver abajo), todo lo que las herramientas no resuelven se responde con un modelo de IA.

**Voz:** entrada con el micrófono (Chrome en Android) y respuesta hablada. Modo "siempre escuchando": di *"Ares, ¿qué hora es?"*.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `style.css` | Interfaz |
| `app.js` | Toda la lógica: voz, herramientas, cerebro |
| `sw.js`, `manifest.json`, `icon.svg` | Instalable en el teléfono y funciona sin conexión (menos el cerebro) |
| `worker/ares-proxy.js` | Proxy que guarda tu clave de API (NO se publica en GitHub Pages) |

## Paso 1: publicar en GitHub Pages

1. En Spck, crea una carpeta `ares` y copia estos archivos (todos menos la carpeta `worker`, que puedes guardar aparte).
2. Haz commit y push a un repositorio nuevo en GitHub.
3. En GitHub: **Settings → Pages → Deploy from a branch → main / (root)**.
4. Abre `https://TUUSUARIO.github.io/NOMBRE-DEL-REPO/` en Chrome. Con el menú ⋮ → *Agregar a pantalla de inicio* queda como app.

Con eso ya funcionan las herramientas locales.

## Paso 2: conectar el cerebro (opcional)

Nunca pongas la clave de una API dentro de `app.js`: el código es público y cualquiera podría usarla.

1. Elige un proveedor de IA con capa gratuita que use el formato "OpenAI-compatible" (por ejemplo Google AI Studio, Groq u OpenRouter). **Revisa en su sitio los límites y modelos vigentes**, porque cambian seguido. Crea una clave de API.
2. Crea una cuenta gratis en Cloudflare → **Workers & Pages → Create → Worker**. Pega el contenido de `worker/ares-proxy.js` y despliega.
3. En el Worker, **Settings → Variables**, crea:
   - `API_URL`: la dirección *chat/completions* del proveedor (está en su documentación)
   - `API_KEY`: tu clave, como **Secret**
   - `MODEL`: el nombre del modelo (de la documentación del proveedor)
   - `ALLOWED_ORIGIN`: `https://TUUSUARIO.github.io` (así solo tu sitio puede usar el proxy)
4. Copia la URL del Worker (termina en `.workers.dev`) y pégala en Ares: **⚙ Ajustes → Dirección del cerebro**.

Prueba con: *"Ares, explícame qué es un menú digital"*.

## Hoja de ruta hacia Jarvis

| Fase | Qué se agrega | Nota |
|---|---|---|
| **1 (esta)** | Voz, chat, herramientas locales, cerebro por proxy | Listo |
| **2** | Memoria que dura entre dispositivos (Firestore), perfil del usuario, recordatorios con notificaciones | Necesita login |
| **3** | Ares conectado a tus restaurantes: "¿cuánto vendimos hoy?", "agrega este plato", "cambia la tasa" | Usa la base de datos del menú; las acciones de escritura pedirán confirmación |
| **4** | Herramientas con el modelo (function calling): que el modelo decida qué herramienta usar, en vez de frases fijas | Mucho más flexible que las reglas de `skills()` |
| **5** | Visión (cámara: "¿qué ves?"), voz más natural (TTS en la nube) | Tiene costo según el proveedor |
| **6** | Modelo pequeño que corre en el propio teléfono (WebGPU), para uso sin internet | Depende de tu teléfono; hoy es lento en gamas básicas |

## Límites reales de hoy

- El reconocimiento de voz del navegador necesita internet y solo funciona con la página abierta; no hay "oye Ares" con la pantalla apagada.
- Los temporizadores solo suenan con Ares abierto.
- Un "Jarvis" completo (controlar otras apps, estar siempre despierto) requiere una app nativa; esta base está pensada para crecer hacia ahí paso a paso.
