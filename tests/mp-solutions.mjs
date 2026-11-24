// Co-op solutions used by the playthrough test and the network replay test.
// One bot controls each player in turn using only player actions (walk, jump,
// look, interact, grab, create clone). Clones move only by their own AI.
// Run: node tests/mp-playthrough.mjs [level] [players]

import { assert } from './bot.mjs';

const grounded = (b) => b.g.player.body.grounded;
const spread = (count, gap) => Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * gap);

function door(b, id) { return b.g.doors.find((d) => d.id === id); }
function waitDoor(b, id, t = 6) { b.waitUntil(() => door(b, id).t > 0.92, t, `door ${id} open`); }
function through(b, x, z, label) {
  // Walk up to a door at (x,z) from the south, wait for it, and step through.
  b.walkTo(x, z + 1.3, { label });
  b.walkTo(x, z - 1.4, { label });
}
const PARK = [-1.6, 1.6, -2.9, 2.9];
/** Park players one by one on the row zRow at the given x positions (via a clear row zVia). */
function park(b, n, zRow, xs = PARK, zVia = null) {
  for (let i = 0; i < n; i++) {
    b.use(i);
    if (zVia !== null) { b.walkTo(b.p.x, zVia); b.walkTo(xs[i], zVia); }
    b.walkTo(xs[i], zRow);
  }
}
/**
 * Everybody, parked on the row z+2.5, walks through the 2 m opening at x=0 in
 * wall z one at a time, and parks again just beyond it.
 */
function regroup(b, n, z, xs = PARK) {
  for (let i = 0; i < n; i++) {
    b.use(i);
    b.walkTo(b.p.x, z + 1.0);
    b.walkTo(0, z + 1.0);
    b.walkTo(0, z - 1.2);
    b.walkTo(PARK[i], z - 1.2);
    b.walkTo(PARK[i], z - 2.6);
  }
  void xs;
}

// ------------------------------------------------------------------ stages
function solveRelay(b, n, s) {
  const xs = spread(n - 1, 0.9);
  for (let i = 0; i < n - 1; i++) {
    b.use(i);
    const pl = s.big ? s.plates[0] : s.plates[i];
    b.walkTo(s.big ? pl.x + xs[i] : pl.x, pl.z);
  }
  b.use(n - 1);
  b.walkTo(-3, s.zm + 1.3);
  waitDoor(b, s.p + 'DIN');
  b.walkTo(-3, s.zm - 1.4);
  b.walkTo(s.pb.x, s.pb.z);
  waitDoor(b, s.p + 'DBK');
  for (let i = 0; i < n - 1; i++) {
    b.use(i);
    b.walkTo(3, s.zm + 1.3);
    b.walkTo(3, s.zm - 1.4);
    b.walkTo(PARK[i], s.zN + 4.2);
    b.walkTo(PARK[i], s.zN + 2.5);
  }
  b.use(n - 1);
  b.walkTo(PARK[n - 1], s.zN + 4.2);
  b.walkTo(PARK[n - 1], s.zN + 2.5);
  regroup(b, n, s.zN);
}

function solveLanes(b, n, s) {
  for (let i = 0; i < n; i++) { b.use(i); b.walkTo(s.lanes[i].cx, s.lanes[i].a.z); }
  for (let i = 0; i < n; i++) {
    b.use(i);
    const l = s.lanes[i];
    b.walkTo(l.cx, s.zd + 1.3);
    waitDoor(b, `${s.p}D${i}`);
    b.walkTo(l.cx, s.zd - 1.4);
    b.walkTo(l.cx, l.bp.z);
    b.wait(0.3);
  }
  for (let i = 0; i < n; i++) {
    b.use(i);
    b.walkTo(s.lanes[i].cx, s.zHall - 0.8);
    b.walkTo(PARK[i], s.zHall - 0.8);
    b.walkTo(PARK[i], s.zN + 2.5);
  }
  regroup(b, n, s.zN);
}

function solveLadder(b, n, s) {
  const holders = n === 4 ? [0, 1] : [0];
  const builders = [...Array(n).keys()].filter((i) => !holders.includes(i));
  holders.forEach((h, k) => { b.use(h); b.walkTo(s.holders[0].x + (holders.length > 1 ? (k ? 0.7 : -0.7) : 0), s.holders[0].z); });
  const b1 = builders[0], b2 = builders[1];
  if (b2 !== undefined) { b.use(b2); b.walkTo(2.0, s.zS - 4.6); }
  b.use(b1);
  const crate = b.g.blocks.find((k) => k.id === s.crate);
  b.walkTo(b.p.x, s.zS - 1.9);
  b.walkTo(crate.pos.x + 1.3, s.zS - 1.9);
  b.walkTo(crate.pos.x + 1.3, crate.pos.z);
  b.grab(s.crate);
  b.holdAim = null; b.holdDist = 1.4; b.carryY = 1.2;
  b.walkTo(-3, s.zm + 1.6);
  waitDoor(b, s.p + 'DIN');
  b.walkTo(-3, s.zm - 1.4);
  const cx = -4.6, cz = s.ledgeFace + 0.5;
  b.walkTo(cx, cz + 2.4);
  b.carryY = null;
  b.placeHeld({ x: cx, y: 0.15, z: cz }, { tol: 0.03 });
  b.drop();
  if (n === 2) {
    b.walkTo(cx, cz + 1.9);
    b.walkTo(cx, cz, { jumpAt: (bb) => bb.p.z < cz + 1.2 && grounded(bb) });
    b.wait(0.3);
    assert(b.p.y > 0.95, 'builder on the crate');
    b.walkTo(cx, s.ledgeFace - 1.2, { jumpAt: grounded });
  } else {
    // Human ladder: a second builder stands between the crate and the ledge.
    b.use(b2);
    b.walkTo(-3, s.zm + 1.3);
    b.walkTo(-3, s.zm - 1.4);
    b.walkTo(-3.0, s.ledgeFace + 1.2);
    b.walkTo(-3.82, s.ledgeFace + 0.28);
    b.use(b1);
    b.walkTo(cx, cz + 1.9);
    b.walkTo(cx, cz, { jumpAt: (bb) => bb.p.z < cz + 1.2 && grounded(bb) });
    b.wait(0.3);
    assert(b.p.y > 0.95, 'climber on the crate');
    b.walkTo(-3.82, s.ledgeFace + 0.3, { jumpAt: grounded, tol: 0.2 });
    b.wait(0.3);
    assert(b.p.y > 1.65, `climber on a teammate's head (y=${b.p.y.toFixed(2)})`);
    b.walkTo(-3.82, s.ledgeFace - 1.2, { jumpAt: grounded });
  }
  b.wait(0.3);
  assert(b.p.y > s.L - 0.05, `on the ledge (y=${b.p.y.toFixed(2)})`);
  b.walkTo(s.button.x, s.zN + 0.8);
  b.interact(s.button);
  assert(b.input(s.p + 'S'), 'ledge switch on');
  // Everyone heads for the north door.
  waitDoor(b, s.p + 'DBK');
  const LP = [1.6, 2.9, 4.2, 5.5];
  b.walkTo(-0.6, s.zN + 1.0);
  b.wait(0.5);
  b.walkTo(LP[b1], s.zN + 1.0);
  b.walkTo(LP[b1], s.zN + 2.5);
  for (let i = 0; i < n; i++) {
    if (i === b1) continue;
    b.use(i);
    if (b.p.z > s.zm) { b.walkTo(3, s.zm + 1.3); b.walkTo(3, s.zm - 1.4); }
    b.walkTo(LP[i], s.zN + 4.0);
    b.walkTo(LP[i], s.zN + 2.5);
  }
  waitDoor(b, s.p + 'DX');
  regroup(b, n, s.zN);
}

function solveBooths(b, n, s) {
  const lureZ = s.zb - 2.3;
  for (let i = 0; i < n; i++) {
    b.use(i);
    b.walkTo(b.p.x, s.zS - 5.2);
    b.walkTo(s.rowEnd, s.zS - 5.2);
    b.walkTo(s.rowEnd, lureZ);
    b.walkTo(s.booths[i].x, lureZ);
  }
  for (let i = 0; i < n; i++) {
    b.use(i);
    b.g.spawnClone(b.g.pods.find((pd) => pd.id === s.pods[i].id));
    b.waitUntil(() => b.input(s.booths[i].id), 16, `clone ${i} into booth ${i}`);
    b.wait(0.6);
  }
  b.use(n - 1);
  b.walkTo(s.pp.x, s.pp.z);
  for (let i = 0; i < n - 1; i++) {
    b.use(i);
    b.walkTo(-3, s.zm + 1.3);
    waitDoor(b, s.p + 'DIN');
    b.walkTo(-3, s.zm - 1.4);
    if (i === 0) b.walkTo(s.px.x, s.px.z);
    else { b.walkTo(PARK[i], s.zm - 1.4); b.walkTo(PARK[i], s.zN + 2.5); }
  }
  for (let i = 0; i < n; i++) assert(b.input(s.booths[i].id), `booth ${i} still held while the team leaves`);
  b.use(n - 1);
  waitDoor(b, s.p + 'DBK');
  b.walkTo(3, s.zm + 1.3);
  b.walkTo(3, s.zm - 1.4);
  b.walkTo(3, s.zN + 4.2);
  b.walkTo(PARK[n - 1], s.zN + 4.2);
  b.walkTo(PARK[n - 1], s.zN + 2.5);
  b.use(0);
  b.walkTo(PARK[0], s.zN + 4.2);
  b.walkTo(PARK[0], s.zN + 2.5);
  regroup(b, n, s.zN);
}

function solveLaserHold(b, n, s) {
  for (let k = 0; k < n - 1; k++) {
    b.use(k);
    const pl = s.lanes[k].plate;
    b.walkTo(b.p.x, s.zS - 4.0); b.walkTo(pl.x, s.zS - 4.0); b.walkTo(pl.x, pl.z);
  }
  b.use(n - 1);
  for (const l of s.lanes) {
    b.walkTo(l.mx - 1.6, l.mz + 1.1);
    b.rotateMirrorTo(l.mirror, 2);
  }
  b.waitUntil(() => door(b, s.p + 'DX').latched, 3, 'all receivers lit together');
  const WP = [-1.6, -2.9, -4.2, -5.5];
  b.walkTo(b.p.x, s.lanes[s.lanes.length - 1].mz - 1.3);
  b.walkTo(WP[n - 1], s.lanes[s.lanes.length - 1].mz - 1.3);
  b.walkTo(WP[n - 1], s.zN + 2.5);
  for (let k = 0; k < n - 1; k++) { b.use(k); b.walkTo(b.p.x, s.zS - 4.0); b.walkTo(WP[k], s.zS - 4.0); b.walkTo(WP[k], s.zN + 2.5); }
  for (let i = 0; i < n; i++) {
    b.use(i);
    b.walkTo(WP[i], s.zN + 1.0);
    b.walkTo(0, s.zN + 1.0);
    b.walkTo(0, s.zN - 1.2);
    b.walkTo(PARK[i], s.zN - 1.2);
    b.walkTo(PARK[i], s.zN - 2.6);
  }
}

function toExit(b, n, pad) {
  const xs = [-0.7, 0.7, -1.7, 1.7];
  for (let i = 0; i < n; i++) {
    if (b.g.finalSeq) return; // everyone is already inside the lift
    b.use(i);
    try { b.walkTo(pad.x + xs[i], b.p.z); b.walkTo(pad.x + xs[i], pad.z); }
    catch (e) { if (!b.g.finalSeq) throw e; }
  }
}

// ------------------------------------------------------------------ levels
export const SOLVE = {
  Teamwork(b, n, st) { solveRelay(b, n, st[0]); toExit(b, n, { x: 0, z: st[0].zN - 5 }); },
  'Double Vision'(b, n, st) { solveLanes(b, n, st[0]); toExit(b, n, { x: 0, z: st[0].zN - 5 }); },
  'Weight Distribution'(b, n, st) { solveLadder(b, n, st[0]); toExit(b, n, { x: 0, z: st[0].zN - 5 }); },
  'The Clone Crew'(b, n, st) { solveBooths(b, n, st[0]); toExit(b, n, { x: 0, z: st[0].zN - 5 }); },
  'No Player Left Behind'(b, n, st) {
    solveRelay(b, n, st[0]); solveLadder(b, n, st[1]); solveLaserHold(b, n, st[2]); toExit(b, n, st[3].pad);
  },
  'The Final Collaboration'(b, n, st) {
    solveLanes(b, n, st[0]); solveBooths(b, n, st[1]); solveLadder(b, n, st[2]); solveLaserHold(b, n, st[3]); toExit(b, n, st[4].pad);
  },
  'Split Light'(b, n) {
    for (let i = 0; i < n; i++) {
      b.use(i);
      const u = 8 * i;
      b.walkTo(u - 0.2, -4.75);
      b.rotateMirrorTo(`L${i}Ma`, 2);
      b.rotateMirrorTo(`L${i}Mb`, 2);
    }
    for (let i = 0; i < n; i++) { b.use(i); b.walkTo(8 * i - 2.4, 1.4); }
    b.waitUntil(() => b.g.doors.every((d) => d.latched), 3, 'every receiver lit at once');
    const right = 8 * (n - 1) + 4;
    const xs = spread(n, 0.8);
    for (let i = 0; i < n; i++) {
      b.use(i);
      b.walkTo(8 * i, 2.0);
      b.walkTo(8 * i, 4.6);
      b.walkTo((right - 4) / 2 + xs[i], 6.5 + (i % 2 ? 0.5 : -0.5));
    }
  },
  'Four Directions'(b, n) {
    const has = (k) => k < n;
    // East wing: crate to the ledge, switch, then the crate onto the plate that powers the north laser.
    b.use(1);
    b.walkTo(4.0, 0);
    b.walkTo(6.5, 0);
    b.walkTo(10.3, -3);
    b.carry('EC', { x: 13.5, y: 0, z: 0 }, { via: [[11, -1]] });
    b.walkTo(11.6, 0);
    b.walkTo(13.6, 0, { jumpAt: (bb) => bb.p.x > 12.6 && grounded(bb) });
    b.wait(0.3);
    b.walkTo(15.4, 0, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 1.95, 'east player on the ledge');
    b.walkTo(16.2, 0);
    b.interact({ x: 16.75, y: 3.4, z: 0 });
    b.walkTo(12.6, 0.8);
    b.wait(0.5);
    b.walkTo(8, 3);
    assert(b.input('EP'), 'east plate powers the north laser');
    // North: aim the laser
    b.use(0);
    b.walkTo(0, -3.6);
    b.walkTo(0, -6.5);
    b.walkTo(1.8, -14.2);
    b.rotateMirrorTo('NM1', 6);
    b.walkTo(1.8, -10.2);
    b.rotateMirrorTo('NM2', 2);
    b.waitUntil(() => door(b, 'ND').latched, 3, 'north receiver lit');
    if (has(2)) {
      b.use(2);
      b.walkTo(0, 4);
      b.walkTo(0, 7.4);
      b.g.spawnClone(b.g.pods.find((pd) => pd.id === 'Spod'));
      b.waitUntil(() => b.input('SP'), 16, 'clone into the south booth');
      b.wait(0.6);
      waitDoor(b, 'SD');
      b.walkTo(3.8, 6.75);
      b.walkTo(7.4, 6.75);
      b.interact({ x: 8.35, y: 1.4, z: 6.75 });
      assert(b.input('SS'), 'south switch on');
      b.walkTo(3.6, 6.75);
      b.walkTo(0, 6.0);
      b.walkTo(0, 4.0);
      b.walkTo(-3.4, 3.4);
    }
    if (has(3)) {
      b.use(3);
      b.walkTo(-4, 0);
      b.walkTo(-6.5, 0);
      b.walkTo(-12.7, 0);
      b.carry('WPM', { x: -9, y: 0, z: -3.5 }, { via: [[-11, -2]] });
      b.walkTo(-10.4, -2.4);
      b.rotateMirrorTo('WPM', 14);
      b.walkTo(-12, -2.6);
      b.carry('WC', { x: -13, y: 0, z: 2.5 }, { via: [[-13, 0.5]] });
      b.waitUntil(() => door(b, 'WD').latched, 3, 'west receiver lit and lock dark');
      b.walkTo(-6.5, 0);
      b.walkTo(-4.2, 0);
      b.walkTo(-4.2, 1.6);
    }
    // North and east players come back to the hub (the north door is latched now).
    b.use(0);
    b.walkTo(0, -6.5);
    b.walkTo(0, -4.0);
    b.walkTo(-3.4, -3.4);
    b.use(1);
    b.walkTo(6.5, 0);
    b.walkTo(4.0, 0);
    b.walkTo(3.4, -3.4);
    waitDoor(b, 'CORE');
    const xs = [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]];
    for (let i = 0; i < n; i++) {
      b.use(i);
      if (i >= 2) b.walkTo(-3.4, -3.4);
      b.walkTo(0, -3.4);
      b.walkTo(0, -1.0);
      b.walkTo(xs[i][0], xs[i][1]);
    }
  },
};

