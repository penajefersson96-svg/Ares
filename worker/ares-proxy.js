/**
 * Proxy de Ares para Cloudflare Workers.
 *
 * Para qué sirve: la clave de la API NUNCA debe ir en app.js (es público).
 * Aquí la clave vive como "secreto" del Worker y la app solo conoce la URL del Worker.
 *
 * Variables (las no secretas van en wrangler.jsonc; API_KEY va como Secreto en Cloudflare):
 *   API_URL           Dirección "chat/completions" del proveedor (formato OpenAI-compatible)
 *   API_KEY           Tu clave (Secreto, nunca en GitHub)
 *   MODEL             Modelo principal
 *   FALLBACK_MODEL    (opcional) Modelo de respaldo si el principal está saturado o no existe
 *   ALLOWED_ORIGIN    (recomendado) Tu sitio, por ejemplo https://tuusuario.github.io
 *   REASONING_EFFORT  (opcional) "low", "medium" o "high": cuánto "piensa" el modelo antes de responder
 */

const SYSTEM_PROMPT = [
  'Eres Ares, un asistente personal de voz en español (Venezuela).',
  'Hablas con claridad y seguridad, con un tono sereno y eficiente, como un buen mayordomo digital.',
  'Tus respuestas se leen en voz alta: sé breve (1 a 4 frases), sin listas largas ni formato Markdown.',
  'Si no sabes algo, dilo. No inventes datos ni cifras.'
].join(' ');

const MAX_MESSAGES = 16;
const MAX_CHARS = 2000;

// Los modelos que "piensan" gastan parte de este límite pensando antes de responder.
// Si es muy bajo, la respuesta visible se corta. Por eso es alto.
const MAX_OUTPUT_TOKENS = 2048;

// Errores temporales del proveedor: vale la pena reintentar.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sin punto final: la app ya agrega uno.
function friendlyError(status) {
  switch (status) {
    case 0: return 'No pude contactar al proveedor de IA';
    case 429: return 'Se alcanzó el límite gratuito de uso del modelo. Prueba más tarde';
    case 500:
    case 502:
    case 503:
    case 504: return 'El modelo de IA está saturado en este momento. Inténtalo de nuevo en unos segundos';
    case 401:
    case 403: return 'La clave de la API no es válida o no tiene permiso. Revisa el secreto API_KEY';
    case 404: return 'El modelo configurado no existe. Revisa la variable MODEL';
    case 400: return 'El proveedor rechazó la solicitud. Revisa MODEL y API_URL';
    default: return 'El proveedor respondió con el código ' + status;
  }
}

function callModel(env, model, messages) {
  const body = {
    model,
    messages,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.6
  };
  if (env.REASONING_EFFORT) body.reasoning_effort = env.REASONING_EFFORT;
  return fetch(env.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.API_KEY },
    body: JSON.stringify(body)
  });
}

// Intenta un modelo hasta 2 veces si el fallo es temporal.
async function tryModel(env, model, messages) {
  let status = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await callModel(env, model, messages);
    } catch (_) {
      status = 0;
      if (attempt === 0) await sleep(600);
      continue;
    }
    if (res.ok) return { ok: true, res };
    status = res.status;
    if (!RETRYABLE.has(status)) break;
    if (attempt === 0) await sleep(700);
  }
  return { ok: false, status };
}

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
    const fullMessages = [{ role: 'system', content: system }, ...messages];

    // Modelo principal y, si existe, el de respaldo.
    const models = [env.MODEL];
    if (env.FALLBACK_MODEL && env.FALLBACK_MODEL !== env.MODEL) models.push(env.FALLBACK_MODEL);

    let outcome = { ok: false, status: 0 };
    for (const model of models) {
      outcome = await tryModel(env, model, fullMessages);
      if (outcome.ok) break;
      // Si la clave falla, otro modelo tampoco ayudará.
      if (outcome.status === 401 || outcome.status === 403) break;
    }

    if (!outcome.ok) {
      // No se reenvía el cuerpo del error: podría contener datos de la cuenta.
      return json({ error: friendlyError(outcome.status), code: outcome.status }, 502);
    }

    let data;
    try { data = await outcome.res.json(); } catch (_) { return json({ error: 'Respuesta ilegible del proveedor' }, 502); }

    const choice = data && data.choices && data.choices[0];
    const reply = choice && choice.message && choice.message.content;
    if (!reply || !String(reply).trim()) {
      const agotado = choice && choice.finish_reason === 'length';
      return json({
        error: agotado
          ? 'El modelo se quedó sin espacio para responder. Inténtalo de nuevo'
          : 'El proveedor no devolvió texto'
      }, 502);
    }

    return json({ reply: String(reply).trim() });
  }
};