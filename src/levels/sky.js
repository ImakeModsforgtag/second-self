// "The Ascent": chambers 13 to 20, floating in the sky. They introduce the
// Kickback gun (recoil jumps, wall bounces, grip-panel climbing, remote shots)
// and then combine it with clones, crates and lasers.
// P(b, x0, z0, x1, z1, top) makes a 1 m thick floating platform.

const P = (b, x0, z0, x1, z1, top, th = 1) => b.block(x0, top - th, z0, x1, top, z1);
/** A gate across a 2 m wide walkway: the door plus two tall posts so you cannot go around it. */
const gate = (b, { id, x, z, y0, requires, latch = false, span = 3 }) => {
  b.door({ id, x, z, axis: 'x', width: 2, y0, requires, latch, height: 2.7 });
  b.block(x - 1 - span, y0, z - 0.4, x - 1, y0 + 5, z + 0.4, 'wall');
  b.block(x + 1, y0, z - 0.4, x + 1 + span, y0 + 5, z + 0.4, 'wall');
};
const sky = { sky: true, gun: true, killY: -14, height: 40 };

export const SKY_LEVELS = [
  // ===================================================================== Kickback
  {
    ...sky,
    name: 'Kickback',
    difficulty: 'Easy',
    blurb: 'Above the facility. A gun that pushes back.',
    bounds: [-10, -30, 10, 6],
    start: { x: 0, z: 1.5, yaw: 0 },
    build(b) {
      P(b, -3, -3, 3, 3, 0);
      b.checkpoint({ x: 0, z: 1.5, w: 6, d: 3 });
      P(b, -3, -9, 3, -3, 2.0);                    // a ledge too tall to jump
      P(b, -3, -13.2, 3, -10.8, 2.0);              // across a small gap
      b.block(6.6, -2, -12.6, 7.6, 6, -11.4, 'wall');
      b.target({ id: 'T1', x: 6.5, y: 4.5, z: -12, facing: 'W' });
      P(b, -1, -20, 1, -13.2, 2.0);                // walkway
      gate(b, { id: 'D1', x: 0, z: -13.6, y0: 2.0, requires: ['T1'], latch: true });
      P(b, -3, -26, 3, -20, 4.0);                  // final step up
      b.checkpoint({ x: 0, z: -11.8, y: 2.0, w: 6, d: 2.2 });
      b.exit({ x: 0, z: -23, y: 4.0 });
      b.hint('The lift brought you above the clouds. You now carry the Kickback gun. Right click (or G) fires. In VR, use the right trigger.');
      b.hint('Aim at the floor right under you and fire. The recoil launches you twice as high as a jump.', [-3, -3, 3, 0]);
      b.hint('The pulse also hits switches far away. Shoot the bullseye.', [-3, -13.2, 3, -10.8]);
      b.hint('You get two shots per jump. They refill when you land.', [-1, -20, 1, -14]);
    },
  },

  // ===================================================================== Wall Climber
  {
    ...sky,
    name: 'Wall Climber',
    difficulty: 'Easy to medium',
    blurb: 'Blue panels give your shots back. Plain concrete does not.',
    bounds: [-10, -30, 10, 6],
    start: { x: 0, z: 2.5, yaw: 0 },
    build(b) {
      P(b, -4, -2, 4, 4, 0);
      b.checkpoint({ x: 0, z: 2.5, w: 8, d: 3 });
      b.block(-3, -1, -8, 3, 8, -2.15, 'wall');
      b.grip(-2, -2.15, 2, -2.0, 0, 7.7);
      P(b, -3, -17, 3, -10.2, 6.0);
      b.checkpoint({ x: 0, z: -13, y: 6.0, w: 6, d: 4 });
      b.block(-3, -1, -24, 3, 10, -17.15, 'wall');
      b.grip(1, -17.15, 2.6, -17.0, 6.0, 9.7);
      b.exit({ x: 0, z: -21, y: 10 });
      b.hint('Blue grip panels refill your two shots every time you touch them. Walk into the wall, aim down at it just under you, and fire again and again.');
      b.hint('From up here, take a running jump to the next platform.', [-3, -8, 3, -2.2]);
      b.hint('Plain concrete gives nothing back. Find the narrow blue strip.', [-3, -17, 3, -11]);
    },
  },

  // ===================================================================== Rebound
  {
    ...sky,
    name: 'Rebound',
    difficulty: 'Medium',
    blurb: 'Face the wall. Fly away from it.',
    bounds: [-10, -20, 12, 6],
    start: { x: 0, z: 0.5, yaw: 180 },
    build(b) {
      P(b, -2, -1, 2, 2, 0);
      b.block(-2, -1, 2, 2, 4, 2.4, 'wall');
      b.checkpoint({ x: 0, z: 0.5, w: 4, d: 3 });
      P(b, -2.5, -9, 0.5, -4, 0);
      b.block(-2.9, -1, -9, -2.5, 4, -4, 'wall');
      b.checkpoint({ x: -1, z: -6.5, w: 3, d: 5 });
      P(b, 3.5, -9, 7.5, -4, 0);
      b.checkpoint({ x: 5.5, z: -6.5, w: 4, d: 5 });
      P(b, 3.5, -15, 7.5, -9, 2.0);
      b.exit({ x: 5.5, z: -12.5, y: 2.0 });
      b.hint('Too far to jump. Face the wall behind you, jump, and shoot the wall at chest height. Hold the direction you want to fly.');
      b.hint('Same trick, new direction.', [-2.5, -9, 0.5, -4]);
      b.hint('Launch straight up beside the ledge, then steer onto it.', [3.5, -9, 7.5, -4]);
    },
  },

  // ===================================================================== Trick Shots
  {
    ...sky,
    name: 'Trick Shots',
    difficulty: 'Medium to hard',
    blurb: 'Out of reach is not out of range.',
    bounds: [-10, -30, 10, 10],
    start: { x: 0, z: 4.5, yaw: 0 },
    build(b) {
      P(b, -6, -6, 6, 6, 0);
      b.checkpoint({ x: 0, z: 4.5, w: 6, d: 3 });
      b.emitter({ id: 'E1', x: -5.5, z: 5.5, dir: 'N' });
      P(b, -6.2, -12.6, -4.8, -11.4, 0);
      b.mirror({ id: 'M1', x: -5.5, z: -12, step: 0 });
      P(b, 4.8, -12.6, 6.2, -11.4, 0);
      b.mirror({ id: 'M2', x: 5.5, z: -12, step: 4 });
      b.block(5, -1, 5.8, 6, 2, 6.3, 'wall');
      b.receiver({ id: 'R1', x: 5.5, z: 5.62, facing: 'N' });
      P(b, -1, -16, 1, -6, 0);
      gate(b, { id: 'D1', x: 0, z: -6.4, y0: 0, requires: ['R1', 'T1'] });
      P(b, -3, -22, 3, -16, 0);
      b.block(-0.6, -1, -22.6, 0.6, 8, -22, 'wall');
      b.target({ id: 'T1', x: 0, y: 6, z: -21.95, facing: 'S' });
      b.exit({ x: 0, z: -19.5 });
      b.hint('The mirrors float out of reach. A shot turns a mirror one step. Stand well back: a hit within a few metres kicks you.');
      b.hint('The gate needs the receiver lit and the far bullseye hit.', [-3, -6, 3, -2]);
    },
  },

  // ===================================================================== Updraft
  {
    ...sky,
    name: 'Updraft',
    difficulty: 'Hard',
    blurb: 'You can carry a crate on the way up.',
    bounds: [-10, -30, 10, 8],
    start: { x: 0, z: 3, yaw: 0 },
    build(b) {
      P(b, -4, -4, 4, 4, 0);
      b.checkpoint({ x: 0, z: 3, w: 8, d: 2 });
      b.cube(2, 1, 0, 1, 'C1');
      b.cube(-2, 1, 0, 1, 'C2');
      P(b, -4, -12, 4, -4, 3.2);
      b.checkpoint({ x: -2, z: -6, y: 3.2, w: 4, d: 3 });
      b.plate({ id: 'P1', x: 2, z: -9, y: 3.2 });
      P(b, -1, -18, 1, -12, 3.2);
      gate(b, { id: 'D1', x: 0, z: -12.4, y0: 3.2, requires: ['P1'] });
      P(b, -3, -22, 3, -18, 3.2);
      b.exit({ x: 0, z: -20, y: 3.2 });
      b.hint('The ledge is higher than a gun jump. Stand on something first.');
      b.hint('The plate up here needs weight. You can hold a crate while you launch.', [-4, -12, 4, -4]);
    },
  },

  // ===================================================================== Sky Copy
  {
    ...sky,
    name: 'Sky Copy',
    difficulty: 'Hard',
    blurb: 'Your copy cannot fly. You can.',
    bounds: [-10, -30, 20, 8],
    start: { x: 3, z: 3, yaw: 0 },
    build(b) {
      P(b, -5, -3, 5, 4, 0);
      b.checkpoint({ x: 3, z: 3, w: 3, d: 2 });
      b.pod({ x: 0, z: 2.5, yaw: 0 });
      P(b, -1, -10, 1, -3, 0);
      P(b, -4, -14.6, 4, -10, 0);
      b.checkpoint({ x: -2.5, z: -12, w: 2.5, d: 3 });
      b.barrier(-1.2, -13.4, 1.2, -13.1, 0.9, 0);
      b.barrier(-1.2, -13.1, -0.9, -11, 0.9, 0);
      b.barrier(0.9, -13.1, 1.2, -11, 0.9, 0);
      b.plate({ id: 'P1', x: 0, z: -12.1, w: 1.8, d: 1.8 });
      b.block(4, -1, -14.6, 6, 8, -10, 'wall');
      b.grip(3.85, -13.5, 4.0, -10.5, 0, 7.7);
      b.block(14, -2, -12.6, 15, 11, -11.4, 'wall');
      b.target({ id: 'T1', x: 13.9, y: 9.5, z: -12, facing: 'W' });
      P(b, -1, -20, 1, -14.6, 0);
      gate(b, { id: 'D1', x: 0, z: -15.0, y0: 0, requires: ['P1', 'T1'] });
      P(b, -3, -24, 3, -20, 0);
      b.exit({ x: 0, z: -22 });
      b.hint('Bring your clone across the walkway into the booth. Stand beyond its low wall.');
      b.hint('The bullseye is hidden behind the tower. Climb it.', [-4, -14, 4, -10]);
    },
  },

  // ===================================================================== Crosswind
  {
    ...sky,
    name: 'Crosswind',
    difficulty: 'Very hard',
    blurb: 'Bounce, aim, climb. In that order.',
    bounds: [-12, -26, 12, 6],
    start: { x: 0, z: 0.5, yaw: 180 },
    build(b) {
      P(b, -3, -1, 3, 2, 0);
      b.block(-3, -1, 2, 3, 4, 2.4, 'wall');
      b.checkpoint({ x: 0, z: 0.5, w: 6, d: 3 });
      P(b, -3, -14.05, 3, -4.4, 0);
      b.checkpoint({ x: 0, z: -6, w: 6, d: 3 });
      // Main beam: off the edge, around two floating mirrors, back to a receiver.
      b.emitter({ id: 'E1', x: 2.5, z: -5, dir: 'W' });
      P(b, -6.6, -5.6, -5.4, -4.4, 0);
      b.mirror({ id: 'M1', x: -6, z: -5, step: 4 });
      P(b, -6.6, -13.6, -5.4, -12.4, 0);
      b.mirror({ id: 'M2', x: -6, z: -13, step: 0 });
      b.block(3.0, -1, -13.6, 3.6, 2, -12.4, 'wall');
      b.receiver({ id: 'R1', x: 2.82, z: -13, facing: 'W' });
      // Lock beam
      b.emitter({ id: 'E2', x: -2.5, z: -9.5, dir: 'E' });
      P(b, 4.4, -10.1, 5.6, -8.9, 0);
      b.mirror({ id: 'M3', x: 5, z: -9.5, step: 4 });
      b.block(6.8, -1, -10.1, 7.4, 2, -8.9, 'wall');
      b.receiver({ id: 'RL', x: 6.62, z: -9.5, facing: 'W', lock: true });
      // Climbing tower
      b.block(-3, -1, -21, 3, 7, -14.2, 'wall');
      b.grip(-1.5, -14.2, 1.5, -14.05, 0, 6.7);
      gate(b, { id: 'D1', x: 0, z: -17, y0: 7, requires: ['R1', '!RL'] });
      b.exit({ x: 0, z: -19.5, y: 7 });
      b.hint('Too far to jump. You know the wall trick.');
      b.hint('Two floating mirrors carry the beam home. The third can turn the lock beam aside. Keep your distance when you shoot them.', [-3, -9, 3, -4.4]);
    },
  },

  // ===================================================================== The Summit
  {
    ...sky,
    name: 'The Summit',
    difficulty: 'Extremely hard',
    blurb: 'Everything you have learned, at the top of the sky.',
    bounds: [-12, -42, 18, 8],
    start: { x: 1.5, z: 3.5, yaw: 0 },
    build(b) {
      // A: start, pod and crates
      P(b, -5, -4, 5, 5, 0);
      b.checkpoint({ x: 1.5, z: 3.5, w: 3, d: 2 });
      b.pod({ x: -3.5, z: 3.5, yaw: 0 });
      b.cube(3, 0, 0, 1, 'C1');
      b.cube(-3, -1, 0, 1, 'C2');
      // Walkway to B
      P(b, -1, -12, 1, -4, 0);
      // B: booth for the clone; it powers the main emitter
      P(b, -6, -16.6, 6, -12, 0);
      b.checkpoint({ x: 4, z: -13.5, w: 3, d: 2.5 });
      b.barrier(-1.2, -15.9, 1.2, -15.6, 0.9, 0);
      b.barrier(-1.2, -15.6, -0.9, -13.5, 0.9, 0);
      b.barrier(0.9, -15.6, 1.2, -13.5, 0.9, 0);
      b.plate({ id: 'P1', x: 0, z: -14.6, w: 1.8, d: 1.8 });
      b.emitter({ id: 'E1', x: -5.5, z: -12.6, dir: 'E', power: ['P1'] });
      P(b, 8.9, -13.2, 10.1, -12.0, 0);
      b.mirror({ id: 'M1', x: 9.5, z: -12.6, step: 0 });
      P(b, 8.9, -36.6, 10.1, -35.4, 0);
      b.mirror({ id: 'M2', x: 9.5, z: -36, step: 4 });
      b.block(-9.8, -1, -36.6, -9.2, 2, -35.4, 'wall');
      b.receiver({ id: 'R1', x: -9.02, z: -36, facing: 'E' });
      // C: high shelf (crate step + gun jump), with the lock beam
      P(b, -6, -24.15, 6, -16.6, 3.2, 4.2);
      b.checkpoint({ x: -3, z: -19, y: 3.2, w: 3, d: 3 });
      b.emitter({ id: 'E2', x: -5.5, z: -23.5, y: 3.2, dir: 'E' });
      b.block(6.8, 2.2, -24.1, 7.4, 5.2, -22.9, 'wall');
      b.receiver({ id: 'RL', x: 6.62, z: -23.5, y: 3.2, facing: 'W', lock: true });
      // S: the summit tower, climbed on its blue strip
      b.block(-4, -1, -34, 4, 10, -24.15, 'wall');
      b.grip(-2, -24.15, 2, -24.0, 3.2, 9.7);
      b.block(14, 0, -30.6, 15, 14, -29.4, 'wall');
      b.target({ id: 'T1', x: 13.9, y: 12.5, z: -30, facing: 'W' });
      gate(b, { id: 'D1', x: 0, z: -29, y0: 10, requires: ['P1', 'R1', '!RL', 'T1'] });
      b.exit({ x: 0, z: -32, y: 10, w: 1.9, d: 1.9, final: true });
      b.hint('The summit. Your copy, your crates, two beams, a bullseye and a tall tower. Order matters.');
      b.hint('The shelf ahead is higher than a gun jump. And the lock up there will want a crate.', [-6, -16.6, 6, -12]);
      b.hint('Climb the blue strip. The last bullseye can only be seen from high up.', [-6, -24.15, 6, -20]);
    },
  },
];
