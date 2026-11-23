// Lightweight GPU particle pools: smoke, fire, sparks, splashes, muzzle flashes,
// tire smoke, plus transient point lights for explosions.
import * as THREE from 'three';
import { R } from './util.js';

const vert = `
attribute float aSize; attribute vec4 aColor;
varying vec4 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (600.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const frag = `
varying vec4 vColor;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  if (a <= 0.001) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

class Pool {
  constructor(scene, n, additive) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n); this.base = new Float32Array(n * 4); this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a, grav = 0) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow; this.grav[i] = grav;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * t * Math.min(1, (1 - t) * 8);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new Pool(scene, 1600, false);
    this.glow = new Pool(scene, 1200, true);
    this.lights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 40, 1.6);
      scene.add(l); this.lights.push({ l, t: 0, max: 1 });
    }
  }
  flashLight(x, y, z, intensity, dur, color = 0xffaa55) {
    const s = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    s.l.position.set(x, y, z); s.l.color.set(color); s.max = intensity; s.t = dur; s.dur = dur;
  }
  tireSmoke(x, y, z, amt = 1) { this.smoke.emit(x + (R() - 0.5) * 0.3, y + 0.1, z + (R() - 0.5) * 0.3, (R() - 0.5), 0.6 + R() * 0.6, (R() - 0.5), 1.4 + R(), 0.8, 2.2 * amt, 0.85, 0.85, 0.85, 0.35 * amt); }
  dust(x, y, z) { this.smoke.emit(x, y + 0.1, z, (R() - 0.5), 0.4 + R() * 0.4, (R() - 0.5), 1.0, 0.6, 1.8, 0.6, 0.52, 0.4, 0.3); }
  engineSmoke(x, y, z, black) {
    const c = black ? 0.12 : 0.55;
    this.smoke.emit(x + (R() - 0.5) * 0.4, y, z + (R() - 0.5) * 0.4, (R() - 0.5) * 0.4, 1.4 + R(), (R() - 0.5) * 0.4, 2 + R() * 1.5, 0.6, 1.6, c, c, c, 0.5);
  }
  fire(x, y, z, s = 1) {
    this.glow.emit(x + (R() - 0.5) * 0.8 * s, y, z + (R() - 0.5) * 0.8 * s, (R() - 0.5) * 0.5, 2 + R() * 2, (R() - 0.5) * 0.5, 0.4 + R() * 0.4, 1.0 * s, -0.8, 1.0, 0.45 + R() * 0.2, 0.1, 0.9);
    if (R() < 0.4) this.engineSmoke(x, y + 1, z, true);
  }
  sparks(x, y, z, n = 10, nx = 0, nz = 0) {
    for (let i = 0; i < n; i++) this.glow.emit(x, y, z, nx * 3 + (R() - 0.5) * 6, R() * 4, nz * 3 + (R() - 0.5) * 6, 0.25 + R() * 0.35, 0.12, 0, 1, 0.75, 0.3, 1, 12);
  }
  splash(x, y, z, n = 20) {
    for (let i = 0; i < n; i++) this.smoke.emit(x + (R() - 0.5), y, z + (R() - 0.5), (R() - 0.5) * 3, 2 + R() * 3, (R() - 0.5) * 3, 0.8 + R() * 0.4, 0.4, 0.8, 0.85, 0.92, 1.0, 0.7, 9);
  }
  muzzle(x, y, z) {
    this.glow.emit(x, y, z, 0, 0, 0, 0.06, 0.6, 0, 1, 0.85, 0.5, 1);
    this.flashLight(x, y, z, 30, 0.06, 0xffcc88);
  }
  impact(x, y, z) { for (let i = 0; i < 4; i++) this.smoke.emit(x, y, z, (R() - 0.5) * 2, R() * 2, (R() - 0.5) * 2, 0.5, 0.15, 0.6, 0.6, 0.58, 0.55, 0.6, 3); this.sparks(x, y, z, 3); }
  explosion(x, y, z) {
    for (let i = 0; i < 60; i++) this.glow.emit(x + (R() - 0.5) * 2, y + R(), z + (R() - 0.5) * 2, (R() - 0.5) * 14, R() * 12, (R() - 0.5) * 14, 0.5 + R() * 0.6, 2.2, 3, 1, 0.5 + R() * 0.3, 0.1, 1, 6);
    for (let i = 0; i < 40; i++) this.smoke.emit(x + (R() - 0.5) * 3, y + R() * 2, z + (R() - 0.5) * 3, (R() - 0.5) * 6, 2 + R() * 5, (R() - 0.5) * 6, 3 + R() * 2, 2, 3, 0.1, 0.1, 0.1, 0.75);
    this.sparks(x, y + 1, z, 40);
    this.flashLight(x, y + 2, z, 400, 0.8);
  }
  update(dt) {
    this.smoke.update(dt); this.glow.update(dt);
    for (const s of this.lights) {
      if (s.t > 0) { s.t -= dt; s.l.intensity = s.max * Math.max(0, s.t / s.dur); if (s.t <= 0) s.l.intensity = 0; }
    }
  }
}
