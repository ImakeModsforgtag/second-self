// Builds and updates the 3D scene for one loaded level.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { concreteTiles, crateTexture, labelTexture, glowTexture, gripTexture, cloudTexture, nameTagTexture } from './textures.js';
import { CloneModel } from './cloneModel.js';
import { LASER } from '../config.js';
import { bodyBox } from '../sim/physics.js';

const BLUE = 0x3d8bff;
const RED = 0xff3524;

/** Box geometry with world-space UVs so the 1 m tile grid lines up everywhere. */
function addBox(arr, b, uvScale, skip = {}) {
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  const faces = [
    { n: [1, 0, 0], v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], uv: (p) => [-p[2], p[1]], k: 'px' },
    { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], uv: (p) => [p[2], p[1]], k: 'nx' },
    { n: [0, 1, 0], v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], uv: (p) => [p[0], -p[2]], k: 'py' },
    { n: [0, -1, 0], v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], uv: (p) => [p[0], p[2]], k: 'ny' },
    { n: [0, 0, 1], v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], uv: (p) => [p[0], p[1]], k: 'pz' },
    { n: [0, 0, -1], v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], uv: (p) => [-p[0], p[1]], k: 'nz' },
  ];
  for (const f of faces) {
    if (skip[f.k]) continue;
    const base = arr.pos.length / 3;
    for (const p of f.v) {
      arr.pos.push(...p);
      arr.nor.push(...f.n);
      const [u, v] = f.uv(p);
      arr.uv.push(u * uvScale, v * uvScale);
    }
    arr.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function buildGeometry(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(arr.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uv, 2));
  g.setIndex(arr.idx);
  g.computeBoundingSphere();
  return g;
}

function iconLabel(letter, type, on) {
  const fg = on ? '#cfe3ff' : '#8a8f96';
  const ring = on ? '#3d8bff' : (type === 'lock' ? '#ff4a3a' : '#5a5f66');
  const key = `${letter}-${type}-${on}`;
  if (iconLabel.cache[key]) return iconLabel.cache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1d20'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = ring; ctx.lineWidth = 9;
  if (type === 'plate') ctx.strokeRect(14, 14, 100, 100);
  else if (type === 'button') { ctx.beginPath(); ctx.moveTo(64, 12); ctx.lineTo(118, 112); ctx.lineTo(10, 112); ctx.closePath(); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.stroke(); }
  if (type === 'lock') { ctx.beginPath(); ctx.moveTo(30, 30); ctx.lineTo(98, 98); ctx.stroke(); }
  ctx.fillStyle = fg;
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, type === 'button' ? 76 : 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconLabel.cache[key] = t;
  return t;
}
iconLabel.cache = {};

export class View {
  /**
   * roster (multiplayer): Map pid -> { name, outfit, color } used to dress
   * teammates and their clones. Single player passes nothing.
   */
  constructor(game, scene, { settings, roster = null }) {
    this.game = game;
    this.roster = roster;
    this.playerModels = new Map();
    this.scene = scene;
    this.settings = settings;
    this.root = new THREE.Group();
    this.root.name = 'level';
    scene.add(this.root);
    this.disposables = [];
    this.time = 0;
    this.cloneModels = [];
    this.particles = [];
    this._build();
  }

  track(o) { this.disposables.push(o); return o; }

  // ------------------------------------------------------------------ build
  _build() {
    const g = this.game;
    const d = g.data;
    this._assignTags();

    // ---- Static architecture, merged per material
    const tiles = concreteTiles();
    const mk = (color, rough = 0.9) => this.track(new THREE.MeshStandardMaterial({ map: tiles, bumpMap: tiles, bumpScale: 1.2, color, roughness: rough, metalness: 0 }));
    const mats = {
      floor: mk(0xffffff, 0.92),
      wall: mk(0xeeeeee, 0.95),
      platform: mk(0xe2e2e2, 0.92),
      barrier: mk(0xcfd0d2, 0.9),
      ceiling: this.track(new THREE.MeshStandardMaterial({ map: tiles, color: 0x77797c, roughness: 1 })),
      grip: this.track(new THREE.MeshStandardMaterial({ map: gripTexture(), color: 0xffffff, roughness: 0.5, emissive: new THREE.Color(0x1d4fa8), emissiveIntensity: 0.35 })),
    };
    const groups = {};
    for (const s of d.statics) {
      if (!mats[s.mat]) continue;
      const arr = groups[s.mat] || (groups[s.mat] = { pos: [], nor: [], uv: [], idx: [] });
      const bx = { min: s.b.slice(0, 3), max: s.b.slice(3, 6) };
      addBox(arr, bx, s.mat === 'grip' ? 1 : 0.5, s.mat === 'floor' ? { ny: true } : s.mat === 'ceiling' ? { py: true } : {});
    }
    for (const [mat, arr] of Object.entries(groups)) {
      const mesh = new THREE.Mesh(this.track(buildGeometry(arr)), mats[mat]);
      mesh.receiveShadow = mat !== 'ceiling';
      mesh.castShadow = mat === 'wall' || mat === 'platform' || mat === 'barrier' || mat === 'grip';
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }

    // Barrier caps (thin darker strip on top so low walls read clearly)
    const capArr = { pos: [], nor: [], uv: [], idx: [] };
    for (const s of d.statics) if (s.mat === 'barrier') {
      addBox(capArr, { min: [s.b[0] - 0.01, s.b[4], s.b[2] - 0.01], max: [s.b[3] + 0.01, s.b[4] + 0.03, s.b[5] + 0.01] }, 1);
    }
    if (capArr.pos.length) {
      const cap = new THREE.Mesh(this.track(buildGeometry(capArr)), this.track(new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.6 })));
      cap.castShadow = true;
      this.root.add(cap);
    }

    // ---- Ceiling light panels (emissive; cheap and Quest friendly)
    const lightArr = { pos: [], nor: [], uv: [], idx: [] };
    for (const l of d.lights) {
      addBox(lightArr, { min: [l.x - 0.7, l.y - 0.06, l.z - 0.28], max: [l.x + 0.7, l.y, l.z + 0.28] }, 1);
    }
    if (lightArr.pos.length) {
      const m = new THREE.Mesh(this.track(buildGeometry(lightArr)), this.track(new THREE.MeshBasicMaterial({ color: 0xfaf8f0 })));
      this.root.add(m);
    }

    this._buildDoors();
    this._buildPlates();
    this._buildButtons();
    this._buildPods();
    this._buildEmitters();
    this._buildReceivers();
    this._buildMirrors();
    this._buildSockets();
    this._buildBlocks();
    this._buildExits();
    this._buildBeams();
    this._buildPreview();
    this._buildParticles();
    this._buildSky();
  }

  _assignTags() {
    const g = this.game;
    this.tags = new Map();
    const types = new Map();
    for (const p of g.plates) types.set(p.id, 'plate');
    for (const r of g.receivers) types.set(r.id, r.lock ? 'lock' : 'receiver');
    for (const b of g.buttons) types.set(b.id, 'button');
    this.inputTypes = types;
    let n = 0;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const add = (id) => { if (!this.tags.has(id) && types.has(id)) this.tags.set(id, letters[n++ % 26]); };
    for (const dr of g.doors) for (const r of dr.requires) add(r.id);
    for (const e of g.emitters) for (const r of e.power) add(r.id);
  }

  _tagPlaque(id, size = 0.2) {
    const tag = this.tags.get(id);
    if (!tag) return null;
    const type = this.inputTypes.get(id);
    const mat = this.track(new THREE.MeshBasicMaterial({ map: iconLabel(tag, type, false) }));
    const mesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(size, size)), mat);
    mesh.userData = { tag, type, on: null };
    return mesh;
  }

  _setPlaque(mesh, on) {
    if (!mesh || mesh.userData.on === on) return;
    mesh.userData.on = on;
    mesh.material.map = iconLabel(mesh.userData.tag, mesh.userData.type, on);
    mesh.material.needsUpdate = true;
  }

  _buildDoors() {
    const doorMat = this.track(new THREE.MeshStandardMaterial({ map: crateTexture({ seed: 11, base: 118 }), color: 0x9aa0a8, roughness: 0.55, metalness: 0.35 }));
    const frameMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4b4f55, roughness: 0.6, metalness: 0.3 }));
    this.doorViews = this.game.doors.map((d) => {
      const group = new THREE.Group();
      const panel = new THREE.Group();
      const geo = this.track(new RoundedBoxGeometry(d.width - 0.02, d.height, 0.2, 2, 0.03));
      const slab = new THREE.Mesh(geo, doorMat);
      slab.castShadow = true; slab.receiveShadow = true;
      panel.add(slab);
      const stripMat = this.track(new THREE.MeshBasicMaterial({ color: RED }));
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(this.track(new THREE.BoxGeometry(d.width * 0.7, 0.05, 0.02)), stripMat);
        strip.position.set(0, 0.2, side * 0.105);
        panel.add(strip);
        const v = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, d.height * 0.55, 0.02)), stripMat);
        v.position.set(0, -0.15, side * 0.105);
        panel.add(v);
      }
      group.add(panel);
      // Frame
      const jambGeo = this.track(new THREE.BoxGeometry(0.12, d.height + 0.1, 0.46));
      for (const s of [-1, 1]) {
        const j = new THREE.Mesh(jambGeo, frameMat);
        j.position.set(s * (d.width / 2 + 0.02), d.height / 2, 0);
        group.add(j);
      }
      const head = new THREE.Mesh(this.track(new THREE.BoxGeometry(d.width + 0.2, 0.12, 0.46)), frameMat);
      head.position.set(0, d.height + 0.04, 0);
      group.add(head);
      // Requirement lamps on both faces
      const plaques = [];
      const n = d.requires.length;
      for (let i = 0; i < n; i++) {
        for (const side of [-1, 1]) {
          const p = this._tagPlaque(d.requires[i].id, 0.22);
          if (!p) continue;
          p.position.set((i - (n - 1) / 2) * 0.3, d.height + 0.32, side * 0.24);
          if (side < 0) p.rotation.y = Math.PI;
          group.add(p);
          plaques.push({ mesh: p, req: d.requires[i] });
        }
      }
      group.position.set(d.x, d.y0, d.z);
      if (d.axis === 'z') group.rotation.y = Math.PI / 2;
      this.root.add(group);
      return { d, group, panel, stripMat, plaques };
    });
  }

  _buildPlates() {
    const baseMat = this.track(new THREE.MeshStandardMaterial({ color: 0x34373c, roughness: 0.7, metalness: 0.2 }));
    this.plateViews = this.game.plates.map((p) => {
      const w = p.x1 - p.x0, dd = p.z1 - p.z0;
      const group = new THREE.Group();
      const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(w + 0.1, 0.04, dd + 0.1)), baseMat);
      base.position.y = 0.02;
      base.receiveShadow = true;
      group.add(base);
      const topMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2a64c8, roughness: 0.45, metalness: 0.1, emissive: new THREE.Color(BLUE), emissiveIntensity: 0.15 }));
      const top = new THREE.Mesh(this.track(new RoundedBoxGeometry(w - 0.06, 0.06, dd - 0.06, 2, 0.02)), topMat);
      top.position.y = 0.06;
      top.receiveShadow = true;
      group.add(top);
      const plaque = this._tagPlaque(p.id, 0.24);
      if (plaque) {
        plaque.rotation.x = -Math.PI / 2;
        plaque.position.set(w / 2 - 0.2, 0.095, dd / 2 - 0.2);
        group.add(plaque);
      }
      group.position.set((p.x0 + p.x1) / 2, p.y, (p.z0 + p.z1) / 2);
      this.root.add(group);
      return { p, top, topMat, plaque, press: 0 };
    });
  }

  _buildButtons() {
    const backMat = this.track(new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.6, metalness: 0.3 }));
    this.buttonViews = this.game.buttons.map((b) => {
      if (b.style === 'target') return this._buildTarget(b);
      const group = new THREE.Group();
      const back = new THREE.Mesh(this.track(new RoundedBoxGeometry(0.4, 0.4, 0.05, 2, 0.015)), backMat);
      group.add(back);
      const capMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2a64c8, emissive: new THREE.Color(BLUE), emissiveIntensity: 0.2, roughness: 0.4 }));
      const cap = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.11, 0.12, 0.07, 24)), capMat);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = 0.05;
      group.add(cap);
      const plaque = this._tagPlaque(b.id, 0.16);
      if (plaque) { plaque.position.set(0, -0.32, 0.03); group.add(plaque); }
      group.position.set(b.x, b.y, b.z);
      const n = b.normal;
      group.rotation.y = Math.atan2(n.x, n.z);
      this.root.add(group);
      return { b, cap, capMat, plaque };
    });
  }

  _buildTarget(b) {
    const group = new THREE.Group();
    const rings = [[0.42, 0xe9edf2], [0.32, 0x2a64c8], [0.21, 0xe9edf2], [0.1, 0x2a64c8]];
    const mats = [];
    rings.forEach(([r, c], i) => {
      const m = this.track(new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: new THREE.Color(c === 0x2a64c8 ? BLUE : 0xffffff), emissiveIntensity: 0.05 }));
      const disc = new THREE.Mesh(this.track(new THREE.CylinderGeometry(r, r, 0.06 + i * 0.012, 32)), m);
      disc.rotation.x = Math.PI / 2;
      disc.position.z = 0.03 + i * 0.006;
      group.add(disc);
      if (c === 0x2a64c8) mats.push(m);
    });
    const glow = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x5aa2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
    glow.scale.set(1.6, 1.6, 1); glow.position.z = 0.1;
    group.add(glow);
    const plaque = this._tagPlaque(b.id, 0.22);
    if (plaque) { plaque.position.set(0, -0.6, 0.04); group.add(plaque); }
    group.position.set(b.x, b.y, b.z);
    group.rotation.y = Math.atan2(b.normal.x, b.normal.z);
    this.root.add(group);
    const capMat = { set emissiveIntensity(v) { for (const m of mats) m.emissiveIntensity = v; glow.material.opacity = Math.max(0, (v - 0.3) * 0.5); } };
    return { b, cap: { position: { z: 0 } }, capMat, plaque, target: true };
  }

  _buildSky() {
    const g = this.game;
    if (!g.def.sky) return;
    const [x0, z0, x1, z1] = g.data.bounds;
    const mat = this.track(new THREE.SpriteMaterial({ map: cloudTexture(), color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: true }));
    const rand = (() => { let s = 1234 + g.def.id * 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    this.clouds = [];
    for (let i = 0; i < 46; i++) {
      const c = new THREE.Sprite(mat);
      const below = i < 30;
      const sc = below ? 14 + rand() * 18 : 18 + rand() * 20;
      c.scale.set(sc, sc * 0.45, 1);
      c.position.set(x0 - 40 + rand() * (x1 - x0 + 80), below ? -18 - rand() * 14 : 18 + rand() * 20, z0 - 40 + rand() * (z1 - z0 + 80));
      c.userData.drift = 0.2 + rand() * 0.4;
      this.root.add(c);
      this.clouds.push(c);
    }
    // Checkpoint markers: a thin blue ring on the floor
    const ringMat = this.track(new THREE.MeshBasicMaterial({ color: 0x8cbcff, transparent: true, opacity: 0.45, depthWrite: false }));
    this.checkpointViews = g.checkpoints.map((c) => {
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(0.42, 0.5, 6)), ringMat.clone());
      this.track(ring.material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c.x, c.y + 0.012, c.z);
      this.root.add(ring);
      return { c, ring };
    });
  }

  addTracer(from, to, kicked) {
    const len = from.distanceTo(to);
    if (len < 0.01) return;
    const mat = this.track(new THREE.MeshBasicMaterial({ color: 0x8cc4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const geo = this.track(new THREE.CylinderGeometry(0.012, 0.03, 1, 6, 1, true));
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from).lerp(to, 0.5);
    m.lookAt(to);
    m.scale.set(1, 1, len);
    this.root.add(m);
    const ring = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x8cc4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    ring.position.copy(to);
    ring.scale.set(kicked ? 0.9 : 0.5, kicked ? 0.9 : 0.5, 1);
    this.root.add(ring);
    this.burst(to.x, to.y, to.z, kicked ? 18 : 8, 0x8cc4ff, { spread: 0.15, up: 0.6, life: 0.45, height: 0.05 });
    (this.tracers || (this.tracers = [])).push({ m, ring, t: 0 });
  }

  _buildPods() {
    const white = this.track(new THREE.MeshStandardMaterial({ color: 0xe8ecf1, roughness: 0.35, metalness: 0.1 }));
    this.podViews = this.game.pods.map((p) => {
      const group = new THREE.Group();
      const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.62, 0.66, 0.06, 40)), white);
      base.position.y = 0.03;
      base.receiveShadow = true;
      group.add(base);
      const ringMat = this.track(new THREE.MeshBasicMaterial({ color: BLUE }));
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(0.48, 0.54, 48)), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.062;
      group.add(ring);
      // Facing arrow: the clone steps out looking this way.
      const arrow = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.12, 3)), ringMat);
      arrow.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      arrow.position.set(0, 0.063, -0.34);
      group.add(arrow);
      // Arch
      const arch = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.66, 0.045, 10, 40, Math.PI)), white);
      arch.position.y = 0.06;
      arch.scale.set(1, 3.3, 1);
      arch.castShadow = true;
      group.add(arch);
      const archGlow = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.66, 0.015, 6, 40, Math.PI)), ringMat);
      archGlow.position.set(0, 0.06, -0.05);
      archGlow.scale.set(1, 3.3, 1);
      group.add(archGlow);
      // Spawn light column
      const colMat = this.track(new THREE.MeshBasicMaterial({ color: 0x6aa8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const col = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.5, 0.5, 2.4, 32, 1, true)), colMat);
      col.position.y = 1.2;
      group.add(col);
      group.position.set(p.x, p.y, p.z);
      group.rotation.y = p.yaw;
      this.root.add(group);
      return { p, group, colMat, pulse: 0 };
    });
  }

  _buildEmitters() {
    const housing = this.track(new THREE.MeshStandardMaterial({ color: 0x45494f, roughness: 0.5, metalness: 0.4 }));
    this.emitterViews = this.game.emitters.map((e) => {
      const group = new THREE.Group();
      const h = LASER.height + 0.35;
      const body = new THREE.Mesh(this.track(new RoundedBoxGeometry(0.6, h, 0.6, 2, 0.05)), housing);
      body.position.y = h / 2;
      body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      const lensMat = this.track(new THREE.MeshBasicMaterial({ color: 0x501010 }));
      const lens = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.09, 0.11, 0.08, 20)), lensMat);
      lens.rotation.z = Math.PI / 2;
      lens.position.set(0.31, LASER.height, 0);
      group.add(lens);
      const fins = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.5, 0.04, 0.62)), housing);
      fins.position.y = h + 0.02;
      group.add(fins);
      const plaques = [];
      e.power.forEach((r, i) => {
        const p = this._tagPlaque(r.id, 0.2);
        if (!p) return;
        p.rotation.x = -Math.PI / 2;
        p.position.set(0, h + 0.05, (i - (e.power.length - 1) / 2) * 0.24);
        group.add(p);
        plaques.push({ mesh: p, req: r });
      });
      group.position.set(e.x, e.y, e.z);
      group.rotation.y = -Math.atan2(e.dir.z, e.dir.x);
      this.root.add(group);
      return { e, lensMat, plaques };
    });
  }

  _buildReceivers() {
    const frame = this.track(new THREE.MeshStandardMaterial({ color: 0x585c62, roughness: 0.5, metalness: 0.35 }));
    this.receiverViews = this.game.receivers.map((r) => {
      const group = new THREE.Group();
      const b = r.box;
      const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
      const n = r.normal;
      // Build in a local frame where +z is the facing direction.
      const width = n.x ? sz : sx, depth = n.x ? sx : sz;
      const box = new THREE.Mesh(this.track(new RoundedBoxGeometry(width, sy, depth, 2, 0.03)), frame);
      group.add(box);
      const lensMat = this.track(new THREE.MeshBasicMaterial({ color: 0x3a0d0d }));
      const lens = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.17, 28)), lensMat);
      lens.position.z = depth / 2 + 0.003;
      group.add(lens);
      const ringMat = this.track(new THREE.MeshBasicMaterial({ color: r.lock ? RED : 0x6a7078 }));
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(0.2, 0.25, 32)), ringMat);
      ring.position.z = depth / 2 + 0.004;
      group.add(ring);
      if (r.lock) {
        const bar = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.42, 0.04)), ringMat);
        bar.rotation.z = Math.PI / 4;
        bar.position.z = depth / 2 + 0.005;
        group.add(bar);
      }
      const glow = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff5a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
      glow.scale.set(0.9, 0.9, 1);
      glow.position.z = depth / 2 + 0.05;
      group.add(glow);
      const plaque = this._tagPlaque(r.id, 0.18);
      if (plaque) { plaque.position.set(0, sy / 2 + 0.16, depth / 2 - 0.02); group.add(plaque); }
      group.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      group.rotation.y = Math.atan2(n.x, n.z);
      this.root.add(group);
      return { r, lensMat, ringMat, glow, plaque };
    });
  }

  _buildMirrors() {
    const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x3e4247, roughness: 0.5, metalness: 0.5 }));
    const silverFrame = this.track(new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.3, metalness: 0.9 }));
    this.mirrorViews = this.game.mirrors.map((m) => {
      const group = new THREE.Group();
      if (m.portable) {
        const base = new THREE.Mesh(this.track(new RoundedBoxGeometry(0.58, 0.16, 0.58, 2, 0.04)), dark);
        base.position.y = 0.08; base.castShadow = true;
        group.add(base);
        const handleGeo = this.track(new THREE.TorusGeometry(0.08, 0.018, 6, 12, Math.PI));
        for (const s of [-1, 1]) {
          const h = new THREE.Mesh(handleGeo, silverFrame);
          h.position.set(s * 0.3, 0.12, 0); h.rotation.y = Math.PI / 2;
          group.add(h);
        }
        const stripe = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.59, 0.03, 0.59)), this.track(new THREE.MeshBasicMaterial({ color: BLUE })));
        stripe.position.y = 0.11;
        group.add(stripe);
      } else {
        const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.24, 0.29, 0.22, 24)), dark);
        base.position.y = 0.11; base.castShadow = true;
        group.add(base);
      }
      const post = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8)), dark);
      post.position.y = 0.26;
      group.add(post);
      const pivot = new THREE.Group();
      pivot.position.y = (m.panelY0 + m.panelY1) / 2;
      group.add(pivot);
      const ph = m.panelY1 - m.panelY0, pw = m.halfLen * 2;
      const frame = new THREE.Mesh(this.track(new RoundedBoxGeometry(pw + 0.08, ph + 0.08, 0.06, 2, 0.02)), dark);
      frame.castShadow = true;
      pivot.add(frame);
      const glassMat = this.track(new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.03, metalness: 1.0, envMapIntensity: 1.0, emissive: new THREE.Color(0xff2010), emissiveIntensity: 0 }));
      for (const s of [-1, 1]) {
        const glass = new THREE.Mesh(this.track(new THREE.PlaneGeometry(pw, ph)), glassMat);
        glass.position.z = s * 0.031;
        if (s < 0) glass.rotation.y = Math.PI;
        pivot.add(glass);
      }
      const rim = new THREE.Mesh(this.track(new THREE.BoxGeometry(pw + 0.09, 0.02, 0.07)), silverFrame);
      rim.position.y = ph / 2 + 0.045;
      pivot.add(rim);
      this.root.add(group);
      return { m, group, pivot, glassMat, angle: m.angle, highlight: 0 };
    });
  }

  _buildSockets() {
    const mat = this.track(new THREE.MeshBasicMaterial({ color: 0x2a5aa8, transparent: true, opacity: 0.7 }));
    const inner = this.track(new THREE.MeshBasicMaterial({ color: 0x2b2d31 }));
    for (const s of this.game.sockets) {
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(0.33, 0.39, 4, 1, Math.PI / 4)), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.x, s.y + 0.006, s.z);
      this.root.add(ring);
      const c = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.06, 16)), inner);
      c.rotation.x = -Math.PI / 2;
      c.position.set(s.x, s.y + 0.007, s.z);
      this.root.add(c);
    }
  }

  _buildBlocks() {
    const tex = crateTexture({ base: 128 });
    this.blockMat = this.track(new THREE.MeshStandardMaterial({ map: tex, color: 0xd2d5da, roughness: 0.85, metalness: 0.02, emissive: new THREE.Color(BLUE), emissiveIntensity: 0 }));
    this.blockViews = this.game.blocks.map((b) => {
      const s = b.size;
      const mat = this.blockMat.clone();
      this.track(mat);
      const mesh = new THREE.Mesh(this.track(new RoundedBoxGeometry(s.w, s.h, s.d, 2, Math.min(0.04, s.h * 0.08))), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.root.add(mesh);
      return { b, mesh, mat, rot: 0 };
    });
  }

  _buildExits() {
    this.exitViews = this.game.exits.map((e) => {
      const group = new THREE.Group();
      const w = e.x1 - e.x0, d = e.z1 - e.z0;
      const padMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf2f5f8, emissive: new THREE.Color(0xbfd8ff), emissiveIntensity: 0.6, roughness: 0.4 }));
      const pad = new THREE.Mesh(this.track(new RoundedBoxGeometry(w, 0.06, d, 2, 0.02)), padMat);
      pad.position.y = 0.03;
      pad.receiveShadow = true;
      group.add(pad);
      const colMat = this.track(new THREE.MeshBasicMaterial({ color: 0xa9c9ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const col = new THREE.Mesh(this.track(new THREE.CylinderGeometry(Math.min(w, d) * 0.45, Math.min(w, d) * 0.5, 2.6, 32, 1, true)), colMat);
      col.position.y = 1.35;
      group.add(col);
      group.position.set((e.x0 + e.x1) / 2, e.y, (e.z0 + e.z1) / 2);
      this.root.add(group);
      let shaft = null;
      if (e.final) {
        // Bright shaft above the lift
        const shMat = this.track(new THREE.MeshBasicMaterial({ color: 0xf4f8ff, side: THREE.BackSide }));
        shaft = new THREE.Mesh(this.track(new THREE.BoxGeometry(2.0, 14, 2.4)), shMat);
        shaft.position.set((e.x0 + e.x1) / 2, this.game.data.height + 7, (e.z0 + e.z1) / 2);
        this.root.add(shaft);
      }
      return { e, group, col, colMat, padMat, shaft };
    });
  }

  _buildBeams() {
    this.beamPool = [];
    this.beamCoreMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff1608, toneMapped: false }));
    this.beamGlowMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff1a0a, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }));
    this.beamCoreGeo = this.track(new THREE.CylinderGeometry(0.013, 0.013, 1, 6, 1, true));
    this.beamGlowGeo = this.track(new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1, true));
    this.beamCoreGeo.rotateZ(Math.PI / 2);
    this.beamGlowGeo.rotateZ(Math.PI / 2);
    this.hitPool = [];
    this.hitMat = this.track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff4a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  }

  _beamSeg(i) {
    while (this.beamPool.length <= i) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.beamCoreGeo, this.beamCoreMat));
      g.add(new THREE.Mesh(this.beamGlowGeo, this.beamGlowMat));
      g.frustumCulled = false;
      g.children.forEach((c) => (c.frustumCulled = false));
      this.root.add(g);
      this.beamPool.push(g);
    }
    return this.beamPool[i];
  }

  _hit(i) {
    while (this.hitPool.length <= i) {
      const s = new THREE.Sprite(this.hitMat);
      s.scale.set(0.3, 0.3, 1);
      this.root.add(s);
      this.hitPool.push(s);
    }
    return this.hitPool[i];
  }

  _buildPreview() {
    const mat = this.track(new THREE.MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.22, depthWrite: false }));
    this.preview = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1, 1)), mat);
    this.preview.rotation.x = -Math.PI / 2;
    this.preview.visible = false;
    this.root.add(this.preview);
    const edge = this.track(new THREE.LineBasicMaterial({ color: 0x9cc6ff, transparent: true, opacity: 0.7 }));
    const pts = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0.001));
    this.preview.add(new THREE.Line(this.track(new THREE.BufferGeometry().setFromPoints(pts)), edge));
  }

  _buildParticles() {
    const N = 240;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pCol = new Float32Array(N * 3);
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const mat = this.track(new THREE.PointsMaterial({ size: 0.06, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.root.add(this.points);
    this.pNext = 0;
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -999;
  }

  burst(x, y, z, n, color, { spread = 0.4, up = 1.2, life = 1.2, height = 1.8 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.pNext; this.pNext = (this.pNext + 1) % this.pN;
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.pPos[i * 3] = x + Math.cos(a) * r;
      this.pPos[i * 3 + 1] = y + Math.random() * height;
      this.pPos[i * 3 + 2] = z + Math.sin(a) * r;
      this.pVel[i * 3] = (Math.random() - 0.5) * 0.3;
      this.pVel[i * 3 + 1] = up * (0.4 + Math.random() * 0.6);
      this.pVel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
      this.pLife[i] = life * (0.6 + Math.random() * 0.4);
      this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
    }
  }

  // ------------------------------------------------------------------ events
  onEvent(e) {
    if (e.type === 'clone-spawn') {
      // The model itself is created by _syncClones; this is just the effect.
      const pv = this.podViews.find((p) => p.p.x === e.x && p.p.z === e.z);
      if (pv) pv.pulse = 1.6;
      this.burst(e.x, e.y, e.z, 70, 0x7fb8ff, { spread: 0.5, up: 0.8, life: 1.3 });
    } else if (e.type === 'clone-remove') {
      this.burst(e.x, e.y, e.z, 40, 0x7fb8ff, { spread: 0.35, up: 1.4, life: 0.9 });
    } else if (e.type === 'socket') {
      this.burst(e.x, 0.05, e.z, 16, 0x7fb8ff, { spread: 0.35, up: 0.6, life: 0.5, height: 0.1 });
    } else if (e.type === 'plate-on') {
      this.burst(e.x, e.y + 0.08, e.z, 18, 0x5aa2ff, { spread: 0.7, up: 0.5, life: 0.6, height: 0.05 });
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, ctx) {
    const g = this.game;
    this.time += dt;
    const t = this.time;

    // Doors
    for (const v of this.doorViews) {
      const d = v.d;
      v.panel.position.y = d.height / 2 + d.t * (d.height + 0.05);
      v.stripMat.color.setHex(d.open ? BLUE : RED);
      for (const p of v.plaques) this._setPlaque(p.mesh, p.req.neg ? !g.inputOn(p.req.id) : g.inputOn(p.req.id));
    }
    // Plates
    for (const v of this.plateViews) {
      const target = v.p.pressed ? 1 : 0;
      v.press += (target - v.press) * Math.min(1, dt * 14);
      v.top.position.y = 0.06 - v.press * 0.03;
      v.topMat.emissiveIntensity = 0.15 + v.press * 1.1;
      this._setPlaque(v.plaque, v.p.pressed);
    }
    if (this.tracers) {
      for (let i = this.tracers.length - 1; i >= 0; i--) {
        const tr = this.tracers[i];
        tr.t += dt;
        tr.m.material.opacity = Math.max(0, 0.9 - tr.t * 6);
        tr.ring.material.opacity = Math.max(0, 1 - tr.t * 3);
        if (tr.t > 0.4) { this.root.remove(tr.m); this.root.remove(tr.ring); this.tracers.splice(i, 1); }
      }
    }
    if (this.clouds) for (const c of this.clouds) { c.position.x += c.userData.drift * dt; }
    if (this.checkpointViews) for (const v of this.checkpointViews) v.ring.material.color.setHex(v.c.reached ? 0x5aa2ff : 0xcfe0ff);
    for (const v of this.buttonViews) {
      let glow = v.b.on ? 1.6 : 0.2;
      if (v.b.on && v.b.mode !== 'toggle') {
        const rate = v.b.t < 4 ? 8 : 3;
        glow = 0.6 + (Math.sin(t * rate * Math.PI) > 0 ? 1.4 : 0);
      }
      v.capMat.emissiveIntensity = glow;
      v.cap.position.z = v.b.on ? 0.035 : 0.05;
      this._setPlaque(v.plaque, v.b.on);
    }
    for (const v of this.podViews) {
      v.pulse = Math.max(0, v.pulse - dt);
      v.colMat.opacity = Math.min(0.5, v.pulse * 0.35);
    }
    for (const v of this.emitterViews) {
      v.lensMat.color.setHex(v.e.powered ? 0xff3a22 : 0x501010);
      for (const p of v.plaques) this._setPlaque(p.mesh, p.req.neg ? !g.inputOn(p.req.id) : g.inputOn(p.req.id));
    }
    for (const v of this.receiverViews) {
      const lit = v.r.lit;
      v.lensMat.color.setHex(lit ? 0xffb090 : 0x3a0d0d);
      const ok = v.r.lock ? !lit : lit;
      v.ringMat.color.setHex(ok ? BLUE : (v.r.lock ? RED : 0x6a7078));
      v.glow.material.opacity = lit ? 0.75 + Math.sin(t * 20) * 0.08 : 0;
      this._setPlaque(v.plaque, ok);
    }
    // Mirrors
    const target = ctx.target;
    for (const v of this.mirrorViews) {
      const b = v.m.body;
      v.group.position.set(b.pos.x, b.pos.y, b.pos.z);
      // Smoothly turn toward the simulated angle (shortest way).
      let diff = v.m.angle - v.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.angle += diff * Math.min(1, dt * 14);
      v.pivot.rotation.y = Math.PI / 2 - v.angle;
      const hl = (target && target.obj === v.m) || (g.held && g.held.body === b) ? 1 : 0;
      v.glassMat.emissiveIntensity = v.m.lit ? 0.12 : 0;
      v.glassMat.color.setHex(hl ? 0xd6e4f5 : 0xb4bcc6);
    }
    // Blocks
    for (const v of this.blockViews) {
      const b = v.b;
      v.mesh.position.set(b.pos.x, b.pos.y + b.h / 2, b.pos.z);
      const want = (b.quarter || 0) * Math.PI / 2;
      let diff = want - v.rot;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.rot += diff * Math.min(1, dt * 16);
      v.mesh.rotation.y = v.rot;
      const hl = (target && target.obj === b) ? 0.03 : (b.held ? 0.035 : 0);
      v.mat.emissiveIntensity += (hl - v.mat.emissiveIntensity) * Math.min(1, dt * 10);
    }
    // Exits
    for (const v of this.exitViews) {
      v.colMat.opacity = 0.12 + Math.sin(t * 2) * 0.04;
      if (v.e.final) {
        const lift = v.e.lift || 0;
        v.group.position.y = v.e.y + lift;
        if (g.finalSeq) v.padMat.emissiveIntensity = 0.6 + Math.min(2, g.finalSeq.t * 0.4);
      }
    }

    // Beams
    let si = 0, hi = 0;
    for (const beam of g.beams) {
      const pts = beam.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.001) continue;
        const seg = this._beamSeg(si++);
        seg.visible = true;
        seg.position.set((a.x + b.x) / 2, a.y, (a.z + b.z) / 2);
        seg.rotation.set(0, -Math.atan2(dz, dx), 0);
        seg.scale.set(len, 1, 1);
      }
      const end = pts[pts.length - 1];
      const h = this._hit(hi++);
      h.visible = true;
      h.position.set(end.x, end.y, end.z);
      const s = beam.end === 'receiver' ? 0.5 : 0.28 + Math.random() * 0.08;
      h.scale.set(s, s, 1);
    }
    for (let i = si; i < this.beamPool.length; i++) this.beamPool[i].visible = false;
    for (let i = hi; i < this.hitPool.length; i++) this.hitPool[i].visible = false;
    this.beamGlowMat.opacity = 0.22 + Math.sin(t * 31) * 0.04;

    // Clones (one per player at most) and teammates
    this._syncClones();
    this._updatePlayers(dt);
    for (let i = this.cloneModels.length - 1; i >= 0; i--) {
      const cm = this.cloneModels[i];
      const c = cm.clone;
      if (cm.model.leaving) {
        cm.model.update(dt, { x: cm.model.root.position.x, y: cm.model.root.position.y, z: cm.model.root.position.z, yaw: cm.model.root.rotation.y });
        if (cm.model.done) { this.root.remove(cm.model.root); cm.model.dispose(); this.cloneModels.splice(i, 1); }
        continue;
      }
      if (!c) continue;
      const tgt = c.target ? c.target.body.pos : null;
      const head = tgt ? { x: tgt.x, y: tgt.y + 1.6, z: tgt.z } : g.playerHead();
      const ang = Math.atan2(-(head.x - c.pos.x), -(head.z - c.pos.z)) - c.yaw;
      let a = ang; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
      cm.model.update(dt, {
        x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw, speed: c.speed,
        walkPhase: c.walkPhase, state: c.state, sees: c.sees, spawnT: c.spawnT, headTarget: a,
      });
    }

    // Held-object landing preview
    if (g.held) {
      const b = g.held.body;
      const y = this._landingY(b);
      this.preview.visible = y !== null && b.pos.y - y > 0.05;
      if (this.preview.visible) {
        this.preview.position.set(b.pos.x, y + 0.01, b.pos.z);
        this.preview.scale.set(b.hx * 2, b.hz * 2, 1);
      }
    } else this.preview.visible = false;

    // Particles
    const N = this.pN;
    for (let i = 0; i < N; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -999; continue; }
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  _landingY(body) {
    const b = bodyBox(body);
    let best = null;
    const test = (s) => {
      if (s.max[1] > b.min[1] + 0.01) return;
      if (b.min[0] < s.max[0] && b.max[0] > s.min[0] && b.min[2] < s.max[2] && b.max[2] > s.min[2]) {
        if (best === null || s.max[1] > best) best = s.max[1];
      }
    };
    for (const s of this.game.world.statics) test(s);
    for (const f of this.game.world.dynamicSolids) { const x = f(); if (x) test(x); }
    for (const o of this.game.world.bodies) {
      if (o === body || o.removed || o.kind === 'player') continue;
      test(bodyBox(o));
    }
    return best;
  }

  /** Make the clone models match the game's clones (works for 1 or 4 clones). */
  _syncClones() {
    const live = this.game.clones;
    for (const cm of this.cloneModels) {
      if (!cm.model.leaving && (!cm.clone || cm.clone.removed || !live.includes(cm.clone))) { cm.model.leave(); cm.clone = null; }
    }
    for (const c of live) {
      if (this.cloneModels.some((cm) => cm.clone === c)) continue;
      const info = this.roster && this.roster.get(c.owner);
      const m = new CloneModel(info ? info.outfit : null, { ringColor: info ? info.color : null });
      this.root.add(m.root);
      this.cloneModels.push({ model: m, clone: c });
    }
  }

  /** Teammates: full characters with name tags, smoothed between snapshots. */
  _updatePlayers(dt) {
    const g = this.game;
    if (!this.roster) return;
    for (const pl of g.players.values()) {
      if (pl === g.player) continue;
      let pm = this.playerModels.get(pl.id);
      const info = this.roster.get(pl.id) || { name: pl.id, outfit: null, color: '#4fc3f7' };
      if (!pm) {
        const model = new CloneModel(info.outfit, { mode: 'player', ringColor: info.color });
        const mat = new THREE.SpriteMaterial({ map: nameTagTexture(info.name, info.color), depthTest: false, transparent: true });
        const tag = new THREE.Sprite(mat);
        tag.scale.set(0.9, 0.225, 1);
        tag.renderOrder = 990;
        model.root.add(tag);
        tag.position.y = 2.08;
        this.root.add(model.root);
        const b = pl.body.pos;
        pm = { model, tag, mat, name: info.name, outfitKey: JSON.stringify(info.outfit), x: b.x, y: b.y, z: b.z, yaw: pl.yaw, speed: 0 };
        this.playerModels.set(pl.id, pm);
      }
      // Profile changes while playing
      const ok = JSON.stringify(info.outfit);
      if (ok !== pm.outfitKey && info.outfit) { pm.model.applyOutfit(info.outfit); pm.outfitKey = ok; }
      if (info.name !== pm.name) { pm.mat.map.dispose(); pm.mat.map = nameTagTexture(info.name, info.color); pm.mat.needsUpdate = true; pm.name = info.name; }
      const b = pl.body.pos;
      const k = Math.min(1, dt * 14);
      const ox = pm.x, oz = pm.z;
      pm.x += (b.x - pm.x) * k; pm.y += (b.y - pm.y) * k; pm.z += (b.z - pm.z) * k;
      if (Math.hypot(b.x - pm.x, b.z - pm.z) > 4) { pm.x = b.x; pm.y = b.y; pm.z = b.z; }
      let dy = pl.yaw - pm.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      pm.yaw += dy * k;
      const sp = dt > 0 ? Math.hypot(pm.x - ox, pm.z - oz) / dt : 0;
      pm.speed += (sp - pm.speed) * Math.min(1, dt * 6);
      pm.model.root.visible = !pl.away;
      pm.model.updatePlayer(dt, {
        x: pm.x, y: pm.y, z: pm.z, yaw: pm.yaw, pitch: pl.pitch, speed: pm.speed,
        air: !pl.body.grounded, hold: !!pl.netHold, away: pl.away,
      });
    }
    for (const [pid, pm] of this.playerModels) {
      if (g.players.has(pid)) continue;
      this.root.remove(pm.model.root); pm.model.dispose(); pm.mat.map.dispose(); pm.mat.dispose();
      this.playerModels.delete(pid);
    }
  }

  dispose() {
    for (const cm of this.cloneModels) cm.model.dispose();
    for (const pm of this.playerModels.values()) { pm.model.dispose(); pm.mat.map.dispose(); pm.mat.dispose(); }
    this.scene.remove(this.root);
    for (const o of this.disposables) if (o.dispose) o.dispose();
    this.disposables = [];
  }
}
