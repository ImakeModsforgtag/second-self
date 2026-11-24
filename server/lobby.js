// Lobbies, players and the authoritative co-op simulation.

import { randomUUID, randomInt } from 'node:crypto';
import { Game } from '../src/sim/game.js';
import { MP_LEVEL_LIST } from '../src/mp/levels.js';
import { PLAYER } from '../src/config.js';
import {
  MAX_PLAYERS, MIN_PLAYERS, SIM_HZ, SNAP_HZ, RECONNECT_SECONDS, CODE_ALPHABET, CODE_LENGTH,
  QUICK_CHAT, encodeSnapshot, bodyFromKey, sanitizeOutfit, sanitizeName,
} from '../src/net/protocol.js';

const now = () => Date.now() / 1000;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const vec = (a) => Array.isArray(a) && a.length === 3 && a.every(num) ? { x: a[0], y: a[1], z: a[2] } : null;
const unit = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const levelById = (id) => MP_LEVEL_LIST.find((l) => l.id === Number(id));

function send(ws, msg) {
  if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(msg)); } catch { /* closed */ } }
}

class Member {
  constructor(session, name, outfit) {
    this.session = session;          // secret, used only to reconnect
    this.uid = 'u' + randomInt(1e9).toString(36);
    this.name = name;
    this.outfit = outfit;
    this.ready = false;
    this.vote = null;
    this.voice = false;
    this.ws = null;
    this.connected = false;
    this.leftAt = 0;
    this.pid = null;                 // player id inside the running chamber
    this.chatTimes = [];
  }
  pub(lobby) {
    return {
      uid: this.uid, name: this.name, outfit: this.outfit, ready: this.ready, vote: this.vote,
      connected: this.connected, host: lobby.host === this, voice: this.voice, pid: this.pid,
    };
  }
}

class Lobby {
  constructor(manager, code) {
    this.manager = manager;
    this.code = code;
    this.members = [];
    this.host = null;
    this.state = 'lobby';            // lobby | playing | victory
    this.paused = null;              // { reason, names, deadline } while someone is reconnecting
    this.game = null;
    this.level = null;
    this.levelPlayers = 0;           // lobby size recorded when the chamber started
    this.levelStart = 0;
    this.events = [];
    this.snapAcc = 0;
    this.createdAt = now();
    this.emptySince = null;
  }

  get connected() { return this.members.filter((m) => m.connected); }
  broadcast(msg, except) { for (const m of this.members) if (m !== except && m.connected) send(m.ws, msg); }
  memberByPid(pid) { return this.members.find((m) => m.pid === pid); }

  publicState() {
    return {
      type: 'lobby', code: this.code, state: this.state, max: MAX_PLAYERS,
      level: this.level ? this.level.id : null, levelPlayers: this.levelPlayers,
      players: this.members.map((m) => m.pub(this)),
      paused: this.paused ? { names: this.paused.names, deadline: this.paused.deadline - now() } : null,
    };
  }
  sync() { for (const m of this.members) if (m.connected) send(m.ws, { ...this.publicState(), you: m.uid }); }

  add(member) {
    this.members.push(member);
    if (!this.host) this.host = member;
    this.sync();
    this.system(`${member.name} joined the lobby.`);
  }

  remove(member, reason = 'left') {
    const i = this.members.indexOf(member);
    if (i < 0) return;
    this.members.splice(i, 1);
    if (member.pid && this.game) {
      const pl = this.game.players.get(member.pid);
      if (pl) { if (pl.hold) this.game.release(pl.id, true); pl.away = true; pl.body.removed = true; }
    }
    if (this.host === member) this.host = this.connected[0] || this.members[0] || null;
    this.manager.sessions.delete(member.session);
    if (this.members.length === 0) { this.manager.lobbies.delete(this.code); return; }
    this.system(`${member.name} ${reason}.`);
    this.checkPause();
    this.sync();
  }

  system(text) { this.broadcast({ type: 'chat', system: true, text }); }

  // ------------------------------------------------------------ game flow
  start(levelId) {
    const level = levelById(levelId);
    if (!level) return 'Unknown chamber.';
    const players = this.connected;
    if (players.length < MIN_PLAYERS) return `Co-op needs at least ${MIN_PLAYERS} connected players.`;
    // Members still reconnecting are left out of this chamber.
    for (const m of this.members) m.pid = null;
    players.forEach((m, i) => { m.pid = 'p' + i; });
    this.level = level;
    this.levelPlayers = players.length;
    this.game = new Game(level, { players: players.map((m) => m.pid), kinematic: true });
    this.game.drainEvents();
    this.state = 'playing';
    this.paused = null;
    this.levelStart = now();
    this.events = [];
    for (const m of this.members) { m.ready = false; m.vote = null; }
    const roster = players.map((m) => ({ pid: m.pid, uid: m.uid, name: m.name, outfit: m.outfit }));
    for (const m of players) send(m.ws, { type: 'start', level: level.id, players: roster, you: m.pid, count: players.length });
    this.sync();
    this.system(`Chamber ${level.id}: ${level.name}, built for ${players.length} players.`);
    return null;
  }

  toLobby() {
    this.state = 'lobby';
    this.game = null;
    this.paused = null;
    for (const m of this.members) { m.pid = null; m.ready = false; }
    this.broadcast({ type: 'to-lobby' });
    this.sync();
  }

  /** Pause while anyone from the running chamber is disconnected. */
  checkPause() {
    if (this.state !== 'playing' || !this.game) return;
    const away = this.members.filter((m) => m.pid && !m.connected);
    if (away.length && !(this.paused && this.paused.skip)) {
      const deadline = Math.max(...away.map((m) => m.leftAt)) + RECONNECT_SECONDS;
      const fresh = !this.paused;
      this.paused = { names: away.map((m) => m.name), deadline, skip: false };
      if (fresh) this.broadcast({ type: 'paused', names: this.paused.names, seconds: RECONNECT_SECONDS });
    } else if (!away.length && this.paused) {
      this.paused = null;
      this.broadcast({ type: 'resumed' });
    }
    this.sync();
  }

  tick(dt) {
    if (this.state !== 'playing' || !this.game) return;
    if (this.paused && !this.paused.skip) return;
    const g = this.game;
    g.update(dt, {});
    for (const e of g.drainEvents()) {
      if (e.type === 'hint') continue;            // clients show hints themselves
      if (e.type === 'toast' && e.pid) {           // personal messages
        const m = this.memberByPid(e.pid);
        if (m) send(m.ws, { type: 'toast', text: e.text });
        continue;
      }
      this.events.push(e);
    }
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAP_HZ - 1e-4) {
      this.snapAcc = 0;
      const msg = JSON.stringify({ type: 'snap', s: encodeSnapshot(g), ev: this.events });
      this.events = [];
      for (const m of this.members) if (m.connected && m.pid && m.ws.readyState === 1) m.ws.send(msg);
    }
    if (g.completed) {
      this.state = 'victory';
      const time = now() - this.levelStart;
      this.broadcast({
        type: 'complete', level: this.level.id, name: this.level.name, time, final: this.level.id === MP_LEVEL_LIST.length,
        players: this.members.filter((m) => m.pid).map((m) => ({ name: m.name, outfit: m.outfit })),
        next: levelById(this.level.id + 1) ? this.level.id + 1 : null,
      });
      this.sync();
    }
  }

  // ------------------------------------------------------------ player messages
  input(member, msg) {
    const g = this.game;
    if (!g || !member.pid || this.state !== 'playing') return;
    const pl = g.players.get(member.pid);
    const p = vec(msg.p);
    if (!pl || !p || pl.away) return;
    const [x0, z0, x1, z1] = g.data.bounds || [-200, -200, 200, 200];
    if (p.x < x0 - 6 || p.x > x1 + 6 || p.z < z0 - 6 || p.z > z1 + 6 || p.y < -60 || p.y > 80) return;
    pl.body.pos.x = p.x; pl.body.pos.y = p.y; pl.body.pos.z = p.z;
    pl.body.grounded = !!msg.g;
    pl.jumping = !!msg.j;
    if (num(msg.yaw)) pl.yaw = msg.yaw;
    if (num(msg.pitch)) pl.pitch = msg.pitch;
    if (pl.hold) {
      const h = vec(msg.h);
      if (h && Math.hypot(h.x - p.x, h.z - p.z) < 4 && Math.abs(h.y - p.y) < 4) pl.hold.clientPos = h;
    }
  }

  action(member, msg) {
    const g = this.game;
    if (!g || !member.pid || this.state !== 'playing' || (this.paused && !this.paused.skip)) return;
    const pid = member.pid;
    const pl = g.players.get(pid);
    if (!pl || pl.away) return;
    const head = g.playerHead(pid);
    switch (msg.a) {
      case 'interact':
      case 'rotate': {
        const o = vec(msg.o), d = vec(msg.d);
        if (!o || !d || Math.hypot(o.x - head.x, o.y - head.y, o.z - head.z) > 1.5) return;
        const hit = g.pick(o, unit(d), undefined, pid);
        if (!hit || hit.t > PLAYER.reach + 0.6) return;
        if (msg.a === 'rotate') { if (hit.kind === 'mirror') g.rotateMirror(hit.obj, msg.dir > 0 ? 1 : -1); return; }
        if (hit.kind === 'button') g.pressButton(hit.obj);
        else if (hit.kind === 'mirror') g.rotateMirror(hit.obj, 1);
        else if (hit.kind === 'pod') g.spawnClone(hit.obj, pid);
        return;
      }
      case 'grab': {
        const body = bodyFromKey(g, msg.key);
        if (!body) return;
        const c = body.pos;
        if (Math.hypot(c.x - head.x, c.y + body.h / 2 - head.y, c.z - head.z) > PLAYER.reach + 2) return;
        if (!g.grab(body, msg.hand === 'left' || msg.hand === 'right' ? msg.hand : 'desktop', pid)) send(member.ws, { type: 'grab-denied', key: msg.key });
        return;
      }
      case 'release': {
        if (!pl.hold) return;
        const p = vec(msg.p);
        const b = pl.hold.body;
        if (p && Math.hypot(p.x - pl.body.pos.x, p.z - pl.body.pos.z) < 4) { b.pos.x = p.x; b.pos.y = p.y; b.pos.z = p.z; }
        if (num(msg.q) && b.kind === 'block' && (msg.q & 1) !== (b.quarter & 1)) { const t = b.hx; b.hx = b.hz; b.hz = t; b.quarter = msg.q & 3; }
        g.release(pid, true);
        return;
      }
      case 'press': case 'rotateMirror': {
        // VR hands and twists act on a specific switch or mirror; it must be within reach.
        const obj = msg.a === 'press' ? g.buttons[msg.i] : g.mirrors[msg.i];
        if (!obj) return;
        const c = msg.a === 'press' ? obj : obj.body.pos;
        if (Math.hypot(c.x - head.x, (c.y ?? 0) + (msg.a === 'press' ? 0 : 0.7) - head.y, c.z - head.z) > PLAYER.reach + 1.6) return;
        if (msg.a === 'press') g.pressButton(obj); else g.rotateMirror(obj, msg.dir > 0 ? 1 : -1);
        return;
      }
      case 'rotateHeld': if (pl.hold) g.rotateHeld(msg.dir > 0 ? 1 : -1, pid); return;
      case 'clone': {
        const pod = Number.isInteger(msg.pod) ? g.pods[msg.pod] : g.nearestPod(pid);
        g.spawnClone(pod, pid);
        return;
      }
      case 'resetClone': g.resetClone(pid); return;
      case 'removeClone': g.removeClone(false, pid); return;
      default:
    }
  }
}

export class LobbyManager {
  constructor() {
    this.lobbies = new Map();
    this.sessions = new Map();       // session -> { lobby, member }
    this.clients = new Set();
    this.last = now();
    this.timer = setInterval(() => this.tick(), 1000 / SIM_HZ);
    this.timer.unref?.();
  }

  stats() {
    return { lobbies: this.lobbies.size, players: [...this.lobbies.values()].reduce((n, l) => n + l.connected.length, 0) };
  }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.lobbies.has(c)) return c;
    }
  }

  tick() {
    const t = now();
    const dt = Math.min(0.1, t - this.last);
    this.last = t;
    for (const lobby of [...this.lobbies.values()]) {
      lobby.tick(dt);
      // Drop members whose reconnect window ran out.
      for (const m of [...lobby.members]) {
        if (!m.connected && t - m.leftAt > RECONNECT_SECONDS) lobby.remove(m, 'did not come back');
      }
    }
  }

  connect(ws) {
    const client = { ws, member: null, lobby: null, hello: false };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    this.clients.add(client);
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      try { this.handle(client, msg); } catch (e) { console.error('message error', msg.type, e); }
    });
    ws.on('close', () => this.disconnect(client));
    ws.on('error', () => {});
  }

  disconnect(client) {
    this.clients.delete(client);
    const m = client.member;
    if (!m || m.ws !== client.ws) return;
    m.connected = false;
    m.ws = null;
    m.leftAt = now();
    const lobby = client.lobby;
    if (!lobby) return;
    if (lobby.game && m.pid) {
      const pl = lobby.game.players.get(m.pid);
      if (pl) { if (pl.hold) lobby.game.release(pl.id, true); pl.away = true; pl.body.removed = true; }
    }
    if (lobby.host === m && lobby.connected.length) lobby.host = lobby.connected[0];
    lobby.system(`${m.name} lost connection. Waiting for them to reconnect...`);
    lobby.checkPause();
    lobby.sync();
  }

  attach(client, lobby, member) {
    if (member.ws && member.ws !== client.ws) { send(member.ws, { type: 'kicked', reason: 'You connected from another tab.' }); try { member.ws.close(); } catch { /* */ } }
    member.ws = client.ws;
    member.connected = true;
    client.member = member;
    client.lobby = lobby;
    this.sessions.set(member.session, { lobby, member });
  }

  handle(client, msg) {
    const { ws } = client;
    if (msg.type === 'ping') { send(ws, { type: 'pong', t: msg.t }); return; }
    if (msg.type === 'hello') {
      client.hello = true;
      client.name = sanitizeName(msg.name);
      client.outfit = sanitizeOutfit(msg.outfit);
      const prev = typeof msg.session === 'string' ? this.sessions.get(msg.session) : null;
      if (prev && this.lobbies.get(prev.lobby.code) === prev.lobby) {
        // Reconnect into the same lobby (and the same chamber, if it is still running).
        const { lobby, member } = prev;
        this.attach(client, lobby, member);
        send(ws, { type: 'welcome', session: member.session, rejoined: true });
        lobby.system(`${member.name} reconnected.`);
        if (lobby.game && member.pid && lobby.state !== 'lobby') {
          const pl = lobby.game.players.get(member.pid);
          if (pl) { pl.away = false; pl.body.removed = false; }
          const roster = lobby.members.filter((m) => m.pid).map((m) => ({ pid: m.pid, uid: m.uid, name: m.name, outfit: m.outfit }));
          send(ws, { type: 'start', level: lobby.level.id, players: roster, you: member.pid, count: lobby.levelPlayers, rejoin: true, pos: pl ? [pl.body.pos.x, pl.body.pos.y, pl.body.pos.z, pl.yaw] : null });
        }
        lobby.checkPause();
        lobby.sync();
        return;
      }
      send(ws, { type: 'welcome', session: randomUUID(), rejoined: false });
      return;
    }
    if (!client.hello) return;

    if (msg.type === 'create') {
      this.leave(client);
      const lobby = new Lobby(this, this.newCode());
      this.lobbies.set(lobby.code, lobby);
      const member = new Member(typeof msg.session === 'string' && msg.session.length >= 16 ? msg.session : randomUUID(), client.name, client.outfit);
      this.attach(client, lobby, member);
      lobby.add(member);
      return;
    }
    if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const lobby = this.lobbies.get(code);
      if (!lobby) { send(ws, { type: 'error', where: 'join', text: `No lobby with code ${code || '(empty)'}. Check the code and try again.` }); return; }
      if (client.lobby === lobby) { lobby.sync(); return; }
      if (lobby.members.length >= MAX_PLAYERS) { send(ws, { type: 'error', where: 'join', text: 'That lobby is full (4 players).' }); return; }
      if (lobby.state !== 'lobby') { send(ws, { type: 'error', where: 'join', text: 'That team is in the middle of a chamber. Ask them to return to the lobby, then join.' }); return; }
      this.leave(client);
      const member = new Member(typeof msg.session === 'string' && msg.session.length >= 16 ? msg.session : randomUUID(), client.name, client.outfit);
      this.attach(client, lobby, member);
      lobby.add(member);
      return;
    }

    if (msg.type === 'profile' && !client.member) {
      client.name = sanitizeName(msg.name);
      client.outfit = sanitizeOutfit(msg.outfit);
      return;
    }
    const lobby = client.lobby, member = client.member;
    if (!lobby || !member) return;
    switch (msg.type) {
      case 'leave': this.leave(client); send(ws, { type: 'left' }); return;
      case 'ready': member.ready = !!msg.ready; lobby.sync(); return;
      case 'profile':
        member.name = client.name = sanitizeName(msg.name);
        member.outfit = client.outfit = sanitizeOutfit(msg.outfit);
        lobby.sync();
        if (lobby.game) lobby.broadcast({ type: 'profile', pid: member.pid, name: member.name, outfit: member.outfit });
        return;
      case 'vote': member.vote = levelById(msg.level) ? Number(msg.level) : null; lobby.sync(); return;
      case 'start': {
        if (lobby.host !== member) { send(ws, { type: 'error', where: 'start', text: 'Only the host can start.' }); return; }
        if (lobby.state === 'lobby') {
          const notReady = lobby.connected.filter((m) => m !== member && !m.ready);
          if (notReady.length) { send(ws, { type: 'error', where: 'start', text: `Waiting for ${notReady.map((m) => m.name).join(', ')} to be ready.` }); return; }
        }
        const err = lobby.start(msg.level);
        if (err) send(ws, { type: 'error', where: 'start', text: err });
        return;
      }
      case 'host': {
        if (lobby.host !== member) return;
        if (msg.do === 'lobby') lobby.toLobby();
        else if (msg.do === 'restart' && lobby.level) { const err = lobby.start(lobby.level.id); if (err) send(ws, { type: 'error', where: 'start', text: err }); }
        else if (msg.do === 'continue' && lobby.paused) { lobby.paused.skip = true; lobby.broadcast({ type: 'resumed', without: lobby.paused.names }); lobby.sync(); }
        return;
      }
      case 'input': lobby.input(member, msg); return;
      case 'action': lobby.action(member, msg); return;
      case 'chat': case 'quick': {
        const t = now();
        member.chatTimes = member.chatTimes.filter((x) => t - x < 5);
        if (member.chatTimes.length >= 6) { send(ws, { type: 'toast', text: 'Slow down a little.' }); return; }
        member.chatTimes.push(t);
        let text;
        if (msg.type === 'quick') { text = QUICK_CHAT[msg.i]; if (!text) return; }
        else text = String(msg.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
        if (!text) return;
        lobby.broadcast({ type: 'chat', from: member.name, uid: member.uid, pid: member.pid, text, quick: msg.type === 'quick' });
        return;
      }
      case 'voice': member.voice = !!msg.on; lobby.sync(); lobby.broadcast({ type: 'voice', uid: member.uid, on: member.voice }, member); return;
      case 'rtc': {
        const to = lobby.members.find((m) => m.uid === msg.to);
        if (to && to.connected && msg.data && JSON.stringify(msg.data).length < 20000) send(to.ws, { type: 'rtc', from: member.uid, data: msg.data });
        return;
      }
      default:
    }
  }

  leave(client) {
    const { lobby, member } = client;
    if (lobby && member) lobby.remove(member, 'left the lobby');
    client.lobby = null;
    client.member = null;
  }
}
