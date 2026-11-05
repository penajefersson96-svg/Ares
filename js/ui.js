/* ARES - ui.js
   Todo lo que toca la pantalla: mensajes, markdown seguro, ajustes, avisos. */

const $ = (id) => document.getElementById(id);

export const els = {
  chat: $('chat'),
  welcome: $('welcome'),
  input: $('input'),
  send: $('btn-send'),
  mic: $('btn-mic'),
  status: $('status-text'),
  settings: $('settings'),
  backdrop: $('drawer-backdrop'),
  toast: $('toast'),
};

/* ============ MARKDOWN SEGURO ============
   Primero se escapa TODO el HTML, después se aplica el formato.
   Así nadie puede inyectar código (XSS) a través de un mensaje. */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (m, c) => {
    codes.push(c);
    return `\u0000C${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  s = s.replace(/\u0000C(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

function codeBlockHtml(block) {
  const lang = escapeHtml(block.lang || 'código');
  return (
    '<div class="code-block">' +
      `<div class="code-head"><span>${lang}</span><button class="copy-btn" type="button">Copiar</button></div>` +
      `<pre><code>${escapeHtml(block.code)}</code></pre>` +
    '</div>'
  );
}

export function renderMarkdown(src) {
  const blocks = [];

  // 1) Sacar los bloques de código (también los que aún no se han cerrado)
  const text = String(src).replace(/```([\w+-]*)[ \t]*\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
    blocks.push({ lang, code: code.replace(/\n$/, '') });
    return `\n\u0000B${blocks.length - 1}\u0000\n`;
  });

  // 2) Escapar el resto y convertir línea por línea
  const lines = escapeHtml(text).split('\n');
  let html = '';
  let list = null;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      html += `<p>${inline(para.join('<br>'))}</p>`;
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };

  for (const line of lines) {
    const t = line.trim();
    let m;

    if ((m = t.match(/^\u0000B(\d+)\u0000$/))) {
      flushPara(); closeList();
      html += codeBlockHtml(blocks[Number(m[1])]);
      continue;
    }
    if (!t) { flushPara(); closeList(); continue; }

    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara(); closeList();
      const level = m[1].length + 2;
      html += `<h${level}>${inline(m[2])}</h${level}>`;
      continue;
    }
    if ((m = t.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }

    closeList();
    para.push(t);
  }
  flushPara();
  closeList();
  return html;
}

/* ============ MENSAJES ============ */

function nearBottom() {
  return els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight < 140;
}

export function scrollToBottom(force = false) {
  if (force || nearBottom()) els.chat.scrollTop = els.chat.scrollHeight;
}

export function hideWelcome() {
  els.welcome.hidden = true;
}

export function addMessage(role, text = '') {
  hideWelcome();
  const wrap = document.createElement('div');
  wrap.className = `msg msg--${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'user') bubble.textContent = text;
  else bubble.innerHTML = renderMarkdown(text);

  wrap.appendChild(bubble);
  els.chat.appendChild(wrap);
  scrollToBottom(true);
  return bubble;
}

export function updateBubble(bubble, text) {
  const stick = nearBottom();
  bubble.innerHTML = renderMarkdown(text);
  if (stick) els.chat.scrollTop = els.chat.scrollHeight;
}

export function showTyping() {
  const bubble = addMessage('ares', '');
  bubble.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
  return bubble;
}

export function resetChat() {
  els.chat.querySelectorAll('.msg').forEach((el) => el.remove());
  els.welcome.hidden = false;
}

/* ============ ESTADO Y AVISOS ============ */

export function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

export function setThinking(on) {
  document.body.classList.toggle('thinking', on);
}

let toastTimer;
export function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

export function autoResize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 140) + 'px';
}

/* ============ AJUSTES (panel lateral) ============ */

export function openSettings() {
  els.settings.hidden = false;
  els.backdrop.hidden = false;
}

export function closeSettings() {
  els.settings.hidden = true;
  els.backdrop.hidden = true;
}

/* ============ CONEXIONES BÁSICAS DE LA INTERFAZ ============ */

export function initUI() {
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-close-settings').addEventListener('click', closeSettings);
  els.backdrop.addEventListener('click', closeSettings);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });

  els.input.addEventListener('input', autoResize);

  // Botón "Copiar" de los bloques de código
  els.chat.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const code = btn.closest('.code-block').querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = 'Copiado ✓';
    } catch {
      btn.textContent = 'Error';
    }
    setTimeout(() => { btn.textContent = 'Copiar'; }, 1500);
  });
}