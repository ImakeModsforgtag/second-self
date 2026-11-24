// Automated playthrough: solves every chamber with the real simulation.
// Run with:  npm test
// Each solution only uses player actions (walk, jump, look, interact, grab,
// create clone). The clone is moved purely by its own AI.

import { LEVELS } from '../src/levels/levels.js';
import { Bot, assert } from './bot.mjs';

const only = process.argv[2] && !process.argv[2].startsWith('-') ? Number(process.argv[2]) : null;
const verbose = process.argv.includes('-v');

/** Walk to each point, then wait for the clone to catch up (it follows while it can see us). */
function lead(b, points, { speed = 2.4, near = 1.9, timeout = 10 } = {}) {
  for (const [x, z] of points) {
    b.walkTo(x, z, { speed });
    b.waitUntil(() => {
      const c = b.clone();
      return c && Math.hypot(c.pos.x - b.p.x, c.pos.z - b.p.z) < near;
    }, timeout, `clone to catch up at ${x},${z}`);
  }
}


// ---------------- Kickback gun moves (sky chambers)
const ready = (b) => b.g.player.cool === 0 && b.g.player.charges > 0;
/** Gun jump: shoot straight down, then steer with `move` until landed higher up. */
function gunJump(b, move, minY) {
  b.hold({ x: 0, z: 0 }, 0.6, () => ready(b) && b.g.player.body.grounded);
  b.fireDir(b.g.player.yaw, -Math.PI / 2);
  b.hold(move, 0.25);
  b.hold(move, 2.5, () => b.g.player.body.grounded);
  b.wait(0.2);
  assert(b.p.y > minY - 0.01, `gun jump reached y=${b.p.y.toFixed(2)} (wanted ${minY})`);
}
/** Climb a grip wall: walk into it (move), aim down at it (yaw), kick until standing at topY. */
function climbGrip(b, yaw, move, topY) {
  for (let k = 0; k < 60; k++) {
    if (b.g.player.body.grounded && b.p.y > topY - 0.02) break;
    b.hold(move, 0.8, () => b.g.player.cool === 0 && (b.g.touchingGrip() || b.g.player.body.grounded) && b.g.player.body.vy < 3);
    if (b.g.player.body.grounded && b.p.y > topY - 0.02) break;
    try { b.fireDir(yaw, -1.3); } catch (e) { /* no charge yet */ }
    b.hold(move, 0.05);
  }
  b.hold(move, 0.4);
  assert(b.p.y > topY - 0.02 && b.g.player.body.grounded, `climbed to y=${b.p.y.toFixed(2)} (wanted ${topY})`);
}
/** Wall bounce: facing a wall (yaw), jump and shoot it at chest height, steer with move. */
function bounce(b, yaw, move) {
  b.g.player.yaw = yaw;
  b.tick({ x: 0, z: 0 }, true);
  b.fireDir(yaw, -0.1);
  b.hold(move, 0.2);
  b.hold(move, 3, () => b.g.player.body.grounded);
  b.wait(0.2);
}
/** Fire at a point `n` times (waits for the cooldown between shots). */
function shootAt(b, pt, n = 1) {
  for (let i = 0; i < n; i++) { b.hold({ x: 0, z: 0 }, 1, () => ready(b)); b.fire(pt); }
  b.wait(0.2);
}

const SOLUTIONS = {
  'The First Copy'(b) {
    b.path([[-3, -4.6], [0, -4.6]]);
    b.g.spawnClone();                       // press F
    b.waitUntil(() => b.input('P1'), 14, 'clone on plate P1');
    b.wait(2.5);
    assert(b.input('P1'), 'clone stays on the plate');
    assert(['blocked', 'waiting', 'frozen', 'turning'].includes(b.clone().state), 'clone has stopped (state ' + b.clone().state + ')');
    b.path([[3, -5.2], [3, -7.6]]);
    assert(b.door('D1').t > 0.9, 'D1 open');
    b.walkTo(3, -9.2);
  },

  'Out of Sight'(b) {
    // Stage 1: lead the clone around two corners to the low wall.
    b.walkTo(-4, 3.2);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone reaches player');
    lead(b, [[-1.5, 6], [1.2, 6], [2.6, 4.5], [2.6, 2.2], [2.6, 0.3]]);
    b.walkTo(2.6, -3.3, { speed: 3.4, jumpAt: (bb) => bb.p.z < -1.25 && bb.g.player.body.grounded });
    assert(b.p.z < -2.3, 'hopped the low wall');
    b.waitUntil(() => b.input('P1'), 8, 'clone on P1');
    b.wait(2.0);
    assert(b.input('P1'), 'clone held at the wall');
    b.path([[6, -4], [8, -6.5]]);
    b.waitUntil(() => b.door('D1').t > 0.8, 4, 'D1 open');
    b.path([[8, -9.6], [6, -10.5]]);
    // Stage 2: a new clone from the second pod (the first one is recalled).
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone 2 reaches player');
    lead(b, [[8, -12.6]]);
    b.walkTo(8, -16.0, { speed: 2.0 });
    b.waitUntil(() => b.input('P2') && b.clone().state === 'waiting', 8, 'clone on P2');
    b.path([[8, -16.75], [6.6, -16.95]], { speed: 3.4 });
    b.wait(1.5);
    assert(b.input('P2'), 'clone frozen on P2 behind the wall');
    b.walkTo(3, -19);
    b.waitUntil(() => b.door('D2').latched, 3, 'D2 latched');
    b.path([[6, -19], [13, -19.5], [13, -23.5], [13, -24.5]]);
  },

  'Weight and Height'(b) {
    const grounded = (bb) => bb.g.player.body.grounded;
    b.walkTo(-1.8, -1);
    b.carry('B1', { x: 3, y: 0, z: -3 });
    assert(b.input('P1'), 'crate on plate');
    b.path([[0, -4.5], [0, -7.5]]);
    // Crate against the west ledge, climb, press the switch.
    b.walkTo(-0.2, -9);
    b.carry('C2', { x: -3.5, y: 0, z: -16.5 }, { via: [[-0.5, -13], [-1.5, -16.5]] });
    b.walkTo(-1.6, -16.5);
    b.walkTo(-3.4, -16.5, { jumpAt: (bb) => bb.p.x < -2.35 && grounded(bb) });
    b.wait(0.3);
    assert(b.p.y > 0.95, 'standing on crate');
    b.walkTo(-5, -16.5, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 1.95, 'on the west ledge');
    b.walkTo(-6, -21.2);
    b.interact({ x: -6, y: 3.4, z: -21.75 });
    assert(b.door('D2').latched, 'D2 latched by elevated switch');
    b.path([[-4.6, -18.5], [-2.5, -18.5]]);
    b.wait(0.5);
    // Staircase: long block against the high ledge, cube on top of its far end.
    b.walkTo(-0.9, -11.5);
    b.carry('LB', { x: 3, y: 0, z: -14.8 }, { via: [[-0.5, -14.8]] });
    b.path([[-2.0, -16.0]]);
    b.carry('C2', { x: 3.5, y: 1.0, z: -14.8 }, { via: [[1.0, -13.0], [3.3, -12.6]], standOff: 1.7 });
    const c2 = b.g.blocks.find((k) => k.id === 'C2');
    assert(Math.abs(c2.pos.y - 1) < 0.02, 'cube stacked on the long block (y=' + c2.pos.y.toFixed(2) + ')');
    b.path([[1.0, -13.2], [1.1, -14.8]]);
    b.walkTo(2.5, -14.8, { jumpAt: (bb) => bb.p.x > 1.45 && grounded(bb) });
    b.wait(0.3);
    b.walkTo(3.5, -14.8, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 1.95, 'on the cube (y=' + b.p.y.toFixed(2) + ')');
    b.walkTo(5.2, -14.8, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 2.95, 'on the high ledge');
    b.walkTo(6, -16.2);
    b.walkTo(6, -19.5, { jumpAt: (bb) => bb.p.z < -16.5 && grounded(bb) });
    assert(b.p.y > 2.95, 'cleared the gap');
    b.path([[6, -22.6], [6, -23.6]]);
  },

  'Refraction'(b) {
    b.walkTo(0.6, -1.0);
    b.rotateMirrorTo('M1', 2);
    b.walkTo(2.0, -6.6);
    b.rotateMirrorTo('M2', 14);
    b.walkTo(-2.6, -7.4);
    assert(!b.input('R1'), 'receiver still dark before the last mirror');
    b.rotateMirrorTo('M3', 6);
    b.wait(0.2);
    assert(b.input('R1'), 'beam reaches receiver R1');
    b.path([[3.5, -9.8], [4.5, -10.6]]);
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'D1 open');
    b.path([[4.5, -13], [4.5, -14.5]]);
  },

  'The Split Path'(b) {
    // East emitter: around the dividing wall with three fixed mirrors.
    b.path([[1.2, -3], [1.2, -8.8]]);
    b.rotateMirrorTo('M2', 2);
    b.walkTo(1.2, -6.5);
    b.rotateMirrorTo('M3', 2);
    b.path([[-3, -6.9], [-4.8, -6.9]]);
    b.rotateMirrorTo('M4', 14);
    b.wait(0.2);
    assert(b.input('R1'), 'R1 lit');
    // West emitter: carry the portable mirror to the right socket.
    b.path([[-3, -2.5], [-2.6, 1]]);
    b.carry('PM1', { x: 6, y: 0, z: -4 }, { via: [[0, -1.5], [3.8, -2.6]] });
    const pm = b.g.mirrors.find((m) => m.id === 'PM1');
    assert(Math.abs(pm.body.pos.x - 6) < 0.01 && Math.abs(pm.body.pos.z + 4) < 0.01, 'mirror snapped into socket');
    b.walkTo(4.6, -3.0);
    b.rotateMirrorTo('PM1', 2);
    b.wait(0.2);
    assert(b.input('R2'), 'R2 lit');
    assert(b.input('RL'), 'lock still lit');
    // Block the lock beam with the crate.
    b.path([[1, -1], [-4.2, 1.6]]);
    b.carry('C1', { x: 3, y: 0, z: -1 }, { via: [[0, 0.5]] });
    b.wait(0.3);
    assert(!b.input('RL'), 'lock beam blocked');
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'D1 open');
    b.path([[1.2, -3], [1.2, -12.6], [0, -13.4], [0, -16.5]]);
  },

  'Two of You'(b) {
    const grounded = (bb) => bb.g.player.body.grounded;
    // Chamber A: clone on the plate behind the partition powers the emitter.
    b.walkTo(-2.5, 1.5);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone reaches player');
    lead(b, [[-1, 0.3]]);
    b.walkTo(-1, -3.0, { speed: 2.0 });
    b.waitUntil(() => b.input('P1') && b.clone().state === 'waiting', 8, 'clone on P1');
    b.path([[0.4, -3.7], [1.6, -4.2]], { speed: 3.4 });
    b.wait(1.2);
    assert(b.input('P1'), 'clone frozen on P1');
    b.walkTo(2.3, -5.2);
    b.rotateMirrorTo('M1', 2);
    b.walkTo(2.3, -7.5);
    b.rotateMirrorTo('M2', 14);
    b.wait(0.2);
    assert(b.input('R1'), 'R1 lit while the clone holds the plate');
    assert(b.door('D1').latched, 'D1 latched');
    b.path([[6, -9], [6, -11.2]]);
    // Chamber B: build a detour, then park the clone in the shallow booth.
    b.walkTo(-4, -16.2);
    assert(b.input('R2'), 'R2 lit by the direct beam at first');
    b.rotateMirrorTo('M3', 2);
    b.path([[-5.2, -17.6], [-4, -19.8]]);
    b.rotateMirrorTo('M4', 2);
    b.walkTo(4, -19.8);
    b.rotateMirrorTo('M5', 14);
    b.path([[5.3, -18.6], [5.3, -17.55]]);
    b.rotateMirrorTo('M6', 6);
    b.wait(0.2);
    assert(b.input('R2'), 'R2 lit through the detour');
    b.path([[5.3, -15], [0, -14.4]]);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 12, 'clone 2 reaches player');
    lead(b, [[0, -15.6]]);
    b.walkTo(0, -19.4, { speed: 3.0, jumpAt: (bb) => bb.p.z < -17.45 && grounded(bb) });
    b.waitUntil(() => b.input('P2'), 8, 'clone on P2');
    b.wait(1.5);
    assert(b.input('P2') && b.input('R2'), 'plate held and beam still lit');
    b.path([[2.5, -19.6], [6, -20.8]]);
    b.waitUntil(() => b.door('D2').t > 0.9, 4, 'D2 open');
    b.path([[6, -23], [6, -26.5]]);
  },

  'Build Your Way Out'(b) {
    const grounded = (bb) => bb.g.player.body.grounded;
    // ---- Chamber A
    b.walkTo(5.4, 0.6);
    b.carry('C1', { x: 2, y: 0, z: -8.0 }, { via: [[3.5, -4]] });
    b.path([[0, -4.5], [-3, 2.2]]);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone reaches player');
    lead(b, [[-3, 0.6]], { speed: 1.6 });
    b.walkTo(-3, -4.6, { speed: 3.0, jumpAt: (bb) => bb.p.z < -2.6 && grounded(bb) });
    b.waitUntil(() => b.input('P1'), 8, 'clone in booth on P1');
    b.wait(1.5);
    assert(b.input('P1'), 'clone held by the booth');
    // Climb to the ledge with the crate, turn the ledge mirror.
    b.walkTo(2, -6.3);
    b.walkTo(2, -8.0, { jumpAt: (bb) => bb.p.z < -6.6 && grounded(bb) });
    b.wait(0.3);
    b.walkTo(2, -9.6, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 1.95, 'on the ledge');
    b.walkTo(-2.8, -9.6);
    b.rotateMirrorTo('M1', 14);
    // Down to the floor, turn the pillar mirrors.
    b.walkTo(-4, -7.6);
    b.wait(0.6);
    b.walkTo(-4, -6.75);
    b.rotateMirrorTo('M2', 6);
    b.walkTo(6, -6.75);
    b.rotateMirrorTo('M3', 2);
    b.wait(0.2);
    assert(b.input('R1'), 'R1 lit');
    assert(b.input('P1'), 'clone still on P1');
    b.walkTo(2, -6.3);
    b.walkTo(2, -8.0, { jumpAt: (bb) => bb.p.z < -6.6 && grounded(bb) });
    b.wait(0.3);
    b.walkTo(2, -9.6, { jumpAt: grounded });
    b.wait(0.3);
    b.path([[8, -10.6], [8, -13], [8, -14.9]]);
    // ---- Chamber B
    b.walkTo(4, -15.0);
    b.rotateMirrorTo('M4', 6);
    b.path([[7.3, -17.5], [7.3, -19.5]]);
    b.carry('PM2', { x: 4, y: 2, z: -21 }, { via: [[7.0, -21]] });
    b.walkTo(5.6, -20.4);
    b.rotateMirrorTo('PM2', 14);
    b.wait(0.2);
    assert(b.input('R2'), 'R2 lit via the portable mirror');
    b.path([[2, -18.5], [-1.8, -19]]);
    b.carry('C2', { x: -6, y: 2, z: -22.1 }, { via: [[-4, -20.4]] });
    b.wait(0.3);
    assert(!b.input('RL'), 'lock beam blocked by crate');
    b.path([[-2, -20], [4, -19.6], [8.6, -21]]);
    b.walkTo(8.6, -22.6);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone 2 reaches player');
    lead(b, [[8.6, -25.0]], { speed: 1.6 });
    b.walkTo(6, -24.5, { speed: 2.0 });
    b.walkTo(3.6, -24.5, { speed: 3.0, jumpAt: (bb) => bb.p.x < 5.55 && grounded(bb) });
    b.waitUntil(() => b.input('P2'), 8, 'clone on P2');
    b.wait(1.5);
    assert(b.input('P2'), 'clone held in booth');
    b.path([[2, -20.6], [-6, -20.6]]);
    b.walkTo(-6, -22.0, { jumpAt: (bb) => bb.p.z < -20.95 && grounded(bb) });
    b.wait(0.3);
    assert(b.p.y > 2.95, 'on the crate');
    b.walkTo(-6, -24.2, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 3.95, 'on the landing');
    b.waitUntil(() => b.door('D2').t > 0.9, 4, 'D2 open');
    b.path([[-7, -25.2], [-7, -28.5]]);
  },

  'The Final Experiment'(b) {
    const grounded = (bb) => bb.g.player.body.grounded;
    const climb = (x0, z0, x1, z1, jumpWhen) => { b.walkTo(x0, z0); b.walkTo(x1, z1, { jumpAt: (bb) => jumpWhen(bb) && grounded(bb) }); b.wait(0.3); };

    // ======== Chamber 1: crate onto the shelf, clone through the doorway
    b.path([[3, -3], [3, -7.2], [-4.7, -9]]);
    b.carry('C1', { x: 7.2, y: 2, z: -11 }, { via: [[3, -9], [5.0, -11]] });
    assert(b.input('P2'), 'crate on the shelf plate');
    b.path([[3, -7.2], [3, -3], [-6, 2.0]]);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone reaches player');
    lead(b, [[-1, 1.0], [3, -1.5]]);
    b.walkTo(3, -6.0, { speed: 2.0 });
    b.waitUntil(() => b.input('P1') && b.clone().state === 'waiting', 8, 'clone on P1');
    b.path([[3, -6.75], [1.6, -6.95]], { speed: 3.4 });
    b.wait(1.2);
    assert(b.input('P1'), 'clone frozen on P1');
    b.path([[-2, -8], [-8, -12.6]]);
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'D1 open');
    b.path([[-8, -15.2]]);

    // ======== Chamber 2: two beams, a lock, a ledge
    b.walkTo(4, -15.6);
    b.rotateMirrorTo('Ma', 2);
    b.path([[-2, -16.4], [-4.7, -18.5]]);
    b.carry('PM1', { x: 4, y: 0, z: -21 }, { via: [[0, -19.6]] });
    b.walkTo(2.6, -22.2);
    b.rotateMirrorTo('PM1', 2);
    b.path([[6, -19.8], [9, -19.8]]);
    b.rotateMirrorTo('Mc', 2);
    b.wait(0.2);
    assert(b.input('R1'), 'R1 lit');
    b.path([[7.3, -16]]);
    b.carry('C2', { x: -7.5, y: 0, z: -24 }, { via: [[2, -18.5], [-4, -22.5]] });
    climb(-5.6, -24, -7.4, -24, (bb) => bb.p.x < -6.6);
    b.walkTo(-9.2, -24, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 1.95, 'on the west ledge');
    b.walkTo(-9, -26.7);
    b.rotateMirrorTo('Md', 2);
    b.wait(0.2);
    assert(b.input('R2'), 'R2 lit');
    b.path([[-9.5, -26.6], [-6.4, -26.6]]);
    b.wait(0.5);
    b.walkTo(-6.2, -24);
    b.carry('C2', { x: 0, y: 0, z: -24 }, { via: [[-3, -24]] });
    b.wait(0.3);
    assert(!b.input('RL'), 'lock blocked');
    b.waitUntil(() => b.door('D2').latched, 3, 'D2 latched');
    b.path([[-4, -28.6], [-4, -31.6]]);

    // ======== Chamber 3: staircase, booth, clone-powered beam
    b.walkTo(-2, -38.6);
    b.carry('S3', { x: 0, y: 0, z: -43.5 }, { via: [[0, -40.8]] });
    b.path([[3, -40], [5, -39.6]]);
    b.carry('C3', { x: 0.5, y: 1.0, z: -43.5 }, { via: [[2.5, -41.5], [0.6, -41.4]], standOff: 1.6 });
    const c3 = b.g.blocks.find((k) => k.id === 'C3');
    assert(Math.abs(c3.pos.y - 1) < 0.02, 'cube stacked on slab');
    b.path([[-4, -38], [-8, -35.8]]);
    b.g.spawnClone();
    b.waitUntil(() => b.input('P3'), 12, 'clone walks into the booth');
    b.wait(1.0);
    assert(b.input('P3'), 'clone held in booth');
    b.path([[-4, -38], [-0.5, -41.8]]);
    b.walkTo(-0.5, -43.4, { jumpAt: (bb) => bb.p.z < -42.55 && grounded(bb) });
    b.wait(0.3);
    assert(b.p.y > 0.95, 'on the slab');
    b.walkTo(0.5, -43.5, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 1.95, 'on the cube');
    b.walkTo(0.5, -45.2, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 2.95, 'on the tower ledge');
    b.walkTo(6, -44.8);
    b.rotateMirrorTo('Me', 14);
    b.wait(0.2);
    assert(b.input('R3'), 'R3 lit');
    b.waitUntil(() => b.door('D3').t > 0.9, 4, 'D3 open');
    b.path([[9, -46.2], [9, -49], [9, -53.8], [9, -55.4]]);
    assert(b.p.y < 0.05, 'down the stairs');

    // ======== Chamber 4: everything at once
    b.path([[6, -58], [1.5, -61], [-1.2, -61], [-4.8, -57]]);
    b.carry('PM2', { x: -4, y: 2, z: -67 }, { via: [[-5.5, -63], [-4, -64.5]] });
    const pm2 = b.g.mirrors.find((m) => m.id === 'PM2');
    assert(Math.abs(pm2.body.pos.y - 2) < 0.02, 'mirror on the plinth socket');
    b.walkTo(-4, -65.6);
    b.rotateMirrorTo('PM2', 14);
    b.wait(0.2);
    assert(b.input('R4'), 'R4 lit');
    b.path([[-5, -62.7]]);
    b.carry('C4', { x: -6, y: 0, z: -60 }, { via: [[-6, -61.6]] });
    b.wait(0.2);
    assert(!b.input('RL2'), 'lock 2 blocked');
    b.path([[-4.5, -61], [-1.7, -58]]);
    b.carry('C5', { x: -10.8, y: 0, z: -58 }, { via: [[-7, -57.4]] });
    climb(-8.9, -58, -10.7, -58, (bb) => bb.p.x < -9.65);
    assert(b.p.y > 0.95, 'on the crate');
    b.interact({ x: -11.75, y: 3.3, z: -58 });
    assert(b.input('B4'), 'switch on');
    b.path([[-8.8, -58], [-1.0, -61.0], [0, -61]]);
    b.g.spawnClone();
    b.waitUntil(() => b.input('P4') && b.clone().state === 'waiting', 12, 'clone on P4');
    b.path([[-0.6, -61.2], [-1.0, -62.6]], { speed: 3.4 });
    b.wait(1.5);
    assert(b.input('P4'), 'clone frozen on P4');
    b.path([[-1.4, -64], [-2, -66.8]]);
    b.waitUntil(() => b.door('D4').t > 0.9, 4, 'D4 open');
    b.path([[-2, -69], [-2, -70.2]]);
    b.waitUntil(() => b.g.finalSeq, 2, 'final lift starts');
  },
  'Countdown'(b) {
    const grounded = (bb) => bb.g.player.body.grounded;
    b.walkTo(-4, -2.8);
    b.rotateMirrorTo('M1', 14);
    b.walkTo(-2.8, -10.2);
    b.rotateMirrorTo('M2', 2);
    b.wait(0.2);
    assert(b.input('R1'), 'R1 lit');
    b.path([[0, -1], [1.7, 0]]);
    b.carry('C1', { x: -7.0, y: 0, z: -2 }, { via: [[-3, -1]] });
    b.walkTo(-5.2, -2);
    b.walkTo(-7.0, -2, { jumpAt: (bb) => bb.p.x < -6.15 && grounded(bb) });
    b.wait(0.3);
    assert(b.p.y > 0.95, 'on the crate');
    const t0 = b.g.time;
    b.interact({ x: -7.75, y: 3.4, z: -2 });
    assert(b.input('B1'), 'timed switch on');
    b.path([[-5.4, -2], [-2, -2], [3, -5], [5, -14.6], [5, -16.6]], { speed: 3.4 });
    b.walkTo(5, -18.5);
    b.note(`reached the exit ${(b.g.time - t0).toFixed(1)} s after pressing the switch`);
    assert(b.g.time - t0 < 12, 'made it before the switch timed out');
  },

  'Stand-In'(b) {
    b.walkTo(-4.2, -1);
    b.carry('C1', { x: -4, y: 0, z: -12 }, { via: [[-3.5, -5]] });
    assert(b.input('P1'), 'crate on plate');
    b.path([[-3, -6], [-2.7, 1]]);
    b.carry('PM1', { x: 5, y: 0, z: -10 }, { via: [[2, -3], [5, -6.5]] });
    b.walkTo(5, -8.6);
    b.rotateMirrorTo('PM1', 14);
    b.wait(0.2);
    assert(b.input('R1'), 'R1 lit');
    assert(b.input('RL'), 'lock still lit');
    b.path([[3, -4.5], [2, -7.8], [0, -7.8]]);
    b.g.spawnClone();
    b.waitUntil(() => !b.input('RL'), 14, 'clone walks into the booth and blocks the lock beam');
    b.wait(1.0);
    assert(!b.input('RL'), 'lock stays dark');
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'D1 open');
    b.path([[0, -13], [0, -16.5]]);
  },

  'Elevation'(b) {
    const grounded = (bb) => bb.g.player.body.grounded;
    b.walkTo(0.7, 0);
    b.carry('C1', { x: 4, y: 0, z: -8 }, { via: [[3, -4]] });
    b.path([[1, -3], [-0.7, 0]]);
    b.carry('C2', { x: 4, y: 1, z: -8 }, { via: [[2, -4.5]] });
    const c2 = b.g.blocks.find((k) => k.id === 'C2');
    assert(Math.abs(c2.pos.y - 1) < 0.02, 'crates stacked');
    b.path([[1, -4], [-1.3, -2]]);
    b.carry('PM1', { x: 4, y: 2, z: -8 }, { via: [[3, -5]] });
    const pm = b.g.mirrors[0];
    assert(Math.abs(pm.body.pos.y - 2) < 0.02, 'mirror on top of the tower');
    b.walkTo(4, -6.6);
    b.rotateMirrorTo('PM1', 2);
    b.wait(0.2);
    assert(b.input('R1'), 'R1 lit by the raised mirror');
    b.path([[6.5, -5], [6.5, -1.6], [5, -1.6]]);
    b.carry('S1', { x: -4, y: 0, z: -12.5 }, { via: [[0, -5], [-4, -9]] });
    b.walkTo(-4.5, -10.9);
    b.walkTo(-4.5, -12.5, { jumpAt: (bb) => bb.p.z < -11.5 && grounded(bb) });
    b.wait(0.3);
    b.walkTo(-4.5, -14.2, { jumpAt: grounded });
    b.wait(0.3);
    assert(b.p.y > 1.95, 'on the north ledge');
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'D1 open');
    b.path([[-4, -15.6], [-4, -18.5]]);
  },

  'Mirror Image'(b) {
    b.path([[0, -3], [0, -7.5], [2, -10.4]]);
    b.carry('C1', { x: 7.2, y: 2, z: -16.5 }, { via: [[4, -14], [5.4, -16.5]], standOff: 1.8 });
    assert(b.input('P2'), 'crate on the shelf plate');
    b.path([[4.3, -11], [4.3, -8]]);
    b.carry('PM1', { x: -3, y: 0, z: -13 }, { via: [[0, -10]] });
    const pm = b.g.mirrors.find((m) => m.id === 'PM1');
    assert(Math.abs(pm.body.pos.x + 3) < 0.01, 'mirror in the socket on the lock beam');
    b.walkTo(-1.8, -12.2);
    b.rotateMirrorTo('PM1', 0);
    b.wait(0.2);
    assert(!b.input('RL'), 'mirror turns the lock beam away');
    b.walkTo(-4.8, -10.8);
    b.rotateMirrorTo('M1', 14);
    b.path([[0, -8], [0, -3], [-6, 2.0]]);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone reaches player');
    lead(b, [[-1, 1.0], [0, -1.5]]);
    b.walkTo(0, -6.0, { speed: 2.0 });
    b.waitUntil(() => b.input('P1') && b.clone().state === 'waiting', 8, 'clone on P1');
    b.path([[0, -6.75], [-1.4, -6.95]], { speed: 3.4 });
    b.wait(1.2);
    assert(b.input('P1'), 'clone frozen on P1');
    assert(b.input('R1'), 'R1 lit while the clone powers the emitter');
    b.path([[-4.5, -11.5], [-8.5, -16.6]]);
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'D1 open');
    b.path([[-8.5, -18.6], [-8.5, -20.2]]);
  },

  'Kickback'(b) {
    const N = { x: 0, z: -3.4 };
    b.walkTo(0, -2.68);
    gunJump(b, N, 2.0);
    b.walkTo(0, -8.5);
    b.walkTo(0, -12, { jumpAt: (bb) => bb.p.z < -8.55 && bb.g.player.body.grounded });
    b.wait(0.3);
    assert(b.p.y > 1.95, 'across the gap');
    shootAt(b, { x: 6.5, y: 4.5, z: -12 });
    assert(b.input('T1'), 'bullseye hit');
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'gate open');
    b.path([[0, -16], [0, -19.68]]);
    gunJump(b, N, 4.0);
    b.walkTo(0, -23);
  },

  'Wall Climber'(b) {
    const N = { x: 0, z: -3 };
    b.walkTo(0, -1.72);
    climbGrip(b, 0, N, 8);
    b.walkTo(0, -7.6);
    b.walkTo(0, -12.5, { jumpAt: (bb) => bb.p.z < -7.55 && bb.g.player.body.grounded });
    b.wait(0.4);
    assert(b.p.y > 5.95, 'landed on the middle platform');
    b.path([[1.8, -14], [1.8, -16.72]]);
    climbGrip(b, 0, N, 10);
    b.walkTo(0, -21);
  },

  'Rebound'(b) {
    b.walkTo(0, 1.72);
    bounce(b, Math.PI, { x: 0, z: -3.4 });
    assert(b.p.z < -4 && b.p.y > -0.1, `bounced onto the second platform (z=${b.p.z.toFixed(2)})`);
    b.walkTo(-2.22, -6.5);
    bounce(b, Math.PI / 2, { x: 3.4, z: 0 });
    assert(b.p.x > 3.5 && b.p.y > -0.1, `bounced onto the third platform (x=${b.p.x.toFixed(2)})`);
    b.walkTo(5.5, -8.72);
    gunJump(b, { x: 0, z: -3.4 }, 2.0);
    b.walkTo(5.5, -12.5);
  },

  'Trick Shots'(b) {
    b.walkTo(-5, -4);
    shootAt(b, { x: -5.5, y: 0.75, z: -12 }, 2);
    b.walkTo(5, -4);
    shootAt(b, { x: 5.5, y: 0.75, z: -12 }, 2);
    assert(b.input('R1'), 'beam reaches the receiver via the floating mirrors');
    b.walkTo(0, 4.5);
    shootAt(b, { x: 0, y: 6, z: -21.95 });
    assert(b.input('T1'), 'far bullseye hit over the gate');
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'gate open');
    b.path([[0, -10], [0, -19.5]]);
  },

  'Updraft'(b) {
    b.walkTo(2, 2.3);
    b.carry('C1', { x: 0, y: 0, z: -3.5 }, { via: [[1, -0.5]] });
    b.path([[-0.5, 0], [-2, 2.3]]);
    b.grab('C2');
    b.holdAim = null; b.holdDist = 1.2; b.carryY = 1.4;
    b.walkTo(0, -1.5);
    b.walkTo(0, -3.4, { jumpAt: (bb) => bb.p.z < -1.8 && bb.g.player.body.grounded });
    b.wait(0.3);
    assert(b.p.y > 0.95 && b.g.held, 'standing on the crate, still holding the other');
    b.carryY = 4.6;
    b.hold({ x: 0, z: 0 }, 0.6, () => ready(b));
    b.fireDir(0, -Math.PI / 2);
    b.hold({ x: 0, z: -3.4 }, 0.25);
    b.hold({ x: 0, z: -3.4 }, 2.5, () => b.g.player.body.grounded);
    b.wait(0.2);
    assert(b.p.y > 3.15, `up on the high ledge with the crate (y=${b.p.y.toFixed(2)})`);
    b.carryY = null;
    b.walkTo(2, -7.2);
    b.placeHeld({ x: 2, y: 3.35, z: -9 }, { tol: 0.03 });
    b.drop();
    assert(b.input('P1'), 'crate carried up onto the plate');
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'gate open');
    b.path([[0, -11], [0, -20]]);
  },

  'Sky Copy'(b) {
    b.path([[0, -2]]);
    b.wait(0.2);
    b.path([[2.5, 0]]);
    b.walkTo(0, -1.5);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone reaches player');
    lead(b, [[0, -5], [0, -9]], { speed: 1.8 });
    b.walkTo(0, -13.8, { speed: 3.0, jumpAt: (bb) => bb.p.z < -12.6 && bb.g.player.body.grounded });
    b.waitUntil(() => b.input('P1'), 10, 'clone in the booth');
    b.wait(1);
    b.path([[2.5, -14.1], [3.58, -12]]);
    climbGrip(b, -Math.PI / 2, { x: 3, z: 0 }, 8);
    shootAt(b, { x: 13.9, y: 9.5, z: -12 });
    assert(b.input('T1'), 'hidden bullseye hit from the tower');
    b.walkTo(2.5, -12);
    b.wait(1.2);
    assert(b.input('P1'), 'clone still in the booth');
    b.path([[2.5, -14.1], [0, -14.1]]);
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'gate open');
    b.path([[0, -18], [0, -22]]);
  },

  'Crosswind'(b) {
    b.walkTo(0, 1.72);
    bounce(b, Math.PI, { x: 0, z: -3.4 });
    assert(b.p.z < -4.4 && b.p.y > -0.1, `bounced onto the long platform (z=${b.p.z.toFixed(2)})`);
    b.walkTo(1.5, -6.5);
    shootAt(b, { x: -6, y: 0.75, z: -5 }, 2);
    b.walkTo(1.5, -10);
    shootAt(b, { x: -6, y: 0.75, z: -13 }, 2);
    assert(b.input('R1'), 'main beam home');
    b.walkTo(-1, -6.5);
    shootAt(b, { x: 5, y: 0.75, z: -9.5 }, 1);
    assert(!b.input('RL'), 'lock beam turned aside');
    b.walkTo(0, -13.78);
    climbGrip(b, 0, { x: 0, z: -3 }, 7);
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'gate open');
    b.path([[0, -16], [0, -19.5]]);
  },

  'The Summit'(b) {
    // Crates over to B first
    b.walkTo(3, 1.3);
    b.carry('C1', { x: -3, y: 0, z: -16.1 }, { via: [[0, -3], [0, -11], [-3, -13]] });
    b.path([[-1.5, -13], [0, -11], [0, -3], [-3, 0.3]]);
    b.carry('C2', { x: -4.6, y: 0, z: -13.2 }, { via: [[0, -3], [0, -11], [-2.5, -12.5]] });
    // Floating mirror near B
    b.path([[2, -12.8], [4, -14]]);
    shootAt(b, { x: 9.5, y: 0.75, z: -12.6 }, 2);
    // Clone into the booth
    b.path([[2, -12.8], [0, -11], [0, -4], [0, -1.5]]);
    b.g.spawnClone();
    b.waitUntil(() => b.clone().state === 'waiting', 10, 'clone reaches player');
    lead(b, [[0, -5], [0, -9], [0, -12.4]], { speed: 1.8 });
    b.walkTo(0, -16.3, { speed: 3.0, jumpAt: (bb) => bb.p.z < -15.1 && bb.g.player.body.grounded });
    b.waitUntil(() => b.input('P1'), 10, 'clone in the booth');
    b.wait(1);
    // Updraft with the second crate
    b.path([[-2, -16.2], [-4.6, -14.5]]);
    b.grab('C2');
    b.holdAim = null; b.holdDist = 1.2; b.carryY = 1.4;
    b.walkTo(-3, -14.6);
    b.walkTo(-3, -16.0, { jumpAt: (bb) => bb.p.z < -14.9 && bb.g.player.body.grounded });
    b.wait(0.3);
    assert(b.p.y > 0.95 && b.g.held, 'on the crate holding the other');
    b.carryY = 4.6;
    b.hold({ x: 0, z: 0 }, 0.6, () => ready(b));
    b.fireDir(0, -Math.PI / 2);
    b.hold({ x: 0, z: -3.4 }, 0.25);
    b.hold({ x: 0, z: -3.4 }, 2.5, () => b.g.player.body.grounded);
    b.wait(0.2);
    assert(b.p.y > 3.15, `up on the shelf (y=${b.p.y.toFixed(2)})`);
    b.carryY = null;
    b.walkTo(-3.2, -21.8);
    b.placeHeld({ x: -4.5, y: 3.35, z: -23.5 }, { tol: 0.03 });
    b.drop();
    assert(!b.input('RL'), 'lock blocked with the carried crate');
    // Second floating mirror from the shelf
    b.walkTo(5, -20);
    shootAt(b, { x: 9.5, y: 0.75, z: -36 }, 2);
    b.wait(0.3);
    assert(b.input('R1'), 'main beam home');
    // Climb the summit tower and shoot the last bullseye
    b.walkTo(0, -23.74);
    climbGrip(b, 0, { x: 0, z: -3 }, 10);
    b.walkTo(2, -26.5);
    shootAt(b, { x: 13.9, y: 12.5, z: -30 });
    assert(b.input('T1'), 'summit bullseye hit');
    b.waitUntil(() => b.door('D1').t > 0.9, 4, 'final gate open');
    b.path([[0, -27.5], [0, -32]]);
    b.waitUntil(() => b.g.finalSeq, 2, 'final ascent starts');
  },
};

let failures = 0;
for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  const sol = SOLUTIONS[level.name];
  if (!sol) { console.log(`Level ${level.id} ${level.name}: NO SOLUTION SCRIPT`); failures++; continue; }
  const b = new Bot(level, { verbose });
  const t0 = Date.now();
  try {
    sol(b);
    b.waitUntil(() => b.g.completed, 14, 'level completion');
    console.log(`PASS  Level ${level.id} ${level.name.padEnd(22)} sim ${b.g.time.toFixed(1)}s  clones ${b.g.clonesCreated}  (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    console.log(`FAIL  Level ${level.id} ${level.name}: ${e.message}`);
    console.log('   player', JSON.stringify(b.p), 'clone', b.clone() ? JSON.stringify({ ...b.clone().pos, state: b.clone().state, yaw: b.clone().yaw.toFixed(2) }) : 'none');
    console.log(b.log.slice(-25).map((l) => '   ' + l).join('\n'));
  }
}
if (failures) { console.log(`\n${failures} level(s) failed`); process.exit(1); }
console.log('\nAll levels completed.');
