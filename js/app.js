/* ARES - app.js
   Cerebro de la interfaz: une los botones, guarda el historial,
   pide la contraseña y conversa con el Worker. */

import {
  els, initUI, addMessage, updateBubble, showTyping, resetChat,
  setStatus, setThinking, toast, autoResize, closeSettings,
} from './ui.js';
import { streamChat, getKey, setKey, clearKey } from './api.js';

/* ============ ALMACENAMIENTO LOCAL ============ */

const KEYS = {
  history: 'ares.history.v1',
  settings: 'ares.settings.v1',
};

const MAX_HISTORY = 100;
const MAX_SENT = 20; // mensajes que se envían al cerebro en cada petición

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

/* ============ PANTALLA DE BLOQUEO ============ */

const lock = {
  screen: document.getElementById('lock-screen'),
  input: document.getElementById('lock-input'),
  btn: document.getElementById('lock-btn'),
  error: document.getElementById('lock-error'),
};

function showLock(message = '') {
  lock.screen.hidden = false;
  lock.input.value = '';
  lock.error.textContent = message;
  lock.error.hidden = !message;
  setTimeout(() => lock.input.focus(), 50);
}

function hideLock() {
  lock.screen.hidden = true;
}

function tryUnlock() {
  const key = lock.input.value.trim();
  if (!key) {
    lock.error.textContent = 'Escribe tu contraseña.';
    lock.error.hidden = false;
    return;
  }
  setKey(key);
  lock.input.value = '';
  hideLock();
  toast('Acceso configurado');
}

/* ============ ENVIAR MENSAJES ============ */

let busy = false;

function setBusy(value) {
  busy = value;
  els.send.disabled = value;
  setThinking(value);
  if (value) setStatus('Procesando...', 'busy');
}

function handleError(err, bubble) {
  if (err && err.status === 401) {
    clearKey();
    updateBubble(bubble, '🔒 Acceso denegado. Revisa tu contraseña maestra.');
    setStatus('Bloqueado', 'error');
    showLock('Contraseña incorrecta.');
    return;
  }

  let msg = err && err.message ? err.message : 'Error desconocido';
  if (err instanceof TypeError) {
    msg =
      'No pude conectar con el cerebro de ARES. Revisa tu conexión y que la página esté abierta desde la dirección de tu Worker.';
  }
  updateBubble(bubble, '⚠️ ' + msg);
  setStatus('Error', 'error');
}

async function send(textOverride) {
  const text = (typeof textOverride === 'string' ? textOverride : els.input.value).trim();
  if (!text || busy) return;

  if (!getKey()) {
    showLock();
    return;
  }

  els.input.value = '';
  autoResize();

  addMessage('user', text);
  history.push({ role: 'user', content: text });
  saveHistory();

  setBusy(true);
  const bubble = showTyping();

  // El texto se dibuja como máximo una vez por fotograma para que sea fluido
  let pending = '';
  let frame = 0;
  const render = () => {
    frame = 0;
    updateBubble(bubble, pending);
  };

  try {
    const result = await streamChat({
      messages: history.slice(-MAX_SENT),
      persona: settings.persona,
      model: settings.model,
      onToken: (full) => {
        pending = full;
        if (!frame) frame = requestAnimationFrame(render);
      },
    });

    if (frame) cancelAnimationFrame(frame);

    const reply = result.text.trim() || '(El modelo no devolvió respuesta)';
    updateBubble(bubble, reply);
    history.push({ role: 'assistant', content: reply });
    saveHistory();
    setStatus('En línea');

    if (settings.model === 'auto' && result.model === 'rapido') {
      toast('Usando el modelo rápido');
    }
  } catch (err) {
    if (frame) cancelAnimationFrame(frame);
    handleError(err, bubble);
  } finally {
    setBusy(false);
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

  // Pantalla de bloqueo
  lock.btn.addEventListener('click', tryUnlock);
  lock.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryUnlock();
  });
  if (!getKey()) showLock();
}

init();