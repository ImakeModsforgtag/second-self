// The puzzle simulation. Pure logic, no rendering, no DOM: the same code runs
// in the browser and in the automated playthrough test (tests/playthrough.mjs).

import { PhysicsWorld, box, bodyBox, overlaps } from './physics.js';
import { Clone, wrapAngle } from './clone.js';
import { traceLasers, collectBlockers } from './laser.js';
import { PLAYER, LASER, MIRROR_STEPS, GUN } from '../config.js';
import { buildLevel } from '../levels/builder.js';

const DIRS = { E: 0, S: 90, W: 180, N: 270 };

function parseReq(list) {
  return (list || []).map((r) => (r[0] === '!' ? { id: r.slice(1), neg: true } : { id: r, neg: false }));
}

export class Game {
  /**
   * opts.players: player ids (default one player, 'p0').
   * opts.localId: the player this copy is "about" (camera, hints).
   * opts.kinematic: player positions are set from outside (multiplayer server).
   * opts.netClient: shared state arrives in snapshots (multiplayer client).
   */
  constructor(levelDef, opts = {}) {
    this.def = levelDef;
    this.opts = opts;
    this.playerIds = opts.players || ['p0'];
    this.kinematic = !!opts.kinematic;
    this.netClient = !!opts.netClient;
    this.data = buildLevel(levelDef, this.playerIds.length);
    this.world = new PhysicsWorld();
    this.events = [];
    this.time = 0;
    this.inputs = new Map();
    this.completed = false;
    this.finalSeq = null;
    this.maxClones = levelDef.maxClones || 1;
    this.clonesCreated = 0;
    this.shownHints = new Set();
    this.solidsTmp = [];
    this.beams = [];
    this._setup();
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  // Single-player shorthands (the local player's hold and clone).
  get held() { return this.player.hold; }
  set held(v) { this.player.hold = v; }
  get clone() { return this.player.clone; }
  set clone(v) { this.player.clone = v; }
  get playerList() { return [...this.players.values()]; }
  /** Every clone in the level (one per player at most). */
  get clones() { const out = []; for (const p of this.players.values()) if (p.clone) out.push(p.clone); return out; }
  _pl(pid) { return pid === undefined || pid === null ? this.player : this.players.get(pid); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------ setup
  _setup() {
    const d = this.data;
    for (const s of d.statics) this.world.addStatic(box(...s.b, { mat: s.mat, noLaser: !!s.noLaser, seeThrough: !!s.seeThrough, grip: s.mat === 'grip' }));

    // Players
    this.players = new Map();
    this.playerIds.forEach((id, i) => {
      const st = (d.starts && d.starts[i]) || { ...d.start, yaw: ((d.start.yaw || 0) * Math.PI) / 180 };
      const pl = {
        id,
        index: i,
        body: this.world.addBody({ kind: 'player', pos: { x: st.x, y: st.y || 0, z: st.z }, hx: PLAYER.radius, hz: PLAYER.radius, h: PLAYER.height }),
        yaw: st.yaw || 0,
        pitch: 0,
        headOverride: null,
        stepDist: 0,
        airT: 0,
        spawn: { ...st },
        vel: { x: 0, z: 0 },
        charges: GUN.charges,
        cool: 0,
        hold: null,
        clone: null,
        inExit: false,
      };
      pl.body.playerId = id;
      pl.body.ignore = (o) => pl.hold && o === pl.hold.body;
      this.players.set(id, pl);
    });
    this.player = this.players.get(this.opts.localId || this.playerIds[0]);
    this.hasGun = !!this.def.gun;
    this.killY = this.def.killY ?? -12;
    this.checkpoints = (d.checkpoints || []).map((c) => ({ ...c, reached: false }));

    // Pods
    this.pods = d.pods.map((p, i) => ({ ...p, id: p.id || 'pod' + i, y: p.y || 0 }));

    // Plates
    this.plates = d.plates.map((p) => ({ ...p, y: p.y || 0, pressed: false, need: p.need || 1, count: 0 }));

    // Buttons (wall switches)
    this.buttons = d.buttons.map((b) => {
      const n = b.normal;
      const r = b.style === 'target' ? 0.42 : 0.2;
      const bx = box(b.x - r, b.y - r, b.z - r, b.x + r, b.y + r, b.z + r);
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
  playerHead(pid) {
    const pl = this._pl(pid);
    if (pl.headOverride) return pl.headOverride;
    const p = pl.body.pos;
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
  pick(origin, dir, maxDist = PLAYER.reach + 0.5, pid) {
    const held = this._pl(pid).hold;
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
      if (body.removed) continue;
      if (body.kind === 'player') { if (body.playerId !== this._pl(pid).id) consider(bodyBox(body), 'solid', null); continue; }
      if (held && body === held.body) continue;
      const bx = bodyBox(body);
      if (body.kind === 'mirror') consider(bx, 'mirror', body.mirror);
      else if (body.kind === 'block') consider(bx, 'block', body);
      else consider(bx, 'solid', null);
    }
    return best.kind && best.kind !== 'solid' ? best : null;
  }

  podBox(p) { return box(p.x - 0.55, p.y, p.z - 0.55, p.x + 0.55, p.y + 2.3, p.z + 0.55); }

  /** Is the player standing on (or under-supporting) this body? */
  playerStandsOn(body, pid) {
    const pb = bodyBox(this._pl(pid).body);
    const bb = bodyBox(body);
    return Math.abs(pb.min[1] - bb.max[1]) < 0.06 &&
      pb.min[0] < bb.max[0] && pb.max[0] > bb.min[0] && pb.min[2] < bb.max[2] && pb.max[2] > bb.min[2];
  }

  grabbable(body) {
    if (!body || body.removed || body.held) return false;
    if (body.kind === 'block') return true;
    if (body.kind === 'mirror') return body.portable;
    return false;
  }

  // ------------------------------------------------------------ actions
  interact(origin, dir, pid) {
    const hit = this.pick(origin, dir, undefined, pid);
    if (!hit || hit.t > PLAYER.reach + 0.3) return false;
    if (hit.kind === 'button') { this.pressButton(hit.obj); return true; }
    if (hit.kind === 'mirror') { this.rotateMirror(hit.obj, 1); return true; }
    if (hit.kind === 'pod') { this.spawnClone(hit.obj, pid); return true; }
    if (hit.kind === 'block') { this.grab(hit.obj, 'desktop', pid); return true; }
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

  grab(body, hand = 'desktop', pid) {
    const pl = this._pl(pid);
    if (!pl) return false;
    if (pl.hold && pl.hold.body === body) return true;
    if (!this.grabbable(body)) return false;
    if (this.playerStandsOn(body, pid)) { this.emit('toast', { text: "You can't lift something you're standing on.", pid: pl.id }); return false; }
    // Nobody else may be standing on it either.
    for (const other of this.players.values()) if (other !== pl && this.playerStandsOn(body, other.id)) { this.emit('toast', { text: 'Someone is standing on that.', pid: pl.id }); return false; }
    if (pl.hold) this.release(pid);
    pl.hold = { body, hand, target: { x: body.pos.x, y: body.pos.y, z: body.pos.z }, stuckT: 0 };
    body.held = true;
    body.heldBy = pl.id;
    body.vy = 0;
    body.ignore = (o) => o === pl.body;
    this.emit('pickup', { x: body.pos.x, y: body.pos.y, z: body.pos.z, kind: body.kind, pid: pl.id });
    return true;
  }

  /** Where a held object should float, given the eye, a unit view vector and a distance. */
  holdTargetFromView(eye, fwd, dist, pid) {
    const h = this._pl(pid).hold;
    if (!h) return null;
    const b = h.body;
    return { x: eye.x + fwd.x * dist, y: eye.y + fwd.y * dist - b.h / 2, z: eye.z + fwd.z * dist };
  }

  setHoldTarget(x, y, z, pid) {
    const h = this._pl(pid).hold;
    if (!h) return;
    h.target.x = x; h.target.y = y; h.target.z = z;
  }

  /** Rotate the held object by quarter turns (blocks) or mirror steps. */
  rotateHeld(dir, pid) {
    const h = this._pl(pid).hold;
    if (!h) return;
    const b = h.body;
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

  release(pid, force = false) {
    const pl = this._pl(pid);
    if (!pl || !pl.hold) return false;
    const b = pl.hold.body;
    // Never drop an object into the player.
    const pb = bodyBox(pl.body);
    if (overlaps(pb, bodyBox(b), 0.01)) {
      const solids = this.world.solidsFor(b, this.solidsTmp);
      b.ignore = null;
      solids.push(pb);
      if (!this.world.depenetrate(b, solids, 0.9) && !force) {
        b.ignore = (o) => o === pl.body;
        this.emit('toast', { text: 'No room to put it down here.', pid: pl.id });
        return false;
      }
    }
    b.held = false;
    b.heldBy = null;
    b.ignore = null;
    b.vy = 0;
    pl.hold = null;
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

  nearestPod(pid) {
    const p = this._pl(pid).body.pos;
    let best = null, bd = Infinity;
    for (const pod of this.pods) {
      const d = Math.hypot(pod.x - p.x, pod.z - p.z) + Math.abs(pod.y - p.y) * 2;
      if (d < bd) { bd = d; best = pod; }
    }
    return best;
  }

  spawnClone(pod, pid) {
    const pl = this._pl(pid);
    pod = pod || this.nearestPod(pid);
    if (!pod) { this.emit('toast', { text: 'There is no clone pod in this chamber.', pid: pl.id }); return false; }
    const zone = this.podBox(pod);
    zone.max[1] = pod.y + 1.8;
    for (const b of this.world.bodies) {
      if (b.removed || (pl.clone && b === pl.clone.body)) continue;
      if (overlaps(bodyBox(b), zone, 0.02)) {
        this.emit('toast', { text: b.kind === 'player' ? 'Step out of the pod first.' : 'The pod is obstructed.', pid: pl.id });
        return false;
      }
    }
    if (pl.clone) this.removeClone(true, pid);
    pl.clone = new Clone(this, pod);
    pl.clone.owner = pl.id;
    pl.clone.id = pl.id + ':' + (++this.clonesCreated);
    this.emit('clone-spawn', { x: pod.x, y: pod.y, z: pod.z, pid: pl.id });
    return true;
  }

  resetClone(pid) {
    const pl = this._pl(pid);
    if (!pl.clone) return this.spawnClone(undefined, pid);
    return this.spawnClone(pl.clone.pod, pid);
  }

  removeClone(silentReplace = false, pid) {
    const pl = this._pl(pid);
    if (!pl || !pl.clone) return;
    const c = pl.clone;
    c.removed = true;
    c.body.removed = true;
    this.world.removeBody(c.body);
    this.emit('clone-remove', { x: c.body.pos.x, y: c.body.pos.y, z: c.body.pos.z, yaw: c.yaw, replace: silentReplace, pid: pl.id });
    pl.clone = null;
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

    // ---- Players (on a multiplayer server their positions come from clients)
    if (!this.kinematic) {
      if (input.players) {
        for (const [pid, inp] of Object.entries(input.players)) { const pl = this.players.get(pid); if (pl) this._stepPlayer(pl, dt, inp); }
      } else this._stepPlayer(this.player, dt, input);
    }

    // ---- Held objects follow their holders, colliding with the world
    for (const pl of this.players.values()) if (pl.hold) this._updateHeld(dt, pl);

    // ---- Dynamic bodies (bottom-up so stacks settle in one frame)
    const order = w.bodies.filter((b) => b.kind === 'block' || (b.kind === 'mirror' && b.portable));
    order.sort((a, b) => a.pos.y - b.pos.y);
    for (const b of order) {
      if (b.held) continue;
      const s = w.solidsFor(b, this.solidsTmp);
      const was = b.grounded, v0 = b.vy;
      w.applyGravity(b, dt, s);
      if (!was && b.grounded && v0 < -3) this.emit('thud', { x: b.pos.x, y: b.pos.y, z: b.pos.z, speed: -v0 });
      if (b.pos.y < this.killY) this._respawnBody(b);
    }

    // ---- Clones
    for (const pl of this.players.values()) {
      const c = pl.clone;
      if (!c) continue;
      c.update(dt, w.solidsFor(c.body, this.solidsTmp));
      if (c.pos.y < this.killY) { this.removeClone(false, pl.id); this.emit('toast', { text: 'Your clone fell. Make a new one at a pod.', pid: pl.id }); }
    }

    // ---- Logic network
    this._updateLogic(dt);

    // ---- Lasers (after doors/bodies have moved)
    this._traceLasers(true);

    // ---- Hints and exits
    this._updateHints();
    this._checkExit();
  }

  _traceLasers(emitEvents) {
    for (const m of this.mirrors) m.lit = false;
    const res = traceLasers(this);
    this.beams = res.beams;
    for (const r of this.receivers) {
      const on = res.hits.has(r.id);
      if (emitEvents && on !== r.lit) this.emit(on ? 'receiver-on' : 'receiver-off', { id: r.id, x: r.x, y: r.beamY, z: r.z });
      r.lit = on;
      if (emitEvents) this.inputs.set(r.id, on);
    }
  }

  /** Multiplayer client: move only our own player (and what we hold); shared state comes from the server. */
  stepLocal(dt, input = {}) {
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    if (this.finalSeq) return;
    this._stepPlayer(this.player, dt, input);
    if (this.player.hold) this._updateHeld(dt, this.player, true);
    this._traceLasers(false);
    this._updateHints();
  }

  _stepPlayer(pl, dt, input) {
    const w = this.world;
    const pb = pl.body;
    const solids = w.solidsFor(pb, this.solidsTmp);
    const mv = input.move || { x: 0, z: 0 };
    if (input.teleport) this._teleport(input.teleport, solids, pl);
    const before = { x: pb.pos.x, z: pb.pos.z };
    if (input.fire) this.fire(input.fire.origin, input.fire.dir, pl.id);
    if (this.hasGun) this._moveWithMomentum(dt, mv, solids, pl);
    else w.moveHorizontal(pb, mv.x * dt, mv.z * dt, solids, PLAYER.step);
    if (input.jump && pb.grounded) { pb.vy = PLAYER.jumpSpeed; pb.grounded = false; this.emit('jump', { pid: pl.id }); }
    const wasGrounded = pb.grounded;
    const vyBefore = pb.vy;
    w.applyGravity(pb, dt, solids);
    if (!wasGrounded && pb.grounded && vyBefore < -4) this.emit('land', { speed: -vyBefore, pid: pl.id });
    const moved = Math.hypot(pb.pos.x - before.x, pb.pos.z - before.z);
    if (pb.grounded && moved > 0) {
      pl.stepDist += moved;
      if (pl.stepDist > 0.7) { pl.stepDist = 0; this.emit('step', { pid: pl.id }); }
    }
    w.depenetrate(pb, w.solidsFor(pb, this.solidsTmp), 0.5);
    if (this.hasGun) this._updateGun(dt, pl);
    this._updateCheckpoints(pl);
    if (pb.pos.y < this.killY) this._respawnPlayer(pl);
  }

  // ------------------------------------------------------------ Kickback gun
  _moveWithMomentum(dt, mv, solids, pl = this.player) {
    const pb = pl.body, v = pl.vel;
    const tx = mv.x || 0, tz = mv.z || 0;
    if (pb.grounded) {
      const dx = tx - v.x, dz = tz - v.z, l = Math.hypot(dx, dz), a = GUN.groundAccel * dt;
      if (l <= a) { v.x = tx; v.z = tz; } else { v.x += (dx / l) * a; v.z += (dz / l) * a; }
    } else if (tx || tz) {
      // Air control: speed up toward the input direction (never slows a launch
      // that already goes that way) and gently trim sideways drift.
      const ts = Math.hypot(tx, tz), ux = tx / ts, uz = tz / ts, a = GUN.airAccel * dt;
      let vp = v.x * ux + v.z * uz;
      let px = v.x - vp * ux, pz = v.z - vp * uz;
      if (vp < ts) vp = Math.min(ts, vp + a);
      const pmag = Math.hypot(px, pz);
      if (pmag > 0) { const k = Math.max(0, pmag - a * 0.6) / pmag; px *= k; pz *= k; }
      v.x = vp * ux + px; v.z = vp * uz + pz;
    } else {
      const k = Math.max(0, 1 - GUN.airDrag * dt);
      v.x *= k; v.z *= k;
    }
    const r = this.world.moveHorizontal(pb, v.x * dt, v.z * dt, solids, PLAYER.step);
    if (Math.abs(r.mx - v.x * dt) > 1e-5) v.x = 0;
    if (Math.abs(r.mz - v.z * dt) > 1e-5) v.z = 0;
  }

  _updateGun(dt, pl = this.player) {
    const pb = pl.body;
    pl.cool = Math.max(0, pl.cool - dt);
    if (pb.grounded && pl.charges < GUN.charges) { pl.charges = GUN.charges; this.emit('recharge'); }
    if (!pb.grounded && pl.charges < GUN.charges && this.touchingGrip(pl.id)) { pl.charges = GUN.charges; this.emit('grip', { x: pb.pos.x, y: pb.pos.y + 1, z: pb.pos.z }); }
  }

  touchingGrip(pid) {
    const b = bodyBox(this._pl(pid).body);
    const m = 0.07;
    for (const s of this.world.statics) {
      if (!s.grip) continue;
      if (b.min[0] - m < s.max[0] && b.max[0] + m > s.min[0] && b.min[1] < s.max[1] && b.max[1] > s.min[1] && b.min[2] - m < s.max[2] && b.max[2] + m > s.min[2]) return true;
    }
    return false;
  }

  /** Fire the Kickback gun from origin along unit dir. Returns the hit (or null). */
  fire(origin, dir, pid) {
    const pl = this._pl(pid), pb = pl.body;
    if (!this.hasGun) return null;
    if (pl.cool > 0) return null;
    if (pl.charges <= 0) { this.emit('dry'); pl.cool = 0.15; return null; }
    pl.cool = GUN.cooldown;
    pl.charges--;
    const ray = PhysicsWorld.rayBox;
    let best = { t: GUN.range, kind: null, obj: null };
    const consider = (bx, kind, obj) => { const t = ray(origin, dir, bx, best.t); if (t >= 0 && t < best.t) best = { t, kind, obj }; };
    for (const s of this.world.statics) consider(s, 'solid', null);
    for (const d of this.doors) consider(d.box(), 'solid', null);
    for (const b of this.buttons) consider(b.box, 'button', b);
    for (const body of this.world.bodies) {
      if (body.removed || body.kind === 'player' || (pl.hold && body === pl.hold.body)) continue;
      consider(bodyBox(body), body.kind === 'mirror' ? 'mirror' : 'solid', body.mirror || null);
    }
    const hit = best.kind ? { x: origin.x + dir.x * best.t, y: origin.y + dir.y * best.t, z: origin.z + dir.z * best.t } : null;
    if (best.kind === 'button') this.pressButton(best.obj);
    if (best.kind === 'mirror') this.rotateMirror(best.obj, 1);
    let kicked = false;
    if (hit) {
      const c = { x: pb.pos.x, y: pb.pos.y + 0.85, z: pb.pos.z };
      const d = Math.hypot(hit.x - c.x, hit.y - c.y, hit.z - c.z);
      if (d < GUN.kickRange) {
        const s = GUN.kick * Math.min(1, (GUN.kickRange - d) / (GUN.kickRange - GUN.fullDist));
        const ix = -dir.x * s, iy = -dir.y * s, iz = -dir.z * s;
        const add = (v, imp) => (imp > 0 ? Math.max(v + GUN.carry * imp, imp) : imp < 0 ? Math.min(v + GUN.carry * imp, imp) : v);
        pl.vel.x = add(pl.vel.x, ix);
        pl.vel.z = add(pl.vel.z, iz);
        pb.vy = add(pb.vy, iy);
        if (iy > 0.5) pb.grounded = false;
        kicked = true;
      }
    }
    this.emit('shot', { ox: origin.x, oy: origin.y, oz: origin.z, hx: hit ? hit.x : origin.x + dir.x * GUN.range, hy: hit ? hit.y : origin.y + dir.y * GUN.range, hz: hit ? hit.z : origin.z + dir.z * GUN.range, kicked, hitKind: best.kind, x: origin.x, y: origin.y, z: origin.z });
    return { ...best, point: hit, kicked };
  }

  _updateCheckpoints(pl = this.player) {
    const p = pl.body.pos;
    for (const c of this.checkpoints) {
      if (p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1 && Math.abs(p.y - c.y) < 0.6 && pl.body.grounded) {
        const s = pl.spawn;
        if (s.x !== c.x || s.z !== c.z || s.y !== c.y) {
          pl.spawn = { x: c.x, y: c.y, z: c.z, yaw: c.yaw ?? pl.yaw };
          if (!c.reached) this.emit('checkpoint', { x: c.x, y: c.y, z: c.z });
          c.reached = true;
        }
      }
    }
  }

  _teleport(t, solids, pl = this.player) {
    const pb = pl.body;
    const ox = pb.pos.x, oy = pb.pos.y, oz = pb.pos.z;
    pb.pos.x = t.x; pb.pos.y = t.y + 0.02; pb.pos.z = t.z;
    if (this.world.overlapsAny(pb, solids)) { pb.pos.x = ox; pb.pos.y = oy; pb.pos.z = oz; return false; }
    this.emit('teleport');
    return true;
  }

  _updateHeld(dt, pl = this.player, local = false) {
    const h = pl.hold;
    const b = h.body;
    if (h.clientPos && !local) {
      // Multiplayer server: the holder's client reports where the object is.
      b.pos.x = h.clientPos.x; b.pos.y = h.clientPos.y; b.pos.z = h.clientPos.z;
      return;
    }
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
    if (h.stuckT > 0.35) { if (local) this.emit('auto-release'); else this.release(pl.id); }
  }

  _respawnPlayer(pl = this.player) {
    const s = pl.spawn;
    const pb = pl.body;
    pb.pos.x = s.x; pb.pos.y = (s.y || 0) + 0.05; pb.pos.z = s.z; pb.vy = 0;
    pl.vel.x = 0; pl.vel.z = 0;
    if (pl.hold) { if (this.netClient) this.emit('auto-release'); else this.release(pl.id, true); }
    this.emit('toast', { text: this.hasGun ? 'Back to the last checkpoint.' : 'Recovered.', pid: pl.id });
    this.emit('respawn', { pid: pl.id });
  }

  _respawnBody(b) {
    b.pos.x = b.home.x; b.pos.y = b.home.y + 0.5; b.pos.z = b.home.z; b.vy = 0;
  }

  _updateLogic(dt) {
    // Pressure plates
    for (const p of this.plates) {
      let count = 0;
      for (const b of this.world.bodies) {
        if (b.removed || b.held) continue;
        if (b.kind === 'mirror' && !b.portable) continue;
        const bb = bodyBox(b);
        if (bb.min[1] < p.y - 0.12 || bb.min[1] > p.y + 0.3) continue;
        if (bb.min[0] < p.x1 - 0.04 && bb.max[0] > p.x0 + 0.04 && bb.min[2] < p.z1 - 0.04 && bb.max[2] > p.z0 + 0.04) { count++; if (count >= p.need && p.need === 1) break; }
      }
      p.count = count;
      const pressed = count >= p.need;
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
      const met = d.any ? d.requires.some((r) => (r.neg ? !this.inputOn(r.id) : this.inputOn(r.id))) : this.reqsMet(d.requires);
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
    if (this.completed || (this.netClient)) return;
    const inside = (pl) => {
      const pb = bodyBox(pl.body);
      for (const e of this.exits) {
        if (pb.min[0] > e.x0 && pb.max[0] < e.x1 && pb.min[2] > e.z0 && pb.max[2] < e.z1 && Math.abs(pb.min[1] - e.y) < 0.4) return e;
      }
      return null;
    };
    if (this.def.teamExit) {
      // Co-op: everybody (still connected) has to be on the exit together.
      let exit = null, all = true;
      for (const pl of this.players.values()) {
        if (pl.away) continue;
        const e = inside(pl);
        pl.inExit = !!e;
        if (!e) all = false; else exit = e;
      }
      if (!all || !exit) return;
      for (const pl of this.players.values()) if (pl.hold) this.release(pl.id, true);
      if (exit.final) {
        this.finalSeq = { t: 0, exit, startY: exit.y, team: true };
        this.emit('final-start', { x: (exit.x0 + exit.x1) / 2, z: (exit.z0 + exit.z1) / 2 });
      } else {
        this.completed = true;
        this.emit('complete', { team: true });
      }
      return;
    }
    const e = inside(this.player);
    if (!e) return;
    if (e.final) {
      this.finalSeq = { t: 0, exit: e, startY: this.player.body.pos.y };
      if (this.held) this.release();
      this.emit('final-start', { x: (e.x0 + e.x1) / 2, z: (e.z0 + e.z1) / 2 });
    } else {
      this.completed = true;
      if (this.held) this.release();
      this.emit('complete');
    }
  }

  _updateFinal(dt) {
    const f = this.finalSeq;
    f.t += dt;
    const e = f.exit;
    // Lift: rises after a short pause.
    const rise = Math.max(0, f.t - 1.2) * 0.9;
    e.lift = Math.min(rise, 9);
    const riders = f.team ? [...this.players.values()] : [this.player];
    for (const pl of riders) {
      const pb = pl.body;
      if (this.kinematic && f.team) continue;
      pb.pos.y = (f.team ? e.y : f.startY) + e.lift;
      if (!f.team) {
        pb.pos.x += ((e.x0 + e.x1) / 2 - pb.pos.x) * Math.min(1, dt * 2);
        pb.pos.z += ((e.z0 + e.z1) / 2 - pb.pos.z) * Math.min(1, dt * 2);
      }
    }
    for (const c of this.clones) c.update(dt, this.world.solidsFor(c.body, this.solidsTmp));
    if (f.t > 9 && !this.completed) { this.completed = true; this.emit('complete', { final: !!this.def.isLast, team: !!f.team }); }
  }
}

export { wrapAngle };
