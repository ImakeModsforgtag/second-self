// SECOND SELF co-op: eight multiplayer chambers. Every chamber is built for the
// number of players in the lobby (2, 3 or 4): the count changes how many people
// must hold plates, how many rooms the light passes through, how many clones
// are needed and who does what. tests/mp-playthrough.mjs solves every chamber
// at every player count with one bot per player.
//
// Chambers are made of reusable "stages" stacked from south to north. Each
// stage spans z from zS (south wall) to zN (north wall) and connects to the next
// stage through a 2 m opening at x = -1..1.

const H = 5;

/** Walls around a stage: west, east, and optional south/north lines with a central 2 m opening. */
function shell(b, x0, x1, zS, zN, { south = 'gap', north = 'gap' } = {}) {
  if (south) b.wallX(zS, x0, x1, south === 'gap' ? { gaps: [[-1, 1]] } : {});
  if (north) b.wallX(zN, x0, x1, north === 'gap' ? { gaps: [[-1, 1]] } : {});
  b.wallZ(x0, zN, zS);
  b.wallZ(x1, zN, zS);
}

const spread = (count, gap) => Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * gap);

// ---------------------------------------------------------------- stages
/**
 * RELAY: holders stand on plates so a runner can get through the first door;
 * the runner then stands on the plate beyond, which opens the return door.
 * big: one wide plate that needs all holders at once instead of separate plates.
 */
export function stageRelay(b, n, zS, p, { big = false, first = false } = {}) {
  const zN = zS - 14, zm = zS - 7, h = n - 1;
  shell(b, -7, 7, zS, zN, { south: first ? 'solid' : 'gap' });
  b.wallX(zm, -7, 7, { gaps: [[-4, -2], [2, 4]] });
  const plates = [];
  if (big) {
    b.plate({ id: p + 'BIG', x: 0, z: zS - 3.4, w: 3.4, d: 2.6, need: h });
    plates.push({ id: p + 'BIG', x: 0, z: zS - 3.4, big: true });
  } else {
    spread(h, 3.6).forEach((x, i) => { b.plate({ id: `${p}H${i}`, x, z: zS - 3.2 }); plates.push({ id: `${p}H${i}`, x, z: zS - 3.2 }); });
  }
  b.plate({ id: p + 'PB', x: 4.6, z: zm - 3.6 });
  b.door({ id: p + 'DIN', x: -3, z: zm, axis: 'x', width: 2, requires: plates.map((q) => q.id) });
  b.door({ id: p + 'DBK', x: 3, z: zm, axis: 'x', width: 2, requires: [p + 'PB'] });
  b.light(-3.5, zS - 3.5); b.light(3.5, zS - 3.5); b.light(-3.5, zm - 3.5); b.light(3.5, zm - 3.5);
  return { kind: 'relay', zS, zN, zm, plates, pb: { x: 4.6, z: zm - 3.6 }, din: -3, dback: 3, big, p };
}

/**
 * LANES: one lane per player. Each lane's door is opened by the plates in the
 * previous lane (before or after its own door), so players cross one by one.
 */
export function stageLanes(b, n, zS, p, { first = false } = {}) {
  const lw = 3.6, W = lw * n, x0 = -W / 2, zN = zS - 18, zd = zS - 6.5, zHall = zS - 13;
  const x1 = Math.max(W / 2, 4);
  b.wallX(zS, x0, x0 + W, first ? {} : { gaps: [[-1, 1]] });
  b.wallX(zN, -Math.max(x1, 4), Math.max(x1, 4), { gaps: [[-1, 1]] });
  b.wallZ(x0, zHall, zS);
  b.wallZ(x0 + W, zHall, zS);
  b.wallZ(-Math.max(x1, 4), zN, zHall);
  b.wallZ(Math.max(x1, 4), zN, zHall);
  if (W / 2 < 4) { b.wallX(zHall, -4, x0); b.wallX(zHall, x0 + W, 4); }
  for (let i = 1; i < n; i++) b.wallZ(x0 + lw * i, zHall, zS);
  const lanes = [];
  const gaps = [];
  for (let i = 0; i < n; i++) {
    const cx = x0 + lw * (i + 0.5);
    gaps.push([cx - 1, cx + 1]);
    lanes.push({ cx, a: { x: cx, z: zS - 3 }, bp: { x: cx, z: zS - 10 } });
    b.plate({ id: `${p}A${i}`, x: cx, z: zS - 3 });
    b.plate({ id: `${p}B${i}`, x: cx, z: zS - 10 });
    b.light(cx, zS - 3); b.light(cx, zS - 10);
  }
  b.wallX(zd, x0, x0 + W, { gaps });
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    b.door({ id: `${p}D${i}`, x: lanes[i].cx, z: zd, axis: 'x', width: 2, requires: [`${p}A${prev}`, `${p}B${prev}`], any: true });
  }
  b.light(0, zS - 15.5);
  return { kind: 'lanes', zS, zN, zd, zHall, lanes, p };
}

/**
 * LADDER: holders keep the first door open while builders carry the crate in.
 * Two players: the crate alone reaches the 2 m ledge. Three or four: the ledge
 * is 2.7 m, so one builder stands still and the other climbs crate, then head.
 * The switch on the ledge opens the return door and the way north.
 */
export function stageLadder(b, n, zS, p, { first = false } = {}) {
  const zN = zS - 17, zm = zS - 6, L = n === 2 ? 2.0 : 2.7;
  shell(b, -7, 7, zS, zN, { south: first ? 'solid' : 'gap' });
  b.wallX(zm, -7, 7, { gaps: [[-4, -2], [2, 4]] });
  let holders;
  if (n === 4) { b.plate({ id: p + 'BIG', x: 0, z: zS - 3.2, w: 3.2, d: 2.4, need: 2 }); holders = [{ id: p + 'BIG', x: 0, z: zS - 3.2 }]; }
  else { b.plate({ id: p + 'H0', x: 0, z: zS - 3.2 }); holders = [{ id: p + 'H0', x: 0, z: zS - 3.2 }]; }
  b.cube(-5, zS - 2, 0, 1, p + 'C');
  b.platform(-7, zN, -1.4, zS - 13.5, L);
  b.button({ id: p + 'S', x: -4.2, y: L + 1.35, z: zN + 0.25, facing: 'S', mode: 'toggle' });
  b.door({ id: p + 'DIN', x: -3, z: zm, axis: 'x', width: 2, requires: holders.map((q) => q.id) });
  b.door({ id: p + 'DBK', x: 3, z: zm, axis: 'x', width: 2, requires: [p + 'S'] });
  b.door({ id: p + 'DX', x: 0, z: zN, axis: 'x', width: 2, requires: [p + 'S'] });
  b.light(-3.5, zS - 3); b.light(3.5, zS - 3); b.light(-3, zS - 10); b.light(4, zS - 12); b.light(-4, zN + 2, H - 0.05);
  return { kind: 'ladder', zS, zN, zm, L, holders, crate: p + 'C', button: { x: -4.2, y: L + 1.35, z: zN + 0.25 }, ledgeFace: zS - 13.5, p, exitX: 0 };
}

/**
 * BOOTHS: one clone pod per player and one more booth than there are clones.
 * Every player brings their own clone; the last booth needs a person, who is
 * let through by a teammate on the plate beyond the second door.
 */
export function stageBooths(b, n, zS, p, { first = false } = {}) {
  const zN = zS - 20, zb = zS - 9, zm = zS - 14;
  shell(b, -10, 10, zS, zN, { south: first ? 'solid' : 'gap' });
  b.wallX(zm, -10, 10, { gaps: [[-4, -2], [2, 4]] });
  const booths = [];
  for (let k = 0; k < n; k++) {
    const bx = (k - (n - 1) / 2) * 2.4 - 1.5;
    b.barrier(bx - 1.2, zb - 1.2, bx + 1.2, zb - 0.9, 0.9);
    b.barrier(bx - 1.2, zb - 0.9, bx - 0.9, zb + 1.3, 0.9);
    b.barrier(bx + 0.9, zb - 0.9, bx + 1.2, zb + 1.3, 0.9);
    b.plate({ id: `${p}K${k}`, x: bx, z: zb + 0.1, w: 1.8, d: 1.8 });
    booths.push({ id: `${p}K${k}`, x: bx, z: zb + 0.1 });
    b.pod({ x: bx, z: zS - 1.5, yaw: 0, id: `${p}pod${k}` });
  }
  // One plate for a person, in front of the booths where every clone can see them.
  const pp = { id: p + 'PP', x: 7, z: zb - 3 };
  b.plate(pp);
  b.plate({ id: p + 'PX', x: 4.6, z: zm - 3.4 });
  b.door({ id: p + 'DIN', x: -3, z: zm, axis: 'x', width: 2, requires: [...booths.map((q) => q.id), pp.id] });
  b.door({ id: p + 'DBK', x: 3, z: zm, axis: 'x', width: 2, requires: [p + 'PX'] });
  b.light(-5, zS - 3); b.light(5, zS - 3); b.light(-4, zb); b.light(4, zb); b.light(-4, zm - 3); b.light(4, zm - 3);
  const rowEnd = booths[booths.length - 1].x + 2.2;
  return { kind: 'booths', zS, zN, zb, zm, booths, pp, rowEnd, pods: booths.map((q, i) => ({ x: q.x, z: zS - 1.5, id: `${p}pod${i}` })), px: { x: 4.6, z: zm - 3.4 }, p };
}

/**
 * LASER HOLD: one emitter per holder (players minus one), each powered by its
 * own plate. The last player sets the mirrors; the door latches when every
 * receiver is lit at the same moment.
 */
export function stageLaserHold(b, n, zS, p, { first = false } = {}) {
  const zN = zS - 16, h = n - 1;
  shell(b, -8, 8, zS, zN, { south: first ? 'solid' : 'gap', north: false });
  b.wallX(zN, -8, 8, { gaps: [[-1, 1]] });
  const lanes = [];
  for (let k = 0; k < h; k++) {
    const z = zS - 7 - 2.2 * k, x = 2.5 + 2 * k;
    const plate = { id: `${p}P${k}`, x: -5 + 3.4 * k, z: zS - 2.2 };
    b.plate(plate);
    b.emitter({ id: `${p}E${k}`, x: -7.5, z, dir: 'E', power: [plate.id] });
    b.mirror({ id: `${p}M${k}`, x, z, step: 0 });
    b.receiver({ id: `${p}R${k}`, x, z: zN + 0.38, facing: 'S' });
    lanes.push({ plate, mirror: `${p}M${k}`, mx: x, mz: z, r: `${p}R${k}` });
  }
  b.door({ id: p + 'DX', x: 0, z: zN, axis: 'x', width: 2, requires: lanes.map((l) => l.r), latch: true });
  b.light(-4, zS - 3); b.light(4, zS - 3); b.light(-4, zS - 10); b.light(4, zS - 10);
  return { kind: 'laserhold', zS, zN, lanes, p };
}

/** Final room with the team exit pad (all players must stand on it together). */
export function stageExit(b, zS, { final = false, width = 10 } = {}) {
  const zN = zS - 9;
  shell(b, -width / 2, width / 2, zS, zN, { north: 'solid' });
  b.exit({ x: 0, z: zS - 5, w: 4.2, d: 3.2, final });
  b.light(0, zS - 5);
  return { kind: 'exit', zS, zN, pad: { x: 0, z: zS - 5 } };
}

// ---------------------------------------------------------------- levels
const mp = (def) => ({ mp: true, teamExit: true, height: H, ...def });

function boundsOf(minX, minZ, maxX, maxZ) { return [minX - 0.4, minZ - 0.4, maxX + 0.4, maxZ + 0.4]; }

export const MP_LEVELS = [
  mp({
    name: 'Teamwork',
    difficulty: 'Easy',
    blurb: 'One holds the door. Then the door holds itself.',
    bounds: boundsOf(-7, -24, 7, 0),
    start: { x: 0, z: -1.5 },
    build(b, n) {
      const s = stageRelay(b, n, 0, 'a', { first: true });
      stageExit(b, s.zN);
      spread(n, 1.6).forEach((x, i) => b.spawn(i, x, -1.2, 0));
      b.hint('Teamwork: the left door opens only while the plates are held. Someone must go through and stand on the plate on the far side.');
    },
  }),

  mp({
    name: 'Double Vision',
    difficulty: 'Easy',
    blurb: 'Your door is in someone else\'s hands.',
    bounds: boundsOf(-8, -28, 8, 0),
    start: { x: 0, z: -1.5 },
    build(b, n) {
      const s = stageLanes(b, n, 0, 'b', { first: true });
      stageExit(b, s.zN);
      s.lanes.forEach((l, i) => b.spawn(i, l.cx, -1.2, 0));
      b.hint('Each door is opened by the plates in the lane to its left (the leftmost by the rightmost). Cross one at a time and keep the next door open for your teammate.');
    },
  }),

  mp({
    name: 'Weight Distribution',
    difficulty: 'Easy to medium',
    blurb: 'Carry it together. Climb each other.',
    bounds: boundsOf(-7, -27, 7, 0),
    start: { x: 0, z: -1.5 },
    build(b, n) {
      const s = stageLadder(b, n, 0, 'c', { first: true });
      stageExit(b, s.zN);
      spread(n, 1.6).forEach((x, i) => b.spawn(i, x + 2, -1.2, 0));
      b.hint(n === 2
        ? 'Hold the plate so your partner can carry the crate through and climb to the switch.'
        : 'The ledge is too high for one crate. Stand still beside it and let a teammate climb the crate and then your head.');
    },
  }),

  mp({
    name: 'Split Light',
    difficulty: 'Medium',
    blurb: 'Each of you starts in a sealed room. The light passes through all of them.',
    bounds: (n) => [-6.8, -12.6, 8 * (n - 1) + 6.8, 9.4],
    start: { x: 0, z: 0 },
    build(b, n) {
      // Rooms in a row: room i spans x = 8i-4 .. 8i+4, z = -8 .. 3.
      const right = 8 * (n - 1) + 4;
      const slitWall = (x, zSlit) => {
        b.solid(x - 0.2, 0, -8, x + 0.2, H, zSlit - 0.5);
        b.solid(x - 0.2, 0, zSlit + 0.5, x + 0.2, H, 3);
        b.solid(x - 0.2, 0, zSlit - 0.5, x + 0.2, 0.5, zSlit + 0.5);
        b.solid(x - 0.2, 1.0, zSlit - 0.5, x + 0.2, H, zSlit + 0.5);
      };
      for (let i = 0; i <= n; i++) slitWall(8 * i - 4, -3);
      const doorGaps = [];
      for (let i = 0; i < n; i++) doorGaps.push([8 * i - 1, 8 * i + 1]);
      b.wallX(-8, -4, right);
      b.wallX(3, -4, right, { gaps: doorGaps });
      // Return tube for the last room's beam (sealed, mirrors preset).
      b.wallX(-12, -6.4, right + 2.4);
      b.wallZ(-6.4, -12, -2);
      b.wallZ(right + 2.4, -12, -2);
      b.wallX(-2, -6.4, -4.2);
      b.wallX(-2, right + 0.2, right + 2.4);
      b.mirror({ id: 'T1', x: right + 1.2, z: -3, step: 2 });
      b.mirror({ id: 'T2', x: right + 1.2, z: -10.5, step: 14 });
      b.mirror({ id: 'T3', x: -5.2, z: -10.5, step: 10 });
      b.mirror({ id: 'T4', x: -5.2, z: -3, step: 6 });
      // Hall and exit
      b.wallX(9, -4, right);
      b.wallZ(-4, 3, 9);
      b.wallZ(right, 3, 9);
      b.exit({ x: (right - 4) / 2, z: 6.5, w: 4.2, d: 3 });
      const rooms = [];
      for (let i = 0; i < n; i++) {
        const u = 8 * i;
        b.emitter({ id: `L${i}E`, x: u + 3.2, z: -3, dir: 'E', power: [`L${i}P`] });
        b.plate({ id: `L${i}P`, x: u - 2.4, z: 1.4 });
        b.mirror({ id: `L${i}Ma`, x: u - 1.5, z: -3, step: 0 });
        b.mirror({ id: `L${i}Mb`, x: u - 1.5, z: -6.5, step: 0 });
        b.receiver({ id: `L${i}R`, x: u + 3.62, z: -6.5, facing: 'W' });
        b.spawn(i, u + 1.5, 1.2, 0);
        b.light(u, -2.5);
        rooms.push({ u, plate: { x: u - 2.4, z: 1.4 } });
      }
      for (let i = 0; i < n; i++) b.door({ id: `L${i}X`, x: 8 * i, z: 3, axis: 'x', width: 2, requires: rooms.map((_, k) => `L${k}R`), latch: true });
      b.light((right - 4) / 2, 6);
      b.hint('Your room is sealed. A beam enters from the wall slit on the left when your neighbour stands on their plate. Turn your two mirrors to send it to your receiver, then everyone stand on your plates together.');
    },
  }),

  mp({
    name: 'The Clone Crew',
    difficulty: 'Medium to hard',
    blurb: 'Bring your copy. Then bring yourself.',
    bounds: boundsOf(-10, -29, 10, 0),
    start: { x: 0, z: -3 },
    build(b, n) {
      const s = stageBooths(b, n, 0, 'e', { first: true });
      stageExit(b, s.zN);
      s.pods.forEach((pd, i) => b.spawn(i, pd.x, -3.4, 0));
      b.hint('Every booth needs a clone, and the plate beside them needs a person. Make your clone at your pod (F) and stand beyond its booth so it walks in. Clones follow whoever they can see, so you can guide each other\'s copies.');
    },
  }),

  mp({
    name: 'Four Directions',
    difficulty: 'Hard',
    blurb: 'A hub, one wing per player, and one locked core.',
    bounds: [-17.4, -17.4, 17.4, 17.4],
    start: { x: 0, z: 3 },
    build(b, n) {
      const wings = ['N', 'E', 'S', 'W'].slice(0, n);
      const has = (w) => wings.includes(w);
      // Hub
      b.wallX(-5, -5, 5, has('N') ? { gaps: [[-1, 1]] } : {});
      b.wallX(5, -5, 5, has('S') ? { gaps: [[-1, 1]] } : {});
      b.wallZ(5, -5, 5, has('E') ? { gaps: [[-1, 1]] } : {});
      b.wallZ(-5, -5, 5, has('W') ? { gaps: [[-1, 1]] } : {});
      // Core with the team exit
      b.wallX(-1.9, -1.9, 1.9, { gaps: [[-1, 1]] });
      b.wallX(1.9, -1.9, 1.9);
      b.wallZ(-1.9, -1.9, 1.9);
      b.wallZ(1.9, -1.9, 1.9);
      b.exit({ x: 0, z: 0, w: 3.2, d: 3.2 });
      const req = [];
      // North: laser (its emitter is powered from the east wing)
      if (has('N')) {
        b.wallX(-17, -5, 5, { gaps: [[-1, 1]] }); b.wallZ(-5, -17, -5); b.wallZ(5, -17, -5);
        b.emitter({ id: 'NE', x: -4.5, z: -15.5, dir: 'E', power: ['EP'] });
        b.mirror({ id: 'NM1', x: 3, z: -15.5, step: 0 });
        b.mirror({ id: 'NM2', x: 3, z: -9, step: 0 });
        b.receiver({ id: 'NR', x: -4.62, z: -9, facing: 'E' });
        b.door({ id: 'ND', x: 0, z: -17, axis: 'x', width: 2, requires: ['NR'], latch: true });
        b.wallX(-19, -1.2, 1.2); b.wallZ(-1.2, -19, -17); b.wallZ(1.2, -19, -17);
        req.push('ND');
        b.light(-2, -9); b.light(2, -14);
      }
      // East: stacking, and the plate that powers the north laser
      if (has('E')) {
        b.wallZ(17, -5, 5); b.wallX(-5, 5, 17); b.wallX(5, 5, 17);
        b.plate({ id: 'EP', x: 8, z: 3 });
        b.platform(14, -5, 17, 5, 2.0);
        b.button({ id: 'ES', x: 16.75, y: 3.4, z: 0, facing: 'W', mode: 'toggle' });
        b.cube(9, -3, 0, 1, 'EC');
        req.push('ES');
        b.light(9, 0); b.light(15, 0);
      }
      // South: clone booth guarding a switch alcove
      if (has('S')) {
        b.wallX(17, -5, 5); b.wallZ(-5, 5, 17); b.wallZ(5, 5, 17, { gaps: [[5.75, 7.75]] });
        b.pod({ x: 0, z: 15.8, yaw: 0, id: 'Spod' });
        b.barrier(-1.2, 8.6, 1.2, 8.9, 0.9);
        b.barrier(-1.2, 8.9, -0.9, 11.2, 0.9);
        b.barrier(0.9, 8.9, 1.2, 11.2, 0.9);
        b.plate({ id: 'SP', x: 0, z: 10, w: 1.8, d: 1.8 });
        b.door({ id: 'SD', x: 5, z: 6.75, axis: 'z', width: 2, requires: ['SP'] });
        b.wallX(5.4, 5, 8.6); b.wallX(8.1, 5, 8.6); b.wallZ(8.6, 5.4, 8.1);
        b.button({ id: 'SS', x: 8.35, y: 1.4, z: 6.75, facing: 'W', mode: 'toggle' });
        req.push('SS');
        b.light(0, 12); b.light(7, 6.75);
      }
      // West: portable mirror plus a lock to block with a crate
      if (has('W')) {
        b.wallZ(-17, -5, 5); b.wallX(-5, -17, -5, { gaps: [[-12, -10]] }); b.wallX(5, -17, -5);
        b.emitter({ id: 'WE', x: -16.5, z: -3.5, dir: 'E' });
        b.mirror({ id: 'WPM', x: -14, z: 0, step: 0, portable: true });
        b.socket({ x: -9, z: -3.5 }); b.socket({ x: -14, z: 0 }); b.socket({ x: -12, z: 3 });
        b.receiver({ id: 'WR', x: -9, z: 4.62, facing: 'N' });
        b.emitter({ id: 'WLE', x: -16.5, z: 2.5, dir: 'E' });
        b.receiver({ id: 'WRL', x: -5.38, z: 2.5, facing: 'W', lock: true });
        b.cube(-12, -1.2, 0, 1, 'WC');
        b.door({ id: 'WD', x: -11, z: -5, axis: 'x', width: 2, requires: ['WR', '!WRL'], latch: true });
        b.wallX(-7, -12.2, -9.8); b.wallZ(-12.2, -7, -5); b.wallZ(-9.8, -7, -5);
        req.push('WD');
        b.light(-11, 0);
      }
      b.door({ id: 'CORE', x: 0, z: -1.9, axis: 'x', width: 2, requires: req });
      [[-3.2, 3.2], [3.2, 3.2], [3.2, -3.2], [-3.2, -3.2]].slice(0, n).forEach(([x, z], i) => b.spawn(i, x, z, 0));
      b.light(-3, 0); b.light(3, 0);
      b.hint(`Split up: ${wings.map((w) => ({ N: 'north (laser)', E: 'east (crates, and the plate that powers the north laser)', S: 'south (clone)', W: 'west (mirror and lock)' })[w]).join(', ')}. The core opens when every wing is done.`);
    },
  }),

  mp({
    name: 'No Player Left Behind',
    difficulty: 'Very hard',
    blurb: 'Weigh it down, climb each other, light it up.',
    bounds: boundsOf(-8, -56, 8, 0),
    start: { x: 0, z: -1.5 },
    build(b, n) {
      const s1 = stageRelay(b, n, 0, 'g1', { big: true, first: true });
      const s2 = stageLadder(b, n, s1.zN, 'g2');
      const s3 = stageLaserHold(b, n, s2.zN, 'g3');
      stageExit(b, s3.zN);
      spread(n, 1.4).forEach((x, i) => b.spawn(i, x, -1.2, 0));
      b.hint('The big plate needs every player but one standing on it. Then the climb, then the light. Nobody gets left behind.');
    },
  }),

  mp({
    name: 'The Final Collaboration',
    difficulty: 'Extremely hard',
    blurb: 'Everything, everyone, all the way up.',
    bounds: boundsOf(-10, -95, 10, 0),
    start: { x: 0, z: -1.5 },
    build(b, n) {
      const s1 = stageLanes(b, n, 0, 'h1', { first: true });
      const s2 = stageBooths(b, n, s1.zN, 'h2');
      const s3 = stageLadder(b, n, s2.zN, 'h3');
      const s4 = stageLaserHold(b, n, s3.zN, 'h4');
      stageExit(b, s4.zN, { final: true });
      s1.lanes.forEach((l, i) => b.spawn(i, l.cx, -1.2, 0));
      b.hint('The final collaboration: crossed lanes, clone booths, the human ladder and the light. Then the lift, together.');
    },
  }),
];

/** Rebuild-time stage info for the bots (same arguments as the level). */
export function mpStages(level, n) {
  const fake = new Proxy({}, { get: () => () => {} });
  const stub = { ...Object.fromEntries(['wallX', 'wallZ', 'solid', 'platform', 'barrier', 'pillar', 'door', 'plate', 'button', 'pod', 'emitter', 'receiver', 'mirror', 'socket', 'cube', 'slab', 'exit', 'hint', 'hintOn', 'light', 'wire', 'decal', 'target', 'block', 'grip', 'checkpoint', 'spawn'].map((k) => [k, () => {}])) };
  void fake;
  const name = level.name;
  if (name === 'Teamwork') return [stageRelay(stub, n, 0, 'a', { first: true })];
  if (name === 'Double Vision') return [stageLanes(stub, n, 0, 'b', { first: true })];
  if (name === 'Weight Distribution') return [stageLadder(stub, n, 0, 'c', { first: true })];
  if (name === 'The Clone Crew') return [stageBooths(stub, n, 0, 'e', { first: true })];
  if (name === 'No Player Left Behind') {
    const s1 = stageRelay(stub, n, 0, 'g1', { big: true, first: true });
    const s2 = stageLadder(stub, n, s1.zN, 'g2');
    const s3 = stageLaserHold(stub, n, s2.zN, 'g3');
    return [s1, s2, s3, { kind: 'exit', pad: { x: 0, z: s3.zN - 5 } }];
  }
  if (name === 'The Final Collaboration') {
    const s1 = stageLanes(stub, n, 0, 'h1', { first: true });
    const s2 = stageBooths(stub, n, s1.zN, 'h2');
    const s3 = stageLadder(stub, n, s2.zN, 'h3');
    const s4 = stageLaserHold(stub, n, s3.zN, 'h4');
    return [s1, s2, s3, s4, { kind: 'exit', pad: { x: 0, z: s4.zN - 5 } }];
  }
  return [];
}

export const MP_LEVEL_LIST = MP_LEVELS.map((lv, i) => ({ ...lv, id: i + 1, mpIndex: i + 1 }));
