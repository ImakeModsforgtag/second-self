// Real network test. Starts the multiplayer server, then connects real
// WebSocket clients that form several lobbies AT THE SAME TIME. Each lobby
// replays a recorded bot solution through the server (positions at 20 Hz plus
// actions), and the server, which runs the authoritative simulation, must
// declare the chamber complete. Also covers join errors, ready checks, chat,
// quick chat, full lobbies, disconnect pause, reconnect and host recovery.
//
// Run: node tests/mp-net.mjs

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { MP_LEVEL_LIST, mpStages } from '../src/mp/levels.js';
import { Bot, assert } from './bot.mjs';
import { SOLVE } from './mp-solutions.mjs';
import { bodyKey, QUICK_CHAT } from '../src/net/protocol.js';

const PORT = 8790 + Math.floor(Math.random() * 100);
const URL_WS = `ws://127.0.0.1:${PORT}/ws`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed++; console.log('  ok   ' + label); } else { failed++; console.log('  FAIL ' + label); } };

// ------------------------------------------------------------ recording
function record(levelName, n) {
  const level = MP_LEVEL_LIST.find((l) => l.name === levelName);
  const b = new Bot(level, { players: Array.from({ length: n }, (_, i) => 'p' + i) });
  const g = b.g;
  const frames = [], actions = [];
  let depth = 0;
  const pid = () => g.player.id;
  const head = () => { const h = g.playerHead(); return [h.x, h.y, h.z]; };
  const fwd = () => { const f = b.fwd(); return [f.x, f.y, f.z]; };
  const guard = (name, before, after) => {
    const orig = g[name].bind(g);
    g[name] = (...args) => {
      depth++;
      const pre = depth === 1 && before ? before(...args) : null;
      try { const r = orig(...args); if (depth === 1 && after) after(r, pre, ...args); return r; } finally { depth--; }
    };
  };
  guard('interact', null, (r, pre, o, d) => actions.push({ t: g.time, pid: pid(), a: 'interact', o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] }));
  guard('rotateMirror', null, (r, pre, m, steps) => actions.push({ t: g.time, pid: pid(), a: 'rotate', o: head(), d: fwd(), dir: steps }));
  guard('spawnClone', null, (r, pre, pod) => { if (r) actions.push({ t: g.time, pid: pid(), a: 'clone', pod: g.pods.indexOf(pod || g.nearestPod()) }); });
  guard('grab', null, (r, pre, body) => { if (r) actions.push({ t: g.time, pid: pid(), a: 'grab', key: bodyKey(g, body) }); });
  guard('release', () => { const h = g.player.hold; return h ? h.body : null; },
    (r, body) => { if (r && body) actions.push({ t: g.time, pid: pid(), a: 'release', p: [body.pos.x, body.pos.y, body.pos.z], q: body.quarter }); });
  guard('rotateHeld', null, (r, pre, dir) => actions.push({ t: g.time, pid: pid(), a: 'rotateHeld', dir }));
  const update = g.update.bind(g);
  g.update = (dt, input) => {
    update(dt, input);
    frames.push({ t: g.time, pl: g.playerList.map((p) => ({
      p: [p.body.pos.x, p.body.pos.y, p.body.pos.z], yaw: p.yaw, pitch: p.pitch, g: p.body.grounded,
      h: p.hold ? [p.hold.body.pos.x, p.hold.body.pos.y, p.hold.body.pos.z] : null,
    })) });
  };
  SOLVE[levelName](b, n, mpStages(level, n));
  b.waitUntil(() => g.completed || g.finalSeq, 6, 'exit');
  if (g.finalSeq) b.waitUntil(() => g.completed, 12, 'final');
  b.wait(1.0);
  return { level, n, frames, actions, duration: g.time };
}

// ------------------------------------------------------------ client
class TestClient {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.session = null;
  }
  open(session = null) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL_WS);
      this.ws.on('open', () => this.send({ type: 'hello', name: this.name, session, outfit: { shirt: '#22aa44', hat: 'cap' } }));
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'welcome') { this.session = m.session; this.rejoined = m.rejoined; resolve(this); }
        if (m.type === 'lobby') this.lobby = m;
        if (m.type === 'start') this.startMsg = m;
        if (m.type === 'snap') { this.lastSnap = m.s; return; }
        const w = this.waiters.find((x) => x.pred(m));
        if (w) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); } else this.msgs.push(m);
      });
      this.ws.on('error', reject);
    });
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 5000, label = 'message') {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => { if (this.waiters.includes(w)) { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error(`${this.name}: timed out waiting for ${label}`)); } }, ms);
    });
  }
  waitType(type, ms, extra = () => true) { return this.wait((m) => m.type === type && extra(m), ms, type); }
  close() { try { this.ws.terminate(); } catch { /* */ } }
}

async function makeLobby(n, tag) {
  const cs = [];
  for (let i = 0; i < n; i++) cs.push(await new TestClient(`${tag}${i}`).open());
  cs[0].send({ type: 'create', session: cs[0].session });
  const lob = await cs[0].waitType('lobby', 4000);
  for (let i = 1; i < n; i++) { cs[i].send({ type: 'join', code: lob.code, session: cs[i].session }); await cs[i].waitType('lobby', 4000, (m) => m.code === lob.code); }
  return { cs, code: lob.code };
}

async function readyAndStart(cs, levelId) {
  for (const c of cs.slice(1)) c.send({ type: 'ready', ready: true });
  await sleep(150);
  cs[0].send({ type: 'start', level: levelId });
  await Promise.all(cs.map((c) => c.waitType('start', 4000)));
}

/** Drive each client from the recording in real time. */
async function replay(cs, rec, label) {
  const pidOf = new Map(cs.map((c) => [c, c.startMsg.you]));
  const t0 = Date.now();
  const scale = 0.96;               // replay a touch slower than recorded, for safety
  const sentAct = new Set();
  let fi = 0;
  const done = Promise.all(cs.map((c) => c.waitType('complete', (rec.duration / scale) * 1000 + 15000)));
  const timer = setInterval(() => {
    const t = ((Date.now() - t0) / 1000) * scale;
    while (fi < rec.frames.length - 1 && rec.frames[fi + 1].t <= t) fi++;
    const fr = rec.frames[fi];
    for (const c of cs) {
      const pid = pidOf.get(c);
      const idx = Number(pid.slice(1));
      const st = fr.pl[idx];
      c.send({ type: 'input', p: st.p, yaw: st.yaw, pitch: st.pitch, g: st.g, h: st.h });
      rec.actions.forEach((a, k) => {
        if (sentAct.has(k) || a.pid !== pid || a.t > t) return;
        sentAct.add(k);
        const { t: _t, pid: _p, ...rest } = a;
        c.send({ type: 'action', ...rest });
      });
    }
  }, 50);
  try {
    const res = await done;
    clearInterval(timer);
    ok(res.every((m) => m.level === rec.level.id), `${label}: server completed "${rec.level.name}" with ${rec.n} players in ${res[0].time.toFixed(1)}s`);
  } catch (e) {
    clearInterval(timer);
    const s = cs[0].lastSnap;
    ok(false, `${label}: ${e.message} (doors ${s ? s.dr.map((d) => d[0].toFixed(1)).join(',') : '?'})`);
  }
}

// ------------------------------------------------------------ main
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
server.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(d));
const stop = () => { try { server.kill(); } catch { /* */ } };
process.on('exit', stop);

try {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) break; } catch { /* starting */ } await sleep(100); }
  console.log(`Server up on ${PORT}`);

  console.log('Recording bot solutions...');
  const plans = [
    ['Teamwork', 2], ['Teamwork', 4], ['Weight Distribution', 3], ['Split Light', 3], ['The Clone Crew', 2],
  ].map(([name, n]) => record(name, n));
  for (const r of plans) console.log(`  ${r.level.name} x${r.n}: ${r.duration.toFixed(1)}s, ${r.actions.length} actions`);

  console.log('Lobby basics');
  const solo = await new TestClient('Lonely').open();
  solo.send({ type: 'join', code: 'ZZZZZZ' });
  const err = await solo.waitType('error', 3000);
  ok(/No lobby/.test(err.text), 'joining a wrong code is refused with a clear message');

  const lobbies = [];
  for (const [k, r] of plans.entries()) lobbies.push({ ...(await makeLobby(r.n, `L${k}_`)), rec: r });
  const codes = new Set(lobbies.map((l) => l.code));
  ok(codes.size === lobbies.length, `${lobbies.length} lobbies created at once with unique codes (${[...codes].join(' ')})`);
  ok(lobbies.every((l) => l.cs.every((c) => c.lobby.players.length === l.rec.n)), 'every client sees the right player count');

  // Full lobby (the 4 player one)
  const four = lobbies.find((l) => l.rec.n === 4);
  const fifth = await new TestClient('Fifth').open();
  fifth.send({ type: 'join', code: four.code });
  ok(/full/.test((await fifth.waitType('error', 3000)).text), 'a fifth player cannot join a full lobby');

  // Start blocked until everyone is ready
  four.cs[0].send({ type: 'start', level: 1 });
  ok(/ready/.test((await four.cs[0].waitType('error', 3000)).text), 'host cannot start before everyone is ready');
  four.cs[1].send({ type: 'start', level: 1 });
  ok(/host/.test((await four.cs[1].waitType('error', 3000)).text), 'only the host can start');

  // Chat and quick chat
  four.cs[2].send({ type: 'chat', text: 'hello team' });
  const heard = await Promise.all(four.cs.map((c) => c.waitType('chat', 3000, (m) => m.text === 'hello team')));
  ok(heard.every((m) => m.from === 'L1_2'), 'text chat reaches every player with the sender name');
  four.cs[3].send({ type: 'quick', i: 3 });
  const q = await four.cs[0].waitType('chat', 3000, (m) => m.quick);
  ok(q.text === QUICK_CHAT[3], `quick chat "${q.text}" arrives`);

  // Profile change shows up for everyone
  four.cs[1].send({ type: 'profile', name: 'Renamed', outfit: { shirt: '#ff0000', hat: 'beanie', pattern: 'stripes' } });
  const seen = await four.cs[3].waitType('lobby', 3000, (m) => m.players.some((p) => p.name === 'Renamed' && p.outfit.hat === 'beanie'));
  ok(!!seen, 'username and outfit changes sync to the lobby');

  console.log('Replaying solutions in all lobbies at the same time...');
  for (const l of lobbies) await readyAndStart(l.cs, l.rec.level.id);
  ok(lobbies.every((l) => l.cs.every((c) => c.startMsg.count === l.rec.n)), 'every chamber recorded its lobby size at start');
  await Promise.all(lobbies.map((l, k) => replay(l.cs, l.rec, `lobby ${k + 1} (${l.code})`)));

  console.log('Disconnect and reconnect');
  const { cs: rc } = await makeLobby(3, 'R');
  await readyAndStart(rc, 1);
  await sleep(600);
  const session = rc[2].session;
  rc[2].close();
  const p = await rc[0].waitType('paused', 4000);
  ok(p.names.includes('R2'), 'the team is paused when a player drops');
  const back = new TestClient('R2');
  await back.open(session);
  const rs = await back.waitType('start', 4000);
  ok(back.rejoined && rs.rejoin && rs.you === 'p2', 'the player reconnects into the same chamber as the same character');
  ok(!!(await rc[0].waitType('resumed', 4000)), 'play resumes when they are back');
  // Host recovery: drop again and continue without them
  back.close();
  const flush = () => rc.forEach((c) => { c.msgs = []; });
  await rc[0].waitType('paused', 4000);
  flush();
  rc[0].send({ type: 'host', do: 'continue' });
  const res = await rc[1].waitType('resumed', 4000).catch((e) => { console.log('    rc1 msgs:', rc[1].msgs.map((m) => m.type + (m.text ? ':' + m.text : '')).join(' / ')); throw e; });
  ok(res.without && res.without.includes('R2'), 'host can continue without the missing player' + (res.without ? '' : ' got ' + JSON.stringify(res)));
  flush();
  rc[0].send({ type: 'host', do: 'restart' });
  const rst = await rc[1].waitType('start', 4000);
  ok(rst.count === 2, 'host can restart the chamber for the players still here (rebuilt for 2)');
  flush();
  rc[0].send({ type: 'host', do: 'lobby' });
  ok(!!(await rc[1].waitType('to-lobby', 4000)), 'host can take everyone back to the lobby');
  // Host leaves: host passes on
  flush();
  rc[0].send({ type: 'leave' });
  const after = await rc[1].waitType('lobby', 4000, (m) => !m.players.some((pl) => pl.name === 'R0'));
  ok((after.players.find((pl) => pl.host) || {}).name === 'R1', 'when the host leaves, the next player becomes host');

  const h = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok(h.ok && h.lobbies >= lobbies.length, `health endpoint reports ${h.lobbies} lobbies and ${h.players} players`);
  for (const l of lobbies) for (const c of l.cs) c.close();
} catch (e) {
  failed++;
  console.log('ERROR', e.stack || e.message);
}
stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
