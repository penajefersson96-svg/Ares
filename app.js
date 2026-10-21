/* ARES v0.2
 * Asistente de voz y chat. Herramientas locales + cerebro opcional vía proxy.
 * Todo el texto que se muestra usa textContent (nada de innerHTML con datos externos).
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ */
  /* Almacenamiento (localStorage puede fallar: siempre con try/catch)   */
  /* ------------------------------------------------------------------ */
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('ares_' + k); return v === null ? d : JSON.parse(v); }
      catch (_) { return d; }
    },
    set(k, v) { try { localStorage.setItem('ares_' + k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { localStorage.removeItem('ares_' + k); } catch (_) {} }
  };

  const state = {
    name: store.get('name', ''),
    proxy: store.get('proxy', ''),
    voice: store.get('voice', true),
    wake: store.get('wake', false),
    notes: store.get('notes', []),
    history: store.get('history', []),
    mode: 'idle'
  };
  let busy = false;
  let speaking = false;

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  function parseNum(s) {
    s = String(s);
    if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''));
    return parseFloat(s);
  }

  /* ------------------------------------------------------------------ */
  /* Interfaz                                                            */
  /* ------------------------------------------------------------------ */
  const logEl = $('log');
  function addMsg(role, text, extraClass) {
    const el = document.createElement('div');
    el.className = 'msg ' + role + (extraClass ? ' ' + extraClass : '');
    el.textContent = text;
    logEl.appendChild(el);
    while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
    return el;
  }

  const STATUS = {
    idle: 'En espera', listening: 'Escuchando', thinking: 'Pensando', speaking: 'Hablando'
  };
  function setMode(mode) {
    state.mode = mode;
    $('status-dot').className = 'dot ' + (mode === 'idle' ? '' : mode);
    $('status-text').textContent = STATUS[mode] || '';
    orbTarget = { idle: 0.12, listening: 0.45, thinking: 0.7, speaking: 0.95 }[mode] || 0.12;
  }

  /* ------------------------------------------------------------------ */
  /* Orbe animado                                                        */
  /* ------------------------------------------------------------------ */
  const cv = $('orb');
  const ctx = cv.getContext('2d');
  let orbT = 0, orbE = 0.12, orbTarget = 0.12;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function drawOrb() {
    orbT += reduceMotion ? 0.003 : 0.016;
    orbE += (orbTarget - orbE) * 0.06;
    const W = cv.width, c = W / 2;
    ctx.clearRect(0, 0, W, W);

    const glow = ctx.createRadialGradient(c, c, 10, c, c, c * 0.98);
    glow.addColorStop(0, 'rgba(255,59,47,' + (0.22 + orbE * 0.35) + ')');
    glow.addColorStop(1, 'rgba(255,59,47,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, W);

    const spin = 1 + orbE * 3;
    for (let i = 0; i < 4; i++) {
      const r = c * (0.36 + i * 0.16);
      ctx.beginPath();
      ctx.setLineDash([18 + i * 14, 10 + i * 8]);
      ctx.lineDashOffset = -orbT * (24 + i * 16) * spin * (i % 2 ? -1 : 1);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,' + (59 + i * 38) + ',47,' + (0.85 - i * 0.18) + ')';
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const pulse = 1 + Math.sin(orbT * 3) * 0.04 + orbE * 0.22 * Math.sin(orbT * 9);
    const pr = c * 0.2 * pulse;
    const core = ctx.createRadialGradient(c, c, 2, c, c, pr);
    core.addColorStop(0, '#fff3e0');
    core.addColorStop(0.35, '#ffb02e');
    core.addColorStop(1, 'rgba(255,59,47,0.15)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(c, c, pr, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(drawOrb);
  }

  /* ------------------------------------------------------------------ */
  /* Voz: salida                                                         */
  /* ------------------------------------------------------------------ */
  const synth = window.speechSynthesis || null;
  let esVoice = null;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    esVoice = vs.find((v) => /^es[-_]VE/i.test(v.lang)) ||
              vs.find((v) => /^es[-_](MX|US|419|CO|AR)/i.test(v.lang)) ||
              vs.find((v) => /^es/i.test(v.lang)) || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }

  function speak(text) {
    if (!state.voice || !synth) return Promise.resolve();
    const clean = text.replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return Promise.resolve();
    return new Promise((resolve) => {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = (esVoice && esVoice.lang) || 'es-ES';
      if (esVoice) u.voice = esVoice;
      u.rate = 1.03;
      const done = () => { speaking = false; resolve(); };
      u.onstart = () => { speaking = true; setMode('speaking'); };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });
  }
  function stopSpeaking() { if (synth) synth.cancel(); speaking = false; }

  /* ------------------------------------------------------------------ */
  /* Voz: entrada                                                        */
  /* ------------------------------------------------------------------ */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let recRunning = false;
  let wantRec = false;
  let awaitingCommand = false;
  const micBtn = $('btn-mic');

  function startRec() {
    if (!SR) {
      addMsg('sys', 'Este navegador no tiene reconocimiento de voz. Usa Chrome en Android, o escribe.');
      wantRec = false;
      return;
    }
    if (recRunning) return;
    rec = new SR();
    rec.lang = 'es-VE';
    rec.interimResults = false;
    rec.continuous = state.wake;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      recRunning = true;
      micBtn.classList.add('on');
      if (!busy && !speaking) setMode('listening');
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) onHeard(e.results[i][0].transcript.trim());
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRec = false;
        addMsg('sys', 'No tengo permiso para usar el micrófono. Actívalo en los ajustes del sitio.');
      }
    };
    rec.onend = () => {
      recRunning = false;
      micBtn.classList.remove('on');
      if (!busy && !speaking) setMode('idle');
      if (wantRec && state.wake && !speaking) setTimeout(startRec, 350);
      else if (!state.wake) wantRec = false;
    };
    try { rec.start(); } catch (_) { recRunning = false; }
  }

  function stopRec() {
    wantRec = false;
    awaitingCommand = false;
    try { if (rec) rec.stop(); } catch (_) {}
  }

  function onHeard(text) {
    if (!text) return;
    if (!state.wake) { handle(text); return; }

    // Modo "siempre escuchando": solo reacciona si empieza con "Ares"
    if (awaitingCommand) { awaitingCommand = false; handle(text); return; }
    const m = norm(text).match(/^(?:oye |hey |ok )?ares[\s,.:;!¿?-]*(.*)$/);
    if (!m) return;
    const rest = m[1].trim();
    if (rest) {
      // Recupera el texto original sin la palabra "Ares"
      const original = text.replace(/^\s*(?:oye |hey |ok )?ares[\s,.:;!¿?-]*/i, '').trim();
      handle(original || rest);
    } else {
      awaitingCommand = true;
      addMsg('ares', 'Dime.');
      speak('Dime.');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Calculadora segura (sin eval)                                       */
  /* ------------------------------------------------------------------ */
  function calc(exprText) {
    let s = norm(exprText)
      .replace(/[?=]/g, ' ')
      .replace(/(\d+(?:[.,]\d+)?)\s*(?:%|por ciento)\s*de\s*(\d+(?:[.,]\d+)?)/g, '($1/100*$2)')
      .replace(/\belevado a\b/g, '^')
      .replace(/\bdividido (?:por|entre)\b|\bentre\b/g, '/')
      .replace(/\bpor\b|\bx\b/g, '*')
      .replace(/\bmas\b/g, '+')
      .replace(/\bmenos\b/g, '-');

    const tokens = [];
    const re = /\s*(\d[\d.,]*|[-+*/^()%])/gy;
    let m, last = 0;
    while ((m = re.exec(s)) !== null) { tokens.push(m[1]); last = re.lastIndex; }
    if (s.slice(last).trim() !== '' || tokens.length === 0) throw new Error('expresión no válida');

    let p = 0;
    const peek = () => tokens[p];
    const next = () => tokens[p++];
    function expr() {
      let v = term();
      while (peek() === '+' || peek() === '-') { const op = next(); const r = term(); v = op === '+' ? v + r : v - r; }
      return v;
    }
    function term() {
      let v = power();
      while (peek() === '*' || peek() === '/') {
        const op = next(); const r = power();
        if (op === '/' && r === 0) throw new Error('división entre cero');
        v = op === '*' ? v * r : v / r;
      }
      return v;
    }
    function power() {
      const b = unary();
      if (peek() === '^') { next(); return Math.pow(b, power()); }
      return b;
    }
    function unary() {
      if (peek() === '-') { next(); return -unary(); }
      if (peek() === '+') { next(); return unary(); }
      return primary();
    }
    function primary() {
      const t = next();
      if (t === undefined) throw new Error('expresión incompleta');
      if (t === '(') { const v = expr(); if (next() !== ')') throw new Error('paréntesis sin cerrar'); return v; }
      if (/^\d/.test(t)) {
        let v = parseNum(t);
        if (Number.isNaN(v)) throw new Error('número no válido');
        if (peek() === '%') { next(); v = v / 100; }
        return v;
      }
      throw new Error('símbolo inesperado');
    }
    const result = expr();
    if (p < tokens.length) throw new Error('expresión no válida');
    if (!Number.isFinite(result)) throw new Error('resultado no válido');
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Temporizadores (solo mientras la app esté abierta)                  */
  /* ------------------------------------------------------------------ */
  function startTimer(ms, label) {
    setTimeout(() => {
      const msg = '⏰ Tiempo cumplido: ' + label + '.';
      addMsg('ares', msg);
      speak('Tiempo cumplido. ' + label);
      try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (_) {}
    }, ms);
  }

  /* ------------------------------------------------------------------ */
  /* Herramientas locales: devuelven texto, o null si no aplican         */
  /* ------------------------------------------------------------------ */
  const HELP =
    'Esto puedo hacer ahora mismo, sin conexión a ningún modelo:\n' +
    '• Hora y fecha\n' +
    '• Cálculos (“calcula 15% de 240”, “cuánto es 12 por 8”)\n' +
    '• Notas (“anota comprar harina”, “mis notas”, “borra mis notas”)\n' +
    '• Temporizador (“pon un temporizador de 5 minutos”)\n' +
    'Con el cerebro conectado (Ajustes), también converso de cualquier tema.';

  async function skills(text) {
    const n = norm(text);
    let m;

    // Presentación y ayuda
    if (/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|oye)( ares)?\W*$/.test(n)) {
      const h = new Date().getHours();
      const g = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
      return g + (state.name ? ', ' + state.name : '') + '. Ares en línea. ¿Qué necesitas?';
    }
    if (/(que puedes hacer|que sabes hacer|ayuda|comandos|que haces)/.test(n) && n.length < 50) return HELP;

    // Nombre
    if ((m = n.match(/(?:me llamo|mi nombre es|llamame)\s+([a-zñ]+)/))) {
      state.name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      store.set('name', state.name);
      return 'Entendido, ' + state.name + '. Lo recordaré.';
    }

    // Hora y fecha
    if (/(que hora es|dime la hora|hora actual|la hora)/.test(n) && n.length < 40) {
      return 'Son las ' + new Date().toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit', hour12: true }) + '.';
    }
    if (/(que dia es|que fecha es|fecha de hoy|dia de hoy|que dia es hoy)/.test(n) && n.length < 40) {
      return 'Hoy es ' + new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.';
    }

    // Temporizador
    if (/(temporizador|timer|cronometro|avisame en|alarma)/.test(n) &&
        (m = n.match(/(\d+(?:[.,]\d+)?)\s*(segundos?|seg|minutos?|min|horas?|h)\b/))) {
      const val = parseNum(m[1]);
      const unit = m[2][0] === 'h' ? 3600000 : m[2][0] === 's' ? 1000 : 60000;
      const ms = Math.round(val * unit);
      if (ms < 1000 || ms > 6 * 3600000) return 'Puedo temporizar entre 1 segundo y 6 horas.';
      startTimer(ms, val + ' ' + m[2]);
      return 'Temporizador listo: ' + val + ' ' + m[2] + '. Mantén Ares abierto para que te avise.';
    }

    // Notas
    if ((m = n.match(/^(?:anota|apunta|guarda(?: una)? nota|nota)[:,]?\s+(.+)$/))) {
      const original = text.replace(/^\s*(?:anota|apunta|guarda(?: una)? nota|nota)[:,]?\s+/i, '').trim();
      state.notes.push({ t: original || m[1], d: Date.now() });
      state.notes = state.notes.slice(-50);
      store.set('notes', state.notes);
      return 'Anotado: “' + (original || m[1]) + '”.';
    }
    if (!/(borra|elimina|limpia)/.test(n) &&
        /(mis notas|ver notas|lee mis notas|muestrame las notas|que tengo anotado)/.test(n)) {
      if (!state.notes.length) return 'No tienes notas guardadas.';
      return 'Tus notas:\n' + state.notes.map((x, i) => (i + 1) + '. ' + x.t).join('\n');
    }
    if (/(borra|elimina|limpia).*(notas)/.test(n)) {
      const c = state.notes.length;
      state.notes = [];
      store.set('notes', state.notes);
      return c ? 'Listo, borré ' + c + ' nota' + (c === 1 ? '' : 's') + '.' : 'No había notas que borrar.';
    }

    // Cálculos
    if ((m = n.match(/^(?:calcula(?:r|me)?|cuanto es|cuanto da|cuanto son|resuelve)\s+(.+)$/))) {
      try {
        const v = calc(m[1]);
        return 'Resultado: ' + v.toLocaleString('es-VE', { maximumFractionDigits: 4 });
      } catch (e) {
        if (/^calcula/.test(n)) return 'No pude calcular eso (' + e.message + ').';
        // “cuánto es …” puede ser otra cosa: que decida el cerebro
      }
    }

    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Cerebro (proxy a un modelo de IA)                                   */
  /* ------------------------------------------------------------------ */
  async function askBrain(text) {
    if (!state.proxy) {
      if (/(quien eres|como te llamas|tu nombre|que eres)/.test(norm(text))) {
        return 'Soy Ares, un asistente en construcción. Hoy tengo herramientas locales; cuando conectes mi cerebro en Ajustes, podré conversar de todo.';
      }
      return 'Aún no tengo el cerebro conectado, así que solo manejo mis herramientas locales (di “ayuda” para verlas). ' +
             'Conéctalo en Ajustes (⚙) con la dirección de tu proxy y podré conversar de cualquier tema.';
    }
    const messages = state.history.slice(-14).concat([{ role: 'user', content: text }]);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(state.proxy, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, user: state.name || undefined }),
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) throw new Error(data.error || 'el cerebro respondió con el código ' + res.status);
      return String(data.reply);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('el cerebro tardó demasiado en responder');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Flujo principal                                                     */
  /* ------------------------------------------------------------------ */
  async function handle(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true;
    stopSpeaking();
    addMsg('you', text);
    const waiting = addMsg('ares', 'Procesando', 'thinking');
    setMode('thinking');

    let reply;
    let ok = true;
    try {
      reply = await skills(text);
      if (reply === null) reply = await askBrain(text);
    } catch (e) {
      ok = false;
      reply = 'Tuve un problema: ' + (e && e.message ? e.message : 'error desconocido') + '.';
    }

    waiting.remove();
    addMsg('ares', reply);
    if (ok) {
      state.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      state.history = state.history.slice(-16);
      store.set('history', state.history);
    }
    busy = false;
    await speak(reply);
    setMode(recRunning ? 'listening' : 'idle');
  }

  /* ------------------------------------------------------------------ */
  /* Eventos                                                             */
  /* ------------------------------------------------------------------ */
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input');
    const v = input.value;
    input.value = '';
    handle(v);
  });

  micBtn.addEventListener('click', () => {
    if (recRunning || wantRec) { stopRec(); return; }
    stopSpeaking();
    wantRec = true;
    startRec();
  });

  const CHIPS = ['¿Qué hora es?', 'Calcula 15% de 240', 'Temporizador de 1 minuto', '¿Qué puedes hacer?'];
  CHIPS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = c;
    b.addEventListener('click', () => handle(c));
    $('chips').appendChild(b);
  });

  /* ---- Ajustes ---- */
  const dlg = $('settings');
  $('btn-settings').addEventListener('click', () => {
    $('set-name').value = state.name;
    $('set-proxy').value = state.proxy;
    $('set-voice').checked = state.voice;
    $('set-wake').checked = state.wake;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    state.name = $('set-name').value.trim().slice(0, 40);
    let p = $('set-proxy').value.trim();
    if (p && !/^https:\/\//i.test(p) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(p)) {
      addMsg('sys', 'La dirección del cerebro debe empezar por https://');
      p = state.proxy;
    }
    state.proxy = p;
    state.voice = $('set-voice').checked;
    const wasWake = state.wake;
    state.wake = $('set-wake').checked;
    store.set('name', state.name);
    store.set('proxy', state.proxy);
    store.set('voice', state.voice);
    store.set('wake', state.wake);
    if (wasWake !== state.wake) stopRec();
    addMsg('sys', 'Ajustes guardados.');
    dlg.returnValue = '';
  });
  $('btn-forget').addEventListener('click', () => {
    if (!confirm('¿Borrar notas, historial de conversación y nombre guardados?')) return;
    state.notes = []; state.history = []; state.name = '';
    ['notes', 'history', 'name'].forEach((k) => store.del(k));
    $('set-name').value = '';
    addMsg('sys', 'Memoria borrada.');
  });

  /* ---- Arranque ---- */
  setMode('idle');
  drawOrb();
  addMsg('ares', state.name
    ? 'Hola de nuevo, ' + state.name + '. Ares en línea.'
    : 'Ares en línea. Toca el micrófono para hablarme, o escríbeme. Di “ayuda” para ver qué sé hacer.');
  if (state.wake) addMsg('sys', 'Modo “siempre escuchando” activo: toca el micrófono para empezar y di “Ares, …”.');

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();