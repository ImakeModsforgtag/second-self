// Co-op multiplayer: menus, lobby, chat, voice and the networked game loop.
// The server runs the authoritative chamber. This client moves its own player
// (and what it carries) locally for instant response, sends that to the server
// 20 times a second, and copies everything else from the server's snapshots.

import { NetClient, loadProfile, saveProfile } from '../net/client.js';
import { Voice } from '../net/voice.js';
import { applySnapshot, bodyKey, QUICK_CHAT, PLAYER_COLORS, MAX_PLAYERS, INPUT_HZ, sanitizeOutfit, sanitizeName } from '../net/protocol.js';
import { MP_LEVEL_LIST } from './levels.js';
import { presetOutfit, PRESETS } from './outfits.js';
import { OutfitEditor } from '../ui/outfit.js';
import { PLAYER } from '../config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Multiplayer {
  constructor(app) {
    this.app = app;
    this.profile = loadProfile();
    if (!this.profile.outfit) this.profile.outfit = presetOutfit(this.profile.preset || 0);
    this.profile.outfit = sanitizeOutfit(this.profile.outfit);
    saveProfile(this.profile);
    this.net = new NetClient(this.profile);
    this.voice = new Voice(this.net);
    this.outfitEditor = new OutfitEditor(this);
    this.lobby = null;          // last lobby state from the server
    this.myUid = null;
    this.inGame = false;
    this.roster = new Map();    // pid -> { name, outfit, color, uid }
    this.myPid = null;
    this.snap = null;
    this.serverEvents = [];
    this.sendAcc = 0;
    this.chatLines = [];
    this.vrCode = '';
    this.pausedInfo = null;
    this._wireNet();
    this._wireDom();
  }

  // ------------------------------------------------------------ networking
  _wireNet() {
    const n = this.net;
    n.on('status', (s) => this._status(s));
    n.on('welcome', (m) => {
      if (!m.rejoined && (this.lobby || this.inGame)) {
        // The server no longer knows us (it restarted or we were away too long).
        const wasGame = this.inGame;
        this.lobby = null;
        if (wasGame) this._endGame();
        this.app.menu.toast('Your lobby is gone (the server restarted or you were away too long).', 5);
        this.showMenu();
      }
    });
    n.on('lobby', (m) => {
      this.lobby = m;
      this.myUid = m.you;
      this.voice.sync(m.players, m.you);
      for (const p of m.players) if (p.pid && this.roster.has(p.pid)) { const r = this.roster.get(p.pid); r.name = p.name; r.outfit = p.outfit; }
      if (m.paused) this.pausedInfo = { names: m.paused.names, until: performance.now() / 1000 + m.paused.deadline };
      else this.pausedInfo = null;
      this._renderLobby();
      this._renderNetPause();
      if (this.app.inXR && this.app.vrPanel.isOpen && this.app.vrPanel.page.startsWith('mp')) this.app.vrPanel.draw();
      if (!this.inGame && m.state === 'lobby' && this.app.menu.current !== 'lobby' && this.app.menu.current !== 'outfit' && this.app.menu.current !== 'settings' && this.wantLobbyScreen) {
        this.wantLobbyScreen = false;
        this.showLobby();
      }
    });
    n.on('error', (m) => {
      this.app.audio.play('toast');
      this._note(m.text);
      this.app.menu.toast(m.text, 4);
      if (this.app.inXR) this.app.vrPanel.showHint(m.text);
    });
    n.on('start', (m) => this._start(m));
    n.on('snap', (m) => { this.snap = m.s; if (m.ev && m.ev.length) this.serverEvents.push(...m.ev); });
    n.on('toast', (m) => this._personal(m.text));
    n.on('grab-denied', () => this._personal('Someone else has that.'));
    n.on('chat', (m) => this._chat(m));
    n.on('profile', (m) => { const r = this.roster.get(m.pid); if (r) { r.name = m.name; r.outfit = m.outfit; } });
    n.on('paused', (m) => {
      this.pausedInfo = { names: m.names, until: performance.now() / 1000 + m.seconds };
      this._renderNetPause();
      const t = `${m.names.join(', ')} lost connection. The chamber is paused while they reconnect.`;
      if (this.app.inXR) this.app.vrPanel.showHint(t); else this.app.menu.hint(t, 6);
    });
    n.on('resumed', (m) => {
      this.pausedInfo = null;
      this._renderNetPause();
      const t = m.without ? `Continuing without ${m.without.join(', ')}.` : 'Everyone is back. Go!';
      if (this.app.inXR) this.app.vrPanel.showHint(t); else this.app.menu.toast(t, 3);
    });
    n.on('complete', (m) => this._victory(m));
    n.on('to-lobby', () => { this._endGame(); this.showLobby(); });
    n.on('left', () => { this.lobby = null; });
    n.on('kicked', (m) => { this.net.disconnect(); this._endGame(); this.lobby = null; this.app.toMainMenu(); this.app.menu.toast(m.reason, 5); });
    n.on('voice', () => {});
  }

  _status(s) {
    const text = {
      connecting: 'Connecting to the co-op server...',
      waking: 'Waking up the server. On a free Render plan this can take up to a minute.',
      online: this.net.rtt ? `Connected (${Math.round(this.net.rtt)} ms)` : 'Connected',
      offline: this.net.wanted ? 'Connection lost. Reconnecting...' : 'Offline',
    }[s.status] || '';
    this._note(text);
    const banner = $('netbanner');
    const show = this.inGame && s.status !== 'online';
    banner.textContent = show ? text : '';
    banner.classList.toggle('show', show);
  }

  _note(text) {
    for (const id of ['mp-status', 'lobby-status']) { const el = $(id); if (el) el.textContent = text; }
  }

  // ------------------------------------------------------------ profile
  setName(name) {
    this.profile.name = sanitizeName(name);
    saveProfile(this.profile);
    this.net.send({ type: 'profile', name: this.profile.name, outfit: this.profile.outfit });
  }
  setOutfit(outfit) {
    this.profile.outfit = outfit;
    saveProfile(this.profile);
    this.net.send({ type: 'profile', name: this.profile.name, outfit: this.profile.outfit });
  }

  // ------------------------------------------------------------ DOM menus
  _wireDom() {
    const name = $('mp-name');
    name.value = this.profile.name;
    name.addEventListener('change', () => { this.setName(name.value); name.value = this.profile.name; });
    const code = $('mp-code');
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.action('mp-join'); });
    const lc = $('lobby-chatin');
    lc.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.sendChat(lc.value); lc.value = ''; }
      e.stopPropagation();
    });
    const ci = $('chatinput');
    ci.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.sendChat(ci.value); this.closeChat(); }
      else if (e.key === 'Escape') this.closeChat();
    });
    $('mppause-quick').innerHTML = QUICK_CHAT.map((q, i) => `<button data-quick="${i}">${i + 1}. ${esc(q)}</button>`).join('');
    $('mppause-quick').querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.quick(Number(b.dataset.quick)); }));
    // Keyboard: chat, quick chat, player list
    window.addEventListener('keydown', (e) => {
      if (!this.inGame || this.app.inXR) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      if (this.app.state === 'playing') {
        if ((e.code === 'KeyT' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); this.openChat(); return; }
        const d = /^Digit([1-7])$/.exec(e.code);
        if (d && !e.repeat) { this.quick(Number(d[1]) - 1); return; }
        if (e.code === 'KeyV' && !e.repeat && this.voice.on) { this.voice.setMuted(!this.voice.muted); this.app.menu.toast(this.voice.muted ? 'Microphone muted' : 'Microphone on'); return; }
      }
      if (e.code === 'Tab') { e.preventDefault(); this._renderPlayerList(); $('playerlist').classList.add('show'); }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Tab') $('playerlist').classList.remove('show'); });
    // Host buttons on the reconnect overlay
    $('netpause').querySelectorAll('button[data-host]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation(); this.net.send({ type: 'host', do: b.dataset.host });
    }));
  }

  /** Called by Menu for data-action buttons it does not know. */
  action(a) {
    const app = this.app;
    switch (a) {
      case 'mp': this.showMenu(); break;
      case 'mp-create':
        this.setName($('mp-name').value);
        this.net.connect();
        this.wantLobbyScreen = true;
        this.net.send({ type: 'create', session: this.profile.session }, { queue: true });
        break;
      case 'mp-join': {
        const code = $('mp-code').value.trim().toUpperCase();
        if (code.length !== 6) { this._note('Lobby codes have 6 letters and numbers.'); return; }
        this.setName($('mp-name').value);
        this.net.connect();
        this.wantLobbyScreen = true;
        this.net.send({ type: 'join', code, session: this.profile.session }, { queue: true });
        break;
      }
      case 'mp-outfit': app.menu.show('outfit', { push: true }); this.outfitEditor.open(); break;
      case 'mp-outfit-done': this.outfitEditor.close(); app.menu.back(); this._renderLobby(); break;
      case 'mp-copy': {
        const c = this.lobby && this.lobby.code;
        if (c && navigator.clipboard) navigator.clipboard.writeText(c).then(() => app.menu.toast('Code copied'), () => {});
        break;
      }
      case 'mp-ready': this.net.send({ type: 'ready', ready: !this.me()?.ready }); break;
      case 'mp-start': this.startChosen(); break;
      case 'mp-voice': this.toggleVoice(); break;
      case 'mp-leave': this.leave(); break;
      case 'mp-restart': this.net.send({ type: 'host', do: 'restart' }); break;
      case 'mp-tolobby': this.net.send({ type: 'host', do: 'lobby' }); break;
      case 'mp-next': if (this.nextLevel) this.net.send({ type: 'start', level: this.nextLevel }); break;
      case 'mp-remove-clone': if (app.game) app.game.removeClone(); app.resume(); break;
      default: break;
    }
  }

  showMenu() {
    $('mp-name').value = this.profile.name;
    if (this.lobby && !this.inGame) { this.showLobby(); return; }
    this.app.menu.show('mp', { push: this.app.menu.current === 'main' });
    this.net.connect();
  }

  showLobby() {
    if (this.app.inXR) { this.app.vrPanel.open('mplobby', this.app.camera); return; }
    this.app.menu.show('lobby');
    this._renderLobby();
  }

  me() { return this.lobby ? this.lobby.players.find((p) => p.uid === this.myUid) : null; }
  isHost() { const m = this.me(); return !!(m && m.host); }

  chosenLevel() {
    const L = this.lobby;
    if (!L) return 1;
    const votes = new Map();
    for (const p of L.players) if (p.vote) votes.set(p.vote, (votes.get(p.vote) || 0) + 1);
    let best = null, bn = 0;
    const mine = this.me() && this.me().vote;
    for (const [lv, c] of votes) if (c > bn || (c === bn && lv === mine)) { best = lv; bn = c; }
    return best || mine || 1;
  }

  startChosen() { this.net.send({ type: 'start', level: this.chosenLevel() }); }

  leave() {
    this.net.send({ type: 'leave' });
    if (this.voice.on) this.voice.disable();
    this.lobby = null;
    const wasGame = this.inGame;
    this._endGame();
    if (wasGame || this.app.state !== 'menu') this.app.toMainMenu();
    else if (this.app.inXR) this.app.vrPanel.open('mp', this.app.camera);
    else this.app.menu.show('mp');
  }

  async toggleVoice() {
    try {
      if (this.voice.on) this.voice.disable();
      else await this.voice.enable();
      this.app.menu.toast(this.voice.on ? 'Voice chat on (V mutes)' : 'Voice chat off');
    } catch (e) {
      this.app.menu.toast(e.message && e.message.includes('denied') ? 'Microphone permission was denied.' : (e.message || 'Voice chat could not start.'), 4);
    }
    this._renderLobby();
    if (this.app.inXR && this.app.vrPanel.isOpen) this.app.vrPanel.draw();
  }

  _renderLobby() {
    const L = this.lobby;
    if (!L) return;
    $('lobby-code').textContent = L.code;
    const connected = L.players.filter((p) => p.connected).length;
    $('lobby-count').textContent = `${L.players.length} / ${MAX_PLAYERS}`;
    $('lobby-players').innerHTML = L.players.map((p, i) => {
      const o = p.outfit;
      const status = !p.connected ? '<span class="st warn">Reconnecting...</span>' : p.host ? '<span class="st host">Host</span>' : p.ready ? '<span class="st ok">Ready</span>' : '<span class="st">Not ready</span>';
      return `<div class="pl"><i class="dot" style="background:${PLAYER_COLORS[i % 4]}"></i>` +
        `<span class="sw"><b style="background:${o.shirt}"></b><b style="background:${o.shorts}"></b><b style="background:${o.shoes}"></b>${o.hat !== 'none' ? `<b style="background:${o.hatColor}" title="hat"></b>` : ''}</span>` +
        `<span class="nm">${esc(p.name)}${p.uid === this.myUid ? ' (you)' : ''}</span>${p.voice ? '<span class="st">Voice</span>' : ''}${status}</div>`;
    }).join('') + (L.players.length < MAX_PLAYERS ? `<div class="pl empty">Share the code <b>${L.code}</b> to invite more players</div>` : '');
    const chosen = this.chosenLevel();
    const box = $('lobby-levels');
    box.innerHTML = '';
    for (const lv of MP_LEVEL_LIST) {
      const n = L.players.filter((p) => p.vote === lv.id).length;
      const b = document.createElement('button');
      b.className = 'lv' + (lv.id === chosen ? ' chosen' : '') + (this.me() && this.me().vote === lv.id ? ' mine' : '');
      b.innerHTML = `<span class="num">CO-OP ${lv.id}</span> <span class="name">${esc(lv.name)}</span><span class="votes">${'&#9679;'.repeat(n)}</span>`;
      b.title = lv.blurb || '';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.net.send({ type: 'vote', level: lv.id }); });
      box.appendChild(b);
    }
    const me = this.me();
    const host = this.isHost();
    $('btn-ready').classList.toggle('hidden', host);
    $('btn-ready').textContent = me && me.ready ? 'Not ready' : 'Ready';
    $('btn-start').classList.toggle('hidden', !host);
    const others = L.players.filter((p) => !p.host && p.connected);
    const allReady = others.every((p) => p.ready);
    $('btn-start').disabled = connected < 2 || !allReady;
    $('btn-start').textContent = connected < 2 ? 'Waiting for players' : !allReady ? 'Waiting for ready' : `Start: ${MP_LEVEL_LIST[chosen - 1].name}`;
    $('btn-voice').textContent = `Voice: ${this.voice.on ? 'on' : 'off'}`;
    const ll = $('lobby-chatlog');
    ll.innerHTML = this.chatLines.slice(-30).map((l) => l.html).join('');
    ll.scrollTop = ll.scrollHeight;
  }

  _renderPlayerList() {
    const L = this.lobby;
    if (!L) return;
    $('playerlist').innerHTML = '<h3>Team</h3>' + L.players.filter((p) => p.pid).map((p) => {
      const r = this.roster.get(p.pid);
      return `<div class="pl"><i class="dot" style="background:${r ? r.color : '#888'}"></i><span class="nm">${esc(p.name)}${p.uid === this.myUid ? ' (you)' : ''}</span>` +
        `${p.connected ? '' : '<span class="st warn">Reconnecting</span>'}${p.host ? '<span class="st host">Host</span>' : ''}${p.voice ? '<span class="st">Voice</span>' : ''}</div>`;
    }).join('') + `<p class="note">Built for ${this.levelCount || '?'} players. Ping ${Math.round(this.net.rtt)} ms</p>`;
    $('mppause-players').innerHTML = $('playerlist').innerHTML;
    $('mppause-host').classList.toggle('hidden', !this.isHost());
  }

  _renderNetPause() {
    const el = $('netpause');
    const show = this.inGame && !!this.pausedInfo;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const left = Math.max(0, Math.round(this.pausedInfo.until - performance.now() / 1000));
    $('netpause-text').textContent = `Waiting for ${this.pausedInfo.names.join(', ')} to reconnect (${left}s).`;
    el.querySelector('.hostonly').classList.toggle('hidden', !this.isHost());
    el.querySelector('.guestonly').classList.toggle('hidden', this.isHost());
  }

  // ------------------------------------------------------------ chat
  sendChat(text) {
    text = String(text || '').trim();
    if (text) this.net.send({ type: 'chat', text });
  }
  quick(i) {
    if (QUICK_CHAT[i]) this.net.send({ type: 'quick', i });
  }
  openChat() {
    const app = this.app;
    app.state = 'chat';
    app.input.keys.clear();
    app.input.unlock();
    const ci = $('chatinput');
    ci.classList.remove('hidden');
    ci.value = '';
    setTimeout(() => ci.focus(), 10);
  }
  closeChat() {
    const ci = $('chatinput');
    ci.blur();
    ci.classList.add('hidden');
    if (this.app.state === 'chat') { this.app.state = 'playing'; this.app.input.lock(); }
  }
  _chat(m) {
    const color = m.pid && this.roster.get(m.pid) ? this.roster.get(m.pid).color : '#9fb3c8';
    const html = m.system
      ? `<div class="cl sys">${esc(m.text)}</div>`
      : `<div class="cl"><b style="color:${color}">${esc(m.from)}:</b> ${m.quick ? `<i>${esc(m.text)}</i>` : esc(m.text)}</div>`;
    this.chatLines.push({ html, t: performance.now() });
    if (this.chatLines.length > 60) this.chatLines.shift();
    this._renderChatHud();
    if (this.app.menu.current === 'lobby') this._renderLobby();
    if (!m.system) this.app.audio.play(m.quick ? 'button' : 'toast');
    if (this.app.inXR) this.app.vrPanel.showHint(m.system ? m.text : `${m.from}: ${m.text}`);
  }
  _renderChatHud() {
    const now = performance.now();
    const el = $('chatlog');
    el.innerHTML = this.chatLines.filter((l) => now - l.t < 14000 || this.app.state === 'chat').slice(-6).map((l) => l.html).join('');
  }
  _personal(text) {
    this.app.audio.play('toast');
    if (this.app.inXR) this.app.vrPanel.showHint(text); else this.app.menu.toast(text);
  }

  // ------------------------------------------------------------ game
  _start(m) {
    this.roster = new Map(m.players.map((p, i) => [p.pid, { name: p.name, outfit: sanitizeOutfit(p.outfit), color: PLAYER_COLORS[i % 4], uid: p.uid }]));
    this.myPid = m.you;
    this.levelCount = m.count;
    this.levelId = m.level;
    this.snap = null;
    this.serverEvents = [];
    this.inGame = true;
    this.outfitEditor.close();
    const level = MP_LEVEL_LIST.find((l) => l.id === m.level);
    this.app.startNetLevel(level, m.players.map((p) => p.pid), m.you, this.roster, m.count, m.pos);
    this._renderNetPause();
    this._status({ status: this.net.status });
  }

  _endGame() {
    this.inGame = false;
    this.myPid = null;
    this.pausedInfo = null;
    $('netpause').classList.add('hidden');
    $('netbanner').classList.remove('show');
    $('chatinput').classList.add('hidden');
    if (this.app.game && this.app.game.netClient) this.app.toBackdrop();
  }

  _victory(m) {
    const app = this.app;
    this.nextLevel = m.next;
    const mins = Math.floor(m.time / 60), secs = Math.floor(m.time % 60);
    this.lastStats = `Time ${mins}:${String(secs).padStart(2, '0')}   Team of ${m.players.length}`;
    this.lastWin = m;
    app.state = m.final ? 'final' : 'complete';
    app.audio.play('complete');
    if (app.inXR) { app.vrPanel.open('mpwin', app.camera); return; }
    app.input.unlock();
    $('mpwin-title').textContent = m.final ? 'The Final Collaboration is complete!' : `Co-op ${m.level}: ${m.name} complete`;
    $('mpwin-stats').textContent = this.lastStats;
    $('mpwin-players').innerHTML = m.players.map((p) => `<div class="pl"><span class="sw"><b style="background:${p.outfit.shirt}"></b><b style="background:${p.outfit.shorts}"></b></span><span class="nm">${esc(p.name)}</span></div>`).join('');
    const host = this.isHost();
    $('mpwin-host').classList.toggle('hidden', !host);
    $('mpwin-wait').classList.toggle('hidden', host);
    $('btn-mpnext').classList.toggle('hidden', !m.next);
    app.menu.show('mpwin');
  }

  /** Route the game's actions to the server (works for desktop and VR alike). */
  installWrappers(g) {
    const net = this.net;
    const orig = {};
    for (const k of ['grab', 'release', 'rotateHeld']) orig[k] = g[k].bind(g);
    const act = (m) => net.send({ type: 'action', ...m });
    const near = (x, y, z) => { const h = g.playerHead(); return Math.hypot(x - h.x, y - h.y, z - h.z) <= PLAYER.reach + 1.2; };
    g.pressButton = (b) => { if (near(b.x, b.y, b.z)) act({ a: 'press', i: g.buttons.indexOf(b) }); };
    g.rotateMirror = (m, steps) => act({ a: 'rotateMirror', i: g.mirrors.indexOf(m), dir: steps > 0 ? 1 : -1 });
    g.spawnClone = (pod) => { act({ a: 'clone', pod: pod ? g.pods.indexOf(pod) : g.pods.indexOf(g.nearestPod()) }); return true; };
    g.resetClone = () => { act({ a: 'resetClone' }); return true; };
    g.removeClone = () => act({ a: 'removeClone' });
    g.interact = (o, d) => {
      const hit = g.pick(o, d);
      if (!hit || hit.t > PLAYER.reach + 0.3) return false;
      if (hit.kind === 'block') return g.grab(hit.obj);
      if (hit.kind === 'button') g.pressButton(hit.obj);
      else if (hit.kind === 'mirror') g.rotateMirror(hit.obj, 1);
      else if (hit.kind === 'pod') g.spawnClone(hit.obj);
      return true;
    };
    g.grab = (body, hand = 'desktop') => {
      if (!orig.grab(body, hand)) return false;
      g.player.hold.since = g.time;
      act({ a: 'grab', key: bodyKey(g, body), hand: hand === 0 ? 'left' : hand === 1 ? 'right' : 'desktop' });
      return true;
    };
    g.release = (pid, force) => {
      const h = g.player.hold;
      if (!h) return false;
      const body = h.body;
      if (!orig.release(undefined, force)) return false;
      act({ a: 'release', p: [body.pos.x, body.pos.y, body.pos.z], q: body.quarter });
      return true;
    };
    g.rotateHeld = (dir) => {
      const h = g.player.hold;
      if (!h) return;
      if (h.body.kind === 'mirror') { g.rotateMirror(h.body.mirror, dir); return; }
      orig.rotateHeld(dir);
      act({ a: 'rotateHeld', dir });
    };
  }

  /** One frame of the networked chamber. Returns the events to play. */
  step(dt, input) {
    const g = this.app.game;
    if (this.snap) { applySnapshot(g, this.snap, g.time); this.snap = null; }
    const me = g.player;
    if (g.finalSeq) {
      const e = g.finalSeq.exit;
      me.body.pos.y = e.y + (e.lift || 0);
      me.body.vy = 0;
      g.time += dt;
      g._traceLasers(false);
    } else g.stepLocal(dt, input);
    me.jumping = !me.body.grounded;
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / INPUT_HZ) {
      this.sendAcc = 0;
      const p = me.body.pos;
      const h = me.hold ? me.hold.body.pos : null;
      this.net.send({ type: 'input', p: [p.x, p.y, p.z], yaw: me.yaw, pitch: me.pitch, g: me.body.grounded, j: !me.body.grounded, h: h ? [h.x, h.y, h.z] : null });
    }
    const out = [];
    for (const e of g.drainEvents()) {
      if (e.type === 'auto-release') { g.release(undefined, true); continue; }
      if (e.type === 'net-drop') { this._personal('Someone else has that.'); continue; }
      out.push(e);
    }
    const mine = new Set(['jump', 'step', 'land', 'pickup', 'drop', 'rotate-held', 'respawn']);
    for (const e of this.serverEvents) {
      if (e.type === 'clone-spawn' || e.type === 'clone-remove' || e.type === 'complete' || e.type === 'toast' && e.pid) continue;
      if (e.pid && e.pid === this.myPid && mine.has(e.type)) continue;
      if (e.type === 'step' || e.type === 'land' || e.type === 'jump' || e.type === 'respawn') continue; // teammates' footsteps are not positional
      out.push(e);
    }
    this.serverEvents = [];
    if (this.pausedInfo) this._renderNetPause();
    this._renderChatHud();
    return out;
  }

  // ------------------------------------------------------------ VR panel pages
  vrTitle(page) {
    return {
      mp: 'CO-OP', mpjoin: 'ENTER LOBBY CODE', mplobby: this.lobby ? `LOBBY ${this.lobby.code}` : 'LOBBY',
      mppause: 'TEAM MENU', mpwin: this.lastWin && this.lastWin.final ? 'THE FINAL COLLABORATION IS COMPLETE' : 'TEAM VICTORY',
    }[page] || '';
  }

  vrSubtitle(page) {
    if (page === 'mp') return `You are ${this.profile.name}. ${this.net.status === 'online' ? 'Connected.' : 'Connecting...'}`;
    if (page === 'mpjoin') return `Code: ${this.vrCode.padEnd(6, '_').split('').join(' ')}`;
    if (page === 'mplobby' && this.lobby) return this.lobby.players.map((p) => `${p.name}${p.host ? ' (host)' : p.connected ? (p.ready ? ' (ready)' : '') : ' (reconnecting)'}`).join('   ');
    if (page === 'mppause') return this.pausedInfo ? `Waiting for ${this.pausedInfo.names.join(', ')} to reconnect` : 'The chamber keeps running for your team.';
    if (page === 'mpwin') return this.lastStats || '';
    return '';
  }

  vrLayout(page, add, W) {
    const cx = W / 2 - 210;
    if (page === 'mp') {
      add('Create lobby', 'mp:create', cx, 170);
      add('Join with a code', 'mp:joinpage', cx, 255);
      add(`Outfit: ${PRESETS[this.profile.preset || 0].name}`, 'mp:preset', cx, 340);
      add('Back', 'mp:main', cx, 425);
    } else if (page === 'mpjoin') {
      [...CODE_CHARS].forEach((ch, i) => add(ch, 'mp:key:' + ch, 62 + (i % 8) * 114, 170 + Math.floor(i / 8) * 80, 100, 66));
      add('Delete', 'mp:del', 70, 500, 280, 66);
      add('Join', 'mp:dojoin', 372, 500, 280, 66, this.vrCode.length === 6);
      add('Back', 'mp:menu', 674, 500, 280, 66);
    } else if (page === 'mplobby') {
      const host = this.isHost();
      const lv = MP_LEVEL_LIST[this.chosenLevel() - 1];
      add(`Chamber: ${lv.id}. ${lv.name}`, 'mp:vote', 70, 190, 884, 66);
      if (host) add('Start', 'mp:start', 70, 280, 430, 70, (this.lobby?.players.filter((p) => p.connected).length || 0) >= 2);
      else add(this.me() && this.me().ready ? 'Not ready' : 'Ready', 'mp:ready', 70, 280, 430, 70);
      add(`Voice: ${this.voice.on ? 'on' : 'off'}`, 'mp:voice', 524, 280, 430, 70);
      add(`Outfit: ${PRESETS[this.profile.preset || 0].name}`, 'mp:preset', 70, 370, 430, 70);
      add('Leave lobby', 'mp:leave', 524, 370, 430, 70);
      QUICK_CHAT.slice(0, 4).forEach((q, i) => add(q, 'mp:quick:' + i, 70 + i * 222, 470, 210, 60));
    } else if (page === 'mppause') {
      add('Back to the chamber', 'mp:resume', 70, 150, 430, 66);
      add(`Voice: ${this.voice.on ? (this.voice.muted ? 'muted' : 'on') : 'off'}`, 'mp:voice', 524, 150, 430, 66);
      QUICK_CHAT.forEach((q, i) => add(q, 'mp:quick:' + i, 70 + (i % 4) * 222, 236 + Math.floor(i / 4) * 74, 210, 62));
      add('Remove my clone', 'mp:removeclone', 70, 400, 430, 62);
      add('Leave game', 'mp:leave', 524, 400, 430, 62);
      if (this.isHost()) {
        add(this.pausedInfo ? 'Continue without them' : 'Restart chamber', this.pausedInfo ? 'mp:continue' : 'mp:restart', 70, 480, 430, 62);
        add('Team back to lobby', 'mp:tolobby', 524, 480, 430, 62);
      }
    } else if (page === 'mpwin') {
      if (this.isHost()) {
        if (this.nextLevel) add('Next chamber', 'mp:next', cx, 260);
        add('Replay', 'mp:restart', cx, 345);
        add('Back to lobby', 'mp:tolobby', cx, 430);
      }
      add('Leave', 'mp:leave', cx, 515);
    }
  }

  vrAction(a) {
    const app = this.app, panel = app.vrPanel;
    if (a.startsWith('key:')) { if (this.vrCode.length < 6) this.vrCode += a.slice(4); panel.draw(); return; }
    if (a.startsWith('quick:')) { this.quick(Number(a.slice(6))); return; }
    switch (a) {
      case 'create': this.net.connect(); this.wantLobbyScreen = true; this.net.send({ type: 'create', session: this.profile.session }, { queue: true }); return;
      case 'joinpage': this.vrCode = ''; panel.page = 'mpjoin'; panel.draw(); return;
      case 'del': this.vrCode = this.vrCode.slice(0, -1); panel.draw(); return;
      case 'dojoin': this.net.connect(); this.wantLobbyScreen = true; this.net.send({ type: 'join', code: this.vrCode, session: this.profile.session }, { queue: true }); return;
      case 'menu': panel.page = 'mp'; panel.draw(); return;
      case 'main': panel.page = 'main'; panel.draw(); return;
      case 'preset': this.profile.preset = ((this.profile.preset || 0) + 1) % PRESETS.length; this.setOutfit(presetOutfit(this.profile.preset)); panel.draw(); return;
      case 'vote': { const cur = this.chosenLevel(); this.net.send({ type: 'vote', level: (cur % MP_LEVEL_LIST.length) + 1 }); return; }
      case 'start': this.startChosen(); return;
      case 'ready': this.net.send({ type: 'ready', ready: !this.me()?.ready }); return;
      case 'voice': this.toggleVoice(); return;
      case 'leave': panel.close(); this.leave(); return;
      case 'resume': panel.close(); app.resume(); return;
      case 'removeclone': if (app.game) app.game.removeClone(); panel.close(); app.resume(); return;
      case 'restart': this.net.send({ type: 'host', do: 'restart' }); return;
      case 'continue': this.net.send({ type: 'host', do: 'continue' }); return;
      case 'tolobby': this.net.send({ type: 'host', do: 'lobby' }); return;
      case 'next': if (this.nextLevel) this.net.send({ type: 'start', level: this.nextLevel }); return;
      default:
    }
  }
}
