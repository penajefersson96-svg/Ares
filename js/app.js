/* ARES - app.js
   Cerebro de la interfaz: une los botones, guarda el historial y envía mensajes. */

import {
  els, initUI, addMessage, updateBubble, showTyping, resetChat,
  setStatus, setThinking, toast, autoResize, closeSettings,
} from './ui.js';

/* ============ ALMACENAMIENTO LOCAL ============ */

const KEYS = {
  history: 'ares.history.v1',
  settings: 'ares.settings.v1',
};

const MAX_HISTORY = 100;

const DEFAULT_SETTINGS = {
  persona: 'general',
  model: 'auto',
  voice: false,
  web: false,
};

const PERSONA_NAMES = {
  general: 'General',
  ciberseguridad: 'Ciberseguridad',
  programador: 'Programador',
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* si el almacenamiento está lleno o bloqueado, seguimos sin guardar */
  }
}

let settings = { ...DEFAULT_SETTINGS, ...loadJSON(KEYS.settings, {}) };

let history = loadJSON(KEYS.history, []);
if (!Array.isArray(history)) history = [];
history = history.filter(
  (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
);

function saveHistory() {
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  saveJSON(KEYS.history, history);
}

function saveSettings() {
  saveJSON(KEYS.settings, settings);
}

/* ============ CEREBRO (TEMPORAL) ============
   Este bloque es un simulacro. En la siguiente parte lo reemplazamos
   por la conexión real con Cloudflare (js/api.js). */

async function getReply(messages, options) {
  const last = messages[messages.length - 1].content;
  await new Promise((r) => setTimeout(r, 700));

  if (last.trim() === '/demo') {
    return [
      '## Prueba de formato',
      'Esto es **negrita**, esto es *cursiva* y esto es `código en línea`.',
      '',
      '- Primer punto de lista',
      '- Segundo punto de lista',
      '',
      '```js',
      'console.log("Hola, soy ARES");',
      '```',
      '',
      'Un enlace: [Cloudflare](https://www.cloudflare.com)',
    ].join('\n');
  }

  return (
    '**Cerebro aún sin conectar.** Recibí tu mensaje y la interfaz funciona.\n\n' +
    `Personalidad activa: \`${PERSONA_NAMES[options.persona]}\`. ` +
    'Escribe `/demo` para probar el formato.'
  );
}

/* ============ ENVIAR MENSAJES ============ */

let busy = false;

function setBusy(value) {
  busy = value;
  els.send.disabled = value;
  setThinking(value);
  if (value) setStatus('Procesando...', 'busy');
  else setStatus('En línea');
}

async function send(textOverride) {
  const text = (typeof textOverride === 'string' ? textOverride : els.input.value).trim();
  if (!text || busy) return;

  els.input.value = '';
  autoResize();

  addMessage('user', text);
  history.push({ role: 'user', content: text });
  saveHistory();

  setBusy(true);
  const bubble = showTyping();

  try {
    const reply = await getReply(history, { persona: settings.persona });
    updateBubble(bubble, reply);
    history.push({ role: 'assistant', content: reply });
    saveHistory();
    setStatus('En línea');
  } catch (err) {
    updateBubble(bubble, '⚠️ ' + (err && err.message ? err.message : 'Error desconocido'));
    setStatus('Error', 'error');
  } finally {
    busy = false;
    els.send.disabled = false;
    setThinking(false);
  }
}

/* ============ NUEVA CONVERSACIÓN / BORRAR ============ */

function clearConversation(askConfirm) {
  if (history.length === 0) {
    closeSettings();
    return;
  }
  if (askConfirm && !confirm('¿Borrar toda la conversación?')) return;
  history = [];
  saveHistory();
  resetChat();
  closeSettings();
  toast('Conversación borrada');
}

/* ============ ARRANQUE ============ */

function init() {
  initUI();

  // Restaurar la conversación guardada
  for (const m of history) {
    addMessage(m.role === 'user' ? 'user' : 'ares', m.content);
  }

  // Restaurar ajustes en los controles
  const personaSelect = document.getElementById('persona-select');
  const voiceToggle = document.getElementById('toggle-voice');
  const webToggle = document.getElementById('toggle-web');
  const modelSelect = document.getElementById('model-select');

  personaSelect.value = settings.persona;
  voiceToggle.checked = settings.voice;
  webToggle.checked = settings.web;
  modelSelect.value = settings.model;

  personaSelect.addEventListener('change', () => {
    settings.persona = personaSelect.value;
    saveSettings();
    toast('Personalidad: ' + PERSONA_NAMES[settings.persona]);
  });
  voiceToggle.addEventListener('change', () => {
    settings.voice = voiceToggle.checked;
    saveSettings();
  });
  webToggle.addEventListener('change', () => {
    settings.web = webToggle.checked;
    saveSettings();
  });
  modelSelect.addEventListener('change', () => {
    settings.model = modelSelect.value;
    saveSettings();
  });

  // Enviar
  els.send.addEventListener('click', () => send());

  // En PC: Enter envía y Shift+Enter hace salto de línea.
  // En móvil: Enter hace salto de línea y se envía con el botón.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      send();
    }
  });

  // Sugerencias de la pantalla de bienvenida
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => send(chip.dataset.prompt));
  });

  // Botones de conversación
  document.getElementById('btn-new').addEventListener('click', () => clearConversation(true));
  document.getElementById('btn-clear').addEventListener('click', () => clearConversation(true));

  // Micrófono (se activa en la fase de voz)
  els.mic.addEventListener('click', () => toast('La voz llega en la Fase 4'));
}

init();