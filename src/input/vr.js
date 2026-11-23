// WebXR controller handling (Meta Quest and other xr-standard controllers).
//   Left stick: walk (smooth mode)   Right stick: snap turn / push forward to aim a teleport
//   Grip: grab (near or by pointing)  Trigger: use / turn mirror / press button
//   A: jump   B: create clone   X: reset clone   Y: menu
import * as THREE from 'three';
import { Hand } from '../render/hands.js';
import { PhysicsWorld, bodyBox } from '../sim/physics.js';
import { PLAYER, MIRROR_STEPS } from '../config.js';

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpV2 = new THREE.Vector3();

export class VRControls {
  constructor(app) {
    this.app = app;
    const r = app.renderer;
    this.ctrls = [0, 1].map((i) => {
      const ray = r.xr.getController(i);
      const grip = r.xr.getControllerGrip(i);
      app.rig.add(ray); app.rig.add(grip);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x8cbcff, transparent: true, opacity: 0.5 });
      const line = new THREE.Line(lineGeo, lineMat);
      line.scale.z = 0.35;
      ray.add(line);
      const c = { i, ray, grip, line, lineMat, hand: null, handed: null, gp: null, prev: [], prevAxes: [0, 0, 0, 0], twist: null, pressCooldown: 0 };
      ray.addEventListener('connected', (e) => {
        c.handed = e.data.handedness;
        c.gp = e.data.gamepad;
        if (c.hand) grip.remove(c.hand.root);
        c.hand = new Hand(c.handed === 'left' ? 'left' : 'right');
        // Grip space: palm faces the controller. Roll the hand so its palm faces inward.
        c.hand.root.rotation.set(-0.35, 0, c.handed === 'left' ? Math.PI / 2 : -Math.PI / 2);
        c.hand.root.position.set(c.handed === 'left' ? 0.01 : -0.01, -0.01, 0.06);
        grip.add(c.hand.root);
      });
      ray.addEventListener('disconnected', () => { c.gp = null; c.handed = null; });
      return c;
    });

    // Teleport arc
    const N = 40;
    this.arcPts = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.arcPts, 3));
    this.arcMat = new THREE.LineBasicMaterial({ color: 0x8cbcff, transparent: true, opacity: 0.8 });
    this.arc = new THREE.Line(g, this.arcMat);
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    app.scene.add(this.arc);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 32), new THREE.MeshBasicMaterial({ color: 0x8cbcff, transparent: true, opacity: 0.8, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    app.scene.add(this.marker);
    this.teleportTarget = null;
    this.aiming = false;

    // Comfort vignette
    const vc = document.createElement('canvas');
    vc.width = vc.height = 256;
    const vctx = vc.getContext('2d');
    const grd = vctx.createRadialGradient(128, 128, 60, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.7, 'rgba(0,0,0,0.75)'); grd.addColorStop(1, 'rgba(0,0,0,1)');
    vctx.fillStyle = grd; vctx.fillRect(0, 0, 256, 256);
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(vc), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.vignette.position.z = -0.12;
    this.vignette.renderOrder = 1000;
    app.camera.add(this.vignette);
    this.vigAmount = 0;

    this.raycaster = new THREE.Raycaster();
    this.move = { x: 0, z: 0 };
    this.jump = false;
    this.snapCooldown = 0;
  }

  setActive(on) {
    for (const c of this.ctrls) { c.ray.visible = on; c.grip.visible = on; }
    if (!on) { this.arc.visible = false; this.marker.visible = false; this.vignette.material.opacity = 0; }
  }

  pressed(c, i) { return !!(c.gp && c.gp.buttons[i] && c.gp.buttons[i].pressed); }
  down(c, i) { return this.pressed(c, i) && !c.prev[i]; }
  up(c, i) { return !this.pressed(c, i) && c.prev[i]; }
  value(c, i) { return c.gp && c.gp.buttons[i] ? c.gp.buttons[i].value : 0; }
  axes(c) {
    if (!c.gp) return [0, 0];
    const a = c.gp.axes;
    // xr-standard puts the thumbstick on axes 2/3; some runtimes use 0/1.
    const x = a.length >= 4 ? a[2] : a[0] || 0, y = a.length >= 4 ? a[3] : a[1] || 0;
    return [Math.abs(x) > 0.15 ? x : 0, Math.abs(y) > 0.15 ? y : 0];
  }

  rayOf(c) {
    c.ray.getWorldPosition(tmpV);
    c.ray.getWorldQuaternion(tmpQ);
    const dir = tmpV2.set(0, 0, -1).applyQuaternion(tmpQ).normalize();
    return { o: { x: tmpV.x, y: tmpV.y, z: tmpV.z }, d: { x: dir.x, y: dir.y, z: dir.z }, q: tmpQ.clone(), p: tmpV.clone(), dv: dir.clone() };
  }

  gripPose(c) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    c.grip.getWorldPosition(p); c.grip.getWorldQuaternion(q);
    return { p, q };
  }

  /** Called once per frame. Returns { move, jump, teleport }. */
  update(dt) {
    const app = this.app;
    const out = { move: { x: 0, z: 0 }, jump: false, teleport: null };
    const left = this.ctrls.find((c) => c.handed === 'left');
    const right = this.ctrls.find((c) => c.handed === 'right');
    for (const c of this.ctrls) {
      if (c.hand) {
        const grip = this.value(c, 1), trig = this.value(c, 0);
        const holding = app.game && app.game.held && app.game.held.hand === c.i;
        c.hand.setTarget({ curl: holding ? 0.95 : 0.25 + grip * 0.7, point: trig > 0.5 ? 0 : (grip > 0.5 ? 0.85 : 0.6), thumb: 0.2 + grip * 0.6 });
        c.hand.update(dt);
      }
      c.pressCooldown = Math.max(0, c.pressCooldown - dt);
    }

    const panel = app.vrPanel;
    if (panel.isOpen) {
      let hovered = -1;
      for (const c of this.ctrls) {
        const r = this.rayOf(c);
        this.raycaster.set(r.p, r.dv);
        const i = panel.hitTest(this.raycaster);
        if (i >= 0) hovered = i;
        c.line.scale.z = i >= 0 ? 1.4 : 0.6;
        c.lineMat.opacity = 0.8;
        if (i >= 0 && this.down(c, 0)) { panel.click(i); }
      }
      panel.setHover(hovered);
      this._endFrame();
      this.arc.visible = false; this.marker.visible = false;
      return out;
    }
    if (app.state !== 'playing' || !app.game) { this._endFrame(); return out; }
    const game = app.game;

    // ---------------- Locomotion
    const head = app.headWorld();
    const camQ = new THREE.Quaternion();
    app.camera.getWorldQuaternion(camQ);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQ); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const rightV = new THREE.Vector3(-fwd.z, 0, fwd.x);
    let moving = 0;
    if (left && app.save.settings.vrMovement === 'smooth') {
      const [x, y] = this.axes(left);
      const sp = PLAYER.walkSpeed * 0.85;
      out.move.x = (rightV.x * x - fwd.x * y) * sp;
      out.move.z = (rightV.z * x - fwd.z * y) * sp;
      moving = Math.min(1, Math.hypot(x, y));
    }

    // ---------------- Snap turn + teleport (right stick)
    this.snapCooldown = Math.max(0, this.snapCooldown - dt);
    if (right) {
      const [x, y] = this.axes(right);
      if (Math.abs(x) > 0.7 && this.snapCooldown === 0 && !this.aiming) {
        app.snapTurn(-Math.sign(x) * (app.save.settings.vrSnapAngle * Math.PI / 180));
        this.snapCooldown = 0.35;
        this.vigAmount = 1;
      }
      if (y < -0.65) {
        this.aiming = true;
        this._aimTeleport(right, game);
      } else if (this.aiming && y > -0.3) {
        this.aiming = false;
        this.arc.visible = false; this.marker.visible = false;
        if (this.teleportTarget) { out.teleport = this.teleportTarget; this.vigAmount = 1; }
        this.teleportTarget = null;
      }
    }
    if (left && app.save.settings.vrMovement === 'teleport') {
      const [, y] = this.axes(left);
      if (y < -0.65 && !this.aiming) { this.aimingLeft = true; this._aimTeleport(left, game); }
      else if (this.aimingLeft && y > -0.3) {
        this.aimingLeft = false;
        this.arc.visible = false; this.marker.visible = false;
        if (this.teleportTarget) { out.teleport = this.teleportTarget; this.vigAmount = 1; }
        this.teleportTarget = null;
      }
    }

    // ---------------- Face buttons
    if (right && this.pressed(right, 4)) out.jump = true;
    if (right && this.down(right, 5)) app.doCreateClone();
    if (left && this.down(left, 4)) app.doResetClone();
    if (left && this.down(left, 5)) { app.pause(); this._endFrame(); return out; }

    // ---------------- Hands: grab, use, press
    for (const c of this.ctrls) {
      if (!c.gp) continue;
      const r = this.rayOf(c);
      const g = this.gripPose(c);
      const heldHere = game.held && game.held.hand === c.i;

      // Physical press: poke a wall switch with your hand.
      if (c.pressCooldown === 0) {
        for (const b of game.buttons) {
          const bx = b.box;
          const m = 0.06;
          if (g.p.x > bx.min[0] - m && g.p.x < bx.max[0] + m && g.p.y > bx.min[1] - m && g.p.y < bx.max[1] + m && g.p.z > bx.min[2] - m && g.p.z < bx.max[2] + m) {
            game.pressButton(b); c.pressCooldown = 1.0; this._pulse(c, 0.6, 60);
            if (c.hand) c.hand.setTarget({ point: 1, curl: 0.9 });
          }
        }
      }

      // Squeeze: grab
      if (this.down(c, 1) && !game.held) {
        let target = this._nearGrab(game, g.p);
        let distance = false;
        if (!target) {
          const hit = game.pick(r.o, r.d, 3.2);
          if (hit && (hit.kind === 'block' || (hit.kind === 'mirror' && hit.obj.portable))) { target = hit.kind === 'block' ? hit.obj : hit.obj.body; distance = true; }
          else if (hit && hit.kind === 'mirror') {
            c.twist = { mirror: hit.obj, yaw0: this._yaw(g.q), step0: hit.obj.step };
            this._pulse(c, 0.4, 30);
          }
        }
        if (target && game.grab(target, c.i)) {
          const center = new THREE.Vector3(target.pos.x, target.pos.y + target.h / 2, target.pos.z);
          if (distance) center.copy(g.p).addScaledVector(r.dv, 0.25 + Math.max(target.hx, target.hz));
          const inv = g.q.clone().invert();
          c.grab = { offset: center.sub(g.p).applyQuaternion(inv), yaw0: this._yaw(g.q), steps: 0 };
          this._pulse(c, 0.5, 40);
        }
      }
      if (this.up(c, 1)) {
        if (heldHere) { game.release(); c.grab = null; this._pulse(c, 0.3, 30); }
        c.twist = null;
      }
      // Twist a fixed mirror while gripping it
      if (c.twist) {
        const d = this._wrap(this._yaw(g.q) - c.twist.yaw0);
        const want = c.twist.step0 - Math.round(d / (2 * Math.PI / MIRROR_STEPS));
        const m = c.twist.mirror;
        if (((want % MIRROR_STEPS) + MIRROR_STEPS) % MIRROR_STEPS !== m.step) {
          game.setMirrorStep(m, want);
          game.emit('mirror-rotate', { x: m.body.pos.x, y: m.body.pos.y, z: m.body.pos.z });
          this._pulse(c, 0.25, 20);
        }
      }
      // Carry
      if (heldHere && c.grab) {
        const pos = c.grab.offset.clone().applyQuaternion(g.q).add(g.p);
        const b = game.held.body;
        game.setHoldTarget(pos.x, pos.y - b.h / 2, pos.z);
        const unit = b.kind === 'mirror' ? (2 * Math.PI / MIRROR_STEPS) : Math.PI / 2;
        const d = this._wrap(this._yaw(g.q) - c.grab.yaw0);
        const steps = -Math.round(d / unit);
        while (c.grab.steps < steps) { game.rotateHeld(1); c.grab.steps++; }
        while (c.grab.steps > steps) { game.rotateHeld(-1); c.grab.steps--; }
      }

      // Trigger: use what you point at
      let hit = null;
      if (!heldHere) hit = game.pick(r.o, r.d, PLAYER.reach + 0.6);
      const usable = hit && hit.t <= PLAYER.reach + 0.3 && hit.kind !== 'block';
      c.line.scale.z = usable ? hit.t : (hit && hit.kind === 'block' && hit.t < 3.2 ? hit.t : 0.35);
      c.lineMat.color.setHex(usable ? 0x8cbcff : 0xffffff);
      c.lineMat.opacity = usable || (hit && hit.kind === 'block') ? 0.85 : 0.3;
      if (this.down(c, 0)) {
        if (heldHere) game.rotateHeld(1);
        else if (usable) { game.interact(r.o, r.d); this._pulse(c, 0.4, 30); }
      }
    }

    // Vignette
    const vigTarget = app.save.settings.vrVignette ? Math.max(moving * 0.85, this.vigAmount) : 0;
    this.vigAmount = Math.max(0, this.vigAmount - dt * 2.5);
    const vm = this.vignette.material;
    vm.opacity += (vigTarget - vm.opacity) * Math.min(1, dt * 8);
    this.vignette.visible = vm.opacity > 0.01;

    this._endFrame();
    return out;
  }

  _nearGrab(game, p) {
    let best = null, bd = 0.16;
    for (const b of game.world.bodies) {
      if (!game.grabbable(b)) continue;
      const bx = bodyBox(b);
      const dx = Math.max(bx.min[0] - p.x, 0, p.x - bx.max[0]);
      const dy = Math.max(bx.min[1] - p.y, 0, p.y - bx.max[1]);
      const dz = Math.max(bx.min[2] - p.z, 0, p.z - bx.max[2]);
      const d = Math.hypot(dx, dy, dz);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  _aimTeleport(c, game) {
    const r = this.rayOf(c);
    const v0 = 7.5, gArc = 9.8, step = 0.03;
    let x = r.o.x, y = r.o.y, z = r.o.z;
    let vx = r.d.x * v0, vy = r.d.y * v0, vz = r.d.z * v0;
    let n = 0, hitPt = null;
    const N = this.arcPts.length / 3;
    for (; n < N; n++) {
      this.arcPts[n * 3] = x; this.arcPts[n * 3 + 1] = y; this.arcPts[n * 3 + 2] = z;
      const nx = x + vx * step, ny = y + vy * step, nz = z + vz * step;
      const seg = { x: nx - x, y: ny - y, z: nz - z };
      const len = Math.hypot(seg.x, seg.y, seg.z);
      const d = { x: seg.x / len, y: seg.y / len, z: seg.z / len };
      let best = len, bestBox = null;
      const test = (bx) => { const t = PhysicsWorld.rayBox({ x, y, z }, d, bx, best); if (t >= 0 && t < best) { best = t; bestBox = bx; } };
      for (const s of game.world.statics) test(s);
      for (const f of game.world.dynamicSolids) { const bx = f(); if (bx) test(bx); }
      for (const b of game.world.bodies) if (b.kind !== 'player' && !b.removed && !b.held) test(bodyBox(b));
      if (bestBox) {
        hitPt = { x: x + d.x * best, y: y + d.y * best, z: z + d.z * best, top: Math.abs(y + d.y * best - bestBox.max[1]) < 0.03 };
        n++;
        this.arcPts[n * 3] = hitPt.x; this.arcPts[n * 3 + 1] = hitPt.y; this.arcPts[n * 3 + 2] = hitPt.z;
        break;
      }
      x = nx; y = ny; z = nz; vy -= gArc * step;
    }
    for (let k = n + 1; k < N; k++) { this.arcPts[k * 3] = this.arcPts[n * 3]; this.arcPts[k * 3 + 1] = this.arcPts[n * 3 + 1]; this.arcPts[k * 3 + 2] = this.arcPts[n * 3 + 2]; }
    this.arc.geometry.attributes.position.needsUpdate = true;
    this.arc.visible = true;
    let ok = false;
    if (hitPt && hitPt.top) {
      // Check the player fits there and the spot is not much higher than a jump.
      const pb = game.player.body;
      const ox = pb.pos.x, oy = pb.pos.y, oz = pb.pos.z;
      pb.pos.x = hitPt.x; pb.pos.y = hitPt.y + 0.02; pb.pos.z = hitPt.z;
      const solids = game.world.solidsFor(pb, []);
      ok = !game.world.overlapsAny(pb, solids) && hitPt.y - oy < 1.2;
      pb.pos.x = ox; pb.pos.y = oy; pb.pos.z = oz;
    }
    this.teleportTarget = ok ? { x: hitPt.x, y: hitPt.y, z: hitPt.z } : null;
    this.arcMat.color.setHex(ok ? 0x8cbcff : 0xff6a5a);
    this.marker.visible = !!hitPt;
    if (hitPt) { this.marker.position.set(hitPt.x, hitPt.y + 0.02, hitPt.z); this.marker.material.color.setHex(ok ? 0x8cbcff : 0xff6a5a); }
  }

  /** Heading of the controller around the vertical axis. */
  _yaw(q) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    return Math.atan2(-f.x, -f.z);
  }

  _wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  _pulse(c, intensity, ms) {
    try {
      const h = c.gp && c.gp.hapticActuators && c.gp.hapticActuators[0];
      if (h && h.pulse) h.pulse(intensity, ms);
    } catch (e) { /* ignore */ }
  }

  _endFrame() {
    for (const c of this.ctrls) {
      if (!c.gp) continue;
      c.prev = c.gp.buttons.map((b) => b.pressed);
    }
  }
}
