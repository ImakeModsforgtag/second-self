// Axis-aligned box physics. Everything solid in the facility (walls, floors,
// crates, the player, clones) is an axis-aligned box, which keeps stacking rock
// solid: no jitter, no tunnelling, objects stay exactly where they are placed.
// Moves are clamped per axis against every overlapping solid (swept AABB).

import { PHYS } from '../config.js';

const EPS = 1e-4;

export function box(x0, y0, z0, x1, y1, z1, extra = {}) {
  return {
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    ...extra,
  };
}

export function bodyBox(b, out) {
  const o = out || { min: [0, 0, 0], max: [0, 0, 0] };
  o.min[0] = b.pos.x - b.hx; o.max[0] = b.pos.x + b.hx;
  o.min[1] = b.pos.y; o.max[1] = b.pos.y + b.h;
  o.min[2] = b.pos.z - b.hz; o.max[2] = b.pos.z + b.hz;
  return o;
}

export function overlaps(a, b, m = EPS) {
  return a.min[0] < b.max[0] - m && a.max[0] > b.min[0] + m &&
         a.min[1] < b.max[1] - m && a.max[1] > b.min[1] + m &&
         a.min[2] < b.max[2] - m && a.max[2] > b.min[2] + m;
}

function overlapOther(a, s, axis) {
  for (let i = 0; i < 3; i++) {
    if (i === axis) continue;
    if (!(a.min[i] < s.max[i] - EPS && a.max[i] > s.min[i] + EPS)) return false;
  }
  return true;
}

const tmpA = { min: [0, 0, 0], max: [0, 0, 0] };
const AX = ['x', 'y', 'z'];

export class PhysicsWorld {
  constructor() {
    this.statics = [];      // immovable boxes
    this.bodies = [];       // dynamic bodies (player, clone, blocks, mirrors)
    this.dynamicSolids = []; // functions returning boxes (doors)
  }

  addStatic(b) { this.statics.push(b); return b; }

  addBody(b) {
    b.vy = b.vy || 0;
    b.grounded = false;
    if (b.solid === undefined) b.solid = true;
    this.bodies.push(b);
    return b;
  }

  removeBody(b) {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  /** Collect every solid that `body` should collide with. */
  solidsFor(body, list = []) {
    list.length = 0;
    for (const s of this.statics) list.push(s);
    for (const f of this.dynamicSolids) { const b = f(); if (b) list.push(b); }
    for (const o of this.bodies) {
      if (o === body || !o.solid || o.removed) continue;
      if (body.ignore && body.ignore(o)) continue;
      if (o.ignore && o.ignore(body)) continue;
      if (!o._box) o._box = { min: [0, 0, 0], max: [0, 0, 0] };
      bodyBox(o, o._box);
      o._box.body = o;
      list.push(o._box);
    }
    return list;
  }

  /** Move along one axis, stopping at the first solid. Returns distance moved. */
  moveAxis(body, axis, delta, solids) {
    if (delta === 0) return 0;
    const b = bodyBox(body, tmpA);
    let allowed = delta;
    for (const s of solids) {
      if (!overlapOther(b, s, axis)) continue;
      if (delta > 0) {
        const gap = s.min[axis] - b.max[axis];
        if (gap >= -EPS * 4 && gap < allowed) allowed = Math.max(0, gap);
      } else {
        const gap = s.max[axis] - b.min[axis];
        if (gap <= EPS * 4 && gap > allowed) allowed = Math.min(0, gap);
      }
    }
    body.pos[AX[axis]] += allowed;
    return allowed;
  }

  /** Horizontal move with optional step-up (stairs, plate lips). */
  moveHorizontal(body, dx, dz, solids, stepH = 0) {
    const sx = body.pos.x, sy = body.pos.y, sz = body.pos.z;
    const mx = this.moveAxis(body, 0, dx, solids);
    const mz = this.moveAxis(body, 2, dz, solids);
    const blocked = Math.abs(mx - dx) > 1e-5 || Math.abs(mz - dz) > 1e-5;
    if (!blocked || stepH <= 0 || !body.grounded) return { mx, mz, blocked };

    const ax = body.pos.x, ay = body.pos.y, az = body.pos.z;
    body.pos.x = sx; body.pos.y = sy; body.pos.z = sz;
    const up = this.moveAxis(body, 1, stepH, solids);
    if (up > 0.01) {
      const mx2 = this.moveAxis(body, 0, dx, solids);
      const mz2 = this.moveAxis(body, 2, dz, solids);
      const gain = mx2 * mx2 + mz2 * mz2 - (mx * mx + mz * mz);
      this.moveAxis(body, 1, -up - 0.02, solids);
      const supported = body.pos.y > sy + 0.005 ? this.isSupported(body, solids) : true;
      if (gain > 1e-6 && supported) {
        return { mx: mx2, mz: mz2, blocked: Math.abs(mx2 - dx) > 1e-5 || Math.abs(mz2 - dz) > 1e-5 };
      }
    }
    body.pos.x = ax; body.pos.y = ay; body.pos.z = az;
    return { mx, mz, blocked };
  }

  isSupported(body, solids) {
    const b = bodyBox(body, tmpA);
    for (const s of solids) {
      if (Math.abs(s.max[1] - b.min[1]) < 0.03 &&
          b.min[0] < s.max[0] - EPS && b.max[0] > s.min[0] + EPS &&
          b.min[2] < s.max[2] - EPS && b.max[2] > s.min[2] + EPS) return true;
    }
    return false;
  }

  /** Apply gravity to one body. */
  applyGravity(body, dt, solids) {
    body.vy = Math.max(-PHYS.maxFall, body.vy - PHYS.gravity * dt);
    const dy = body.vy * dt;
    const my = this.moveAxis(body, 1, dy, solids);
    if (dy < 0) {
      if (my > dy + 1e-6) { body.grounded = true; body.vy = 0; }
      else body.grounded = false;
    } else if (dy > 0) {
      body.grounded = false;
      if (my < dy - 1e-6) body.vy = 0;
    }
  }

  /** Bodies that overlap any solid (e.g. after a door closes) get pushed out. */
  depenetrate(body, solids, maxPush = 0.8) {
    const b = bodyBox(body, tmpA);
    let hit = null;
    for (const s of solids) { if (overlaps(b, s, 0.002)) { hit = s; break; } }
    if (!hit) return false;
    const options = [
      [1, hit.max[1] - b.min[1]],
      [0, hit.max[0] - b.min[0]], [0, hit.min[0] - b.max[0]],
      [2, hit.max[2] - b.min[2]], [2, hit.min[2] - b.max[2]],
    ];
    options.sort((p, q) => Math.abs(p[1]) - Math.abs(q[1]));
    for (const [axis, d] of options) {
      if (Math.abs(d) > maxPush) continue;
      const k = AX[axis];
      body.pos[k] += d + Math.sign(d) * 0.002;
      if (!this.overlapsAny(body, solids)) return true;
      body.pos[k] -= d + Math.sign(d) * 0.002;
    }
    return false;
  }

  overlapsAny(body, solids, margin = 0.002) {
    const b = bodyBox(body, tmpA);
    for (const s of solids) if (overlaps(b, s, margin)) return s;
    return null;
  }

  /** 3D ray against a box (slab test). Returns entry distance or -1. */
  static rayBox(o, d, bx, maxT = Infinity) {
    let t0 = 0, t1 = maxT;
    for (let i = 0; i < 3; i++) {
      const oi = i === 0 ? o.x : i === 1 ? o.y : o.z;
      const di = i === 0 ? d.x : i === 1 ? d.y : d.z;
      if (Math.abs(di) < 1e-9) {
        if (oi < bx.min[i] || oi > bx.max[i]) return -1;
      } else {
        let ta = (bx.min[i] - oi) / di, tb = (bx.max[i] - oi) / di;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return -1;
      }
    }
    return t0;
  }

  /** Is the straight segment a->b free of solids? `skip(box)` can exclude boxes. */
  segmentClear(a, b, skip) {
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-6) return true;
    d.x /= len; d.y /= len; d.z /= len;
    const test = (bx) => {
      if (skip && skip(bx)) return false;
      const t = PhysicsWorld.rayBox(a, d, bx, len);
      return t >= 0 && t < len - 0.05;
    };
    for (const s of this.statics) if (!s.seeThrough && test(s)) return false;
    for (const f of this.dynamicSolids) { const bx = f(); if (bx && test(bx)) return false; }
    for (const o of this.bodies) {
      if (!o.solid || o.removed || o.seeThrough) continue;
      if (!o._box) o._box = { min: [0, 0, 0], max: [0, 0, 0] };
      bodyBox(o, o._box); o._box.body = o;
      if (test(o._box)) return false;
    }
    return true;
  }
}
