// All sound is synthesised live with the Web Audio API: original, no samples,
// no licensing concerns. Sounds are panned and attenuated by distance.

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.ambienceOn = true;
    this.listener = { x: 0, y: 1.6, z: 0, yaw: 0 };
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.amb = this.ctx.createGain(); this.amb.gain.value = 0; this.amb.connect(this.master);
    // Shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.6 + b * 3; }
    this._startAmbience();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setAmbience(on) {
    this.ambienceOn = on;
    if (this.amb) this.amb.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.5);
  }

  setListener(x, y, z, yaw) { this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw; }

  _startAmbience() {
    const c = this.ctx;
    // Low ventilation hum: two detuned tones and filtered noise, slowly breathing.
    const hum = c.createGain(); hum.gain.value = 0.05; hum.connect(this.amb);
    for (const f of [55, 82.6, 110.3]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain(); g.gain.value = f === 55 ? 0.6 : 0.25;
      o.connect(g).connect(hum); o.start();
    }
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const ng = c.createGain(); ng.gain.value = 0.05;
    n.connect(lp).connect(ng).connect(this.amb); n.start();
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lg = c.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg).connect(ng.gain); lfo.start();
    this.amb.gain.setTargetAtTime(this.ambienceOn ? 0.5 : 0, c.currentTime, 1.5);
  }

  /** Output node for a sound at a world position (or null for non-positional). */
  _out(pos, gain = 1) {
    const c = this.ctx;
    const g = c.createGain();
    let vol = gain;
    if (pos) {
      const L = this.listener;
      const dx = pos.x - L.x, dz = pos.z - L.z, dy = (pos.y ?? L.y) - L.y;
      const dist = Math.hypot(dx, dy, dz);
      vol *= 1 / (1 + dist * 0.18);
      if (c.createStereoPanner) {
        const p = c.createStereoPanner();
        // Right vector of the listener: (cos yaw, -sin yaw)
        const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
        p.pan.value = dist > 0.01 ? Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / dist)) : 0;
        g.connect(p).connect(this.sfx);
      } else g.connect(this.sfx);
    } else g.connect(this.sfx);
    g.gain.value = vol;
    return g;
  }

  _tone(out, { type = 'sine', f0, f1 = f0, t = 0, dur = 0.2, a = 0.005, vol = 0.3 }) {
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(out);
    o.start(now); o.stop(now + dur + 0.05);
  }

  _noise(out, { t = 0, dur = 0.15, type = 'lowpass', f = 800, f1 = f, q = 0.8, vol = 0.3, a = 0.004 }) {
    const c = this.ctx, now = c.currentTime + t;
    const s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, now);
    if (f1 !== f) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(fl).connect(g).connect(out);
    s.start(now, Math.random()); s.stop(now + dur + 0.05);
  }

  play(name, pos = null, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const out = this._out(pos, opts.gain ?? 1);
    const r = () => 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'step':
        this._noise(out, { dur: 0.09, f: 420 * r(), vol: 0.22 });
        this._tone(out, { f0: 90 * r(), f1: 60, dur: 0.07, vol: 0.12 });
        break;
      case 'clone-step':
        this._noise(out, { dur: 0.08, f: 520 * r(), vol: 0.18 });
        break;
      case 'jump':
        this._noise(out, { dur: 0.12, type: 'bandpass', f: 600, f1: 1200, vol: 0.06 });
        break;
      case 'land':
        this._noise(out, { dur: 0.16, f: 300, vol: 0.32 });
        this._tone(out, { f0: 70, f1: 45, dur: 0.14, vol: 0.2 });
        break;
      case 'pickup':
        this._noise(out, { dur: 0.1, f: 900, vol: 0.18 });
        this._tone(out, { f0: 140, f1: 110, dur: 0.12, vol: 0.18 });
        this._tone(out, { type: 'triangle', f0: 1200, dur: 0.05, t: 0.03, vol: 0.05 });
        break;
      case 'drop':
        this._tone(out, { type: 'triangle', f0: 700, f1: 500, dur: 0.06, vol: 0.05 });
        break;
      case 'thud': {
        const v = Math.min(1, (opts.speed || 4) / 8);
        this._noise(out, { dur: 0.22, f: 260, vol: 0.25 + v * 0.3 });
        this._tone(out, { f0: 80, f1: 38, dur: 0.22, vol: 0.25 + v * 0.25 });
        break;
      }
      case 'clone-spawn':
        this._tone(out, { f0: 180, f1: 760, dur: 1.0, a: 0.25, vol: 0.18 });
        this._tone(out, { type: 'triangle', f0: 361, f1: 1522, dur: 1.0, a: 0.3, vol: 0.06 });
        this._noise(out, { dur: 1.1, type: 'bandpass', f: 400, f1: 4000, q: 2, a: 0.4, vol: 0.12 });
        for (let i = 0; i < 4; i++) this._tone(out, { f0: 1046 * (1 + i * 0.25), dur: 0.5, t: 0.75 + i * 0.07, vol: 0.05 });
        break;
      case 'clone-remove':
        this._tone(out, { f0: 700, f1: 160, dur: 0.5, a: 0.02, vol: 0.14 });
        this._noise(out, { dur: 0.5, type: 'bandpass', f: 3000, f1: 300, q: 2, vol: 0.1 });
        break;
      case 'plate-on':
        this._tone(out, { type: 'square', f0: 220, f1: 180, dur: 0.05, vol: 0.06 });
        this._tone(out, { f0: 110, f1: 70, dur: 0.18, t: 0.02, vol: 0.25 });
        this._tone(out, { f0: 660, dur: 0.25, t: 0.06, vol: 0.06 });
        break;
      case 'plate-off':
        this._tone(out, { type: 'square', f0: 260, f1: 300, dur: 0.04, vol: 0.05 });
        this._tone(out, { f0: 440, dur: 0.2, t: 0.03, vol: 0.04 });
        break;
      case 'button':
        this._tone(out, { type: 'square', f0: 1800, dur: 0.02, vol: 0.05 });
        this._tone(out, { f0: 880, f1: 1320, dur: 0.18, t: 0.02, vol: 0.09 });
        break;
      case 'laser-on':
        this._tone(out, { type: 'sawtooth', f0: 120, f1: 240, dur: 0.35, a: 0.02, vol: 0.06 });
        this._noise(out, { dur: 0.3, type: 'bandpass', f: 2400, q: 6, vol: 0.06 });
        break;
      case 'laser-off':
        this._tone(out, { type: 'sawtooth', f0: 240, f1: 80, dur: 0.3, vol: 0.05 });
        break;
      case 'receiver-on':
        this._tone(out, { f0: 784, dur: 0.35, vol: 0.09 });
        this._tone(out, { f0: 1175, dur: 0.45, t: 0.08, vol: 0.08 });
        break;
      case 'receiver-off':
        this._tone(out, { f0: 587, f1: 392, dur: 0.3, vol: 0.06 });
        break;
      case 'mirror':
        for (let i = 0; i < 3; i++) this._noise(out, { t: i * 0.035, dur: 0.025, type: 'highpass', f: 3000, vol: 0.1 });
        this._tone(out, { type: 'triangle', f0: 320, dur: 0.06, vol: 0.05 });
        break;
      case 'door-open':
        this._noise(out, { dur: 1.2, f: 120, f1: 500, a: 0.1, vol: 0.32 });
        this._tone(out, { type: 'sawtooth', f0: 70, f1: 140, dur: 1.1, a: 0.15, vol: 0.05 });
        this._tone(out, { f0: 660, dur: 0.3, vol: 0.05 });
        this._tone(out, { f0: 990, dur: 0.4, t: 0.1, vol: 0.05 });
        break;
      case 'door-close':
        this._noise(out, { dur: 1.0, f: 500, f1: 120, a: 0.05, vol: 0.28 });
        this._tone(out, { f0: 60, f1: 40, dur: 0.3, t: 0.9, vol: 0.25 });
        break;
      case 'complete':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this._tone(out, { f0: f, dur: 1.4, t: i * 0.14, a: 0.01, vol: 0.09 });
          this._tone(out, { type: 'triangle', f0: f * 2, dur: 0.8, t: i * 0.14, vol: 0.02 });
        });
        break;
      case 'final':
        [130.8, 196, 261.6, 329.6, 392, 523.3].forEach((f, i) => this._tone(out, { f0: f, dur: 7, t: i * 0.25, a: 2, vol: 0.06 }));
        this._noise(out, { dur: 6, type: 'bandpass', f: 300, f1: 6000, q: 0.5, a: 3, vol: 0.06 });
        break;
      case 'toast':
        this._tone(out, { type: 'triangle', f0: 520, f1: 420, dur: 0.12, vol: 0.05 });
        break;
      case 'teleport':
        this._noise(out, { dur: 0.25, type: 'bandpass', f: 2000, f1: 500, q: 2, vol: 0.1 });
        break;
      case 'rotate':
        this._noise(out, { dur: 0.08, f: 600, vol: 0.14 });
        break;
      case 'ui':
        this._tone(out, { type: 'triangle', f0: 700, dur: 0.05, vol: 0.05 });
        break;
      default: break;
    }
  }
}
