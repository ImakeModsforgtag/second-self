// The clone: a stylised person built from simple shapes. Navy wave-print tee,
// olive shorts, white sneakers with a blue stripe, a face with eyes, nose and
// mouth. Faces -z. Feet at y = 0, height about 1.75 m.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { shirtTexture } from './textures.js';

function capsule(r, len, mat) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class CloneModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'clone';
    this.body = new THREE.Group();
    this.root.add(this.body);

    const M = (color, rough = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
    this.mats = {
      skin: M(0xd6a07c, 0.6),
      hair: M(0x3a2a1f, 0.8),
      shirt: M(0xffffff, 0.85, { map: shirtTexture() }),
      sleeve: M(0x1f2a44, 0.85),
      shorts: M(0x6f6a4c, 0.85),
      shoe: M(0xeef0f2, 0.5),
      sole: M(0x55585c, 0.8),
      stripe: M(0x3d8bff, 0.5),
      sock: M(0xf4f4f4, 0.9),
      eyeW: M(0xf7f7f5, 0.3),
      iris: M(0x3d6e8f, 0.3),
      pupil: M(0x101012, 0.2),
      brow: M(0x2e2118, 0.8),
      lip: M(0xa45a4e, 0.6),
    };
    this.allMats = Object.values(this.mats);
    const mats = this.mats;

    // ---------------- Torso
    const hips = new THREE.Group();
    hips.position.y = 0.88;
    this.body.add(hips);
    this.hips = hips;

    const shorts = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.16, 0.22, 3, 0.05), mats.shorts);
    shorts.position.y = 0.02;
    shorts.castShadow = true;
    hips.add(shorts);

    const chest = new THREE.Group();
    chest.position.y = 0.06;
    hips.add(chest);
    this.chest = chest;
    const torsoGeo = new THREE.CylinderGeometry(0.185, 0.16, 0.5, 20, 1, false);
    const torso = new THREE.Mesh(torsoGeo, mats.shirt);
    torso.scale.z = 0.62;
    torso.position.y = 0.25;
    torso.castShadow = true;
    chest.add(torso);
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.185, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.sleeve);
    shoulders.scale.set(1.02, 0.5, 0.64);
    shoulders.position.y = 0.5;
    chest.add(shoulders);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10), mats.skin);
    neck.position.y = 0.56;
    chest.add(neck);

    // ---------------- Head
    const head = new THREE.Group();
    head.position.y = 0.66;
    chest.add(head);
    this.head = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), mats.skin);
    skull.scale.set(0.95, 1.12, 1.0);
    skull.position.y = 0.06;
    skull.castShadow = true;
    head.add(skull);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), mats.skin);
    jaw.scale.set(1, 0.8, 1);
    jaw.position.set(0, 0.0, -0.015);
    head.add(jaw);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.112, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.hair);
    hair.scale.set(0.97, 1.08, 1.04);
    hair.position.set(0, 0.075, 0.008);
    hair.rotation.x = 0.18;
    head.add(hair);
    const fringe = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.035, 0.05, 2, 0.015), mats.hair);
    fringe.position.set(0.01, 0.15, -0.083);
    fringe.rotation.set(-0.3, 0, -0.12);
    head.add(fringe);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), mats.skin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(0.1 * s, 0.055, 0.005);
      head.add(ear);
      // Eyes: white, iris, pupil
      const eye = new THREE.Group();
      eye.position.set(0.037 * s, 0.072, -0.088);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), mats.eyeW);
      white.scale.set(1.15, 0.9, 0.6);
      eye.add(white);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 10, 8), mats.iris);
      iris.position.z = -0.0085;
      iris.scale.z = 0.5;
      eye.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 8, 6), mats.pupil);
      pupil.position.z = -0.012;
      pupil.scale.z = 0.4;
      eye.add(pupil);
      head.add(eye);
      const brow = new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.008, 0.01, 1, 0.003), mats.brow);
      brow.position.set(0.038 * s, 0.1, -0.094);
      brow.rotation.z = -0.12 * s;
      head.add(brow);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 8), mats.skin);
    nose.rotation.x = -Math.PI / 2 - 0.25;
    nose.position.set(0, 0.04, -0.105);
    head.add(nose);
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 8, 6), mats.skin);
    noseTip.position.set(0, 0.03, -0.118);
    head.add(noseTip);
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0045, 6, 14, Math.PI), mats.lip);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, 0.0, -0.094);
    mouth.scale.set(1, 0.55, 1);
    head.add(mouth);

    // ---------------- Arms
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.215 * s, 0.47, 0);
      chest.add(shoulder);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.17, 12), mats.sleeve);
      sleeve.position.y = -0.07;
      sleeve.castShadow = true;
      shoulder.add(sleeve);
      const upper = capsule(0.042, 0.29, mats.skin);
      upper.position.y = 0.0;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      shoulder.add(elbow);
      elbow.add(capsule(0.037, 0.25, mats.skin));
      const hand = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.09, 0.03, 2, 0.013), mats.skin);
      hand.position.y = -0.29;
      hand.castShadow = true;
      elbow.add(hand);
      shoulder.rotation.z = 0.08 * s;
      this.arms.push({ shoulder, elbow, s });
    }

    // ---------------- Legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.09 * s, -0.04, 0);
      hips.add(hip);
      const short = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.078, 0.28, 12), mats.shorts);
      short.position.y = -0.12;
      short.castShadow = true;
      hip.add(short);
      hip.add(capsule(0.06, 0.42, mats.skin));
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);
      knee.add(capsule(0.05, 0.38, mats.skin));
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.043, 0.08, 10), mats.sock);
      sock.position.y = -0.36;
      knee.add(sock);
      const foot = new THREE.Group();
      foot.position.y = -0.4;
      knee.add(foot);
      const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.075, 0.25, 2, 0.03), mats.shoe);
      shoe.position.set(0, -0.02, -0.04);
      shoe.castShadow = true;
      foot.add(shoe);
      const sole = new THREE.Mesh(new RoundedBoxGeometry(0.104, 0.02, 0.254, 1, 0.008), mats.sole);
      sole.position.set(0, -0.055, -0.04);
      foot.add(sole);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.106, 0.014, 0.12), mats.stripe);
      stripe.position.set(0, -0.012, -0.03);
      stripe.rotation.x = 0.25;
      foot.add(stripe);
      this.legs.push({ hip, knee, foot, s });
    }

    // Ground ring: blue while it can see you, pale while frozen.
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0.5, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.39, 40), this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    this.root.add(ring);
    this.ring = ring;

    // Spawn scan ring
    this.scanMat = new THREE.MeshBasicMaterial({ color: 0x7fb8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.scan = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 32, 1, true), this.scanMat);
    this.root.add(this.scan);

    this.phase = 0;
    this.headYaw = 0;
    this.breath = Math.random() * 10;
    this.appear = 0;   // 0..1
    this.leaving = false;
    this.done = false;
    this.setGlow(1);
  }

  setGlow(v) {
    for (const m of this.allMats) {
      m.emissive = m.emissive || new THREE.Color();
      m.emissive.setRGB(0.25 * v, 0.5 * v, 1.0 * v);
      m.emissiveIntensity = v > 0 ? 1.6 : 0;
    }
  }

  /** state: { x,y,z,yaw, speed, walkPhase, state, sees, spawnT, headTarget } */
  update(dt, s) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    this.breath += dt;

    if (this.leaving) {
      this.appear = Math.max(0, this.appear - dt * 2.2);
      const a = this.appear;
      this.body.scale.set(1, Math.max(0.02, a), 1);
      this.setGlow(1 - a + 0.3);
      this.scanMat.opacity = a * 0.9;
      this.scan.position.y = a * 1.75;
      if (a <= 0) this.done = true;
      return;
    }

    if (s.state === 'spawning') {
      this.appear = Math.min(1, s.spawnT / 1.0);
      const a = this.appear;
      this.body.scale.set(1, Math.max(0.02, a), 1);
      this.scan.position.y = a * 1.78;
      this.scanMat.opacity = (1 - a) * 0.9 + 0.1;
      this.setGlow(1 - a * 0.85);
    } else if (this.appear < 1.5) {
      this.appear = Math.min(1.5, Math.max(1, this.appear) + dt);
      this.body.scale.set(1, 1, 1);
      this.scanMat.opacity = Math.max(0, 0.6 - (this.appear - 1) * 2);
      this.setGlow(Math.max(0, 0.15 - (this.appear - 1) * 0.4));
    }

    // Walk cycle driven by distance actually travelled.
    const walking = s.speed > 0.05;
    const target = walking ? 1 : 0;
    this.walkBlend = (this.walkBlend || 0) + (target - (this.walkBlend || 0)) * Math.min(1, dt * 8);
    const wb = this.walkBlend;
    const ph = s.walkPhase;
    const sw = Math.sin(ph) * 0.55 * wb;
    for (const leg of this.legs) {
      const dir = leg.s;
      leg.hip.rotation.x = sw * dir;
      leg.knee.rotation.x = Math.max(0, Math.sin(ph + (dir > 0 ? 0 : Math.PI) + 0.6)) * 0.8 * wb;
      leg.foot.rotation.x = -leg.hip.rotation.x * 0.3;
    }
    const pushing = s.state === 'blocked';
    for (const arm of this.arms) {
      const swing = -sw * arm.s * 0.8;
      const reach = pushing ? -1.2 : 0;
      arm.shoulder.rotation.x += ((swing + reach) - arm.shoulder.rotation.x) * Math.min(1, dt * 10);
      arm.elbow.rotation.x = (pushing ? -0.2 : -0.25 - Math.abs(sw) * 0.3);
    }
    this.body.position.y = Math.abs(Math.cos(ph)) * 0.025 * wb + Math.sin(this.breath * 1.7) * 0.003;
    this.chest.rotation.y = sw * 0.12;
    this.chest.rotation.x = Math.sin(this.breath * 1.7) * 0.01 + (walking ? 0.04 : 0);

    // Head looks toward you while it sees you; holds still when frozen.
    const ht = s.sees ? Math.max(-0.6, Math.min(0.6, s.headTarget || 0)) : this.headYaw;
    this.headYaw += (ht - this.headYaw) * Math.min(1, dt * 6);
    this.head.rotation.y = this.headYaw;

    // Ground ring
    const seen = s.sees ? 1 : 0;
    this.ringMat.color.setRGB(0.35 + 0.6 * (1 - seen), 0.62 + 0.36 * (1 - seen), 1);
    this.ringMat.opacity = s.sees ? 0.75 : 0.28;
  }

  leave() { this.leaving = true; this.appear = Math.min(this.appear, 1); }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.allMats) m.dispose();
    this.ringMat.dispose(); this.scanMat.dispose();
  }
}
