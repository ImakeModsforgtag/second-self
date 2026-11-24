// Shared by the multiplayer server (Node) and the browser client.
// Snapshots are plain JSON with short keys so they stay small at 20 per second.

import { Clone } from '../sim/clone.js';
import { MIRROR_STEPS } from '../config.js';

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
export const SIM_HZ = 30;
export const SNAP_HZ = 20;
export const INPUT_HZ = 20;
export const RECONNECT_SECONDS = 120;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export const QUICK_CHAT = [
  'Follow me!',
  'Wait!',
  'I need help!',
  'Stand here!',
  'Move the mirror!',
  'Press the button!',
  "Let's go!",
];

export const PLAYER_COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#f06292'];

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Stable key for a carryable body: "b<index>" for blocks, "m<index>" for mirrors. */
export function bodyKey(g, body) {
  if (!body) return null;
  if (body.kind === 'block') return 'b' + g.blocks.indexOf(body);
  if (body.kind === 'mirror') return 'm' + g.mirrors.findIndex((m) => m.body === body);
  return null;
}
export function bodyFromKey(g, key) {
  if (typeof key !== 'string' || key.length < 2) return null;
  const i = Number(key.slice(1));
  if (!Number.isInteger(i) || i < 0) return null;
  if (key[0] === 'b') return g.blocks[i] || null;
  if (key[0] === 'm') return g.mirrors[i] ? g.mirrors[i].body : null;
  return null;
}

/** Server side: the shared state of a running co-op chamber. */
export function encodeSnapshot(g) {
  const s = {
    t: r3(g.time),
    pl: g.playerList.map((p) => [
      p.id, r3(p.body.pos.x), r3(p.body.pos.y), r3(p.body.pos.z), r3(p.yaw), r3(p.pitch),
      (p.away ? 1 : 0) | (p.inExit ? 2 : 0) | (p.body.grounded ? 4 : 0) | (p.jumping ? 8 : 0),
      p.hold ? bodyKey(g, p.hold.body) : null,
    ]),
    bl: g.blocks.map((b) => [r3(b.pos.x), r3(b.pos.y), r3(b.pos.z), b.quarter, b.heldBy || null]),
    mi: g.mirrors.map((m) => [m.step, r3(m.body.pos.x), r3(m.body.pos.y), r3(m.body.pos.z), m.body.heldBy || null]),
    cl: g.clones.map((c) => [c.id, c.owner, r3(c.pos.x), r3(c.pos.y), r3(c.pos.z), r3(c.yaw), c.state, r3(c.speed), r3(c.spawnT), g.pods.indexOf(c.pod)]),
    dr: g.doors.map((d) => [r3(d.t), d.latched ? 1 : 0, d.open ? 1 : 0]),
    pa: g.plates.map((p) => (p.pressed ? 1 : 0) + p.count * 2),
    bu: g.buttons.map((b) => [b.on ? 1 : 0, r3(b.t)]),
    em: g.emitters.map((e) => (e.powered ? 1 : 0)),
  };
  if (g.finalSeq) s.fs = [r3(g.finalSeq.t), r3(g.finalSeq.exit.lift || 0), g.exits.indexOf(g.finalSeq.exit)];
  if (g.completed) s.done = 1;
  return s;
}

/**
 * Client side: copy a snapshot into the local Game (created with netClient: true).
 * The local player and whatever it holds stay under local control.
 */
export function applySnapshot(g, s, now = 0) {
  const me = g.player;
  // Players
  for (const row of s.pl) {
    const [id, x, y, z, yaw, pitch, flags, holdKey] = row;
    const pl = g.players.get(id);
    if (!pl) continue;
    pl.away = !!(flags & 1);
    pl.inExit = !!(flags & 2);
    pl.netHold = holdKey;
    if (pl === me) continue;
    pl.body.pos.x = x; pl.body.pos.y = y; pl.body.pos.z = z;
    pl.body.grounded = !!(flags & 4);
    pl.jumping = !!(flags & 8);
    pl.yaw = yaw; pl.pitch = pitch;
    // Away players are not solid (they are not really there).
    pl.body.removed = pl.away;
  }
  const mine = me.hold ? me.hold.body : null;
  // Blocks
  s.bl.forEach((row, i) => {
    const b = g.blocks[i];
    if (!b) return;
    const [x, y, z, quarter, heldBy] = row;
    if (b === mine) {
      // The server gave it to someone else: let go of our local copy.
      if (heldBy && heldBy !== me.id) dropLocal(g);
      else if (!heldBy && now - (me.hold.since || 0) > 0.8) dropLocal(g);
      else return;
    }
    b.pos.x = x; b.pos.y = y; b.pos.z = z;
    if ((quarter & 1) !== (b.quarter & 1)) { const t = b.hx; b.hx = b.hz; b.hz = t; }
    b.quarter = quarter;
    b.held = !!heldBy; b.heldBy = heldBy;
  });
  // Mirrors
  s.mi.forEach((row, i) => {
    const m = g.mirrors[i];
    if (!m) return;
    const [step, x, y, z, heldBy] = row;
    m.step = step; m.angle = (step * 2 * Math.PI) / MIRROR_STEPS;
    if (m.body === mine) {
      if (heldBy && heldBy !== me.id) dropLocal(g);
      else if (!heldBy && now - (me.hold.since || 0) > 0.8) dropLocal(g);
      else return;
    }
    m.body.pos.x = x; m.body.pos.y = y; m.body.pos.z = z;
    m.body.held = !!heldBy; m.body.heldBy = heldBy;
  });
  // Clones: create, update and remove to match the server.
  const seen = new Set();
  for (const row of s.cl) {
    const [id, owner, x, y, z, yaw, state, speed, spawnT, podIdx] = row;
    seen.add(id);
    const pl = g.players.get(owner);
    if (!pl) continue;
    let c = pl.clone;
    if (!c || c.id !== id) {
      if (c) removeLocalClone(g, pl);
      const pod = g.pods[podIdx] || { x, y, z, yaw };
      c = new Clone(g, pod);
      c.id = id; c.owner = owner;
      pl.clone = c;
      g.emit('clone-spawn', { x: pod.x, y: pod.y, z: pod.z, pid: owner, net: true });
    }
    c.body.pos.x = x; c.body.pos.y = y; c.body.pos.z = z;
    c.yaw = yaw; c.state = state; c.speed = speed; c.spawnT = spawnT;
  }
  for (const pl of g.players.values()) if (pl.clone && !seen.has(pl.clone.id)) removeLocalClone(g, pl);
  // Doors, plates, buttons, emitters
  s.dr.forEach((row, i) => {
    const d = g.doors[i];
    if (!d) return;
    d.t = row[0]; d.latched = !!row[1]; d.open = !!row[2];
    g.inputs.set(d.id, d.t > 0.95);
  });
  s.pa.forEach((v, i) => { const p = g.plates[i]; if (p) { p.pressed = !!(v & 1); p.count = v >> 1; g.inputs.set(p.id, p.pressed); } });
  s.bu.forEach((row, i) => { const b = g.buttons[i]; if (b) { b.on = !!row[0]; b.t = row[1]; g.inputs.set(b.id, b.on); } });
  s.em.forEach((v, i) => { const e = g.emitters[i]; if (e) e.powered = !!v; });
  if (s.fs) {
    const exit = g.exits[s.fs[2]] || g.exits[0];
    if (!g.finalSeq) g.finalSeq = { t: 0, exit, startY: exit.y, team: true };
    g.finalSeq.t = s.fs[0];
    exit.lift = s.fs[1];
  }
  if (s.done) g.completed = true;
}

function dropLocal(g) {
  const me = g.player;
  if (!me.hold) return;
  const b = me.hold.body;
  b.held = false; b.heldBy = null; b.ignore = null;
  me.hold = null;
  g.emit('net-drop');
}

function removeLocalClone(g, pl) {
  const c = pl.clone;
  c.removed = true; c.body.removed = true;
  g.world.removeBody(c.body);
  g.emit('clone-remove', { x: c.body.pos.x, y: c.body.pos.y, z: c.body.pos.z, yaw: c.yaw, pid: pl.id, net: true });
  pl.clone = null;
}

/** Outfit defaults and validation (shared so the server can sanitise profiles). */
export const OUTFIT_OPTIONS = {
  shirtStyle: ['tee', 'longsleeve', 'tank', 'hoodie'],
  pattern: ['solid', 'stripes', 'wave', 'dots', 'check', 'split'],
  shortsStyle: ['shorts', 'long', 'cargo'],
  shoeStyle: ['sneakers', 'boots', 'hightops'],
  hat: ['none', 'cap', 'beanie', 'bucket', 'visor', 'tophat'],
};
export const DEFAULT_OUTFIT = {
  shirtStyle: 'tee', pattern: 'wave', shirt: '#1e3a8a', shirt2: '#3b82f6',
  shortsStyle: 'shorts', shorts: '#2b2f38',
  shoeStyle: 'sneakers', shoes: '#f2f2f2',
  hat: 'none', hatColor: '#c62828',
  skin: '#e8b48a', hair: '#3a2a1e',
};
const HEX = /^#[0-9a-fA-F]{6}$/;
export function sanitizeOutfit(o) {
  const out = { ...DEFAULT_OUTFIT };
  if (!o || typeof o !== 'object') return out;
  for (const [k, list] of Object.entries(OUTFIT_OPTIONS)) if (list.includes(o[k])) out[k] = o[k];
  for (const k of ['shirt', 'shirt2', 'shorts', 'shoes', 'hatColor', 'skin', 'hair']) if (typeof o[k] === 'string' && HEX.test(o[k])) out[k] = o[k];
  return out;
}
export function sanitizeName(n) {
  const s = String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return s || 'Player';
}
