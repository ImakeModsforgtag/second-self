// The Kickback gun: a chunky white-and-blue pulse device. Points along -z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export class GunModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'kickback-gun';
    const white = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.35, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.5, metalness: 0.4 });
    this.glow = new THREE.MeshBasicMaterial({ color: 0x5aa2ff });
    this.pipOn = new THREE.MeshBasicMaterial({ color: 0x8cc4ff });
    this.pipOff = new THREE.MeshBasicMaterial({ color: 0x2a2f38 });
    this.kick = new THREE.Group();
    this.root.add(this.kick);
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.085, 0.24, 3, 0.02), white);
    body.position.set(0, 0.0, -0.02);
    this.kick.add(body);
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.03, 0.15, 2, 0.01), dark);
    top.position.set(0, 0.055, -0.01);
    this.kick.add(top);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.12, 20), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.004, -0.18);
    this.kick.add(barrel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.008, 8, 24), this.glow);
    ring.position.set(0, 0.004, -0.24);
    this.kick.add(ring);
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.11, 0.05, 2, 0.015), dark);
    handle.position.set(0, -0.08, 0.05); handle.rotation.x = 0.25;
    this.kick.add(handle);
    this.pips = [];
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), this.pipOn);
      p.position.set(-0.012 + i * 0.024, 0.074, 0.03);
      this.kick.add(p);
      this.pips.push(p);
    }
    this.recoil = 0;
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.004, -0.26);
    this.kick.add(this.muzzle);
    this.root.traverse((o) => { o.castShadow = false; });
  }

  fire() { this.recoil = 1; }

  update(dt, charges) {
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const r = this.recoil;
    this.kick.position.set(0, r * 0.02, r * 0.06);
    this.kick.rotation.x = r * 0.35;
    this.pips.forEach((p, i) => { p.material = i < charges ? this.pipOn : this.pipOff; });
    this.glow.color.setHex(charges > 0 ? 0x5aa2ff : 0x3a4250);
  }

  muzzleWorld() { const v = new THREE.Vector3(); this.muzzle.getWorldPosition(v); return v; }
}
