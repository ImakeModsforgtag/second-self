// A floating menu panel for VR, drawn on a canvas and clicked with a
// controller ray + trigger. Also shows short hint text in the headset.
import * as THREE from 'three';
import { LEVELS } from '../levels/levels.js';

const W = 1024, H = 720;

export class VRPanel {
  constructor(app) {
    this.app = app;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.2 * H / W),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }),
    );
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    this.page = null;
    this.buttons = [];
    this.hover = -1;

    // Hint panel (follows the view lazily)
    this.hc = document.createElement('canvas');
    this.hc.width = 1024; this.hc.height = 200;
    this.htex = new THREE.CanvasTexture(this.hc);
    this.htex.colorSpace = THREE.SRGBColorSpace;
    this.hint = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.195), new THREE.MeshBasicMaterial({ map: this.htex, transparent: true, depthTest: false, opacity: 0 }));
    this.hint.renderOrder = 998;
    this.hintT = 0;
  }

  open(page, camera) {
    this.page = page;
    this.mesh.visible = true;
    this.draw();
    // Place 1.4 m in front of the head, facing it.
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    camera.getWorldPosition(p);
    camera.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0; fwd.normalize();
    this.mesh.position.copy(p).addScaledVector(fwd, 1.4);
    this.mesh.position.y = p.y - 0.1;
    this.mesh.lookAt(p.x, this.mesh.position.y, p.z);
  }

  close() { this.page = null; this.mesh.visible = false; }

  get isOpen() { return this.mesh.visible; }

  _layout() {
    const app = this.app;
    const b = [];
    const add = (label, action, x, y, w = 420, h = 70, enabled = true) => b.push({ label, action, x, y, w, h, enabled });
    const cx = W / 2 - 210;
    if (this.page === 'main' || this.page === 'levels') {
      LEVELS.forEach((lv, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        add(`${lv.id}. ${lv.name}`, 'level:' + lv.id, 70 + col * 450, 170 + row * 86, 430, 70, lv.id <= app.save.unlocked);
      });
      add(`Movement: ${app.save.settings.vrMovement === 'smooth' ? 'Smooth + teleport' : 'Teleport only'}`, 'toggle-move', 70, 530, 430, 64);
      add('Exit VR', 'exit-vr', 520, 530, 430, 64);
    } else if (this.page === 'pause') {
      add('Resume', 'resume', cx, 150);
      add('Restart chamber', 'restart', cx, 235);
      add('Remove clone', 'remove-clone', cx, 320, 420, 70, !!(app.game && app.game.clone));
      add(`Movement: ${app.save.settings.vrMovement === 'smooth' ? 'Smooth + teleport' : 'Teleport only'}`, 'toggle-move', cx, 405);
      add('Level select', 'levels', cx, 490);
      add('Exit VR', 'exit-vr', cx, 575);
    } else if (this.page === 'complete') {
      add('Next chamber', 'next', cx, 260, 420, 70, app.levelIndex < LEVELS.length);
      add('Replay', 'restart', cx, 345);
      add('Level select', 'levels', cx, 430);
    } else if (this.page === 'final') {
      add('Level select', 'levels', cx, 400);
      add('Exit VR', 'exit-vr', cx, 485);
    }
    this.buttons = b;
  }

  draw() {
    this._layout();
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(30,32,36,0.94)';
    roundRect(c, 10, 10, W - 20, H - 20, 24); c.fill();
    c.strokeStyle = '#4a4d52'; c.lineWidth = 3; c.stroke();
    c.fillStyle = '#e6e7e9';
    c.textAlign = 'center';
    c.font = '300 52px system-ui, sans-serif';
    const titles = {
      main: 'SECOND SELF', levels: 'SELECT A CHAMBER', pause: 'PAUSED',
      complete: `CHAMBER ${String(this.app.levelIndex).padStart(2, '0')} COMPLETE`, final: 'EXPERIMENT COMPLETE',
    };
    c.fillText(titles[this.page] || '', W / 2, 90);
    c.font = '24px system-ui, sans-serif';
    c.fillStyle = '#9a9ea5';
    if (this.page === 'main' || this.page === 'levels') c.fillText('Point and pull the trigger. Y opens this menu during play.', W / 2, 135);
    if (this.page === 'complete') c.fillText(this.app.lastStats || '', W / 2, 180);
    if (this.page === 'final') { c.fillText('Subject and copy have been released.', W / 2, 200); c.fillText(this.app.lastStats || '', W / 2, 245); }
    if (this.page === 'pause') c.fillText('Grip: grab  Trigger: use  A: jump  B: clone  X: reset clone', W / 2, 125);
    this.buttons.forEach((bt, i) => {
      c.fillStyle = !bt.enabled ? 'rgba(44,47,52,0.5)' : i === this.hover ? '#3361a3' : '#2c2f34';
      roundRect(c, bt.x, bt.y, bt.w, bt.h, 10); c.fill();
      c.strokeStyle = i === this.hover ? '#8cbcff' : '#4a4d52'; c.lineWidth = 2; c.stroke();
      c.fillStyle = bt.enabled ? '#e6e7e9' : '#666a70';
      c.font = '28px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(bt.label, bt.x + bt.w / 2, bt.y + bt.h / 2 + 10);
    });
    this.tex.needsUpdate = true;
  }

  /** ray: THREE.Raycaster. Returns button index under the ray or -1. */
  hitTest(ray) {
    if (!this.isOpen) return -1;
    const hits = ray.intersectObject(this.mesh);
    if (!hits.length) return -1;
    const uv = hits[0].uv;
    const x = uv.x * W, y = (1 - uv.y) * H;
    return this.buttons.findIndex((b) => b.enabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }

  setHover(i) { if (i !== this.hover) { this.hover = i; this.draw(); } }

  click(i) {
    const bt = this.buttons[i];
    if (!bt || !bt.enabled) return;
    this.app.audio.play('ui');
    const a = bt.action;
    if (a.startsWith('level:')) { this.close(); this.app.startLevel(Number(a.slice(6))); return; }
    if (a === 'toggle-move') {
      const s = this.app.save.settings;
      s.vrMovement = s.vrMovement === 'smooth' ? 'teleport' : 'smooth';
      this.app.persist(); this.draw(); return;
    }
    if (a === 'exit-vr') { this.close(); this.app.exitVR(); return; }
    if (a === 'resume') { this.close(); this.app.resume(); return; }
    if (a === 'restart') { this.close(); this.app.startLevel(this.app.levelIndex); return; }
    if (a === 'remove-clone') { this.app.game && this.app.game.removeClone(); this.close(); this.app.resume(); return; }
    if (a === 'next') { this.close(); this.app.startLevel(this.app.levelIndex + 1); return; }
    if (a === 'levels') { this.page = 'levels'; this.draw(); return; }
  }

  showHint(text) {
    const c = this.hc.getContext('2d');
    c.clearRect(0, 0, 1024, 200);
    c.fillStyle = 'rgba(20,22,25,0.78)';
    roundRect(c, 4, 4, 1016, 192, 20); c.fill();
    c.fillStyle = '#f0f2f5';
    c.font = '32px system-ui, sans-serif';
    c.textAlign = 'center';
    const lines = wrap(c, text, 960);
    lines.slice(0, 4).forEach((l, i) => c.fillText(l, 512, 100 - (Math.min(lines.length, 4) - 1) * 21 + i * 42 + 10));
    this.htex.needsUpdate = true;
    this.hintT = 8;
  }

  updateHint(dt, camera) {
    this.hintT = Math.max(0, this.hintT - dt);
    this.hint.material.opacity = Math.min(1, this.hintT);
    this.hint.visible = this.hintT > 0 && !this.isOpen;
    if (!this.hint.visible) return;
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    camera.getWorldPosition(p); camera.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q); fwd.y = 0; fwd.normalize();
    const target = p.clone().addScaledVector(fwd, 1.3); target.y = p.y - 0.42;
    this.hint.position.lerp(target, Math.min(1, dt * 3));
    this.hint.lookAt(p);
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function wrap(c, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
