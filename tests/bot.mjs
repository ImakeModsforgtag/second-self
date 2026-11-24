// A scripted "player" that drives the real game simulation through the same
// actions a person uses: walking, jumping, looking, interacting, grabbing.
// It cannot teleport objects or the clone; it can only move its own body.

import { Game } from '../src/sim/game.js';
import { PLAYER } from '../src/config.js';

export const DT = 1 / 60;

export class Bot {
  constructor(level, { verbose = false } = {}) {
    this.g = new Game(level);
    this.level = level;
    this.verbose = verbose;
    this.log = [];
    this.events = [];
    this.holdDist = PLAYER.holdDistance;
    this.holdAim = null;
    this.carryY = null;
  }

  get p() { return this.g.player.body.pos; }
  get yaw() { return this.g.player.yaw; }
  eye() { return this.g.playerHead(); }
  fwd() {
    const { yaw, pitch } = this.g.player;
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  }

  note(msg) { this.log.push(`[t=${this.g.time.toFixed(1)}] ${msg}`); if (this.verbose) console.log(this.log.at(-1)); }

  lookAt(pt) {
    const e = this.eye();
    const dx = pt.x - e.x, dy = pt.y - e.y, dz = pt.z - e.z;
    this.g.player.yaw = Math.atan2(-dx, -dz);
    this.g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  /** Advance the simulation one frame. */
  tick(move = { x: 0, z: 0 }, jump = false) {
    if (this.g.held && this.holdAim) {
      this.lookAt(this.holdAim);
      const e = this.eye();
      const d = Math.min(2.3, Math.max(0.9, Math.hypot(this.holdAim.x - e.x, this.holdAim.y - e.y, this.holdAim.z - e.z)));
      const t = this.g.holdTargetFromView(e, this.fwd(), d);
      this.g.setHoldTarget(t.x, t.y, t.z);
    } else if (this.g.held) {
      if (this.carryY != null) {
        // Choose the pitch that keeps the carried object's bottom at carryY.
        const e = this.eye();
        const want = this.carryY + this.g.held.body.h / 2 - e.y;
        this.g.player.pitch = Math.asin(Math.max(-0.95, Math.min(0.95, want / this.holdDist)));
      }
      const t = this.g.holdTargetFromView(this.eye(), this.fwd(), this.holdDist);
      this.g.setHoldTarget(t.x, t.y, t.z);
    }
    this.g.update(DT, { move, jump });
    for (const e of this.g.drainEvents()) {
      this.events.push(e);
      if (['door-open', 'door-close', 'plate-on', 'plate-off', 'receiver-on', 'receiver-off', 'complete', 'clone-spawn', 'toast', 'laser-on', 'laser-off'].includes(e.type)) {
        this.note(`${e.type}${e.id ? ' ' + e.id : ''}${e.text ? ' "' + e.text + '"' : ''}`);
      }
    }
  }

  wait(sec) { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) this.tick(); }

  waitUntil(cond, timeout = 10, label = 'condition') {
    const n = Math.round(timeout / DT);
    for (let i = 0; i < n; i++) { if (cond()) return true; this.tick(); }
    if (cond()) return true;
    throw new Error(`Timed out waiting for ${label}`);
  }

  /**
   * Walk to (x,z). Options: speed, tol, timeout, jump (jump when blocked or
   * at start), face (keep looking where we walk).
   */
  walkTo(x, z, { speed = PLAYER.walkSpeed, tol = 0.12, timeout = 20, jumpAt = null, label } = {}) {
    const n = Math.round(timeout / DT);
    let jumped = false;
    for (let i = 0; i < n; i++) {
      const dx = x - this.p.x, dz = z - this.p.z;
      const d = Math.hypot(dx, dz);
      if (d < tol) { return true; }
      const s = Math.min(speed, d / DT);
      let jump = false;
      if (jumpAt && !jumped && jumpAt(this)) { jump = true; jumped = true; }
      if (!this.g.held || !this.holdAim) this.g.player.yaw = Math.atan2(-dx, -dz);
      this.tick({ x: (dx / d) * s, z: (dz / d) * s }, jump);
    }
    throw new Error(`walkTo(${x},${z}) failed${label ? ' (' + label + ')' : ''}: at ${this.p.x.toFixed(2)},${this.p.y.toFixed(2)},${this.p.z.toFixed(2)}`);
  }

  /** Path through several waypoints. */
  path(points, opts = {}) { for (const [x, z] of points) this.walkTo(x, z, opts); }

  /** Run toward (x,z) and jump once the player is within `dist` of the start edge. */
  jumpTo(x, z, { runup = 0.0, timeout = 6 } = {}) {
    const y0 = this.p.y;
    this.walkTo(x, z, {
      timeout,
      jumpAt: (b) => b.g.player.body.grounded && Math.abs(b.p.y - y0) < 0.01,
    });
    this.wait(0.4);
  }

  interact(pt) {
    this.lookAt(pt);
    const ok = this.g.interact(this.eye(), this.fwd());
    this.tick();
    if (!ok) throw new Error(`interact failed at ${JSON.stringify(pt)} from ${this.p.x.toFixed(2)},${this.p.z.toFixed(2)}`);
    return ok;
  }

  /** Fire the Kickback gun at a world point (or along yaw/pitch). */
  fire(pt) {
    if (pt) this.lookAt(pt);
    const h = this.g.fire(this.eye(), this.fwd());
    if (!h) throw new Error('gun did not fire (cooldown or no charges) at t=' + this.g.time.toFixed(2));
    return h;
  }

  fireDir(yaw, pitch) {
    this.g.player.yaw = yaw; this.g.player.pitch = pitch;
    const h = this.g.fire(this.eye(), this.fwd());
    if (!h) throw new Error('gun did not fire (cooldown or no charges)');
    return h;
  }

  /** Run frames while holding a movement velocity; stop early when cond() is true. */
  hold(move, sec, cond = null, jump = false) {
    const n = Math.round(sec / DT);
    for (let i = 0; i < n; i++) { if (cond && cond()) return true; this.tick(move, jump && i === 0); }
    return cond ? cond() : true;
  }

  rotateMirrorTo(id, step) {
    const m = this.g.mirrors.find((mm) => mm.id === id);
    const c = { x: m.body.pos.x, y: m.body.pos.y + 0.75, z: m.body.pos.z };
    let guard = 0;
    while (m.step !== step) {
      // Turn the shorter way, exactly like pressing E (clockwise) or Q.
      const diff = (step - m.step + 16) % 16;
      this.lookAt(c);
      const hit = this.g.pick(this.eye(), this.fwd());
      if (!hit || hit.obj !== m || hit.t > PLAYER.reach + 0.3) throw new Error(`mirror ${id} not reachable from ${this.p.x.toFixed(2)},${this.p.z.toFixed(2)}`);
      this.g.rotateMirror(m, diff <= 8 ? 1 : -1);
      this.wait(0.15);
      if (++guard > 20) throw new Error('rotate loop');
    }
  }

  grab(bodyOrId) {
    const body = typeof bodyOrId === 'string'
      ? (this.g.blocks.find((b) => b.id === bodyOrId) || this.g.mirrors.find((m) => m.id === bodyOrId).body)
      : bodyOrId;
    const c = { x: body.pos.x, y: body.pos.y + body.h / 2, z: body.pos.z };
    this.lookAt(c);
    const hit = this.g.pick(this.eye(), this.fwd());
    if (!hit || (hit.obj !== body && !(hit.obj && hit.obj.body === body))) throw new Error(`cannot see ${body.id || 'object'} to grab (hit ${hit && hit.kind})`);
    if (hit.t > PLAYER.reach + 0.3) throw new Error(`${body.id} out of reach (${hit.t.toFixed(2)})`);
    if (!this.g.grab(body)) throw new Error('grab refused');
    this.holdAim = c;
    this.tick();
    return body;
  }

  /** While holding: aim the held object's centre at `pt` and wait until it gets there. */
  placeHeld(pt, { tol = 0.04, timeout = 4 } = {}) {
    const b = this.g.held.body;
    this.holdAim = { x: pt.x, y: pt.y + b.h / 2, z: pt.z };
    const n = Math.round(timeout / DT);
    for (let i = 0; i < n; i++) {
      this.tick();
      if (Math.hypot(b.pos.x - pt.x, b.pos.y - pt.y, b.pos.z - pt.z) < tol) break;
    }
  }

  drop() {
    const b = this.g.held.body;
    if (!this.g.release()) throw new Error('release refused');
    this.holdAim = null;
    this.wait(0.8);
    return b;
  }

  /** Lift, carry and set down a body so that its bottom-centre lands near `dest`. */
  carry(id, dest, { via = [], liftY = null, standOff = 1.6 } = {}) {
    const body = this.grab(id);
    // Raise it a bit and carry it in front while walking.
    const e = this.eye();
    const carryY = liftY ?? Math.max(body.pos.y + 0.3, Math.max(this.p.y + 1.15, 1.2));
    this.placeHeld({ x: body.pos.x, y: carryY, z: body.pos.z }, { timeout: 1 });
    this.holdAim = null;
    this.holdDist = 1.4;
    this.carryY = carryY;
    for (const [x, z] of via) this.walkTo(x, z);
    // Approach a stand point short of the destination.
    const dx = dest.x - this.p.x, dz = dest.z - this.p.z, d = Math.hypot(dx, dz);
    if (d > standOff) this.walkTo(dest.x - (dx / d) * standOff, dest.z - (dz / d) * standOff);
    this.carryY = null;
    this.placeHeld({ x: dest.x, y: Math.max(dest.y + 0.15, carryY), z: dest.z }, { tol: 0.03 });
    this.placeHeld({ x: dest.x, y: dest.y + 0.15, z: dest.z }, { tol: 0.03 });
    this.drop();
    return body;
  }

  clone() { return this.g.clone; }
  input(id) { return this.g.inputOn(id); }
  door(id) { return this.g.doors.find((d) => d.id === id); }
}

export function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + msg); }
