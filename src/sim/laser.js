// Laser beam tracing. Beams travel horizontally (in the x/z plane) at a fixed
// height. Any solid box whose vertical range contains the beam height blocks it.
// Mirrors are vertical, double-sided reflective panels: r = d - 2(d.n)n.

import { LASER } from '../config.js';
import { bodyBox } from './physics.js';

const tmp = { min: [0, 0, 0], max: [0, 0, 0] };

/** 2D ray vs rectangle on x/z. Returns entry t (>= tMin) or -1. */
function rayRect(ox, oz, dx, dz, b, tMin) {
  let t0 = -Infinity, t1 = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox <= b.min[0] || ox >= b.max[0]) return -1;
  } else {
    let a = (b.min[0] - ox) / dx, c = (b.max[0] - ox) / dx;
    if (a > c) { const t = a; a = c; c = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz <= b.min[2] || oz >= b.max[2]) return -1;
  } else {
    let a = (b.min[2] - oz) / dz, c = (b.max[2] - oz) / dz;
    if (a > c) { const t = a; a = c; c = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
  }
  if (t0 > t1 || t1 < tMin) return -1;
  return Math.max(t0, tMin);
}

/** 2D ray vs segment. Returns t or -1. */
function raySeg(ox, oz, dx, dz, ax, az, bx, bz, tMin) {
  const ex = bx - ax, ez = bz - az;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-7) return -1; // parallel: beam slides past
  const wx = ax - ox, wz = az - oz;
  const t = (wx * ez - wz * ex) / den;
  const u = (wx * dz - wz * dx) / den;
  if (t < tMin || u < 0 || u > 1) return -1;
  return t;
}

/**
 * Trace every powered emitter.
 * game must provide: emitters, mirrors, receivers, laserBlockers() -> boxes.
 * Returns { beams: [{emitter, points:[{x,y,z}...]}], hits: Set(receiverId) }.
 */
export function traceLasers(game) {
  const beams = [];
  const hits = new Set();
  const blockers = game.laserBlockers();

  for (const em of game.emitters) {
    if (!em.powered) continue;
    const y = em.beamY;
    let ox = em.x + em.dir.x * (em.half + 0.01);
    let oz = em.z + em.dir.z * (em.half + 0.01);
    let dx = em.dir.x, dz = em.dir.z;
    const points = [{ x: ox, y, z: oz }];
    let lastMirror = null;
    let travelled = 0;
    let endHit = null;

    for (let bounce = 0; bounce <= LASER.maxBounces; bounce++) {
      let bestT = LASER.maxLength - travelled;
      let best = null;

      for (const b of blockers) {
        if (b === em.box) continue;
        if (y < b.min[1] || y > b.max[1]) continue;
        const t = rayRect(ox, oz, dx, dz, b, 1e-4);
        if (t >= 0 && t < bestT) { bestT = t; best = { type: 'box', box: b }; }
      }
      for (const r of game.receivers) {
        if (y < r.box.min[1] || y > r.box.max[1]) continue;
        const t = rayRect(ox, oz, dx, dz, r.box, 1e-4);
        if (t >= 0 && t < bestT) { bestT = t; best = { type: 'receiver', r }; }
      }
      for (const m of game.mirrors) {
        if (m === lastMirror || m.removed) continue;
        const base = m.body ? m.body.pos.y : m.y;
        if (y < base + m.panelY0 || y > base + m.panelY1) continue;
        const cx = m.body ? m.body.pos.x : m.x;
        const cz = m.body ? m.body.pos.z : m.z;
        const px = -Math.sin(m.angle) * m.halfLen, pz = Math.cos(m.angle) * m.halfLen;
        const t = raySeg(ox, oz, dx, dz, cx - px, cz - pz, cx + px, cz + pz, 1e-4);
        if (t >= 0 && t < bestT) { bestT = t; best = { type: 'mirror', m }; }
      }

      const hx = ox + dx * bestT, hz = oz + dz * bestT;
      points.push({ x: hx, y, z: hz });
      travelled += bestT;

      if (best && best.type === 'mirror') {
        const nx = Math.cos(best.m.angle), nz = Math.sin(best.m.angle);
        const dot = dx * nx + dz * nz;
        dx -= 2 * dot * nx; dz -= 2 * dot * nz;
        const l = Math.hypot(dx, dz); dx /= l; dz /= l;
        ox = hx; oz = hz;
        lastMirror = best.m;
        best.m.lit = true;
        continue;
      }
      if (best && best.type === 'receiver') { hits.add(best.r.id); endHit = 'receiver'; }
      else if (best) endHit = 'box';
      break;
    }
    beams.push({ emitter: em, points, end: endHit });
  }
  return { beams, hits };
}

/** Boxes that stop beams: static geometry, closed doors, crates, clones. */
export function collectBlockers(game, out = []) {
  out.length = 0;
  for (const s of game.world.statics) if (!s.noLaser) out.push(s);
  for (const f of game.world.dynamicSolids) { const b = f(); if (b) out.push(b); }
  for (const b of game.world.bodies) {
    if (b.removed || b.kind === 'player' || b.kind === 'mirror') continue;
    if (!b._lbox) b._lbox = { min: [0, 0, 0], max: [0, 0, 0] };
    bodyBox(b, b._lbox);
    out.push(b._lbox);
  }
  return out;
}

export { rayRect, raySeg, tmp };
