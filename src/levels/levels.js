// SECOND SELF: the eight test chambers. Every chamber is authored by hand and
// has a verified solution (see tests/playthrough.mjs, which solves each one
// using the real game simulation).
//
// Mirror steps: the panel normal points at step * 22.5 degrees, measured from +x
// toward +z. Useful values: 2 or 10 = "/" diagonal, 6 or 14 = "\" diagonal,
// 0 or 8 = faces east/west, 4 or 12 = faces north/south (beams along x pass by).

const RAW_LEVELS = [
  // ===================================================================== 1
  {
    id: 1,
    name: 'The First Copy',
    difficulty: 'Very easy',
    blurb: 'Make a copy of yourself and let it hold the door.',
    bounds: [-6.2, -11.2, 6.2, 6.2],
    height: 5,
    start: { x: -3.5, z: 4.5, yaw: 0 },
    build(b) {
      b.wallX(6, -6, 6);
      b.wallZ(-6, -6, 6);
      b.wallZ(6, -6, 6);
      b.wallX(-6, -6, 6, { gaps: [[2, 4]] });
      // Exit room
      b.wallZ(1, -11, -6);
      b.wallZ(5, -11, -6);
      b.wallX(-11, 1, 5);

      // The plate sits in a small booth. The low front wall stops the clone.
      b.barrier(-1.2, -3.4, 1.2, -3.1, 0.9);
      b.barrier(-1.2, -3.1, -0.9, -1.1, 0.9);
      b.barrier(0.9, -3.1, 1.2, -1.1, 0.9);
      b.plate({ id: 'P1', x: 0, z: -2.2, w: 1.8, d: 1.8 });

      b.pod({ x: 0, z: 4.6, yaw: 0 });
      b.door({ id: 'D1', x: 3, z: -6, axis: 'x', width: 2, requires: ['P1'] });
      b.exit({ x: 3, z: -9.2 });

      b.light(-3, 2); b.light(3, 2); b.light(0, -3.5); b.light(3, -8.5);

      b.hint('Welcome, subject. WASD to walk, mouse to look. The door ahead is locked.');
      b.hint('A pressure plate. The door stays open only while something stands on it.', [-2, -5, 2, -1]);
      b.hint('That is a clone pod. Press F (B on a VR controller) to make a copy of yourself.', [-3, 2, 3, 6]);
      b.hintOn('clone', 'Your clone walks toward you only while it can see you in front of it. Stand beyond the booth so it walks onto the plate.');
      b.hint('Out of its sight, the clone freezes in place. Leave it holding the plate and head through the door.', [1, -6, 6, -3.5]);
    },
  },

  // ===================================================================== 2
  {
    id: 2,
    name: 'Out of Sight',
    difficulty: 'Easy',
    blurb: 'Guide your copy around corners. Then make it stop where you need it.',
    bounds: [-8.2, -26.2, 16.2, 8.2],
    height: 5,
    start: { x: -5, z: 6.5, yaw: 0 },
    build(b) {
      // Room A
      b.wallX(8, -8, -2);
      b.wallZ(-8, 0, 8);
      b.wallX(0, -8, -2);
      b.wallZ(-2, 0, 8, { gaps: [[4.6, 7.4]] });
      // L-shaped corridor
      b.wallX(4.6, -2, 1.2);
      b.wallX(7.4, -2, 4);
      b.wallZ(1.2, -2, 4.6);
      b.wallZ(4, -2, 7.4);
      // Low wall at the end of the corridor (you can hop it, the clone cannot)
      b.barrier(1.2, -2.2, 4, -1.8, 0.9);
      b.plate({ id: 'P1', x: 2.6, z: -1.0, w: 2.4, d: 1.6 });
      // Hall
      b.wallZ(-2, -8, -2);
      b.wallX(-2, -2, 1.2);
      b.wallX(-2, 4, 10);
      b.wallZ(10, -8, -2);
      b.wallX(-8, -2, 16, { gaps: [[7, 9]] });
      b.door({ id: 'D1', x: 8, z: -8, axis: 'x', width: 2, requires: ['P1'] });
      // Room B with a partition and a narrow doorway
      b.wallZ(0, -22, -8);
      b.wallZ(16, -22, -8);
      b.wallX(-22, 0, 16, { gaps: [[12, 14]] });
      b.wallX(-16, 0, 16, { gaps: [[7.4, 8.6]] });
      b.pillar(11, -13, 12, -12);
      b.plate({ id: 'P2', x: 8, z: -14.9, w: 1.8, d: 1.8 });
      b.plate({ id: 'P3', x: 3, z: -19, w: 1.6, d: 1.6 });
      b.door({ id: 'D2', x: 13, z: -22, axis: 'x', width: 2, requires: ['P2', 'P3'], latch: true });
      // Exit
      b.wallZ(12, -26, -22);
      b.wallZ(14, -26, -22);
      b.wallX(-26, 12, 14);
      b.exit({ x: 13, z: -24.5 });

      b.pod({ x: -7.2, z: 1.4, yaw: -90 });
      b.pod({ x: 2, z: -9.6, yaw: -90 });

      b.light(-5, 4); b.light(2.6, 6); b.light(2.6, 0); b.light(4, -5); b.light(8, -12); b.light(3, -12);
      b.light(4, -19); b.light(12, -19); b.light(13, -24);

      b.hint('Make a clone, then lead it along the corridor. If you walk out of its sight it stops, so stay where it can see you.');
      b.hint('The clone cannot climb or jump. You can hop this low wall.', [0.5, -1.5, 4.5, 2.5]);
      b.hint('Only one clone can exist. Creating a new one recalls the old copy.', [0, -12, 6, -8]);
      b.hint('This door needs both plates pressed at the same moment. Once open, it stays open.', [9, -21, 16, -16.5]);
      b.hint('A narrow doorway. Stand in it, let your clone come to you, then slip behind the wall.', [6, -15.5, 10, -12]);
    },
  },

  // ===================================================================== 3
  {
    id: 3,
    name: 'Weight and Height',
    difficulty: 'Easy to medium',
    blurb: 'Concrete has weight. Concrete can be climbed.',
    bounds: [-8.2, -25.2, 8.2, 4.2],
    height: 7,
    start: { x: 0, z: 2.6, yaw: 0 },
    build(b) {
      b.wallX(4, -5, 5);
      b.wallZ(-5, -6, 4);
      b.wallZ(5, -6, 4);
      b.wallX(-6, -8, 8, { gaps: [[-1, 1]] });
      b.plate({ id: 'P1', x: 3, z: -3 });
      b.cube(-3, -1, 0, 1, 'B1');
      b.door({ id: 'D1', x: 0, z: -6, axis: 'x', width: 2, requires: ['P1'] });

      // Room 2
      b.wallZ(-8, -22, -6);
      b.wallZ(8, -22, -6);
      b.wallX(-22, -8, 8, { gaps: [[5, 7]] });
      b.platform(-8, -22, -4, -14, 2.0);           // west ledge
      b.platform(4, -17, 8, -12, 3.0);             // east high ledge
      b.platform(4, -22, 8, -18.2, 3.0);           // exit ledge beyond a small gap
      b.button({ id: 'S1', x: -6, y: 3.4, z: -21.75, facing: 'S', mode: 'toggle' });
      b.door({ id: 'D2', x: 6, z: -22, axis: 'x', width: 2, y0: 3.0, requires: ['S1'], latch: true });
      b.cube(-1, -9, 0, 1, 'C2');
      b.slab(1, -11.5, 2, 1, 1, 0, 'LB');
      b.cube(-2, -15, 0, 0.5, 'SC');
      // Exit room (on the high level)
      b.platform(5, -25, 7, -22, 3.0);
      b.wallZ(5, -25, -22);
      b.wallZ(7, -25, -22);
      b.wallX(-25, 5, 7);
      b.exit({ x: 6, z: -23.6, y: 3.0 });

      b.light(0, 0, 6.95); b.light(0, -10, 6.95); b.light(-5, -18, 6.95); b.light(5, -16, 6.95); b.light(6, -23.5, 6.95);

      b.hint('Look at the crate and click (or squeeze grip in VR) to pick it up. Click again to set it down. Mouse wheel changes the distance.');
      b.hint('The ledge is too high to jump. Something to stand on would help.', [-4, -18, 0, -12]);
      b.hint('Q and E turn the crate you are holding. Crates stack.', [0, -14, 4, -8]);
      b.hint('Higher still. Build a staircase.', [1, -16, 4, -12]);
    },
  },

  // ===================================================================== 4
  {
    id: 4,
    name: 'Refraction',
    difficulty: 'Medium',
    blurb: 'Light travels in straight lines. Mirrors disagree.',
    bounds: [-7.2, -16.2, 7.2, 4.2],
    height: 5,
    start: { x: 0, z: 2.6, yaw: 0 },
    build(b) {
      b.wallX(4, -7, 7);
      b.wallZ(-7, -12, 4);
      b.wallZ(7, -12, 4);
      b.wallX(-12, -7, 7, { gaps: [[3.5, 5.5]] });
      b.wallX(-5, -7, 0.5);
      b.emitter({ id: 'E1', x: -6.5, z: -2, dir: 'E' });
      b.mirror({ id: 'M1', x: 2, z: -2, step: 0 });
      b.mirror({ id: 'M2', x: 2, z: -8, step: 0 });
      b.mirror({ id: 'M3', x: -4, z: -8, step: 4 });
      b.mirror({ id: 'M4', x: 4.5, z: -5, step: 3 });
      b.receiver({ id: 'R1', x: -4, z: -11.62, facing: 'S' });
      b.door({ id: 'D1', x: 4.5, z: -12, axis: 'x', width: 2, requires: ['R1'] });
      b.wallZ(3.5, -16, -12);
      b.wallZ(5.5, -16, -12);
      b.wallX(-16, 3.5, 5.5);
      b.exit({ x: 4.5, z: -14.5 });

      b.light(0, 1); b.light(-3, -2); b.light(3, -4); b.light(-3, -9); b.light(3, -9); b.light(4.5, -14.5);

      b.hint('A laser emitter. The receiver on the far wall opens the door when the beam reaches it.');
      b.hint('Press E on a mirror to turn it clockwise, Q to turn it the other way. In VR, pull the trigger or grab and twist.', [-1, -4, 4, 0]);
      b.hint('The angle in equals the angle out. Turn each mirror 45 degrees to bend the beam around a corner.', [-6, -11, 0, -6]);
    },
  },

  // ===================================================================== 5
  {
    id: 5,
    name: 'The Split Path',
    difficulty: 'Medium to hard',
    blurb: 'Three beams. Two are friends.',
    bounds: [-8.2, -18.2, 8.2, 4.2],
    height: 5,
    start: { x: 0, z: 2.6, yaw: 0 },
    build(b) {
      b.wallX(4, -8, 8);
      b.wallZ(-8, -14, 4);
      b.wallZ(8, -14, 4);
      b.wallX(-14, -8, 8, { gaps: [[-1, 1]] });
      b.wallZ(-2, -12, -8);

      b.emitter({ id: 'E1', x: -7.5, z: -4, dir: 'E' });
      b.emitter({ id: 'E2', x: 7.5, z: -10, dir: 'W' });
      b.emitter({ id: 'E3', x: 3, z: 3.5, dir: 'N' });
      b.receiver({ id: 'R1', x: -6, z: -13.62, facing: 'S' });
      b.receiver({ id: 'R2', x: 6, z: -13.62, facing: 'S' });
      b.receiver({ id: 'RL', x: 3, z: -13.62, facing: 'S', lock: true });
      b.mirror({ id: 'M2', x: 0, z: -10, step: 4 });
      b.mirror({ id: 'M3', x: 0, z: -6, step: 0 });
      b.mirror({ id: 'M4', x: -6, z: -6, step: 0 });
      b.mirror({ id: 'PM1', x: -4, z: 1, step: 0, portable: true });
      b.socket({ x: -4, z: 1 });
      b.socket({ x: 6, z: -4 });
      b.socket({ x: -3, z: -4 });
      b.socket({ x: 3, z: -7 });
      b.cube(-5.5, 2.2, 0, 1, 'C1');
      b.door({ id: 'D1', x: 0, z: -14, axis: 'x', width: 2, requires: ['R1', 'R2', '!RL'] });
      b.wallZ(-1, -18, -14);
      b.wallZ(1, -18, -14);
      b.wallX(-18, -1, 1);
      b.exit({ x: 0, z: -16.5 });

      b.light(0, 1); b.light(-4, -3); b.light(4, -3); b.light(-4, -10); b.light(4, -10); b.light(0, -16.5);

      b.hint('This door needs two receivers lit, and one receiver dark. The red-ringed receiver is a lock.');
      b.hint('Portable mirrors can be carried. Set one down near a floor socket and it clicks into place.', [-6, -1, -2, 3]);
      b.hint('Solid objects stop a beam.', [1, -2, 5, 2]);
    },
  },

  // ===================================================================== 6
  {
    id: 6,
    name: 'Two of You',
    difficulty: 'Hard',
    blurb: 'One of you holds the switch. The other bends the light.',
    bounds: [-8.2, -28.2, 8.2, 4.2],
    height: 5,
    start: { x: 5, z: 2.6, yaw: 0 },
    build(b) {
      // Chamber A
      b.wallX(4, -8, 8);
      b.wallZ(-8, -10, 4);
      b.wallZ(8, -10, 4);
      b.wallX(-3, -8, 8, { gaps: [[-1.6, -0.4]] });
      b.wallX(-10, -8, 8, { gaps: [[5, 7]] });
      b.pod({ x: -6.5, z: 2.5, yaw: -90 });
      b.plate({ id: 'P1', x: -1, z: -1.85, w: 1.8, d: 1.8 });
      b.emitter({ id: 'E1', x: -7.5, z: -6, dir: 'E', power: ['P1'] });
      b.mirror({ id: 'M1', x: 3.5, z: -6, step: 0 });
      b.mirror({ id: 'M2', x: 3.5, z: -8.5, step: 0 });
      b.receiver({ id: 'R1', x: -7.62, z: -8.5, facing: 'E' });
      b.door({ id: 'D1', x: 6, z: -10, axis: 'x', width: 2, requires: ['R1'], latch: true });

      // Chamber B
      b.wallZ(-8, -24, -10);
      b.wallZ(8, -24, -10);
      b.wallX(-24, -8, 8, { gaps: [[5, 7]] });
      b.pod({ x: -6.5, z: -11.5, yaw: -90 });
      b.emitter({ id: 'E2', x: -7.5, z: -17.55, dir: 'E' });
      b.receiver({ id: 'R2', x: 7.62, z: -17.55, facing: 'W' });
      b.barrier(-1.2, -18.3, 1.2, -18.0, 0.9);
      b.barrier(-1.2, -18.0, -0.9, -17.1, 0.6);
      b.barrier(0.9, -18.0, 1.2, -17.1, 0.6);
      b.plate({ id: 'P2', x: 0, z: -17.55, w: 1.8, d: 0.9 });
      b.mirror({ id: 'M3', x: -4, z: -17.55, step: 4 });
      b.mirror({ id: 'M4', x: -4, z: -21, step: 0 });
      b.mirror({ id: 'M5', x: 4, z: -21, step: 0 });
      b.mirror({ id: 'M6', x: 4, z: -17.55, step: 4 });
      b.door({ id: 'D2', x: 6, z: -24, axis: 'x', width: 2, requires: ['P2', 'R2'] });
      b.wallZ(5, -28, -24);
      b.wallZ(7, -28, -24);
      b.wallX(-28, 5, 7);
      b.exit({ x: 6, z: -26.5 });

      b.light(-4, 1); b.light(4, 1); b.light(-3, -6.5); b.light(3, -6.5);
      b.light(-4, -14); b.light(4, -14); b.light(-4, -20); b.light(4, -20); b.light(6, -26.5);

      b.hint('This emitter only fires while the plate is pressed. Someone has to stand there.');
      b.hint('Through the doorway: if your clone can see you working, it will come to you.', [-3, -5.5, 1, -3.2]);
      b.hint('Your clone is solid. It blocks lasers too.', [-4, -16, 4, -12]);
    },
  },

  // ===================================================================== Countdown
  {
    id: 0,
    name: 'Countdown',
    difficulty: 'Hard',
    blurb: 'Some switches only hold for a few seconds. Plan the run before you press.',
    bounds: [-8.2, -20.2, 8.2, 4.2],
    height: 5,
    start: { x: 0, z: 2.6, yaw: 0 },
    build(b) {
      b.wallX(4, -8, 8);
      b.wallZ(-8, -16, 4);
      b.wallZ(8, -16, 4);
      b.wallX(-16, -8, 8, { gaps: [[4, 6]] });
      // Timed switch, high on the west wall: needs something to stand on.
      b.button({ id: 'B1', x: -7.75, y: 3.4, z: -2, facing: 'E', mode: 'timed', duration: 12 });
      b.cube(3, 0, 0, 1, 'C1');
      // Beam that must reach the east wall
      b.emitter({ id: 'E1', x: 7.5, z: -4, dir: 'W' });
      b.mirror({ id: 'M1', x: -4, z: -4, step: 0 });
      b.mirror({ id: 'M2', x: -4, z: -10, step: 4 });
      b.receiver({ id: 'R1', x: 7.62, z: -10, facing: 'W' });
      b.pillar(0.5, -8, 1.5, -6);
      b.door({ id: 'D1', x: 5, z: -16, axis: 'x', width: 2, requires: ['B1', 'R1'] });
      b.wallZ(4, -20, -16);
      b.wallZ(6, -20, -16);
      b.wallX(-20, 4, 6);
      b.exit({ x: 5, z: -18.5 });

      b.light(-4, 1); b.light(4, 1); b.light(-4, -6); b.light(4, -6); b.light(-4, -12); b.light(4, -12); b.light(5, -18.5);

      b.hint('A timed switch stays on for only a few seconds. Get everything else ready first.');
      b.hint('Point the beam at the receiver on the east wall before you go for the switch.', [-6, -12, -2, -2]);
      b.hint('The switch is out of reach. You know what to do about that.', [-8, -4, -4, 0]);
    },
  },

  // ===================================================================== Stand-In
  {
    id: 0,
    name: 'Stand-In',
    difficulty: 'Hard',
    blurb: 'One crate, two jobs. Your copy can take the other one.',
    bounds: [-8.2, -18.2, 8.2, 4.2],
    height: 5,
    start: { x: 3, z: 2.6, yaw: 0 },
    build(b) {
      b.wallX(4, -8, 8);
      b.wallZ(-8, -14, 4);
      b.wallZ(8, -14, 4);
      b.wallX(-14, -8, 8, { gaps: [[-1, 1]] });
      b.pod({ x: 0, z: 2.5, yaw: 0 });
      // Lock beam straight across the room, through a shallow booth.
      b.emitter({ id: 'E1', x: -7.5, z: -6.15, dir: 'E' });
      b.receiver({ id: 'RL', x: 7.62, z: -6.15, facing: 'W', lock: true });
      b.barrier(-1.2, -6.9, 1.2, -6.6, 0.9);
      b.barrier(-1.2, -6.6, -0.9, -5.7, 0.6);
      b.barrier(0.9, -6.6, 1.2, -5.7, 0.6);
      // A beam to bend with the portable mirror
      b.emitter({ id: 'E2', x: 5, z: 3.5, dir: 'N' });
      b.receiver({ id: 'R1', x: -7.62, z: -10, facing: 'E' });
      b.mirror({ id: 'PM1', x: -4, z: 1, step: 0, portable: true });
      b.socket({ x: -4, z: 1 });
      b.socket({ x: 5, z: -10 });
      b.socket({ x: 5, z: -2 });
      b.socket({ x: -3, z: -10 });
      b.plate({ id: 'P1', x: -4, z: -12 });
      b.cube(-5.5, -1, 0, 1, 'C1');
      b.door({ id: 'D1', x: 0, z: -14, axis: 'x', width: 2, requires: ['P1', 'R1', '!RL'] });
      b.wallZ(-1, -18, -14);
      b.wallZ(1, -18, -14);
      b.wallX(-18, -1, 1);
      b.exit({ x: 0, z: -16.5 });

      b.light(-4, 1); b.light(4, 1); b.light(-4, -6); b.light(4, -6); b.light(-4, -11); b.light(4, -11); b.light(0, -16.5);

      b.hint('Three demands, one crate. Remember: your clone is solid too.');
      b.hint('The lock beam runs straight through that little booth.', [-3, -9, 3, -4]);
    },
  },

  // ===================================================================== 7
  {
    id: 7,
    name: 'Build Your Way Out',
    difficulty: 'Very hard',
    blurb: 'Every tool you have. Two chambers. Mind the order.',
    bounds: [-10.2, -30.2, 10.2, 4.2],
    height: 7,
    start: { x: 6, z: 2.5, yaw: 0 },
    build(b) {
      // ---- Chamber A (floor 0, ledge 2)
      b.wallX(4, -10, 10);
      b.wallZ(-10, -12, 4);
      b.wallZ(10, -12, 4);
      b.wallX(-12, -10, 10, { gaps: [[7, 9]] });
      b.platform(-10, -12, 10, -8.5, 2.0);
      b.pod({ x: -8.5, z: 2.5, yaw: -90 });
      b.barrier(-4.2, -3.3, -1.8, -3.0, 0.9);
      b.barrier(-4.2, -3.0, -3.9, -0.8, 0.9);
      b.barrier(-2.1, -3.0, -1.8, -0.8, 0.9);
      b.plate({ id: 'P1', x: -3, z: -2.1, w: 1.8, d: 1.8 });
      b.emitter({ id: 'E1', x: -9.5, z: -10.5, y: 2, dir: 'E', power: ['P1'] });
      b.mirror({ id: 'M1', x: -4, z: -10.5, y: 2, step: 0 });
      b.platform(-4.5, -6, -3.5, -5, 2.0);
      b.platform(5.5, -6, 6.5, -5, 2.0);
      b.mirror({ id: 'M2', x: -4, z: -5.5, y: 2, step: 4 });
      b.mirror({ id: 'M3', x: 6, z: -5.5, y: 2, step: 0 });
      b.receiver({ id: 'R1', x: 6, z: -11.62, y: 2, facing: 'S' });
      b.door({ id: 'D1', x: 8, z: -12, axis: 'x', width: 2, y0: 2.0, requires: ['R1'] });
      b.cube(4, 0, 0, 1, 'C1');

      // ---- Corridor
      b.platform(7, -14, 9, -12, 2.0);
      b.wallZ(7, -14, -12);
      b.wallZ(9, -14, -12);

      // ---- Chamber B (floor 2, landing 4)
      b.platform(-10, -26, 10, -14, 2.0);
      b.wallX(-14, -10, 10, { gaps: [[7, 9]] });
      b.wallZ(-10, -26, -14);
      b.wallZ(10, -26, -14);
      b.wallX(-26, -10, 10, { gaps: [[-8, -6]] });
      b.platform(-10, -26, -4, -23, 4.0);
      b.pod({ x: 8.5, z: -19, y: 2, yaw: 0 });
      b.emitter({ id: 'E2', x: 9.5, z: -16, y: 2, dir: 'W' });
      b.pillar(-1, -17, 1, -15);
      b.mirror({ id: 'M4', x: 4, z: -16, y: 2, step: 4 });
      b.mirror({ id: 'PM2', x: 6, z: -19.5, y: 2, step: 0, portable: true });
      b.socket({ x: 4, z: -21, y: 2 });
      b.socket({ x: 0, z: -21, y: 2 });
      b.socket({ x: -4, z: -18, y: 2 });
      b.socket({ x: 6, z: -19.5, y: 2 });
      b.receiver({ id: 'R2', x: -9.62, z: -21, y: 2, facing: 'E' });
      b.emitter({ id: 'E3', x: -6, z: -14.5, y: 2, dir: 'N' });
      b.receiver({ id: 'RL', x: -6, z: -22.82, y: 2, facing: 'S', lock: true });
      b.barrier(4.7, -25.7, 5.0, -23.3, 0.9, 2);
      b.barrier(5.0, -25.7, 7.2, -25.4, 0.9, 2);
      b.barrier(5.0, -23.6, 7.2, -23.3, 0.9, 2);
      b.plate({ id: 'P2', x: 5.9, z: -24.5, y: 2, w: 1.8, d: 1.8 });
      b.cube(-3, -19, 2, 1, 'C2');
      b.cube(2, -24, 2, 1, 'C3');
      b.door({ id: 'D2', x: -7, z: -26, axis: 'x', width: 2, y0: 4.0, requires: ['P2', 'R2', '!RL'] });
      b.platform(-8, -30, -6, -26, 4.0);
      b.wallZ(-8, -30, -26);
      b.wallZ(-6, -30, -26);
      b.wallX(-30, -8, -6);
      b.exit({ x: -7, z: -28.5, y: 4.0 });

      b.light(-5, 1, 6.95); b.light(5, 1, 6.95); b.light(-5, -7, 6.95); b.light(5, -7, 6.95); b.light(0, -10.5, 6.95);
      b.light(8, -16, 6.95); b.light(-5, -17, 6.95); b.light(4, -21, 6.95); b.light(-7, -24, 6.95); b.light(-7, -28.5, 6.95);

      b.hint('Chamber A: the emitter on the ledge needs someone on the plate. The exit door needs the beam to keep shining.');
      b.hint('Mirrors on pillars can be turned from the floor.', [-6, -5, 8, -3.5]);
      b.hint('Chamber B: a lock, a portable mirror, a booth, and a landing out of reach. Plan before you lift.', [5, -16, 10, -13.8]);
    },
  },

  // ===================================================================== Elevation
  {
    id: 0,
    name: 'Elevation',
    difficulty: 'Very hard',
    blurb: 'The beam runs high. Meet it halfway.',
    bounds: [-8.2, -20.2, 8.2, 4.2],
    height: 7,
    start: { x: 0, z: 2.6, yaw: 0 },
    build(b) {
      b.wallX(4, -8, 8);
      b.wallZ(-8, -16, 4);
      b.wallZ(8, -16, 4);
      b.wallX(-16, -8, 8, { gaps: [[-5, -3]] });
      b.platform(-8, -10, -6, -6, 2.0);            // emitter ledge
      b.platform(-8, -16, 8, -13, 2.0);            // north ledge with the exit door
      b.emitter({ id: 'E1', x: -7.3, z: -8, y: 2, dir: 'E' });
      b.receiver({ id: 'R1', x: 4, z: -15.62, y: 2, facing: 'S' });
      b.mirror({ id: 'PM1', x: 0, z: -2, step: 0, portable: true });
      b.cube(2, 0, 0, 1, 'C1');
      b.cube(-2, 0, 0, 1, 'C2');
      b.slab(5, -3, 2, 1, 1, 0, 'S1');
      b.door({ id: 'D1', x: -4, z: -16, axis: 'x', width: 2, y0: 2.0, requires: ['R1'] });
      b.platform(-5, -20, -3, -16, 2.0);
      b.wallZ(-5, -20, -16);
      b.wallZ(-3, -20, -16);
      b.wallX(-20, -5, -3);
      b.exit({ x: -4, z: -18.5, y: 2.0 });

      b.light(-4, 1, 6.95); b.light(4, 1, 6.95); b.light(-4, -7, 6.95); b.light(4, -7, 6.95); b.light(0, -14.5, 6.95); b.light(-4, -18.5, 6.95);

      b.hint('That beam passes far above the floor. A mirror on the floor will never catch it.');
      b.hint('Mirrors can sit on top of crates.', [-2, -6, 6, -1]);
    },
  },

  // ===================================================================== Mirror Image
  {
    id: 0,
    name: 'Mirror Image',
    difficulty: 'Very hard',
    blurb: 'A mirror can stop a beam too. Your copy is watching the doorway.',
    bounds: [-10.2, -22.2, 10.2, 4.2],
    height: 5,
    start: { x: 4, z: 2.5, yaw: 0 },
    build(b) {
      b.wallX(4, -10, 10);
      b.wallZ(-10, -18, 4);
      b.wallZ(10, -18, 4);
      b.wallX(-6, -10, 10, { gaps: [[-0.6, 0.6]] });
      b.wallX(-18, -10, 10, { gaps: [[-9.5, -7.5]] });
      b.pod({ x: -8, z: 2.5, yaw: -90 });
      b.plate({ id: 'P1', x: 0, z: -4.85, w: 1.8, d: 1.8 });
      b.emitter({ id: 'E1', x: 9.5, z: -10, dir: 'W', power: ['P1'] });
      b.mirror({ id: 'M1', x: -6, z: -10, step: 0 });
      b.receiver({ id: 'R1', x: -6, z: -17.62, facing: 'S' });
      b.emitter({ id: 'E2', x: -9.5, z: -13, dir: 'E' });
      b.receiver({ id: 'RL', x: 9.62, z: -13, facing: 'W', lock: true });
      b.platform(6, -18, 10, -15, 2.0);
      b.plate({ id: 'P2', x: 7.2, z: -16.5, y: 2.0, w: 1.6, d: 1.6 });
      b.mirror({ id: 'PM1', x: 3, z: -8, step: 4, portable: true });
      b.socket({ x: -3, z: -13 });
      b.socket({ x: 3, z: -8 });
      b.socket({ x: 2, z: -11 });
      b.cube(2, -11.8, 0, 1, 'C1');
      b.door({ id: 'D1', x: -8.5, z: -18, axis: 'x', width: 2, requires: ['R1', 'P2', '!RL'] });
      b.wallZ(-9.5, -22, -18);
      b.wallZ(-7.5, -22, -18);
      b.wallX(-22, -9.5, -7.5);
      b.exit({ x: -8.5, z: -20.2 });

      b.light(-6, 0); b.light(6, 0); b.light(-6, -10); b.light(6, -10); b.light(-5, -15); b.light(5, -15); b.light(-8.5, -20.2);

      b.hint('One crate and a shelf plate. The lock will need something else.');
      b.hint('Whatever your clone can see through that doorway, it will walk toward.', [-3, -9, 3, -6.5]);
    },
  },

  // ===================================================================== 8
  {
    id: 8,
    name: 'The Final Experiment',
    difficulty: 'Extremely hard',
    blurb: 'Four chambers. Everything you have learned, in the right order.',
    bounds: [-12.2, -72.2, 12.2, 4.2],
    height: 7,
    ceilingHoles: [[-3, -71.4, -1, -69.0]],
    start: { x: 0, z: 2.5, yaw: 0 },
    build(b) {
      // ============ Chamber 1: Recall (clone through a narrow doorway + crate on a shelf)
      b.wallX(4, -12, 12);
      b.wallZ(-12, -30, 4);
      b.wallZ(12, -48, 4);
      b.wallX(-6, -12, 12, { gaps: [[2.4, 3.6]] });
      b.wallX(-14, -12, 12, { gaps: [[-9, -7]] });
      b.pod({ x: -10.5, z: 2.5, yaw: -90 });
      b.plate({ id: 'P1', x: 3, z: -4.85, w: 1.8, d: 1.8 });
      b.platform(6, -14, 12, -10, 2.0);
      b.plate({ id: 'P2', x: 7.2, z: -11.0, y: 2.0, w: 1.6, d: 1.6 });
      b.cube(-6, -9, 0, 1, 'C1');
      b.door({ id: 'D1', x: -8, z: -14, axis: 'x', width: 2, requires: ['P1', 'P2'] });

      // ============ Chamber 2: Prism hall (two emitters, a lock, a portable mirror, a ledge)
      b.wallX(-30, -12, 12, { gaps: [[-5, -3]] });
      b.platform(-12, -30, -8, -22, 2.0);
      b.emitter({ id: 'E1', x: -11.5, z: -17, dir: 'E' });
      b.mirror({ id: 'Ma', x: 4, z: -17, step: 4 });
      b.mirror({ id: 'Mc', x: 9, z: -21, step: 0 });
      b.mirror({ id: 'PM1', x: -6, z: -18.5, step: 0, portable: true });
      b.socket({ x: 4, z: -21 });
      b.socket({ x: -4, z: -21 });
      b.socket({ x: 0, z: -23 });
      b.socket({ x: 8, z: -26 });
      b.receiver({ id: 'R1', x: 9, z: -29.62, facing: 'S' });
      b.emitter({ id: 'E3', x: -11.5, z: -28, y: 2, dir: 'E' });
      b.mirror({ id: 'Md', x: -9, z: -28, y: 2, step: 0 });
      b.receiver({ id: 'R2', x: -9, z: -29.62, y: 2, facing: 'S' });
      b.emitter({ id: 'E2', x: 0, z: -14.5, dir: 'N' });
      b.receiver({ id: 'RL', x: 0, z: -29.62, facing: 'S', lock: true });
      b.cube(6, -16, 0, 1, 'C2');
      b.door({ id: 'D2', x: -4, z: -30, axis: 'x', width: 2, requires: ['R1', 'R2', '!RL'], latch: true });

      // ============ Chamber 3: Tower (booth, clone-powered emitter, a staircase to 3 m)
      b.wallZ(-12, -48, -30);
      b.platform(-12, -48, 12, -44, 3.0);
      b.wallX(-48, -12, 12, { gaps: [[8, 10]] });
      b.pod({ x: -8, z: -31, yaw: 0 });
      b.barrier(-9.2, -34.6, -6.8, -34.3, 0.9);
      b.barrier(-9.2, -34.3, -8.9, -32.2, 0.9);
      b.barrier(-7.1, -34.3, -6.8, -32.2, 0.9);
      b.plate({ id: 'P3', x: -8, z: -33.3, w: 1.8, d: 1.8 });
      b.emitter({ id: 'E4', x: -11.5, z: -46, y: 3, dir: 'E', power: ['P3'] });
      b.mirror({ id: 'Me', x: 6, z: -46, y: 3, step: 0 });
      b.receiver({ id: 'R3', x: 6, z: -30.38, y: 3, facing: 'N' });
      b.slab(-2, -40, 2, 1, 1, 0, 'S3');
      b.cube(5, -41, 0, 1, 'C3');
      b.door({ id: 'D3', x: 9, z: -48, axis: 'x', width: 2, y0: 3.0, requires: ['R3'] });

      // ============ Stair corridor down to chamber 4
      b.platform(8, -50, 10, -48, 3.0);
      for (let i = 0; i < 9; i++) {
        const z1 = -50 - 0.4 * i, z0 = z1 - 0.4;
        b.platform(8, z0, 10, z1, 3.0 - 0.3 * (i + 1));
      }
      b.wallZ(8, -54, -48, { y0: 0 });
      b.wallZ(10, -54, -48, { y0: 0 });

      // ============ Chamber 4: Convergence (all at once)
      b.wallX(-54, -12, 12, { gaps: [[8, 10]] });
      b.wallZ(-12, -68, -54);
      b.wallZ(12, -68, -54);
      b.wallZ(0, -68, -54, { gaps: [[-61.6, -60.4]] });
      b.wallX(-68, -12, 12, { gaps: [[-3, -1]] });
      b.pod({ x: 8, z: -61, yaw: 90 });
      b.plate({ id: 'P4', x: 1.15, z: -61, w: 1.8, d: 1.8 });
      b.platform(-12, -68, -8, -62, 2.0);
      b.emitter({ id: 'E5', x: -11.5, z: -67, y: 2, dir: 'E' });
      b.platform(-4.5, -67.5, -3.5, -66.5, 2.0);
      b.socket({ x: -4, z: -67, y: 2 });
      b.socket({ x: -9, z: -63, y: 2 });
      b.mirror({ id: 'PM2', x: -6, z: -57, step: 0, portable: true });
      b.receiver({ id: 'R4', x: -4, z: -54.38, y: 2, facing: 'N' });
      b.emitter({ id: 'E6', x: -11.5, z: -60, dir: 'E' });
      b.receiver({ id: 'RL2', x: -0.38, z: -60, facing: 'W', lock: true });
      b.button({ id: 'B4', x: -11.75, y: 3.3, z: -58, facing: 'E', mode: 'toggle' });
      b.cube(-6, -64, 0, 1, 'C4');
      b.cube(-3, -58, 0, 1, 'C5');
      b.door({ id: 'D4', x: -2, z: -68, axis: 'x', width: 2, requires: ['P4', 'R4', '!RL2', 'B4'] });

      // ============ The lift
      b.wallZ(-4, -72, -68);
      b.wallZ(0, -72, -68);
      b.wallX(-72, -4, 0);
      b.exit({ x: -2, z: -70.2, w: 1.9, d: 1.9, final: true });

      // Lights
      b.light(-6, 0, 6.95); b.light(6, 0, 6.95); b.light(-6, -10, 6.95); b.light(6, -10, 6.95);
      b.light(-8, -18, 6.95); b.light(4, -18, 6.95); b.light(-8, -26, 6.95); b.light(6, -26, 6.95);
      b.light(-7, -35, 6.95); b.light(4, -35, 6.95); b.light(-4, -42, 6.95); b.light(6, -42, 6.95);
      b.light(9, -51, 6.95); b.light(6, -58, 6.95); b.light(6, -65, 6.95); b.light(-6, -58, 6.95); b.light(-6, -65, 6.95);

      b.hint('The final experiment. Four chambers stand between you and the surface. Nothing here is new. Everything here matters.');
      b.hint('Two plates, one door. One of them is up on the shelf.', [-12, -14, 12, -6.5]);
      b.hint('Two beams to light, one lock to darken. The lock opens permanently once all three agree.', [-12, -22, 0, -14.2]);
      b.hint('The tower: a booth for your copy, a beam that needs it, and a ledge three metres up.', [-12, -36, 0, -30.2]);
      b.hint('The last door wants everything at once: your copy, a beam, a dark lock and the switch on the wall.', [2, -60, 12, -54.2]);
    },
  },
];

// Chamber numbers follow the order above.
export const LEVELS = RAW_LEVELS.map((lv, i) => ({ ...lv, id: i + 1 }));
