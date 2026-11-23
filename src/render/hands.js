// Procedural first-person hands. Each hand is a palm, four three-joint fingers
// and a two-joint thumb, with a shirt cuff. Poses blend smoothly:
//   curl  0 = open, 1 = fist      point 0..1 keeps the index finger straight
//   spread 0..1 fans the fingers (used for the clone gesture)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const SKIN = 0xd6a07c;
const CUFF = 0x1f2a44;

const FINGERS = [
  // x offset, length scale, base z
  { x: -0.029, len: 1.0, z: -0.050 },   // index (thumb side)
  { x: -0.0095, len: 1.08, z: -0.053 }, // middle
  { x: 0.0095, len: 1.0, z: -0.051 },   // ring
  { x: 0.028, len: 0.8, z: -0.046 },    // pinky
];
const SEG = [0.046, 0.029, 0.024];

function segMesh(len, r, mat) {
  // Slightly longer than the bone so neighbouring segments blend into each other.
  const g = new THREE.CapsuleGeometry(r, len - r * 0.6, 3, 10);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -len / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = false;
  return m;
}

export class Hand {
  constructor(side = 'right', { cuffColor = CUFF } = {}) {
    this.side = side;
    const s = side === 'left' ? -1 : 1;
    this.root = new THREE.Group();
    this.root.name = side + '-hand';
    this.skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.62, metalness: 0 });
    this.cuffMat = new THREE.MeshStandardMaterial({ color: cuffColor, roughness: 0.85 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

    // Palm
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.088, 0.034, 0.1, 3, 0.014), this.skin);
    palm.position.set(0, 0, -0.002);
    this.root.add(palm);
    // Back-of-hand bulge
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), this.skin);
    back.scale.set(0.95, 0.32, 1.05);
    back.position.set(0, 0.008, 0.0);
    this.root.add(back);
    // Wrist + cuff
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.07, 12), this.skin);
    wrist.rotation.x = Math.PI / 2; wrist.scale.set(1.15, 1, 0.75);
    wrist.position.set(0, 0.0, 0.075);
    this.root.add(wrist);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.16, 14), this.cuffMat);
    cuff.rotation.x = Math.PI / 2; cuff.scale.set(1.1, 1, 0.85);
    cuff.position.set(0, 0.002, 0.18);
    this.root.add(cuff);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.006, 6, 20), this.glowMat);
    ring.position.set(0, 0.002, 0.105); ring.scale.set(1.1, 0.85, 1);
    this.root.add(ring);

    // Fingers
    this.fingers = [];
    for (let i = 0; i < 4; i++) {
      const f = FINGERS[i];
      const joints = [];
      let parent = this.root;
      for (let j = 0; j < 3; j++) {
        const pivot = new THREE.Group();
        if (j === 0) pivot.position.set(f.x * s, -0.001, f.z);
        else pivot.position.set(0, 0, -SEG[j - 1] * f.len);
        const r = 0.0106 - j * 0.0011 - (i === 3 ? 0.0012 : 0);
        pivot.add(segMesh(SEG[j] * f.len, r, this.skin));
        parent.add(pivot);
        joints.push(pivot);
        parent = pivot;
      }
      this.fingers.push(joints);
    }
    // Thumb
    this.thumb = [];
    const tb = new THREE.Group();
    tb.position.set(-0.036 * s, -0.008, -0.012);
    tb.rotation.set(0, 0.75 * s, 0.5 * s);
    this.root.add(tb);
    const t0 = new THREE.Group();
    t0.add(segMesh(0.04, 0.0115, this.skin));
    tb.add(t0);
    const t1 = new THREE.Group();
    t1.position.set(0, 0, -0.04);
    t1.add(segMesh(0.032, 0.0102, this.skin));
    t0.add(t1);
    this.thumbBase = tb;
    this.thumb = [t0, t1];

    this.pose = { curl: 0.15, point: 0, spread: 0, thumb: 0.1 };
    this.target = { ...this.pose };
    this.glow = 0;
    this.apply();
  }

  setTarget(p) { Object.assign(this.target, p); }

  update(dt) {
    const k = 1 - Math.exp(-dt * 16);
    for (const key of Object.keys(this.target)) this.pose[key] += (this.target[key] - this.pose[key]) * k;
    this.glow = Math.max(0, this.glow - dt * 1.2);
    this.glowMat.opacity = Math.min(1, this.glow);
    this.apply();
  }

  apply() {
    const s = this.side === 'left' ? -1 : 1;
    const { curl, point, spread, thumb } = this.pose;
    for (let i = 0; i < 4; i++) {
      const c = i === 0 ? curl * (1 - point) : curl;
      const j = this.fingers[i];
      j[0].rotation.x = -c * 1.45 - 0.06;
      j[1].rotation.x = -c * 1.6 - 0.05;
      j[2].rotation.x = -c * 1.1 - 0.04;
      j[0].rotation.y = ((i - 1.5) * 0.09 + (i - 1.5) * spread * 0.18) * -s;
    }
    this.thumb[0].rotation.x = -thumb * 0.7;
    this.thumb[1].rotation.x = -thumb * 0.9;
    this.thumbBase.rotation.y = (0.75 - thumb * 0.45) * s;
  }

  flash() { this.glow = 1.4; }
}
