// Shared tuning constants. Changing these changes how puzzles feel, so the
// level designs and the automated playthrough test are built around them.

export const PHYS = {
  gravity: 19.0,          // m/s^2 (slightly stronger than real life for snappy jumps)
  maxFall: 30,
  eps: 1e-4,
};

export const PLAYER = {
  radius: 0.26,           // half width of the player collision box
  height: 1.7,
  eye: 1.6,
  walkSpeed: 3.4,
  slowSpeed: 1.5,         // hold Shift (desktop) for careful clone guiding
  jumpSpeed: 6.6,         // apex ~1.15 m: enough to climb a 1 m crate, not a 2 m ledge
  step: 0.32,
  reach: 2.4,             // interaction reach from the eye
  holdDistance: 1.55,
};

export const CLONE = {
  radius: 0.25,
  height: 1.75,
  eye: 1.62,
  speed: 1.75,
  turnRate: Math.PI * 0.62,   // rad/s (about 110 degrees per second)
  fov: (55 * Math.PI) / 180,  // half angle: the clone sees within +-55 degrees
  walkCone: (30 * Math.PI) / 180, // only walks when the player is within +-30 degrees
  viewDistance: 40,
  notice: 0.22,           // seconds of continuous sight before it reacts
  stopDistance: 1.15,     // stops this far from the player
  resumeDistance: 1.65,   // after stopping, waits until the player is this far
  resumeDelay: 0.55,      // ...and that far for this long before following again
  step: 0.32,
  spawnTime: 1.1,
};

export const LASER = {
  height: 0.75,           // beams travel this far above the surface the emitter sits on
  maxBounces: 24,
  maxLength: 120,
};

export const MIRROR_STEPS = 16; // 22.5 degree increments

export const DEFAULT_SETTINGS = {
  mouseSensitivity: 1.0,
  invertY: false,
  fov: 75,
  volume: 0.8,
  ambience: true,
  shadows: 'high',        // high | low | off
  showHints: true,
  vrMovement: 'smooth',   // smooth | teleport
  vrSnapAngle: 30,
  vrVignette: true,
  headBob: true,
};

export const DEFAULT_BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  interact: 'KeyE',
  rotateLeft: 'KeyQ',
  clone: 'KeyF',
  resetClone: 'KeyR',
  slow: 'ShiftLeft',
  pause: 'Escape',
};

export const BINDING_LABELS = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump',
  interact: 'Interact / rotate mirror right',
  rotateLeft: 'Rotate mirror / held object left',
  clone: 'Create clone',
  resetClone: 'Reset clone',
  slow: 'Walk slowly',
  pause: 'Pause',
};

// --------- Persistent storage (wrapped: storage can be unavailable) ---------
const KEY = 'secondself.v1';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
        bindings: { ...DEFAULT_BINDINGS, ...(s.bindings || {}) },
        unlocked: Math.max(1, s.unlocked || 1),
        completed: s.completed || {},
      };
    }
  } catch (e) { /* ignore */ }
  return { settings: { ...DEFAULT_SETTINGS }, bindings: { ...DEFAULT_BINDINGS }, unlocked: 1, completed: {} };
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}
