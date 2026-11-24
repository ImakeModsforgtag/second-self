// Procedural textures, drawn once on canvases. No external image files.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Value-noise field used for mottling. */
function noiseField(size, cells, rand) {
  const g = [];
  for (let i = 0; i < (cells + 1) * (cells + 1); i++) g.push(rand());
  return (x, y) => {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const ix = Math.floor(fx) % cells, iy = Math.floor(fy) % cells;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * (cells + 1) + ix], b = g[iy * (cells + 1) + ix + 1];
    const c = g[(iy + 1) * (cells + 1) + ix], d = g[(iy + 1) * (cells + 1) + ix + 1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
}

const cache = {};

/**
 * Concrete tiles like the reference: light grey squares, mottled, scratched,
 * separated by thin dark grout lines with small chips at the corners.
 * The canvas holds 2x2 tiles; it is mapped at 2 m per repeat (1 m tiles).
 */
export function concreteTiles({ seed = 7, base = 150, size = 1024, grout = 5, variation = 1 } = {}) {
  const key = `tiles-${seed}-${base}-${size}-${grout}`;
  if (cache[key]) return cache[key];
  const rand = rng(seed);
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n1 = noiseField(size, 8, rand), n2 = noiseField(size, 32, rand), n3 = noiseField(size, 96, rand);
  const tile = size / 2;
  const tileShift = [];
  for (let i = 0; i < 4; i++) tileShift.push((rand() - 0.5) * 14 * variation - (rand() < 0.22 ? 12 : 0));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (Math.floor(y / tile) * 2 + Math.floor(x / tile));
      let v = base + tileShift[t];
      v += (n1(x, y) - 0.5) * 22 + (n2(x, y) - 0.5) * 14 + (n3(x, y) - 0.5) * 10;
      v += (rand() - 0.5) * 16; // grain
      const i = (y * size + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 2; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Scratches and swirl marks
  for (let k = 0; k < 260; k++) {
    const x = rand() * size, y = rand() * size;
    const len = 10 + rand() * 70, ang = rand() * Math.PI;
    ctx.strokeStyle = rand() < 0.5 ? `rgba(255,255,255,${0.04 + rand() * 0.07})` : `rgba(40,40,42,${0.04 + rand() * 0.07})`;
    ctx.lineWidth = 0.6 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5 + (rand() - 0.5) * 10, y + Math.sin(ang) * len * 0.5 + (rand() - 0.5) * 10,
      x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  // Small pits
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = `rgba(50,50,52,${0.15 + rand() * 0.25})`;
    const r = 0.5 + rand() * 1.4;
    ctx.beginPath(); ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2); ctx.fill();
  }
  // Grout lines with slight wobble, plus chips at the corners
  ctx.strokeStyle = '#3a3a3c';
  ctx.lineCap = 'round';
  for (let i = 0; i <= 2; i++) {
    for (const vertical of [true, false]) {
      ctx.lineWidth = grout;
      ctx.beginPath();
      const p = i * tile;
      for (let s = 0; s <= size; s += 16) {
        const w = (rand() - 0.5) * 1.6;
        if (vertical) (s === 0 ? ctx.moveTo(p + w, s) : ctx.lineTo(p + w, s));
        else (s === 0 ? ctx.moveTo(s, p + w) : ctx.lineTo(s, p + w));
      }
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#3a3a3c';
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
    for (let k = 0; k < 2; k++) {
      if (rand() < 0.55) continue;
      const cx = i * tile + (rand() - 0.5) * 30, cy = j * tile + (rand() - 0.5) * 4;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 9, cy - 1); ctx.lineTo(cx + 2, cy + 5); ctx.closePath(); ctx.fill();
    }
  }
  // Grout darkening halo
  const grad = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    return g;
  };
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const x0 = i * tile, y0 = j * tile;
    ctx.fillStyle = grad(x0, y0, x0 + 14, y0); ctx.fillRect(x0, y0, 14, tile);
    ctx.fillStyle = grad(x0, y0, x0, y0 + 14); ctx.fillRect(x0, y0, tile, 14);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  cache[key] = tex;
  return tex;
}

/** Plain smooth concrete (for crates, pedestals): mottled with a dark border seam. */
export function crateTexture({ seed = 3, base = 112, size = 256 } = {}) {
  const key = `crate-${seed}-${base}`;
  if (cache[key]) return cache[key];
  const rand = rng(seed);
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n1 = noiseField(size, 6, rand), n2 = noiseField(size, 24, rand);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = base + (n1(x, y) - 0.5) * 20 + (n2(x, y) - 0.5) * 12 + (rand() - 0.5) * 14;
    const i = (y * size + x) * 4;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 3; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(25,26,28,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.strokeStyle = 'rgba(200,200,205,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(9, 9, size - 18, size - 18);
  for (let k = 0; k < 40; k++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.04 + rand() * 0.05})`;
    ctx.lineWidth = 1;
    const x = rand() * size, y = rand() * size;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 40); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache[key] = tex;
  return tex;
}

/** The clone's (and your) shirt: deep navy with a bold teal and orange wave graphic. */
export function shirtTexture() {
  if (cache.shirt) return cache.shirt;
  const w = 512, h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f2a44';
  ctx.fillRect(0, 0, w, h);
  // Subtle knit stripes
  for (let y = 0; y < h; y += 4) { ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(0, y, w, 2); }
  // Wave bands across the chest (front is the middle of the texture: u 0.25..0.75)
  const band = (y0, amp, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = y0 + Math.sin((x / w) * Math.PI * 6) * amp;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  band(118, 10, '#2fb7a8', 16);
  band(142, 10, '#f08a3c', 9);
  band(160, 10, '#e9edf2', 4);
  // Chest badge: a small double-square "2" mark
  ctx.save();
  ctx.translate(w * 0.5 + 34, 70);
  ctx.strokeStyle = '#e9edf2'; ctx.lineWidth = 4;
  ctx.strokeRect(-14, -14, 20, 20);
  ctx.strokeStyle = '#2fb7a8';
  ctx.strokeRect(-4, -4, 20, 20);
  ctx.restore();
  // Hem
  ctx.fillStyle = '#18213a'; ctx.fillRect(0, h - 14, w, 14);
  ctx.fillStyle = '#18213a'; ctx.fillRect(0, 0, w, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  cache.shirt = tex;
  return tex;
}

/** Text/icon label on a small square (used for door lamps and input tags). */
export function labelTexture(text, { fg = '#ffffff', bg = null, size = 128, font = 'bold 76px system-ui, sans-serif', ring = null } = {}) {
  const key = `label-${text}-${fg}-${bg}-${ring}`;
  if (cache[key]) return cache[key];
  const c = canvas(size);
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
  if (ring) {
    ctx.strokeStyle = ring; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache[key] = tex;
  return tex;
}

/** Soft radial glow sprite. */
export function glowTexture() {
  if (cache.glow) return cache.glow;
  const s = 128;
  const c = canvas(s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  cache.glow = tex;
  return tex;
}

/** Blue grip panel: white-edged tiles with a raised dot grid (1 m per repeat). */
export function gripTexture() {
  if (cache.grip) return cache.grip;
  const s = 256;
  const c = canvas(s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2f6fd6'; ctx.fillRect(0, 0, s, s);
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(235,243,255,0.85)';
  for (let y = 24; y < s; y += 42) for (let x = 24 + ((y / 42) % 2) * 21; x < s; x += 42) { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#e9f1ff'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, s - 8, s - 8);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.grip = tex;
  return tex;
}

/** Bright sky gradient used as the background for the sky chambers. */
export function skyTexture() {
  if (cache.sky) return cache.sky;
  const c = canvas(32, 512);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#4f86c9');
  g.addColorStop(0.42, '#9cc3ea');
  g.addColorStop(0.5, '#dde9f4');
  g.addColorStop(0.58, '#c9d9e9');
  g.addColorStop(1, '#8fa6bd');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  cache.sky = tex;
  return tex;
}

/** Soft cloud puff. */
export function cloudTexture() {
  if (cache.cloud) return cache.cloud;
  const s = 256;
  const c = canvas(s);
  const ctx = c.getContext('2d');
  const rand = rng(42);
  for (let i = 0; i < 26; i++) {
    const x = s * (0.2 + rand() * 0.6), y = s * (0.35 + rand() * 0.3), r = s * (0.08 + rand() * 0.14);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.cloud = tex;
  return tex;
}

/** Shirt print for a multiplayer outfit: {shirt, shirt2, pattern}. Cached per combination. */
export function outfitShirtTexture(o) {
  const key = `shirt:${o.pattern}:${o.shirt}:${o.shirt2}`;
  if (cache[key]) return cache[key];
  if (o.pattern === 'wave' && o.shirt === '#1e3a8a' && o.shirt2 === '#3b82f6') { /* default look keeps its own colours below */ }
  const w = 512, h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = o.shirt;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(0, y, w, 2); }
  ctx.fillStyle = o.shirt2; ctx.strokeStyle = o.shirt2;
  switch (o.pattern) {
    case 'stripes':
      for (let y = 20; y < h; y += 36) ctx.fillRect(0, y, w, 14);
      break;
    case 'wave': {
      const band = (y0, amp, color, width) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) { const y = y0 + Math.sin((x / w) * Math.PI * 6) * amp; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.stroke();
      };
      band(118, 10, o.shirt2, 16); band(142, 10, '#f08a3c', 9); band(160, 10, '#e9edf2', 4);
      break;
    }
    case 'dots':
      for (let y = 18; y < h; y += 30) for (let x = (y / 30) % 2 ? 15 : 0; x < w; x += 30) { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'check':
      ctx.globalAlpha = 0.55;
      for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 14, h);
      for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 14);
      ctx.globalAlpha = 1;
      break;
    case 'split':
      ctx.fillRect(0, h * 0.5, w, h * 0.5);
      ctx.fillStyle = '#e9edf2'; ctx.fillRect(0, h * 0.5 - 4, w, 8);
      break;
    default: break;
  }
  // Small chest mark
  ctx.save();
  ctx.translate(w * 0.5 + 34, 70);
  ctx.strokeStyle = '#e9edf2'; ctx.lineWidth = 4; ctx.strokeRect(-14, -14, 20, 20);
  ctx.strokeStyle = o.shirt2; ctx.strokeRect(-4, -4, 20, 20);
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, h - 14, w, 14); ctx.fillRect(0, 0, w, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  cache[key] = tex;
  return tex;
}

/** Floating name tag (not cached: one per player). */
export function nameTagTexture(name, color = '#4fc3f7', extra = '') {
  const w = 512, h = 128;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.font = '600 52px system-ui, sans-serif';
  const tw = Math.min(w - 40, ctx.measureText(name).width + 70);
  const x0 = (w - tw) / 2;
  ctx.fillStyle = 'rgba(18,20,24,0.78)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, 18, tw, 80, 40) : ctx.rect(x0, 18, tw, 80); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x0 + 36, 58, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2f4f7'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(name, x0 + 58, 60, tw - 70);
  if (extra) { ctx.font = '28px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd27a'; ctx.fillText(extra, w / 2, 116); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
