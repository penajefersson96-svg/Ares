/**
 * Proxy de Ares para Cloudflare Workers.
 *
 * Para qué sirve: la clave de la API NUNCA debe ir en app.js (es público).
 * Aquí la clave vive como "secreto" del Worker y la app solo conoce la URL del Worker.
 *
 * Variables que debes crear en el Worker (Settings → Variables):
 *   API_URL         Dirección "chat/completions" del proveedor (formato OpenAI-compatible)
 *   API_KEY         Tu clave (créala como "Secret", no como texto)
 *   MODEL           Nombre del modelo a usar
 *   ALLOWED_ORIGIN  (recomendado) Tu sitio, por ejemplo https://tuusuario.github.io
 */

const SYSTEM_PROMPT = [
  'Eres Ares, un asistente personal de voz en español (Venezuela).',
  'Hablas con claridad y seguridad, con un tono sereno y eficiente, como un buen mayordomo digital.',
  'Tus respuestas se leen en voz alta: sé breve (1 a 4 frases), sin listas largas ni formato Markdown.',
  'Si no sabes algo, dilo. No inventes datos ni cifras.',
  'Si el usuario pide calcular o consultar el dólar, recuérdale que puede decírtelo directamente (tienes herramientas locales para eso).'
].join(' ');

const MAX_MESSAGES = 16;
const MAX_CHARS = 2000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    // Si configuraste ALLOWED_ORIGIN, solo tu sitio puede usar el proxy.
    if (allowed !== '*' && origin !== allowed) return json({ error: 'Origen no permitido' }, 403);

    if (!env.API_URL || !env.API_KEY || !env.MODEL) {
      return json({ error: 'Faltan API_URL, API_KEY o MODEL en el Worker' }, 500);
    }

    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'JSON inválido' }, 400); }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: 'Falta "messages"' }, 400);
    }

    // Solo roles permitidos, tamaño limitado: la app no puede inyectar mensajes de "system".
    const messages = body.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return json({ error: 'El último mensaje debe ser del usuario' }, 400);
    }

    const userName = typeof body.user === 'string' ? body.user.replace(/[^\p{L} ]/gu, '').slice(0, 40) : '';
    const system = SYSTEM_PROMPT + (userName ? ' El usuario se llama ' + userName + '.' : '');

    let upstream;
    try {
      upstream = await fetch(env.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.API_KEY },
        body: JSON.stringify({
          model: env.MODEL,
          messages: [{ role: 'system', content: system }, ...messages],
          max_tokens: 400,
          temperature: 0.6
        })
      });
    } catch (_) {
      return json({ error: 'No pude contactar al proveedor de IA' }, 502);
    }

    if (!upstream.ok) {
      // No se reenvía el cuerpo del error: podría contener datos de la cuenta.
      return json({ error: 'El proveedor respondió con el código ' + upstream.status }, 502);
    }

    let data;
    try { data = await upstream.json(); } catch (_) { return json({ error: 'Respuesta ilegible del proveedor' }, 502); }
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply) return json({ error: 'El proveedor no devolvió texto' }, 502);

    return json({ reply: String(reply).trim() });
  }
};
