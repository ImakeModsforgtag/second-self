// Outfit customisation screen with a rotating 3D preview of your character.
import * as THREE from 'three';
import { CloneModel } from '../render/cloneModel.js';
import { PRESETS, LABELS, COLOR_FIELDS, OUTFIT_OPTIONS, presetOutfit } from '../mp/outfits.js';
import { sanitizeOutfit } from '../net/protocol.js';

const $ = (id) => document.getElementById(id);

export class OutfitEditor {
  constructor(mp) {
    this.mp = mp;
    this.running = false;
  }

  open() {
    const profile = this.mp.profile;
    this._renderForm();
    this._renderPresets();
    if (!this.renderer) {
      const canvas = $('outfit-canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 20);
      this.camera.position.set(0, 1.15, 4.1);
      this.camera.lookAt(0, 0.95, 0);
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666a70, 2.0));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(2, 3, 3);
      this.scene.add(key);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(0.8, 40), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.9 }));
      floor.rotation.x = -Math.PI / 2;
      this.scene.add(floor);
    }
    this._setModel(profile.outfit);
    this.running = true;
    this.t0 = performance.now();
    const loop = () => {
      if (!this.running) return;
      const t = (performance.now() - this.t0) / 1000;
      if (this.model) {
        this.model.updatePlayer(1 / 60, { x: 0, y: 0, z: 0, yaw: Math.PI + t * 0.7, pitch: 0, speed: 0, air: false, hold: false });
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  close() { this.running = false; }

  _setModel(outfit) {
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); }
    this.model = new CloneModel(outfit, { mode: 'player', ringColor: '#4fc3f7' });
    this.scene.add(this.model.root);
  }

  _change(outfit) {
    this.mp.setOutfit(sanitizeOutfit(outfit));
    if (this.model) this.model.applyOutfit(this.mp.profile.outfit);
    this._renderForm();
  }

  _renderForm() {
    const o = this.mp.profile.outfit;
    const form = $('outfit-form');
    form.innerHTML = '';
    for (const [key, list] of Object.entries(OUTFIT_OPTIONS)) {
      const row = document.createElement('div');
      row.className = 'row';
      const l = document.createElement('label'); l.textContent = LABELS[key].label;
      const box = document.createElement('div'); box.className = 'stepper';
      const prev = document.createElement('button'); prev.textContent = '<'; prev.className = 'mini';
      const val = document.createElement('span'); val.textContent = LABELS[key].names[o[key]];
      const next = document.createElement('button'); next.textContent = '>'; next.className = 'mini';
      const step = (d) => { const i = list.indexOf(o[key]); this._change({ ...o, [key]: list[(i + d + list.length) % list.length] }); };
      prev.addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
      next.addEventListener('click', (e) => { e.stopPropagation(); step(1); });
      box.append(prev, val, next);
      row.append(l, box);
      form.appendChild(row);
    }
    for (const [key, label] of COLOR_FIELDS) {
      const row = document.createElement('div');
      row.className = 'row';
      const l = document.createElement('label'); l.textContent = label;
      const input = document.createElement('input'); input.type = 'color'; input.value = o[key];
      input.addEventListener('input', () => this._change({ ...this.mp.profile.outfit, [key]: input.value }));
      row.append(l, input);
      form.appendChild(row);
    }
  }

  _renderPresets() {
    const box = $('outfit-presets');
    box.innerHTML = '';
    PRESETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'preset';
      b.innerHTML = `<i style="background:${p.shirt}"></i><i style="background:${p.shorts}"></i><i style="background:${p.shoes}"></i><span>${p.name}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.mp.profile.preset = i; this._change(presetOutfit(i)); });
      box.appendChild(b);
    });
  }
}
