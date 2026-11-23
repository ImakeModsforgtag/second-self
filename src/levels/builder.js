// Level construction kit. Levels are authored by hand (see levels.js) with this
// small API; nothing is randomly generated, so every chamber has a known solution.
// Coordinates are metres. North = -z, South = +z, East = +x, West = -x.

const T = 0.4; // wall thickness

const NORMALS = {
  N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 },
};

export function buildLevel(def) {
  const H = def.height || 5;
  const data = {
    statics: [], pods: [], plates: [], buttons: [], emitters: [], receivers: [],
    mirrors: [], sockets: [], blocks: [], doors: [], exits: [], hints: [], lights: [],
    wires: [], decals: [], start: def.start, height: H, bounds: def.bounds,
  };

  const S = (x0, y0, z0, x1, y1, z1, mat = 'wall', extra = {}) => {
    data.statics.push({ b: [x0, y0, z0, x1, y1, z1], mat, ...extra });
  };

  const api = {
    H,
    solid: S,
    /** Wall running along x at z, from x0 to x1, with optional gaps [[a,b],...]. */
    wallX(z, x0, x1, { y0 = 0, y1 = H, gaps = [] } = {}) {
      let cur = x0;
      const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
      for (const [a, b] of sorted) { if (a > cur) S(cur, y0, z - T / 2, a, y1, z + T / 2); cur = Math.max(cur, b); }
      if (x1 > cur) S(cur, y0, z - T / 2, x1, y1, z + T / 2);
    },
    /** Wall running along z at x, from z0 to z1, with optional gaps. */
    wallZ(x, z0, z1, { y0 = 0, y1 = H, gaps = [] } = {}) {
      let cur = z0;
      const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
      for (const [a, b] of sorted) { if (a > cur) S(x - T / 2, y0, cur, x + T / 2, y1, a); cur = Math.max(cur, b); }
      if (z1 > cur) S(x - T / 2, y0, cur, x + T / 2, y1, z1);
    },
    /** Raised solid platform with a top surface at `top`. */
    platform(x0, z0, x1, z1, top, y0 = 0) { S(x0, y0, z0, x1, top, z1, 'platform'); },
    /** Low concrete barrier (a clone cannot step over it, you can see over it). */
    barrier(x0, z0, x1, z1, h = 1.0, y0 = 0) { S(x0, y0, z0, x1, y0 + h, z1, 'barrier'); },
    pillar(x0, z0, x1, z1, y0 = 0, y1 = H) { S(x0, y0, z0, x1, y1, z1, 'wall'); },

    door({ id, x, z, axis, width = 2, height = 2.7, y0 = 0, requires = [], latch = false, exit = false }) {
      data.doors.push({ id, x, z, axis, width, height, y0, requires, latch, exit });
      // Header above the door opening.
      if (axis === 'x') S(x - width / 2, y0 + height, z - T / 2, x + width / 2, H, z + T / 2, 'wall');
      else S(x - T / 2, y0 + height, z - width / 2, x + T / 2, H, z + width / 2, 'wall');
    },
    plate({ id, x, z, w = 1.6, d = 1.6, y = 0 }) {
      data.plates.push({ id, x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, y, x, z });
    },
    button({ id, x, y, z, facing, mode = 'toggle', duration }) {
      data.buttons.push({ id, x, y, z, normal: NORMALS[facing], facing, mode, duration });
    },
    pod({ x, z, y = 0, yaw = 0, id }) {
      data.pods.push({ x, z, y, yaw: (yaw * Math.PI) / 180, id });
    },
    emitter({ id, x, z, y = 0, dir, power }) { data.emitters.push({ id, x, z, y, dir, power }); },
    receiver({ id, x, z, y = 0, facing }) { data.receivers.push({ id, x, z, y, normal: NORMALS[facing], facing }); },
    /** step: 0..15, each step = 22.5 degrees of the panel normal (0 = normal along +x). */
    mirror({ id, x, z, y = 0, step = 0, portable = false }) { data.mirrors.push({ id, x, z, y, step, portable }); },
    socket({ x, z, y = 0 }) { data.sockets.push({ x, z, y }); },
    cube(x, z, y = 0, s = 1, id) { data.blocks.push({ x, z, y, w: s, h: s, d: s, id }); },
    slab(x, z, w, h, d, y = 0, id) { data.blocks.push({ x, z, y, w, h, d, id }); },
    exit({ x, z, y = 0, w = 1.8, d = 1.8, final = false }) {
      data.exits.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, y, final, x, z });
    },
    hint(text, zone) { data.hints.push(zone ? { text, zone } : { text, event: 'start' }); },
    hintOn(event, text) { data.hints.push({ text, event }); },
    light(x, z, y = H - 0.05, intensity = 1) { data.lights.push({ x, y, z, intensity }); },
    /** Floor guide stripe (decal) for indicator cables: points [[x,z],...] */
    wire(points, from, y = 0) { data.wires.push({ points, from, y }); },
    decal(kind, x, z, y = 0, extra = {}) { data.decals.push({ kind, x, z, y, ...extra }); },
  };

  // Floor and ceiling over the whole footprint.
  const [bx0, bz0, bx1, bz1] = def.bounds;
  S(bx0, -0.5, bz0, bx1, 0, bz1, 'floor');
  if (def.ceilingHoles) {
    // Simple split: ceiling around one rectangular hole.
    const [hx0, hz0, hx1, hz1] = def.ceilingHoles[0];
    S(bx0, H, bz0, bx1, H + 0.4, hz0, 'ceiling');
    S(bx0, H, hz1, bx1, H + 0.4, bz1, 'ceiling');
    S(bx0, H, hz0, hx0, H + 0.4, hz1, 'ceiling');
    S(hx1, H, hz0, bx1, H + 0.4, hz1, 'ceiling');
  } else {
    S(bx0, H, bz0, bx1, H + 0.4, bz1, 'ceiling');
  }

  def.build(api);
  return data;
}

export { NORMALS };
