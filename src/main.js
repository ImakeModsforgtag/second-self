// SECOND SELF: application shell. Wires the simulation, renderer, input,
// audio and menus together, for both desktop and WebXR (VR) play.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Game } from './sim/game.js';
import { LEVELS } from './levels/levels.js';
import { View } from './render/view.js';
import { Hand } from './render/hands.js';
import { Audio } from './audio/audio.js';
import { Menu } from './ui/menu.js';
import { VRPanel } from './ui/vrpanel.js';
import { VRControls } from './input/vr.js';
import { DesktopInput } from './input/desktop.js';
import { loadSave, writeSave, PLAYER } from './config.js';
import { GunModel } from './render/gun.js';
import { skyTexture } from './render/textures.js';
import { Multiplayer } from './mp/session.js';

const EVENT_SOUNDS = {
  'clone-step': 'clone-step', jump: 'jump', pickup: 'pickup', drop: 'drop', thud: 'thud',
  'clone-spawn': 'clone-spawn', 'clone-remove': 'clone-remove', 'plate-on': 'plate-on', 'plate-off': 'plate-off',
  button: 'button', 'button-off': 'plate-off', 'laser-on': 'laser-on', 'laser-off': 'laser-off',
  'receiver-on': 'receiver-on', 'receiver-off': 'receiver-off', 'mirror-rotate': 'mirror',
  'door-open': 'door-open', 'door-close': 'door-close', 'rotate-held': 'rotate', teleport: 'teleport', socket: 'drop',
};

class App {
  constructor() {
    this.save = loadSave();
    this.state = 'menu';
    this.levelIndex = 1;
    this.game = null;
    this.view = null;
    this.inXR = false;
    this.holdDist = PLAYER.holdDistance;
    this.bob = 0;
    this.clock = new THREE.Clock();
    this.lastStats = '';

    // ---------------- Renderer
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    document.getElementById('app').appendChild(r.domElement);
    this.renderer = r;

    // ---------------- Scene, camera, rig
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x15171a);
    this.scene.fog = new THREE.Fog(0x2a2c30, 30, 70);
    this.camera = new THREE.PerspectiveCamera(this.save.settings.fov, window.innerWidth / window.innerHeight, 0.03, 120);
    this.rig = new THREE.Group();
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    // Reflections for mirrors only (keeps the concrete matte and cheap).
    const pmrem = new THREE.PMREMGenerator(r);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // ---------------- Lights
    this.hemi = new THREE.HemisphereLight(0xeef1f5, 0x6a6c70, 1.55);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfffaf0, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 4;
    const sc = this.sun.shadow.camera;
    sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 60;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // A few soft room lights that follow the nearest ceiling fixtures.
    this.lamps = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xfff6e8, 0, 11, 1.6);
      this.scene.add(l);
      this.lamps.push(l);
    }
    this.sunDir = new THREE.Vector3(0.32, -1, 0.22).normalize();

    // ---------------- First-person hands (desktop: attached to the camera)
    this.handR = new Hand('right');
    this.handL = new Hand('left');
    this.camera.add(this.handR.root);
    this.camera.add(this.handL.root);
    this.handAnim = { poke: 0, clone: 0, grabT: 0 };
    this.gun = new GunModel();
    this.gun.root.visible = false;
    this.camera.add(this.gun.root);

    // ---------------- Systems
    this.audio = new Audio();
    this.menu = new Menu(this);
    this.mp = new Multiplayer(this);
    this.vrPanel = new VRPanel(this);
    this.scene.add(this.vrPanel.mesh);
    this.scene.add(this.vrPanel.hint);
    this.vr = new VRControls(this);
    this.vr.setActive(false);
    this.input = new DesktopInput(this, r.domElement);

    this.applySettings();
    this._setupVR();
    this._loadMenuBackdrop();

    window.addEventListener('resize', () => this._resize());
    r.setAnimationLoop((t, frame) => this._frame(t, frame));
    this.menu.show('main');
  }

  persist() { writeSave(this.save); }

  applySettings() {
    const s = this.save.settings;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setVolume(s.volume);
    this.audio.setAmbience(s.ambience);
    const shadowsOn = s.shadows !== 'off';
    this.sun.castShadow = shadowsOn;
    const size = s.shadows === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.persist();
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------ VR
  async _setupVR() {
    if (!('xr' in navigator)) {
      this.menu.setVRStatus(false, 'VR needs a WebXR browser (for example the Meta Quest Browser) over HTTPS.');
      return;
    }
    try {
      const ok = await navigator.xr.isSessionSupported('immersive-vr');
      this.menu.setVRStatus(ok, ok ? '' : 'No VR headset detected. Desktop mode is ready to play.');
    } catch (e) {
      this.menu.setVRStatus(false, 'VR is not available in this browser.');
    }
  }

  async enterVR() {
    if (this.inXR || !navigator.xr) return;
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      this.audio.init();
      session.addEventListener('end', () => this._onXREnd());
      await this.renderer.xr.setSession(session);
      try { this.renderer.xr.setFoveation(1); } catch (e) { /* ignore */ }
      this.inXR = true;
      this.input.unlock();
      this.handR.root.visible = false;
      this.handL.root.visible = false;
      this.vr.setActive(true);
      this.gun.root.visible = false;
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      if (this.save.settings.shadows === 'high') { this.sun.shadow.mapSize.set(1024, 1024); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
      this.menu.hideAll();
      document.getElementById('hud').classList.add('hidden');
      if (this.state === 'playing' && this.game) { this._placeRigAt(this.game.player.body.pos, this.game.player.yaw); }
      else if (this.state === 'menu' || this.state === 'complete' || this.state === 'final') {
        this.vrPanelPending = this.state === 'complete' ? 'complete' : this.state === 'final' ? 'final' : 'main';
      } else if (this.state === 'paused') this.vrPanelPending = 'pause';
    } catch (e) {
      this.menu.toast('Could not start VR: ' + (e.message || e));
    }
  }

  exitVR() { const s = this.renderer.xr.getSession(); if (s) s.end(); }

  _onXREnd() {
    this.inXR = false;
    this.vr.setActive(false);
    this.vrPanel.close();
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.handR.root.visible = true;
    this.handL.root.visible = true;
    if (this.gun.root.parent !== this.camera) this.camera.add(this.gun.root);
    this.applySettings();
    if (this.game) this.game.player.headOverride = null;
    if (this.state === 'playing') this.pause();
    else if (this.state === 'menu') this.menu.show('main');
    else if (this.state === 'complete') this.menu.showComplete(this.levelIndex, this.lastStats);
    else if (this.state === 'final') this.menu.showFinal(this.lastStats);
  }

  headWorld() {
    const v = this.camera.position.clone();
    this.rig.localToWorld(v);
    return v;
  }

  /** Put the rig so the headset sits over `pos`, looking along `yaw`. */
  _placeRigAt(pos, yaw) {
    const cam = this.camera;
    const local = cam.position.clone();
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.rig.rotation.y = yaw - e.y;
    this.rig.updateMatrixWorld();
    const off = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rig.rotation.y);
    this.rig.position.set(pos.x - off.x, pos.y, pos.z - off.z);
    this.rig.updateMatrixWorld();
  }

  snapTurn(angle) {
    const before = this.headWorld();
    this.rig.rotation.y += angle;
    this.rig.updateMatrixWorld();
    const after = this.headWorld();
    this.rig.position.x += before.x - after.x;
    this.rig.position.z += before.z - after.z;
    this.rig.updateMatrixWorld();
  }

  /** Room-scale: keep the collision body under the headset, and stop the head entering walls. */
  _syncVRBody() {
    const g = this.game;
    const pb = g.player.body;
    this.rig.updateMatrixWorld();
    const head = this.headWorld();
    const dx = head.x - pb.pos.x, dz = head.z - pb.pos.z;
    if (Math.hypot(dx, dz) > 1.2) {
      this.rig.position.x -= dx; this.rig.position.z -= dz;
    } else {
      const solids = g.world.solidsFor(pb, []);
      g.world.moveHorizontal(pb, dx, dz, solids, PLAYER.step);
      this.rig.position.x += pb.pos.x - head.x;
      this.rig.position.z += pb.pos.z - head.z;
    }
    this.rig.updateMatrixWorld();
    const h = this.headWorld();
    g.player.headOverride = { x: pb.pos.x, y: Math.max(pb.pos.y + 0.5, h.y), z: pb.pos.z };
    const q = new THREE.Quaternion();
    this.camera.getWorldQuaternion(q);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    g.player.yaw = e.y; g.player.pitch = e.x;
  }

  // ------------------------------------------------------------ level flow
  _loadMenuBackdrop() {
    this._disposeLevel();
    this.game = new Game(LEVELS[0]);
    this.view = new View(this.game, this.scene, { settings: this.save.settings });
    this._applyEnv();
    this.backdrop = true;
    this.menuT = 0;
  }

  _disposeLevel() {
    if (this.view) this.view.dispose();
    this.view = null;
    this.game = null;
  }

  _applyEnv() {
    for (const v of this.view.mirrorViews) { v.glassMat.envMap = this.envMap; v.glassMat.needsUpdate = true; }
    const sky = !!this.game.def.sky;
    if (sky) {
      this.scene.background = skyTexture();
      this.scene.fog = new THREE.Fog(0xcfdff0, 45, 160);
      this.hemi.color.setHex(0xdfeeff); this.hemi.groundColor.setHex(0x8a96a6); this.hemi.intensity = 1.5;
      this.sun.intensity = 2.3;
      this.sunDir.set(0.45, -1, 0.3).normalize();
    } else {
      this.scene.background = new THREE.Color(0x15171a);
      this.scene.fog = new THREE.Fog(0x2a2c30, 30, 70);
      this.hemi.color.setHex(0xeef1f5); this.hemi.groundColor.setHex(0x6a6c70); this.hemi.intensity = 1.55;
      this.sun.intensity = 1.5;
      this.sunDir.set(0.32, -1, 0.22).normalize();
    }
    this.sun.shadow.camera.far = sky ? 90 : 60;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.gun.root.visible = !!this.game.hasGun && !this.inXR && !this.backdrop;
    document.getElementById('ammo').classList.toggle('hidden', !this.game.hasGun);
  }

  startLevel(id) {
    id = Math.max(1, Math.min(LEVELS.length, id));
    if (id > this.save.unlocked) return;
    this.audio.init();
    this.levelIndex = id;
    this._disposeLevel();
    this.backdrop = false;
    const def = LEVELS[id - 1];
    this.game = new Game(def);
    this.view = new View(this.game, this.scene, { settings: this.save.settings });
    this._applyEnv();
    this.state = 'playing';
    this.holdDist = PLAYER.holdDistance;
    this.levelStart = performance.now();
    this.menu.clearHUD();
    this.menu.hideAll();
    this.menu.setLevelTag(`Chamber ${String(id).padStart(2, '0')}  ${def.name}`);
    this.menu.fade(true);
    setTimeout(() => this.menu.fade(false), 60);
    if (this.inXR) {
      this.vrPanel.close();
      this._placeRigAt(this.game.player.body.pos, this.game.player.yaw);
    } else {
      this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0);
      this.input.lock();
    }
  }

  /** Co-op: build the chamber the server started, for this team size. */
  startNetLevel(def, playerIds, localId, roster, count, pos) {
    this.audio.init();
    this._disposeLevel();
    this.backdrop = false;
    this.game = new Game(def, { players: playerIds, localId, netClient: true });
    this.mp.installWrappers(this.game);
    if (pos) {
      const b = this.game.player.body.pos;
      b.x = pos[0]; b.y = pos[1]; b.z = pos[2];
      this.game.player.yaw = pos[3];
    }
    this.view = new View(this.game, this.scene, { settings: this.save.settings, roster });
    this._applyEnv();
    this.state = 'playing';
    this.holdDist = PLAYER.holdDistance;
    this.levelStart = performance.now();
    this.menu.clearHUD();
    this.menu.hideAll();
    this.menu.setLevelTag(`Co-op ${def.id}  ${def.name}  (${count} players)`);
    this.menu.fade(true);
    setTimeout(() => this.menu.fade(false), 60);
    if (this.inXR) {
      this.vrPanel.close();
      this._placeRigAt(this.game.player.body.pos, this.game.player.yaw);
    } else {
      this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0);
      this.input.lock();
    }
  }

  /** Back to the menu backdrop without leaving the lobby. */
  toBackdrop() {
    this.state = 'menu';
    this.input.unlock();
    this._loadMenuBackdrop();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.keys.clear();
    const page = this.mp.inGame ? 'mppause' : 'pause';
    if (this.mp.inGame) this.mp._renderPlayerList();
    if (this.inXR) this.vrPanel.open(page, this.camera);
    else { this.input.unlock(); this.menu.show(page); }
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menu.hideAll();
    this.vrPanel.close();
    if (!this.inXR) this.input.lock();
    this.clock.getDelta();
  }

  toMainMenu() {
    this.state = 'menu';
    this.input.unlock();
    this._loadMenuBackdrop();
    if (this.inXR) this.vrPanel.open('main', this.camera);
    else this.menu.show('main');
  }

  _complete(final) {
    const secs = (performance.now() - this.levelStart) / 1000;
    const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
    this.lastStats = `Time ${m}:${String(s).padStart(2, '0')}   Clones created ${this.game.clonesCreated}`;
    this.save.completed[this.levelIndex] = true;
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVELS.length, this.levelIndex + 1));
    this.persist();
    this.state = final ? 'final' : 'complete';
    this.audio.play('complete');
    if (this.inXR) this.vrPanel.open(final ? 'final' : 'complete', this.camera);
    else {
      this.input.unlock();
      if (final) this.menu.showFinal(this.lastStats);
      else this.menu.showComplete(this.levelIndex, this.lastStats);
    }
  }

  // ------------------------------------------------------------ actions
  _viewRay() {
    const e = this.game.playerHead();
    const { yaw, pitch } = this.game.player;
    const d = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    return { e, d };
  }

  desktopGrab() {
    const g = this.game;
    if (g.held) { g.release(); return; }
    const { e, d } = this._viewRay();
    const hit = g.pick(e, d);
    if (!hit || hit.t > PLAYER.reach + 0.3) return;
    if (hit.kind === 'block') g.grab(hit.obj);
    else if (hit.kind === 'mirror') { if (hit.obj.portable) g.grab(hit.obj.body); else g.rotateMirror(hit.obj, 1); }
    else g.interact(e, d);
    this.handAnim.poke = 0.25;
  }

  desktopInteract() {
    const g = this.game;
    if (g.held) { g.rotateHeld(1); return; }
    const { e, d } = this._viewRay();
    if (g.interact(e, d)) this.handAnim.poke = 0.3;
  }

  desktopRotate(dir) {
    const g = this.game;
    if (g.held) { g.rotateHeld(dir); return; }
    const { e, d } = this._viewRay();
    const hit = g.pick(e, d);
    if (hit && hit.kind === 'mirror' && hit.t <= PLAYER.reach + 0.3) { g.rotateMirror(hit.obj, dir); this.handAnim.poke = 0.3; }
  }

  /** Fire the Kickback gun from the view (desktop) or from a controller (VR). */
  fireGun(origin, dir) {
    const g = this.game;
    if (this.state !== 'playing' || !g || !g.hasGun) return;
    if (!origin) { const r = this._viewRay(); origin = r.e; dir = r.d; }
    const hit = g.fire(origin, dir);
    if (!hit) return;
    this.gun.fire();
    const from = this.gun.root.visible || this.gun.root.parent !== this.camera ? this.gun.muzzleWorld() : new THREE.Vector3(origin.x, origin.y - 0.15, origin.z);
    const to = hit.point ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : new THREE.Vector3(origin.x + dir.x * 40, origin.y + dir.y * 40, origin.z + dir.z * 40);
    this.view.addTracer(from, to, hit.kicked);
  }

  doCreateClone() {
    if (this.state !== 'playing') return;
    if (this.game.spawnClone()) { this.handAnim.clone = 0.9; this.handR.flash(); this.handL.flash(); }
  }

  doResetClone() {
    if (this.state !== 'playing') return;
    if (!this.game.clone) { this.menu.toast('No clone to reset. Press F to create one.'); return; }
    if (this.game.resetClone()) { this.handAnim.clone = 0.6; this.handR.flash(); }
  }

  // ------------------------------------------------------------ frame
  _frame() {
    let dt = Math.min(0.05, this.clock.getDelta());
    const g = this.game;
    if (this.inXR && this.renderer.xr.updateCamera) {
      try { this.renderer.xr.updateCamera(this.camera); } catch (e) { /* older three */ }
    }
    if (this.inXR && this.vrPanelPending) { this.vrPanel.open(this.vrPanelPending, this.camera); this.vrPanelPending = null; }

    if (this.backdrop && g) {
      // Slow orbit behind the main menu
      this.menuT += dt;
      if (!this.inXR) {
        const a = this.menuT * 0.06;
        this.camera.position.set(Math.sin(a) * 3.2, 1.75, 1.5 + Math.cos(a) * 3.2);
        this.camera.lookAt(0, 1.0, -2);
      }
      this.handR.root.visible = false; this.handL.root.visible = false;
      if (this.inXR) this.vr.update(dt);
      g.update(dt, {});
      g.drainEvents();
      this.view.update(dt, {});
      this._updateLamps();
    } else if (g) {
      if (!this.inXR) {
        const show = this.state === 'playing' || this.state === 'chat' || !!g.finalSeq;
        this.handR.root.visible = show; this.handL.root.visible = show;
      }
      const playing = this.state === 'playing';
      let input = { move: { x: 0, z: 0 }, jump: false };
      if (this.inXR) {
        const vi = this.vr.update(dt);
        if (playing) { this._syncVRBody(); input = vi; }
      } else if (playing) {
        const it = this.input.intent();
        const yaw = g.player.yaw;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
        let mx = fx * it.f + rx * it.s, mz = fz * it.f + rz * it.s;
        const l = Math.hypot(mx, mz);
        const sp = it.slow ? PLAYER.slowSpeed : PLAYER.walkSpeed;
        if (l > 0) { mx = (mx / l) * sp; mz = (mz / l) * sp; }
        input = { move: { x: mx, z: mz }, jump: it.jump };
      }

      const netGame = this.mp.inGame && g.netClient;
      if (netGame) {
        if (!this.inXR && g.held) {
          const { e, d } = this._viewRay();
          const t = g.holdTargetFromView(e, d, this.holdDist);
          g.setHoldTarget(t.x, t.y, t.z);
        }
        const prev = { x: g.player.body.pos.x, y: g.player.body.pos.y, z: g.player.body.pos.z };
        const events = this.mp.step(dt, playing ? input : { move: { x: 0, z: 0 }, jump: false });
        if (this.inXR) {
          const pb = g.player.body.pos;
          this.rig.position.x += pb.x - prev.x;
          this.rig.position.z += pb.z - prev.z;
          this.rig.position.y = pb.y;
        }
        this._handleEvents(events);
      } else if (playing || this.state === 'complete' || this.state === 'final') {
        // Held object target from the view (desktop) or hand (VR, set in vr.update)
        if (!this.inXR && g.held) {
          const { e, d } = this._viewRay();
          const t = g.holdTargetFromView(e, d, this.holdDist);
          g.setHoldTarget(t.x, t.y, t.z);
        }
        const steps = dt > 1 / 45 ? 2 : 1;
        const prev = { x: g.player.body.pos.x, y: g.player.body.pos.y, z: g.player.body.pos.z };
        for (let i = 0; i < steps; i++) {
          g.update(dt / steps, i === 0 ? input : { move: input.move, jump: input.jump });
        }
        if (this.inXR) {
          const pb = g.player.body.pos;
          this.rig.position.x += pb.x - prev.x;
          this.rig.position.z += pb.z - prev.z;
          this.rig.position.y = pb.y;
        }
        this._handleEvents(g.drainEvents());
      }
      this.view.update(dt, { target: this._target });
      if (g.hasGun) {
        this.gun.update(dt, g.player.charges);
        const pips = document.querySelectorAll('#ammo i');
        pips.forEach((p, i) => p.classList.toggle('on', i < g.player.charges));
      }
      if (!this.inXR) this._updateDesktopCamera(dt, input);
      this._updatePrompt();
      this._updateShadow();
      this._updateLamps();
    }

    if (this.inXR) this.vrPanel.updateHint(dt, this.camera);
    this.menu.update(dt);
    const h = this.game ? (this.inXR ? this.headWorld() : this.camera.getWorldPosition(new THREE.Vector3())) : null;
    if (h) this.audio.setListener(h.x, h.y, h.z, this.game.player.yaw);
    this.renderer.render(this.scene, this.camera);
  }

  _handleEvents(events) {
    for (const e of events) {
      this.view.onEvent(e);
      const snd = EVENT_SOUNDS[e.type];
      const pos = e.x !== undefined ? { x: e.x, y: e.y, z: e.z } : null;
      if (snd) this.audio.play(snd, pos, { speed: e.speed });
      if (e.type === 'tick') this.audio.play('tick', pos, { left: e.left });
      switch (e.type) {
        case 'step': this.audio.play('step', null, { gain: 0.8 }); break;
        case 'land': this.audio.play('land'); break;
        case 'hint': if (this.inXR) this.vrPanel.showHint(e.text); else this.menu.hint(e.text); break;
        case 'toast': this.audio.play('toast'); if (this.inXR) this.vrPanel.showHint(e.text); else this.menu.toast(e.text); break;
        case 'pickup': this.handAnim.grabT = 0.3; break;
        case 'final-start': this.audio.play('final'); if (!this.inXR) this.menu.hint('All chambers solved. Ascending.', 6); break;
        case 'complete': this._complete(!!e.final); break;
        case 'shot': this.audio.play(e.kicked ? 'kick' : 'shot'); break;
        case 'dry': this.audio.play('dry'); break;
        case 'grip': this.audio.play('grip'); break;
        case 'checkpoint': this.audio.play('checkpoint'); if (!this.inXR) this.menu.toast('Checkpoint'); break;
        case 'respawn': this.audio.play('teleport'); this.menu.fade(true); setTimeout(() => this.menu.fade(false), 120); break;
        default: break;
      }
    }
  }

  _updateDesktopCamera(dt, input) {
    const g = this.game;
    const pb = g.player.body;
    const moving = Math.hypot(input.move.x, input.move.z) > 0.1 && pb.grounded;
    if (moving) this.bob += dt * Math.hypot(input.move.x, input.move.z) * 2.6;
    const bobOn = this.save.settings.headBob ? 1 : 0;
    this.bobAmt = (this.bobAmt || 0) + ((moving ? 1 : 0) - (this.bobAmt || 0)) * Math.min(1, dt * 8);
    const by = Math.abs(Math.sin(this.bob)) * 0.035 * this.bobAmt * bobOn;
    const bx = Math.cos(this.bob) * 0.02 * this.bobAmt * bobOn;
    let eyeY = PLAYER.eye;
    if (g.finalSeq) eyeY += Math.sin(g.finalSeq.t * 3) * 0.004;
    this.camera.position.set(pb.pos.x, pb.pos.y + eyeY + by, pb.pos.z);
    this.camera.rotation.set(g.player.pitch, g.player.yaw, 0, 'YXZ');
    if (g.finalSeq) {
      const f = Math.min(1, Math.max(0, (g.finalSeq.t - 4) / 4));
      this.renderer.toneMappingExposure = 1.2 + f * 3;
    } else this.renderer.toneMappingExposure = 1.2;

    // Hands
    const a = this.handAnim;
    a.poke = Math.max(0, a.poke - dt);
    a.clone = Math.max(0, a.clone - dt);
    a.grabT = Math.max(0, a.grabT - dt);
    const poke = Math.sin(Math.min(1, a.poke / 0.3) * Math.PI) * 0.12;
    const cl = Math.sin(Math.min(1, a.clone / 0.9) * Math.PI);
    const holding = !!g.held;
    const targeting = !!this._target;
    const R = this.handR, L = this.handL;
    const hb = Math.sin(this.bob * 2) * 0.008 * this.bobAmt;
    const hx = Math.cos(this.bob) * 0.01 * this.bobAmt;
    const HP = this.handPose || { x: 0.19, y: -0.2, z: -0.36, rx: 0.15, ry: 0.28, rz: -1.15 };
    R.root.position.set(HP.x + hx - cl * 0.05 - (holding ? 0.03 : 0), HP.y + hb + (holding ? 0.04 : 0) + cl * 0.08, HP.z - poke - (holding ? 0.05 : 0));
    R.root.rotation.set(HP.rx + (holding ? 0.12 : 0) - cl * 0.3, HP.ry + (holding ? 0.06 : 0), HP.rz + (holding ? 0.1 : 0) + cl * 0.9, 'YXZ');
    L.root.position.set(-HP.x + hx + cl * 0.05 + (holding ? 0.03 : 0), HP.y - 0.01 + hb + (holding ? 0.04 : 0) + cl * 0.08, HP.z - 0.02 - (holding ? 0.05 : 0));
    L.root.rotation.set(HP.rx + (holding ? 0.12 : 0) - cl * 0.3, -HP.ry - (holding ? 0.06 : 0), -HP.rz - (holding ? 0.1 : 0) - cl * 0.9, 'YXZ');
    if (g.hasGun) {
      // Right hand wraps the gun grip; the gun sits where the hand is.
      this.gun.root.scale.setScalar(0.72);
      this.gun.root.position.set(R.root.position.x - 0.035, R.root.position.y + 0.045, R.root.position.z - 0.015);
      this.gun.root.rotation.set(0.06, 0.07, 0);
    }
    R.setTarget({
      curl: g.hasGun ? 0.92 : holding ? 0.75 : cl > 0.2 ? 0 : targeting || poke > 0.01 ? 0.85 : 0.3,
      point: g.hasGun ? 0.9 : holding ? 0 : (targeting || poke > 0.01) && cl < 0.2 ? 1 : 0,
      spread: cl,
      thumb: holding ? 0.6 : 0.2,
    });
    L.setTarget({ curl: holding ? 0.75 : cl > 0.2 ? 0 : 0.35, point: 0, spread: cl, thumb: holding ? 0.6 : 0.25 });
    R.update(dt); L.update(dt);
  }

  _updatePrompt() {
    const g = this.game;
    this._target = null;
    if (this.state !== 'playing') { this.menu.prompt(''); return; }
    if (this.inXR) return;
    if (g.held) {
      this.menu.prompt(g.held.body.kind === 'mirror' ? 'LMB put down   Q/E turn   Wheel distance' : 'LMB put down   Q/E turn   Wheel distance');
      return;
    }
    const { e, d } = this._viewRay();
    const hit = g.pick(e, d);
    if (!hit || hit.t > PLAYER.reach + 0.3) { this.menu.prompt(''); return; }
    this._target = hit;
    const k = (a) => this.save.bindings[a].replace('Key', '');
    const text = {
      button: `${k('interact')}  Press switch`,
      mirror: hit.obj.portable ? `LMB pick up   ${k('interact')}/${k('rotateLeft')} turn mirror` : `${k('interact')}/${k('rotateLeft')}  Turn mirror`,
      block: 'LMB  Pick up',
      pod: `${k('interact')}  Create clone`,
    }[hit.kind] || '';
    this.menu.prompt(text);
  }

  _updateLamps() {
    const lights = this.game.data.lights;
    const p = this.game.player.body.pos;
    const sorted = lights.map((l) => ({ l, d: (l.x - p.x) ** 2 + (l.z - p.z) ** 2 + (l.y - p.y - 2) ** 2 })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.lamps.length; i++) {
      const s = sorted[i];
      const lamp = this.lamps[i];
      if (!s) { lamp.intensity = 0; continue; }
      lamp.position.set(s.l.x, s.l.y - 0.4, s.l.z);
      lamp.intensity = 9;
    }
  }

  _updateShadow() {
    if (!this.sun.castShadow || !this.game) return;
    const p = this.game.player.body.pos;
    // Snap to the shadow texel grid to avoid shimmering.
    const texel = 36 / this.sun.shadow.mapSize.x;
    const cx = Math.round(p.x / texel) * texel, cz = Math.round(p.z / texel) * texel;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - this.sunDir.x * 30, -this.sunDir.y * 30, cz - this.sunDir.z * 30);
    this.sun.target.updateMatrixWorld();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.app = new App();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#ddd">SECOND SELF needs WebGL to run.<br><small>${e.message}</small></div>`;
    throw e;
  }
});
