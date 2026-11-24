// The puzzle simulation. Pure logic, no rendering, no DOM: the same code runs
// in the browser and in the automated playthrough test (tests/playthrough.mjs).

import { PhysicsWorld, box, bodyBox, overlaps } from './physics.js';
import { Clone, wrapAngle } from './clone.js';
import { traceLasers, collectBlockers } from './laser.js';
import { PLAYER, LASER, MIRROR_STEPS } from '../config.js';
import { buildLevel } from '../levels/builder.js';

const DIRS = { E: 0, S: 90, W: 180, N: 270 };

function parseReq(list) {
  return (list || []).map((r) => (r[0] === '!' ? { id: r.slice(1), neg: true } : { id: r, neg: false }));
}

export class Game {
  constructor(levelDef) {
    this.def = levelDef;
    this.data = buildLevel(levelDef);
    this.world = new PhysicsWorld();
    this.events = [];
    this.time = 0;
    this.inputs = new Map();
    this.completed = false;
    this.finalSeq = null;
    this.held = null;
    this.clone = null;
    this.maxClones = levelDef.maxClones || 1;
    this.clonesCreated = 0;
    this.shownHints = new Set();
    this.solidsTmp = [];
    this.beams = [];
    this._setup();
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------ setup
  _setup() {
    const d = this.data;
    for (const s of d.statics) this.world.addStatic(box(...s.b, { mat: s.mat, noLaser: !!s.noLaser, seeThrough: !!s.seeThrough }));

    // Player
    const st = d.start;
    this.player = {
      body: this.world.addBody({ kind: 'player', pos: { x: st.x, y: st.y || 0, z: st.z }, hx: PLAYER.radius, hz: PLAYER.radius, h: PLAYER.height }),
      yaw: st.yaw || 0,
      pitch: 0,
      headOverride: null,
      stepDist: 0,
      airT: 0,
      spawn: { ...st },
    };
    this.player.body.ignore = (o) => this.held && o === this.held.body;

    // Pods
    this.pods = d.pods.map((p, i) => ({ ...p, id: p.id || 'pod' + i, y: p.y || 0 }));

    // Plates
    this.plates = d.plates.map((p) => ({ ...p, y: p.y || 0, pressed: false }));

    // Buttons (wall switches)
    this.buttons = d.buttons.map((b) => {
      const n = b.normal;
      const bx = box(b.x - 0.2 + (n.x ? 0 : 0), b.y - 0.2, b.z - 0.2, b.x + 0.2, b.y + 0.2, b.z + 0.2);
      // flatten along the normal
      if (n.x) { bx.min[0] = b.x - 0.08; bx.max[0] = b.x + 0.08; }
      if (n.z) { bx.min[2] = b.z - 0.08; bx.max[2] = b.z + 0.08; }
      return { ...b, on: false, t: 0, box: bx };
    });

    // Emitters
    this.emitters = d.emitters.map((e) => {
      const deg = typeof e.dir === 'string' ? DIRS[e.dir] : e.dir;
      const a = (deg * Math.PI) / 180;
      const y = e.y || 0;
      const half = 0.3;
      const em = {
        ...e, y, half,
        dir: { x: Math.round(Math.cos(a) * 1e6) / 1e6, z: Math.round(Math.sin(a) * 1e6) / 1e6 },
        beamY: y + LASER.height,
        power: parseReq(e.power),
        powered: !e.power,
      };
      em.box = this.world.addStatic(box(e.x - half, y, e.z - half, e.x + half, y + LASER.height + 0.35, e.z + half, { mat: 'emitter' }));
      return em;
    });

    // Receivers
    this.receivers = d.receivers.map((r) => {
      const y = (r.y || 0) + LASER.height;
      const n = r.normal;
      const hw = 0.32, depth = 0.18;
      const bx = box(
        r.x - (n.x ? depth : hw), y - 0.32, r.z - (n.z ? depth : hw),
        r.x + (n.x ? depth : hw), y + 0.32, r.z + (n.z ? depth : hw),
        { mat: 'receiver', noLaser: true });
      this.world.addStatic(bx);
      return { ...r, beamY: y, box: bx, lit: false };
    });

    // Mirrors (fixed pedestals and portable ones are both physical bodies)
    this.mirrors = d.mirrors.map((m, i) => {
      const body = this.world.addBody({
        kind: 'mirror',
        pos: { x: m.x, y: m.y || 0, z: m.z },
        hx: 0.3, hz: 0.3, h: 1.2,
        fixed: !m.portable,
        portable: !!m.portable,
      });
      const mir = {
        id: m.id || 'm' + i,
        body, step: m.step || 0, portable: !!m.portable,
        panelY0: 0.3, panelY1: 1.18, halfLen: 0.46,
        home: { x: m.x, y: m.y || 0, z: m.z },
        lit: false,
      };
      mir.angle = (mir.step * 2 * Math.PI) / MIRROR_STEPS;
      body.mirror = mir;
      return mir;
    });

    this.sockets = d.sockets.map((s) => ({ ...s, y: s.y || 0 }));

    // Movable blocks
    this.blocks = d.blocks.map((b, i) => {
      const body = this.world.addBody({
        kind: 'block',
        pos: { x: b.x, y: b.y || 0, z: b.z },
        hx: b.w / 2, hz: b.d / 2, h: b.h,
        size: { w: b.w, h: b.h, d: b.d },
        quarter: 0,
        style: b.style || (b.w === b.d && b.w === b.h ? 'cube' : 'slab'),
      });
      body.id = b.id || 'b' + i;
      body.home = { x: b.x, y: b.y || 0, z: b.z };
      return body;
    });

    // Doors
    this.doors = d.doors.map((dr) => {
      const door = {
        ...dr,
        y0: dr.y0 || 0,
        height: dr.height || 2.6,
        thick: 0.22,
        requires: parseReq(dr.requires),
        t: 0, open: false, latched: false,
      };
      const half = door.width / 2;
      door.footprint = door.axis === 'x'
        ? [door.x - half, door.z - door.thick / 2, door.x + half, door.z + door.thick / 2]
        : [door.x - door.thick / 2, door.z - half, door.x + door.thick / 2, door.z + half];
      door._box = { min: [0, 0, 0], max: [0, 0, 0], door };
      door.box = () => {
        const lift = door.t * (door.height + 0.05);
        const f = door.footprint;
        door._box.min[0] = f[0]; door._box.min[2] = f[1];
        door._box.max[0] = f[2]; door._box.max[2] = f[3];
        door._box.min[1] = door.y0 + lift; door._box.max[1] = door.y0 + door.height + lift;
        return door._box;
      };
      this.world.dynamicSolids.push(door.box);
      return door;
    });

    this.exits = d.exits.map((e) => ({ ...e, y: e.y || 0 }));
    this.hints = d.hints;
    this.lightsList = d.lights;
    this.blockerList = [];
  }

  // ------------------------------------------------------------ queries
  playerHead() {
    if (this.player.headOverride) return this.player.headOverride;
    const p = this.player.body.pos;
    return { x: p.x, y: p.y + PLAYER.eye, z: p.z };
  }

  laserBlockers() { return collectBlockers(this, this.blockerList); }

  inputOn(id) { return !!this.inputs.get(id); }

  reqsMet(reqs) {
    for (const r of reqs) {
      const v = this.inputOn(r.id);
      if (r.neg ? v : !v) return false;
    }
    return true;
  }

  /** Nearest thing a ray hits (for interaction). Returns {kind, obj, t} or null. */
  pick(origin, dir, maxDist = PLAYER.reach + 0.5) {
    const ray = PhysicsWorld.rayBox;
    let best = { t: maxDist, kind: null, obj: null };
    const consider = (bx, kind, obj) => {
      const t = ray(origin, dir, bx, best.t);
      if (t >= 0 && t < best.t) best = { t, kind, obj };
    };
    for (const s of this.world.statics) consider(s, 'solid', null);
    for (const dr of this.doors) consider(dr.box(), 'solid', null);
    for (const b of this.buttons) consider(b.box, 'button', b);
    for (const p of this.pods) consider(this.podBox(p), 'pod', p);
    for (const body of this.world.bodies) {
      if (body.removed || body.kind === 'player') continue;
      if (this.held && body === this.held.body) continue;
      const bx = bodyBox(body);
      if (body.kind === 'mirror') consider(bx, 'mirror', body.mirror);
      else if (body.kind === 'block') consider(bx, 'block', body);
      else consider(bx, 'solid', null);
    }
    return best.kind && best.kind !== 'solid' ? best : null;
  }

  podBox(p) { return box(p.x - 0.55, p.y, p.z - 0.55, p.x + 0.55, p.y + 2.3, p.z + 0.55); }

  /** Is the player standing on (or under-supporting) this body? */
  playerStandsOn(body) {
    const pb = bodyBox(this.player.body);
    const bb = bodyBox(body);
    return Math.abs(pb.min[1] - bb.max[1]) < 0.06 &&
      pb.min[0] < bb.max[0] && pb.max[0] > bb.min[0] && pb.min[2] < bb.max[2] && pb.max[2] > bb.min[2];
  }

  grabbable(body) {
    if (!body || body.removed) return false;
    if (body.kind === 'block') return true;
    if (body.kind === 'mirror') return body.portable;
    return false;
  }

  // ------------------------------------------------------------ actions
  interact(origin, dir) {
    const hit = this.pick(origin, dir);
    if (!hit || hit.t > PLAYER.reach + 0.3) return false;
    if (hit.kind === 'button') { this.pressButton(hit.obj); return true; }
    if (hit.kind === 'mirror') { this.rotateMirror(hit.obj, 1); return true; }
    if (hit.kind === 'pod') { this.spawnClone(hit.obj); return true; }
    if (hit.kind === 'block') { this.grab(hit.obj); return true; }
    return false;
  }

  pressButton(b) {
    if (b.mode === 'toggle') b.on = !b.on;
    else { b.on = true; b.t = b.duration || 8; }
    this.emit('button', { id: b.id, on: b.on, x: b.x, y: b.y, z: b.z });
  }

  rotateMirror(m, steps) {
    m.step = (((m.step + steps) % MIRROR_STEPS) + MIRROR_STEPS) % MIRROR_STEPS;
    m.angle = (m.step * 2 * Math.PI) / MIRROR_STEPS;
    this.emit('mirror-rotate', { x: m.body.pos.x, y: m.body.pos.y, z: m.body.pos.z });
  }

  setMirrorStep(m, step) {
    m.step = ((step % MIRROR_STEPS) + MIRROR_STEPS) % MIRROR_STEPS;
    m.angle = (m.step * 2 * Math.PI) / MIRROR_STEPS;
  }

  grab(body, hand = 'desktop') {
    if (!this.grabbable(body)) return false;
    if (this.playerStandsOn(body)) { this.emit('toast', { text: "You can't lift something you're standing on." }); return false; }
    if (this.held) this.release();
    this.held = { body, hand, target: { x: body.pos.x, y: body.pos.y, z: body.pos.z }, stuckT: 0 };
    body.held = true;
    body.vy = 0;
    body.ignore = (o) => o === this.player.body;
    this.emit('pickup', { x: body.pos.x, y: body.pos.y, z: body.pos.z, kind: body.kind });
    return true;
  }

  /** Where a held object should float, given the eye, a unit view vector and a distance. */
  holdTargetFromView(eye, fwd, dist) {
    if (!this.held) return null;
    const b = this.held.body;
    return { x: eye.x + fwd.x * dist, y: eye.y + fwd.y * dist - b.h / 2, z: eye.z + fwd.z * dist };
  }

  setHoldTarget(x, y, z) {
    if (!this.held) return;
    this.held.target.x = x; this.held.target.y = y; this.held.target.z = z;
  }

  /** Rotate the held object by quarter turns (blocks) or mirror steps. */
  rotateHeld(dir) {
    if (!this.held) return;
    const b = this.held.body;
    if (b.kind === 'mirror') { this.rotateMirror(b.mirror, dir); return; }
    const solids = this.world.solidsFor(b, this.solidsTmp);
    const ohx = b.hx, ohz = b.hz;
    b.hx = ohz; b.hz = ohx;
    if (this.world.overlapsAny(b, solids) && !this.world.depenetrate(b, solids, 0.6)) {
      b.hx = ohx; b.hz = ohz;
      this.emit('toast', { text: 'Not enough room to turn it.' });
      return;
    }
    b.quarter = (b.quarter + (dir > 0 ? 1 : 3)) % 4;
    this.emit('rotate-held', { x: b.pos.x, y: b.pos.y, z: b.pos.z });
  }

  release() {
    if (!this.held) return false;
    const b = this.held.body;
    // Never drop an object into the player.
    const pb = bodyBox(this.player.body);
    if (overlaps(pb, bodyBox(b), 0.01)) {
      const solids = this.world.solidsFor(b, this.solidsTmp);
      b.ignore = null;
      solids.push(pb);
      if (!this.world.depenetrate(b, solids, 0.9)) {
        b.ignore = (o) => o === this.player.body;
        this.emit('toast', { text: 'No room to put it down here.' });
        return false;
      }
    }
    b.held = false;
    b.ignore = null;
    b.vy = 0;
    this.held = null;
    if (b.kind === 'mirror') this.snapToSocket(b);
    this.emit('drop', { x: b.pos.x, y: b.pos.y, z: b.pos.z, kind: b.kind });
    return true;
  }

  snapToSocket(b) {
    let best = null, bd = 0.75;
    for (const s of this.sockets) {
      const d = Math.hypot(s.x - b.pos.x, s.z - b.pos.z);
      if (d < bd && Math.abs(s.y - b.pos.y) < 1.6) { bd = d; best = s; }
    }
    if (!best) return;
    const ox = b.pos.x, oz = b.pos.z, oy = b.pos.y;
    b.pos.x = best.x; b.pos.z = best.z; b.pos.y = Math.max(b.pos.y, best.y);
    const solids = this.world.solidsFor(b, this.solidsTmp);
    if (this.world.overlapsAny(b, solids)) { b.pos.x = ox; b.pos.z = oz; b.pos.y = oy; }
    else this.emit('socket', { x: best.x, z: best.z });
  }

  nearestPod() {
    const p = this.player.body.pos;
    let best = null, bd = Infinity;
    for (const pod of this.pods) {
      const d = Math.hypot(pod.x - p.x, pod.z - p.z) + Math.abs(pod.y - p.y) * 2;
      if (d < bd) { bd = d; best = pod; }
    }
    return best;
  }

  spawnClone(pod) {
    pod = pod || this.nearestPod();
    if (!pod) { this.emit('toast', { text: 'There is no clone pod in this chamber.' }); return false; }
    const zone = this.podBox(pod);
    zone.max[1] = pod.y + 1.8;
    for (const b of this.world.bodies) {
      if (b.removed || (this.clone && b === this.clone.body)) continue;
      if (overlaps(bodyBox(b), zone, 0.02)) {
        this.emit('toast', { text: b.kind === 'player' ? 'Step out of the pod first.' : 'The pod is obstructed.' });
        return false;
      }
    }
    if (this.clone) this.removeClone(true);
    this.clone = new Clone(this, pod);
    this.clonesCreated++;
    this.emit('clone-spawn', { x: pod.x, y: pod.y, z: pod.z });
    return true;
  }

  resetClone() {
    if (!this.clone) return this.spawnClone();
    return this.spawnClone(this.clone.pod);
  }

  removeClone(silentReplace = false) {
    if (!this.clone) return;
    const c = this.clone;
    c.removed = true;
    c.body.removed = true;
    this.world.removeBody(c.body);
    this.emit('clone-remove', { x: c.body.pos.x, y: c.body.pos.y, z: c.body.pos.z, yaw: c.yaw, replace: silentReplace });
    this.clone = null;
  }

  // ------------------------------------------------------------ update
  /**
   * input: { move: {x,z} world-space velocity (m/s), jump: bool }
   */
  update(dt, input = {}) {
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    const w = this.world;

    if (this.finalSeq) { this._updateFinal(dt); return; }

    // ---- Player
    const pl = this.player;
    const pb = pl.body;
    const solids = w.solidsFor(pb, this.solidsTmp);
    const mv = input.move || { x: 0, z: 0 };
    if (input.teleport) {
      this._teleport(input.teleport, solids);
    }
    const before = { x: pb.pos.x, z: pb.pos.z };
    w.moveHorizontal(pb, mv.x * dt, mv.z * dt, solids, PLAYER.step);
    if (input.jump && pb.grounded) { pb.vy = PLAYER.jumpSpeed; pb.grounded = false; this.emit('jump'); }
    const wasGrounded = pb.grounded;
    const vyBefore = pb.vy;
    w.applyGravity(pb, dt, solids);
    if (!wasGrounded && pb.grounded && vyBefore < -4) this.emit('land', { speed: -vyBefore });
    const moved = Math.hypot(pb.pos.x - before.x, pb.pos.z - before.z);
    if (pb.grounded && moved > 0) {
      pl.stepDist += moved;
      if (pl.stepDist > 0.7) { pl.stepDist = 0; this.emit('step'); }
    }
    w.depenetrate(pb, w.solidsFor(pb, this.solidsTmp), 0.5);
    if (pb.pos.y < -12) this._respawnPlayer();

    // ---- Held object follows its target, colliding with the world
    if (this.held) this._updateHeld(dt);

    // ---- Dynamic bodies (bottom-up so stacks settle in one frame)
    const order = w.bodies.filter((b) => b.kind === 'block' || (b.kind === 'mirror' && b.portable));
    order.sort((a, b) => a.pos.y - b.pos.y);
    for (const b of order) {
      if (b.held) continue;
      const s = w.solidsFor(b, this.solidsTmp);
      const was = b.grounded, v0 = b.vy;
      w.applyGravity(b, dt, s);
      if (!was && b.grounded && v0 < -3) this.emit('thud', { x: b.pos.x, y: b.pos.y, z: b.pos.z, speed: -v0 });
      if (b.pos.y < -12) this._respawnBody(b);
    }

    // ---- Clone
    if (this.clone) this.clone.update(dt, w.solidsFor(this.clone.body, this.solidsTmp));

    // ---- Logic network
    this._updateLogic(dt);

    // ---- Lasers (after doors/bodies have moved)
    for (const m of this.mirrors) m.lit = false;
    const res = traceLasers(this);
    this.beams = res.beams;
    for (const r of this.receivers) {
      const on = res.hits.has(r.id);
      if (on !== r.lit) this.emit(on ? 'receiver-on' : 'receiver-off', { id: r.id, x: r.x, y: r.beamY, z: r.z });
      r.lit = on;
      this.inputs.set(r.id, on);
    }

    // ---- Hints and exits
    this._updateHints();
    this._checkExit();
  }

  _teleport(t, solids) {
    const pb = this.player.body;
    const ox = pb.pos.x, oy = pb.pos.y, oz = pb.pos.z;
    pb.pos.x = t.x; pb.pos.y = t.y + 0.02; pb.pos.z = t.z;
    if (this.world.overlapsAny(pb, solids)) { pb.pos.x = ox; pb.pos.y = oy; pb.pos.z = oz; return false; }
    this.emit('teleport');
    return true;
  }

  _updateHeld(dt) {
    const h = this.held;
    const b = h.body;
    const s = this.world.solidsFor(b, this.solidsTmp);
    const maxStep = 14 * dt;
    let dx = h.target.x - b.pos.x, dy = h.target.y - b.pos.y, dz = h.target.z - b.pos.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > maxStep) { dx *= maxStep / len; dy *= maxStep / len; dz *= maxStep / len; }
    this.world.moveAxis(b, 1, dy, s);
    this.world.moveAxis(b, 0, dx, s);
    this.world.moveAxis(b, 2, dz, s);
    const err = Math.hypot(h.target.x - b.pos.x, h.target.y - b.pos.y, h.target.z - b.pos.z);
    h.stuckT = err > 1.6 ? h.stuckT + dt : 0;
    if (h.stuckT > 0.35) this.release();
  }

  _respawnPlayer() {
    const s = this.player.spawn;
    const pb = this.player.body;
    pb.pos.x = s.x; pb.pos.y = (s.y || 0) + 0.05; pb.pos.z = s.z; pb.vy = 0;
    this.emit('toast', { text: 'Recovered.' });
  }

  _respawnBody(b) {
    b.pos.x = b.home.x; b.pos.y = b.home.y + 0.5; b.pos.z = b.home.z; b.vy = 0;
  }

  _updateLogic(dt) {
    // Pressure plates
    for (const p of this.plates) {
      let pressed = false;
      for (const b of this.world.bodies) {
        if (b.removed || b.held) continue;
        if (b.kind === 'mirror' && !b.portable) continue;
        const bb = bodyBox(b);
        if (bb.min[1] < p.y - 0.12 || bb.min[1] > p.y + 0.3) continue;
        if (bb.min[0] < p.x1 - 0.04 && bb.max[0] > p.x0 + 0.04 && bb.min[2] < p.z1 - 0.04 && bb.max[2] > p.z0 + 0.04) { pressed = true; break; }
      }
      if (pressed !== p.pressed) this.emit(pressed ? 'plate-on' : 'plate-off', { id: p.id, x: (p.x0 + p.x1) / 2, y: p.y, z: (p.z0 + p.z1) / 2 });
      p.pressed = pressed;
      this.inputs.set(p.id, pressed);
    }
    // Buttons
    for (const b of this.buttons) {
      if (b.mode !== 'toggle' && b.on) {
        const before = Math.ceil(b.t);
        b.t -= dt;
        if (Math.ceil(b.t) !== before && b.t > 0) this.emit('tick', { x: b.x, y: b.y, z: b.z, left: Math.ceil(b.t) });
        if (b.t <= 0) { b.on = false; this.emit('button-off', { id: b.id, x: b.x, y: b.y, z: b.z }); }
      }
      this.inputs.set(b.id, b.on);
    }
    // Emitters
    for (const e of this.emitters) {
      const on = e.power.length === 0 ? true : this.reqsMet(e.power);
      if (on !== e.powered) this.emit(on ? 'laser-on' : 'laser-off', { x: e.x, y: e.beamY, z: e.z });
      e.powered = on;
    }
    // Doors
    for (const d of this.doors) {
      const met = this.reqsMet(d.requires);
      if (met && d.latch) d.latched = true;
      const want = d.latched || met;
      if (want !== d.open) this.emit(want ? 'door-open' : 'door-close', { id: d.id, x: d.x, y: d.y0 + 1.3, z: d.z });
      d.open = want;
      const speed = 0.9 * dt;
      if (want) d.t = Math.min(1, d.t + speed);
      else if (d.t > 0) {
        // Closing: stop if something stands in the doorway.
        const nt = Math.max(0, d.t - speed);
        const lift = nt * (d.height + 0.05);
        const f = d.footprint;
        const zone = { min: [f[0], d.y0 + lift - 0.01, f[1]], max: [f[2], d.y0 + lift + d.height, f[3]] };
        let blocked = false;
        for (const b of this.world.bodies) { if (!b.removed && overlaps(bodyBox(b), zone, 0.005)) { blocked = true; break; } }
        if (!blocked) d.t = nt;
      }
      this.inputs.set(d.id, d.t > 0.95);
    }
  }

  _updateHints() {
    const p = this.player.body.pos;
    for (let i = 0; i < this.hints.length; i++) {
      const h = this.hints[i];
      if (this.shownHints.has(i)) continue;
      let show = false;
      if (h.zone) {
        const z = h.zone;
        show = p.x > z[0] && p.x < z[2] && p.z > z[1] && p.z < z[3];
      } else if (h.event === 'start') show = this.time > 0.5;
      else if (h.event === 'clone') show = !!this.clone && this.clone.state !== 'spawning';
      else if (h.event === 'held') show = !!this.held;
      if (show) { this.shownHints.add(i); this.emit('hint', { text: h.text }); }
    }
  }

  _checkExit() {
    if (this.completed) return;
    const pb = bodyBox(this.player.body);
    for (const e of this.exits) {
      if (pb.min[0] > e.x0 && pb.max[0] < e.x1 && pb.min[2] > e.z0 && pb.max[2] < e.z1 && Math.abs(pb.min[1] - e.y) < 0.4) {
        if (e.final) {
          this.finalSeq = { t: 0, exit: e, startY: this.player.body.pos.y };
          if (this.held) this.release();
          this.emit('final-start', { x: (e.x0 + e.x1) / 2, z: (e.z0 + e.z1) / 2 });
        } else {
          this.completed = true;
          if (this.held) this.release();
          this.emit('complete');
        }
        return;
      }
    }
  }

  _updateFinal(dt) {
    const f = this.finalSeq;
    f.t += dt;
    const e = f.exit;
    const pb = this.player.body;
    // Lift: rises after a short pause.
    const rise = Math.max(0, f.t - 1.2) * 0.9;
    e.lift = Math.min(rise, 9);
    pb.pos.y = f.startY + e.lift;
    pb.pos.x += ((e.x0 + e.x1) / 2 - pb.pos.x) * Math.min(1, dt * 2);
    pb.pos.z += ((e.z0 + e.z1) / 2 - pb.pos.z) * Math.min(1, dt * 2);
    if (this.clone) this.clone.update(dt, this.world.solidsFor(this.clone.body, this.solidsTmp));
    if (f.t > 9 && !this.completed) { this.completed = true; this.emit('complete', { final: true }); }
  }
}

export { wrapAngle };
