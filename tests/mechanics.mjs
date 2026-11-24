// Focused checks of the core rules, using tiny purpose-built test rooms.
import { Game } from '../src/sim/game.js';
import { bodyBox, overlaps } from '../src/sim/physics.js';

let fails = 0;
const ok = (cond, name) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails++; };
const run = (g, sec, input = {}) => { for (let i = 0; i < Math.round(sec * 60); i++) g.update(1 / 60, input); };

const room = (build, extra = {}) => ({
  id: 99, name: 'test', bounds: [-10.2, -10.2, 10.2, 10.2], height: 5, start: { x: 0, z: 6, yaw: 0 },
  build(b) { b.wallX(-10, -10, 10); b.wallX(10, -10, 10); b.wallZ(-10, -10, 10); b.wallZ(10, -10, 10); build(b); },
  ...extra,
});

// 1. Clone walks toward a visible player in front of it (and is not teleported).
{
  const g = new Game(room((b) => b.pod({ x: 0, z: 5, yaw: 0 })));
  g.player.body.pos.z = -3;
  g.spawnClone();
  const z0 = g.clone.pos.z;
  let maxStep = 0, last = z0, backward = false;
  for (let i = 0; i < 60 * 6; i++) {
    g.update(1 / 60, {});
    const c = g.clone;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const dz = c.pos.z - last;
    if (dz * fz < -1e-6) backward = true;
    maxStep = Math.max(maxStep, Math.abs(dz)); last = c.pos.z;
  }
  ok(g.clone.pos.z < z0 - 5, 'clone follows a visible player');
  ok(maxStep < 0.04, 'clone moves gradually (max step ' + maxStep.toFixed(3) + ' m per frame, no teleport)');
  ok(!backward, 'clone never walks backward');
  ok(Math.abs(Math.hypot(g.clone.pos.x - g.player.body.pos.x, g.clone.pos.z - g.player.body.pos.z) - 1.15) < 0.1, 'clone stops a step away from the player');
}

// 2. Player behind the clone: it does not move or turn.
{
  const g = new Game(room((b) => b.pod({ x: 0, z: 0, yaw: 0 })));
  g.player.body.pos.z = 5;   // south of a north-facing clone
  g.spawnClone();
  run(g, 1.5);
  const p0 = { ...g.clone.pos }, y0 = g.clone.yaw;
  run(g, 4);
  ok(Math.hypot(g.clone.pos.x - p0.x, g.clone.pos.z - p0.z) < 1e-6 && g.clone.yaw === y0, 'clone ignores a player behind it');
}

// 3. Wall between: no line of sight, clone stays frozen.
{
  const g = new Game(room((b) => { b.pod({ x: 0, z: 4, yaw: 0 }); b.wallX(0, -6, 6); }));
  g.player.body.pos.z = -4;
  g.spawnClone();
  run(g, 1.5);
  const p0 = { ...g.clone.pos };
  run(g, 4);
  ok(Math.hypot(g.clone.pos.x - p0.x, g.clone.pos.z - p0.z) < 1e-6 && g.clone.state === 'frozen', 'wall blocks sight: clone frozen');
}

// 4. Sight lost mid-walk: clone freezes exactly where it is.
{
  const g = new Game(room((b) => { b.pod({ x: 0, z: 6, yaw: 0 }); b.pillar(1, -4, 6, -3); }));
  g.player.body.pos.x = 0; g.player.body.pos.z = -6;
  g.spawnClone();
  run(g, 3.5);
  g.player.body.pos.x = 4; g.player.body.pos.z = -6; // behind the pillar
  run(g, 0.2);
  const p0 = { ...g.clone.pos };
  run(g, 3);
  ok(Math.hypot(g.clone.pos.x - p0.x, g.clone.pos.z - p0.z) < 1e-6, 'clone freezes when the player hides');
  g.player.body.pos.x = 0;
  run(g, 3);
  ok(g.clone.pos.z < p0.z - 1, 'clone resumes when the player is visible again');
}

// 5. Clone cannot pass through walls or low barriers it can see over.
{
  const g = new Game(room((b) => { b.pod({ x: 0, z: 6, yaw: 0 }); b.barrier(-10, 1.8, 10, 2.2, 0.9); }));
  g.player.body.pos.z = -4;
  g.spawnClone();
  run(g, 10);
  ok(g.clone.pos.z > 2.2 && g.clone.sees, 'clone sees over a low wall but cannot cross it');
}

// 6. Mirrors reflect: east-going beam turned north, south, and blocked.
{
  const mk = (step, extra = () => {}) => new Game(room((b) => {
    b.emitter({ id: 'E', x: -8, z: 0, dir: 'E' });
    b.mirror({ id: 'M', x: 2, z: 0, step });
    b.receiver({ id: 'RN', x: 2, z: -9.62, facing: 'S' });
    b.receiver({ id: 'RS', x: 2, z: 9.62, facing: 'N' });
    extra(b);
  }));
  let g = mk(2); run(g, 0.1); ok(g.inputOn('RN') && !g.inputOn('RS'), 'mirror at 45 degrees sends the beam north');
  g = mk(6); run(g, 0.1); ok(g.inputOn('RS') && !g.inputOn('RN'), 'mirror at 135 degrees sends the beam south');
  g = mk(4); run(g, 0.1); ok(!g.inputOn('RS') && !g.inputOn('RN'), 'edge-on mirror lets the beam pass');
  g = mk(2, (b) => b.cube(-3, 0, 0, 1)); run(g, 0.5); ok(!g.inputOn('RN'), 'a crate blocks the beam');
  g = mk(2); run(g, 0.1);
  const m = g.mirrors[0]; g.rotateMirror(m, 4); run(g, 0.05); ok(g.inputOn('RS'), 'beam updates immediately when the mirror turns');
}

// 7. Stacking: crates rest exactly on each other, never interpenetrate.
{
  const g = new Game(room((b) => { b.cube(0, 0, 0, 1, 'A'); b.cube(0.3, 3, 0, 1, 'B'); b.cube(-0.2, -4, 0, 1, 'C'); }, { start: { x: 6, z: 6, yaw: 0 } }));
  const [A, B, C] = g.blocks;
  g.grab(B); g.setHoldTarget(0.3, 1.6, 0); run(g, 1.0); g.release();
  g.grab(C); g.setHoldTarget(-0.2, 2.8, 0); run(g, 1.0); g.release();
  run(g, 2);
  ok(Math.abs(B.pos.y - 1) < 1e-6 && Math.abs(C.pos.y - 2) < 1e-6, `three crates stack (heights ${A.pos.y.toFixed(2)}, ${B.pos.y.toFixed(2)}, ${C.pos.y.toFixed(2)})`);
  let pen = false;
  for (const p of [[A, B], [B, C], [A, C]]) if (overlaps(bodyBox(p[0]), bodyBox(p[1]), 0.001)) pen = true;
  ok(!pen, 'stacked crates do not overlap');
  const y = B.pos.y; run(g, 5); ok(B.pos.y === y, 'stacked crates stay put');
  // Pull the bottom one out: the others fall onto the floor (gravity).
  g.grab(A); g.setHoldTarget(3, 0.5, -3); run(g, 1.5); g.release(); run(g, 2);
  ok(Math.abs(B.pos.y) < 1e-6 && Math.abs(C.pos.y - 1) < 1e-6, `removing the base lets the stack fall (${B.pos.y.toFixed(2)}, ${C.pos.y.toFixed(2)})`);
}

// 8. Plates detect clones and crates; doors follow their rules and cannot crush.
{
  const g = new Game(room((b) => {
    b.plate({ id: 'P', x: 0, z: 0 });
    b.cube(3, 0, 0, 1, 'K');
    b.wallX(-5, -10, 10, { gaps: [[-1, 1]] });
    b.door({ id: 'D', x: 0, z: -5, axis: 'x', width: 2, requires: ['P'] });
  }));
  const K = g.blocks[0];
  g.grab(K); g.setHoldTarget(0, 0.6, 0); run(g, 1); g.release(); run(g, 2.5);
  ok(g.inputOn('P') && g.doors[0].t > 0.95, 'crate on plate opens the door');
  g.player.body.pos.x = 0; g.player.body.pos.z = -5;  // stand in the doorway
  g.grab(K); g.setHoldTarget(4, 0.6, 3); run(g, 1); g.release(); run(g, 3);
  ok(g.doors[0].t > 0.5, 'door will not close on the player standing in it');
  g.player.body.pos.z = -3; run(g, 3);
  ok(g.doors[0].t === 0, 'door closes once the doorway is clear');
}

// 9. Kickback gun
{
  const sky = (build) => ({ id: 98, name: 'gun', gun: true, sky: true, bounds: [-20, -20, 20, 20], height: 40, start: { x: 0, z: 0, yaw: 0 },
    build(b) { b.block(-20, -1, -20, 20, 0, 20); build(b); } });
  const peak = (g) => { let m = 0; for (let i = 0; i < 120; i++) { g.update(1 / 60, {}); m = Math.max(m, g.player.body.pos.y); } return m; };
  const down = { x: 0, y: -1, z: 0 };
  let g = new Game(sky(() => {})); run(g, 0.2);
  g.fire(g.playerHead(), down);
  const h = peak(g);
  ok(h > 2.1 && h < 2.6, `shooting the floor launches you (${h.toFixed(2)} m, a jump is 1.15 m)`);
  g = new Game(sky(() => {})); run(g, 0.2);
  g.fire(g.playerHead(), { x: 0, y: 0, z: -1 });
  ok(g.player.vel.z === 0 && g.player.body.vy === 0, 'shooting into the distance does not push you');
  g = new Game(sky(() => {})); run(g, 0.2);
  g.player.body.pos.y = 6; g.player.body.grounded = false; g.player.charges = 2;
  g.fire(g.playerHead(), down); run(g, 0.3); g.fire(g.playerHead(), down); run(g, 0.3);
  ok(g.player.charges === 0 && g.fire(g.playerHead(), down) === null, 'two shots per jump, then empty until you land');
  run(g, 3);
  ok(g.player.charges === 2, 'shots refill on landing');
  g = new Game(sky((b) => b.grip(-3, -3, 3, -2, 0, 20))); run(g, 0.2);
  g.player.body.pos.z = -1.73; g.player.body.pos.y = 4; g.player.body.grounded = false; g.player.charges = 0;
  g.update(1 / 60, { move: { x: 0, z: -3 } });
  ok(g.player.charges === 2, 'touching a blue grip panel refills your shots');
  g = new Game(sky((b) => { b.block(-1, 0, -12.5, 1, 6, -12, 'wall'); b.target({ id: 'T', x: 0, y: 2, z: -11.95, facing: 'S' }); b.mirror({ id: 'M', x: 5, z: -10, step: 0 }); }));
  run(g, 0.2);
  const e = g.playerHead();
  const aim = (p) => { const d = { x: p.x - e.x, y: p.y - e.y, z: p.z - e.z }; const l = Math.hypot(d.x, d.y, d.z); return { x: d.x / l, y: d.y / l, z: d.z / l }; };
  g.fire(e, aim({ x: 0, y: 2, z: -11.95 })); run(g, 0.1);
  ok(g.inputOn('T'), 'a shot presses a bullseye from 12 m away');
  run(g, 0.4); g.fire(e, aim({ x: 5, y: 0.75, z: -10 })); run(g, 0.1);
  ok(g.mirrors[0].step === 1, 'a shot turns a mirror one step');
}

if (fails) { console.log(`\n${fails} mechanic check(s) failed`); process.exit(1); }
console.log('\nAll mechanic checks passed.');
