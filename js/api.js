/* ARES - api.js
   Conexión con el cerebro (Worker de Cloudflare), con respuestas en streaming. */

// Vacío = mismo dominio. La página y el cerebro viven en el mismo Worker,
// así que la app llama a "/chat" sin necesidad de escribir ninguna URL.
const API_BASE = '';

const KEY_STORAGE = 'ares.key.v1';

/* ============ CONTRASEÑA MAESTRA ============ */

export function getKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setKey(key) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* sin almacenamiento disponible */
  }
}

export function clearKey() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* sin almacenamiento disponible */
  }
}

/* ============ CHAT EN STREAMING ============
   onToken(textoCompleto, ultimoFragmento) se llama cada vez que llega texto nuevo.
   Devuelve { text, model }. */

export async function streamChat({ messages, persona, model, onToken, signal }) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getKey()}`,
    },
    body: JSON.stringify({ messages, persona, model }),
    signal,
  });
  
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch {
      /* la respuesta no era JSON */
    }
    if (res.status === 404 || res.status === 405) {
      msg =
        'No encuentro el cerebro (/chat). Abre ARES desde la dirección de tu Worker, no desde la vista previa de SPCK.';
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  
  const usedModel = res.headers.get('X-Ares-Model') || '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  
  let buffer = '';
  let full = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      
      try {
        const obj = JSON.parse(data);
        const token = obj.response ?? obj.choices?.[0]?.delta?.content ?? '';
        if (token) {
          full += token;
          onToken(full, token);
        }
      } catch {
        /* línea incompleta o ajena: se ignora */
      }
    }
  }
  
  return { text: full, model: usedModel };
}