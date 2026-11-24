// Browser side of the multiplayer connection: one WebSocket with automatic
// reconnects. The session id is kept in localStorage so a dropped player
// (refresh, Wi-Fi blip, headset asleep) comes back into the same lobby.

const PROFILE_KEY = 'secondself.mp.v1';

/** Where the multiplayer server lives. Same host by default (the Render Web Service serves both). */
export function serverUrl() {
  const env = (import.meta.env && import.meta.env.VITE_MP_SERVER) || '';
  const q = new URLSearchParams(location.search).get('server');
  let base = q || env;
  if (!base) {
    // `npm run dev` serves the page from Vite on 5173; the game server runs on 8080.
    if (import.meta.env && import.meta.env.DEV) base = `${location.protocol}//${location.hostname}:8080`;
    else base = location.origin;
  }
  base = base.replace(/\/+$/, '').replace(/^http/, 'ws');
  return base.endsWith('/ws') ? base : base + '/ws';
}

export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (p && typeof p === 'object') return p;
  } catch { /* ignore */ }
  return { name: 'Player' + Math.floor(100 + Math.random() * 900), outfit: null, session: null, preset: 0 };
}
export function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export class NetClient {
  constructor(profile) {
    this.profile = profile;
    this.handlers = new Map();
    this.ws = null;
    this.status = 'offline';     // offline | connecting | online
    this.wanted = false;
    this.retry = 0;
    this.queue = [];
    this.rtt = 0;
  }

  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); return this; }
  emit(type, msg) { for (const fn of this.handlers.get(type) || []) fn(msg); for (const fn of this.handlers.get('*') || []) fn(msg); }

  connect() {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.status = 'connecting';
    this.emit('status', { status: this.status, retry: this.retry });
    let ws;
    try { ws = new WebSocket(serverUrl()); } catch (e) { this._scheduleRetry(); return; }
    this.ws = ws;
    const slow = setTimeout(() => { if (ws.readyState === 0) this.emit('status', { status: 'waking', retry: this.retry }); }, 2500);
    ws.onopen = () => {
      clearTimeout(slow);
      this.status = 'online';
      this.retry = 0;
      ws.send(JSON.stringify({ type: 'hello', name: this.profile.name, outfit: this.profile.outfit, session: this.profile.session }));
      this.emit('status', { status: 'online' });
      this.pingTimer = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 3000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'welcome') {
        this.profile.session = msg.session;
        saveProfile(this.profile);
        const q = this.queue; this.queue = [];
        for (const m of q) this.send(m);
      }
      if (msg.type === 'pong') { this.rtt = performance.now() - msg.t; return; }
      this.emit(msg.type, msg);
    };
    ws.onclose = () => {
      clearTimeout(slow);
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.status = 'offline';
      this.emit('status', { status: 'offline', retry: this.retry });
      if (this.wanted) this._scheduleRetry();
    };
    ws.onerror = () => {};
  }

  _scheduleRetry() {
    this.retry++;
    const wait = Math.min(8000, 600 * 2 ** Math.min(this.retry, 4));
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (this.wanted) this.connect(); }, wait);
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch { /* */ } }
    this.status = 'offline';
  }

  /** Send now, or (for lobby actions) once the connection is back. */
  send(msg, { queue = false } = {}) {
    if (this.ws && this.ws.readyState === 1 && this.status === 'online') { this.ws.send(JSON.stringify(msg)); return true; }
    if (queue) this.queue.push(msg);
    return false;
  }
}
