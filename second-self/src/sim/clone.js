// The clone's mind. Rules (from the facility manual):
//  * It only reacts while it can SEE you: you must be inside its field of view
//    (in front of it) and nothing solid may block the line between its eyes and you.
//  * While it sees you it turns toward you and, once roughly facing you, walks
//    forward toward your current position. It never walks backward or sideways.
//  * The moment it loses sight of you it freezes exactly where it is.
//  * It is a physical body: gravity, collisions, it can step onto plates but
//    cannot climb ledges or walk through walls, crates or closed doors.

import { CLONE } from '../config.js';

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Yaw that faces from (x,z) toward (tx,tz). Forward vector = (-sin yaw, -cos yaw). */
export function yawTo(x, z, tx, tz) {
  return Math.atan2(-(tx - x), -(tz - z));
}

export class Clone {
  constructor(game, pod) {
    this.game = game;
    this.pod = pod;
    this.body = game.world.addBody({
      kind: 'clone',
      pos: { x: pod.x, y: pod.y + 0.05, z: pod.z },
      hx: CLONE.radius, hz: CLONE.radius, h: CLONE.height,
      seeThrough: false,
    });
    this.body.clone = this;
    this.yaw = pod.yaw;
    this.state = 'spawning'; // spawning | frozen | turning | walking | waiting | blocked
    this.spawnT = 0;
    this.seeT = 0;
    this.sees = false;
    this.waiting = false;
    this.farT = 0;
    this.walkPhase = 0;
    this.speed = 0;          // current forward speed (for animation)
    this.stepDist = 0;       // distance since last footstep (audio)
    this.blockedT = 0;
    this.removed = false;
  }

  get pos() { return this.body.pos; }

  eyePos() {
    return { x: this.body.pos.x, y: this.body.pos.y + CLONE.eye, z: this.body.pos.z };
  }

  /** True if the player is inside the view cone and in clear line of sight. */
  canSeePlayer() {
    const g = this.game;
    const eye = this.eyePos();
    const head = g.playerHead();
    const dx = head.x - eye.x, dz = head.z - eye.z;
    const dist = Math.hypot(dx, dz);
    if (dist > CLONE.viewDistance) return { sees: false, dist, ang: 0 };
    const ang = dist < 1e-4 ? 0 : wrapAngle(yawTo(eye.x, eye.z, head.x, head.z) - this.yaw);
    if (Math.abs(ang) > CLONE.fov) return { sees: false, dist, ang };
    const chest = { x: head.x, y: g.player.body.pos.y + 1.0, z: head.z };
    const skip = (bx) => bx.body === this.body || bx.body === g.player.body ||
      (g.held && bx.body === g.held.body);
    const clear = g.world.segmentClear(eye, head, skip) || g.world.segmentClear(eye, chest, skip);
    return { sees: clear, dist, ang };
  }

  update(dt, solids) {
    const w = this.game.world;
    if (this.state === 'spawning') {
      this.spawnT += dt;
      w.applyGravity(this.body, dt, solids);
      if (this.spawnT >= CLONE.spawnTime) this.state = 'frozen';
      this.speed = 0;
      return;
    }

    const v = this.canSeePlayer();
    this.sees = v.sees;
    let moved = 0;

    if (!v.sees) {
      this.seeT = 0;
      this.farT = 0;
      this.state = 'frozen';
    } else {
      this.seeT += dt;
      if (this.seeT >= CLONE.notice) {
        // Turn toward the player (rate limited).
        const maxTurn = CLONE.turnRate * dt;
        const turn = Math.max(-maxTurn, Math.min(maxTurn, v.ang));
        this.yaw = wrapAngle(this.yaw + turn);
        const remaining = Math.abs(v.ang - turn);

        const limit = this.waiting ? CLONE.resumeDistance : CLONE.stopDistance;
        if (v.dist <= limit + 0.03) {
          this.waiting = true;
          this.farT = 0;
          this.state = 'waiting';
        } else if (this.waiting && this.farT < CLONE.resumeDelay) {
          // Pause a beat before following again (gives you time to slip away).
          this.farT += dt;
          this.state = 'waiting';
        } else if (remaining < CLONE.walkCone) {
          this.waiting = false;
          const step = Math.min(CLONE.speed * dt, v.dist - CLONE.stopDistance);
          const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
          const before = { x: this.body.pos.x, z: this.body.pos.z };
          w.moveHorizontal(this.body, fx * step, fz * step, solids, CLONE.step);
          moved = Math.hypot(this.body.pos.x - before.x, this.body.pos.z - before.z);
          if (step > 0.004 && moved < step * 0.25) { this.blockedT += dt; this.state = 'blocked'; }
          else { this.blockedT = 0; this.state = 'walking'; }
        } else {
          this.state = 'turning';
        }
      }
    }

    w.applyGravity(this.body, dt, solids);
    this.speed = dt > 0 ? moved / dt : 0;
    if (moved > 0) {
      this.walkPhase += moved * 3.2;
      this.stepDist += moved;
      if (this.stepDist > 0.62) { this.stepDist = 0; this.game.emit('clone-step', { x: this.body.pos.x, z: this.body.pos.z }); }
    }
  }
}
