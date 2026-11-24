// Keyboard and mouse. Pointer lock for mouse look; bindings are configurable.

export class DesktopInput {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.keys = new Set();
    this.locked = false;

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.app.state !== 'playing') return;
      const s = this.app.save.settings;
      const k = 0.0022 * s.mouseSensitivity;
      const pl = this.app.game.player;
      pl.yaw -= e.movementX * k;
      pl.pitch -= e.movementY * k * (s.invertY ? -1 : 1);
      pl.pitch = Math.max(-1.52, Math.min(1.52, pl.pitch));
    });

    canvas.addEventListener('mousedown', (e) => {
      this.app.audio.init();
      if (this.app.state === 'playing' && !this.locked && !this.app.inXR) { this.lock(); return; }
      if (!this.locked || this.app.state !== 'playing') return;
      if (e.button === 0) this.app.desktopGrab();
      if (e.button === 2) { if (this.app.game && this.app.game.hasGun) this.app.fireGun(); else this.app.desktopRotate(-1); }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      if (this.app.state !== 'playing') return;
      this.app.holdDist = Math.max(0.9, Math.min(2.2, this.app.holdDist - Math.sign(e.deltaY) * 0.1));
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.app.state === 'playing' && !this.app.inXR && !this.app.ignoreUnlock) this.app.pause();
      this.app.ignoreUnlock = false;
    });

    window.addEventListener('keydown', (e) => {
      if (this.app.menu.listening) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const b = this.app.save.bindings;
      if (this.app.state === 'playing') {
        if ([b.forward, b.back, b.left, b.right, b.jump].includes(e.code)) e.preventDefault();
        if (e.repeat) { this.keys.add(e.code); return; }
        this.keys.add(e.code);
        if (e.code === b.interact) this.app.desktopInteract();
        else if (e.code === b.rotateLeft) this.app.desktopRotate(-1);
        else if (e.code === b.clone) this.app.doCreateClone();
        else if (e.code === b.resetClone) this.app.doResetClone();
        else if (e.code === b.fire) this.app.fireGun();
        else if (e.code === b.pause || e.code === 'Escape') this.app.pause();
      } else if (e.code === 'Escape' && this.app.state === 'paused' && this.app.menu.current === 'mppause') {
        this.app.resume();
      } else if (e.code === 'Escape' && this.app.state === 'paused' && this.app.menu.current !== 'pause') {
        this.app.menu.back();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  lock() {
    if (this.app.inXR) return;
    try {
      const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  unlock() {
    if (document.pointerLockElement) { this.app.ignoreUnlock = true; document.exitPointerLock(); }
  }

  /** Movement intent in the player's local frame: {f, s, slow, jump}. */
  intent() {
    const b = this.app.save.bindings;
    const k = this.keys;
    const f = (k.has(b.forward) || k.has('ArrowUp') ? 1 : 0) - (k.has(b.back) || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has(b.right) || k.has('ArrowRight') ? 1 : 0) - (k.has(b.left) || k.has('ArrowLeft') ? 1 : 0);
    return { f, s, slow: k.has(b.slow) || k.has('ShiftRight'), jump: k.has(b.jump) };
  }
}
