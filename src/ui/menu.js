// HTML menus and the minimal HUD.
import { LEVELS } from '../levels/levels.js';
import { DEFAULT_BINDINGS, BINDING_LABELS } from '../config.js';

const $ = (id) => document.getElementById(id);

function keyName(code) {
  if (!code) return '-';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'Space');
}

export class Menu {
  constructor(app) {
    this.app = app;
    this.stack = [];
    this.current = 'main';
    this.listening = null;
    this.hintTimer = 0;
    this.toastTimer = 0;
    document.querySelectorAll('#ui button[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.app.audio.init(); this.app.audio.play('ui'); this.action(btn.dataset.action); });
    });
    window.addEventListener('keydown', (e) => this._bindKey(e), true);
    this.renderLevels();
    this.renderSettings();
  }

  show(name, { push = false } = {}) {
    if (push && this.current) this.stack.push(this.current);
    else if (!push) this.stack = [];
    this.current = name;
    document.querySelectorAll('#ui .screen').forEach((s) => s.classList.add('hidden'));
    if (name) {
      const el = $('screen-' + name);
      if (el) el.classList.remove('hidden');
      if (name === 'levels') this.renderLevels();
      if (name === 'settings') this.renderSettings();
      const first = el && el.querySelector('button');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    }
    $('hud').classList.toggle('hidden', name !== null);
  }

  hideAll() { this.show(null); }

  back() {
    const prev = this.stack.pop() || (this.app.state === 'paused' ? 'pause' : 'main');
    const keep = [...this.stack];
    this.show(prev);
    this.stack = keep;
  }

  action(a) {
    const app = this.app;
    switch (a) {
      case 'play': app.startLevel(Math.min(app.save.unlocked, LEVELS.length)); break;
      case 'levels': this.show('levels', { push: true }); break;
      case 'settings': this.show('settings', { push: true }); break;
      case 'back': this.back(); break;
      case 'resume': app.resume(); break;
      case 'restart': app.startLevel(app.levelIndex); break;
      case 'main': app.toMainMenu(); break;
      case 'next': app.startLevel(app.levelIndex + 1); break;
      case 'enter-vr': app.enterVR(); break;
      case 'remove-clone': if (app.game) app.game.removeClone(); app.resume(); break;
      case 'reset-bindings':
        app.save.bindings = { ...DEFAULT_BINDINGS };
        app.persist();
        this.renderSettings();
        break;
      default: break;
    }
  }

  renderLevels() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    for (const lv of LEVELS) {
      const b = document.createElement('button');
      const locked = lv.id > this.app.save.unlocked;
      b.disabled = locked;
      const done = this.app.save.completed[lv.id];
      b.innerHTML = `<span class="num">CHAMBER ${String(lv.id).padStart(2, '0')}</span><span class="name">${lv.name}</span>` +
        `<span class="done">${locked ? 'Locked' : done ? 'Complete' : lv.difficulty}</span>`;
      b.addEventListener('click', () => { this.app.audio.init(); this.app.startLevel(lv.id); });
      grid.appendChild(b);
    }
  }

  renderSettings() {
    const s = this.app.save.settings;
    const form = $('settings-form');
    const rows = [
      ['range', 'mouseSensitivity', 'Mouse sensitivity', 0.2, 3, 0.05],
      ['check', 'invertY', 'Invert mouse Y'],
      ['range', 'fov', 'Field of view', 60, 100, 1],
      ['range', 'volume', 'Volume', 0, 1, 0.05],
      ['check', 'ambience', 'Ambient sound'],
      ['select', 'shadows', 'Shadows', [['high', 'High'], ['low', 'Low'], ['off', 'Off']]],
      ['check', 'showHints', 'Show hints'],
      ['check', 'headBob', 'Head bob'],
      ['select', 'vrMovement', 'VR movement', [['smooth', 'Smooth (left stick)'], ['teleport', 'Teleport only']]],
      ['select', 'vrSnapAngle', 'VR snap turn', [['30', '30 degrees'], ['45', '45 degrees'], ['22', '22 degrees']]],
      ['check', 'vrVignette', 'VR comfort vignette'],
    ];
    form.innerHTML = '';
    for (const [type, key, label, a, b, step] of rows) {
      const row = document.createElement('div');
      row.className = 'row';
      const l = document.createElement('label');
      l.textContent = label;
      row.appendChild(l);
      let input;
      if (type === 'range') {
        input = document.createElement('input');
        input.type = 'range'; input.min = a; input.max = b; input.step = step; input.value = s[key];
        input.addEventListener('input', () => { s[key] = Number(input.value); this.app.applySettings(); });
      } else if (type === 'check') {
        input = document.createElement('input');
        input.type = 'checkbox'; input.checked = !!s[key];
        input.addEventListener('change', () => { s[key] = input.checked; this.app.applySettings(); });
      } else {
        input = document.createElement('select');
        for (const [v, t] of a) { const o = document.createElement('option'); o.value = v; o.textContent = t; input.appendChild(o); }
        input.value = String(s[key]);
        input.addEventListener('change', () => { s[key] = key === 'vrSnapAngle' ? Number(input.value) : input.value; this.app.applySettings(); });
      }
      row.appendChild(input);
      form.appendChild(row);
    }
    const bind = $('bindings');
    bind.innerHTML = '';
    for (const [action, label] of Object.entries(BINDING_LABELS)) {
      const row = document.createElement('div');
      row.className = 'row';
      const l = document.createElement('label'); l.textContent = label;
      const btn = document.createElement('button');
      btn.className = 'keybtn';
      btn.textContent = keyName(this.app.save.bindings[action]);
      if (action === 'pause') { btn.disabled = true; btn.title = 'Escape always pauses'; }
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.keybtn').forEach((k) => k.classList.remove('listening'));
        this.listening = action; btn.classList.add('listening'); btn.textContent = 'Press a key';
      });
      row.appendChild(l); row.appendChild(btn);
      bind.appendChild(row);
    }
    const extra = document.createElement('div');
    extra.className = 'row';
    extra.innerHTML = '<label>Grab / release</label><span class="note">Left mouse button</span>';
    bind.appendChild(extra);
    const extra2 = document.createElement('div');
    extra2.className = 'row';
    extra2.innerHTML = '<label>Hold distance</label><span class="note">Mouse wheel</span>';
    bind.appendChild(extra2);
  }

  _bindKey(e) {
    if (!this.listening) return;
    e.preventDefault(); e.stopPropagation();
    if (e.code !== 'Escape') {
      // Swap if another action already uses this key.
      const b = this.app.save.bindings;
      for (const k of Object.keys(b)) if (b[k] === e.code && k !== this.listening) b[k] = b[this.listening];
      b[this.listening] = e.code;
      this.app.persist();
    }
    this.listening = null;
    this.renderSettings();
  }

  // ---------------- HUD
  setLevelTag(text) { $('levelTag').textContent = text; }

  hint(text, seconds = 8) {
    if (!this.app.save.settings.showHints) return;
    const el = $('hint');
    el.textContent = text;
    el.classList.add('show');
    this.hintTimer = seconds;
  }

  toast(text, seconds = 2.4) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    this.toastTimer = seconds;
  }

  prompt(text) {
    const el = $('prompt');
    if (el.textContent !== text) el.textContent = text;
    $('crosshair').classList.toggle('target', !!text);
  }

  update(dt) {
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) $('hint').classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) $('toast').classList.remove('show'); }
  }

  clearHUD() {
    $('hint').classList.remove('show');
    $('toast').classList.remove('show');
    this.hintTimer = 0; this.toastTimer = 0;
    this.prompt('');
  }

  showComplete(levelId, stats) {
    const isLast = levelId >= LEVELS.length;
    $('complete-title').textContent = `Chamber ${String(levelId).padStart(2, '0')} complete`;
    $('complete-stats').textContent = stats;
    $('btn-next').classList.toggle('hidden', isLast);
    this.show('complete');
  }

  showFinal(stats) {
    $('final-stats').textContent = stats;
    this.show('final');
  }

  setVRStatus(supported, note) {
    $('btn-vr').disabled = !supported;
    $('vr-note').textContent = note || '';
  }

  fade(on) { $('fade').classList.toggle('on', on); }
}
