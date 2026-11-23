// Vehicles: procedural models (extruded body profiles), arcade physics with
// grip/drift/handbrake, terrain following & jumps, collisions, deformable damage,
// lights, sirens, fire and explosions.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, R, wrapAngle } from '../util.js';
import { groundHeight, WATER_Y } from '../world/layout.js';
import { makeConeTexture, makeRadialTexture } from '../world/textures.js';
import { ENV } from '../world/materials.js';

export const VTYPES = {
  sedan: { name: 'Cruiser', len: 4.7, wid: 1.85, wheelR: 0.34, mass: 1400, maxSpeed: 46, accel: 9, brake: 24, grip: 7.5, steer: 0.62, price: 16000,
    belt: 0.95, nose: 0.78, roof: 1.43, gh: [-0.3, -0.15, 0.08, 0.25], colors: [0x2c3e50, 0xbdc3c7, 0x7f1d1d, 0xf5f5f5, 0x1b4f72, 0x4a4a4a, 0x6e5a3a, 0x0b3d2e], engine: 0.9 },
  taxi: { name: 'Cab', len: 4.7, wid: 1.85, wheelR: 0.34, mass: 1400, maxSpeed: 44, accel: 8.5, brake: 24, grip: 7.3, steer: 0.62, price: 14000,
    belt: 0.95, nose: 0.78, roof: 1.43, gh: [-0.3, -0.15, 0.08, 0.25], colors: [0xf4c20d], engine: 0.9, sign: 'taxi' },
  sports: { name: 'Stinger GT', len: 4.5, wid: 1.92, wheelR: 0.35, mass: 1300, maxSpeed: 64, accel: 14, brake: 28, grip: 8.8, steer: 0.58, price: 85000,
    belt: 0.82, nose: 0.62, roof: 1.24, gh: [-0.32, -0.12, 0.06, 0.3], colors: [0xd62828, 0x00a6fb, 0xffd60a, 0x111111, 0xf5f5f5, 0xff5d8f, 0x2ec4b6], engine: 1.15 },
  super: { name: 'Vortex', len: 4.6, wid: 2.02, wheelR: 0.36, mass: 1350, maxSpeed: 78, accel: 18, brake: 32, grip: 9.8, steer: 0.55, price: 320000,
    belt: 0.76, nose: 0.5, roof: 1.12, gh: [-0.22, -0.05, 0.12, 0.36], colors: [0xff6b00, 0x8338ec, 0x06d6a0, 0xf72585, 0xffffff, 0x3a86ff, 0x101010], engine: 1.35 },
  suv: { name: 'Ranger XL', len: 4.9, wid: 2.0, wheelR: 0.4, mass: 2100, maxSpeed: 44, accel: 8, brake: 22, grip: 6.6, steer: 0.6, price: 42000,
    belt: 1.15, nose: 1.0, roof: 1.82, gh: [-0.47, -0.45, 0.12, 0.26], colors: [0x111111, 0xf5f5f5, 0x5d6d7e, 0x1e3a5f, 0x7b2d26, 0x3d5a40], engine: 0.8 },
  pickup: { name: 'Bayou 1500', len: 5.4, wid: 2.0, wheelR: 0.42, mass: 2200, maxSpeed: 42, accel: 8.5, brake: 21, grip: 6.2, steer: 0.6, price: 28000,
    belt: 1.08, nose: 1.0, roof: 1.86, gh: [-0.08, -0.02, 0.16, 0.26], colors: [0x8b0000, 0x1c2833, 0xd5d8dc, 0x2e4053, 0x7d6608, 0x145a32], engine: 0.75, bed: true },
  ambulance: { name: 'Rescue Van', len: 6.0, wid: 2.2, wheelR: 0.42, mass: 3200, maxSpeed: 40, accel: 7, brake: 20, grip: 6, steer: 0.58, price: 60000,
    belt: 1.2, nose: 1.0, roof: 2.0, gh: [0.12, 0.17, 0.3, 0.38], colors: [0xf8f9fa], engine: 0.7, box: 2.7, lights: 'ambulance' },
  police: { name: 'Interceptor', len: 4.9, wid: 1.9, wheelR: 0.35, mass: 1600, maxSpeed: 58, accel: 12.5, brake: 28, grip: 8.2, steer: 0.62, price: 0,
    belt: 0.95, nose: 0.78, roof: 1.45, gh: [-0.3, -0.15, 0.08, 0.25], colors: [0x111111], engine: 1.05, lights: 'police', livery: true },
  moto: { name: 'Razor 600', len: 2.1, wid: 0.75, wheelR: 0.32, mass: 220, maxSpeed: 70, accel: 16, brake: 26, grip: 8.5, steer: 0.5, price: 12000, bike: true,
    colors: [0xd62828, 0x111111, 0x00a6fb, 0xffd60a, 0x2ec4b6], engine: 1.4 },
};
export const BUYABLE = ['sedan', 'pickup', 'suv', 'moto', 'sports', 'super'];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x18222c, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.5 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2, metalness: 1 });
const geoCache = new Map();
const coneTex = makeConeTexture();
const beamMat = new THREE.MeshBasicMaterial({ map: coneTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.28 });
const tailGlowTex = makeRadialTexture('rgba(255,40,30,0.8)', 'rgba(255,0,0,0)');

function vcolor(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function wheelGeo(r, w) {
  const k = `w_${r}_${w}`;
  if (geoCache.has(k)) return geoCache.get(k);
  const tire = new THREE.CylinderGeometry(r, r, w, 18, 1).rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12, 1).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(r * 0.15, r * 0.15, w + 0.04, 8).rotateZ(Math.PI / 2);
  const spokes = [];
  for (let i = 0; i < 5; i++) { const s = new THREE.BoxGeometry(w + 0.03, r * 1.1, 0.05); s.rotateX(i / 5 * Math.PI); spokes.push(vcolor(s, 0xb0b0b0)); }
  const g = mergeGeometries([vcolor(tire, 0x121212), vcolor(rim, 0x7a7a7a), vcolor(hub, 0xdddddd), ...spokes]);
  geoCache.set(k, g);
  return g;
}

// Build body + greenhouse geometries for a car type (cached per type)
function carGeometries(type) {
  if (geoCache.has('car_' + type)) return geoCache.get('car_' + type);
  const T = VTYPES[type];
  const L = T.len, W = T.wid, wr = T.wheelR;
  const wb = L * 0.3; // wheel offsets from center (along length)
  const bottom = 0.3;
  const sh = new THREE.Shape();
  const X = (u) => u * L;
  const ra = wr * 1.18;
  sh.moveTo(X(-0.5), bottom + 0.05);
  sh.lineTo(-wb - ra, bottom);
  sh.absarc(-wb, wr, ra, Math.PI, 0, true);
  sh.lineTo(wb - ra, bottom);
  sh.absarc(wb, wr, ra, Math.PI, 0, true);
  sh.lineTo(X(0.5), bottom + 0.05);
  // front face
  sh.lineTo(X(0.5), T.nose * 0.62);
  sh.lineTo(X(0.47), T.nose);
  // hood up to windshield base
  const ghBaseF = X(T.gh[3]), ghBaseR = X(T.gh[0]);
  sh.lineTo(ghBaseF + 0.1, T.belt);
  if (T.box) {
    // tall box body (ambulance)
    sh.lineTo(ghBaseF - 0.05, T.belt);
    sh.lineTo(X(0.1), T.box);
    sh.lineTo(X(-0.5), T.box);
  } else {
    sh.lineTo(ghBaseR, T.belt);
    sh.lineTo(X(-0.44), T.belt + (T.bed ? 0 : -0.02));
    sh.lineTo(X(-0.5), T.belt - 0.12);
  }
  sh.lineTo(X(-0.5), bottom + 0.05);
  const bev = 0.06;
  const body = new THREE.ExtrudeGeometry(sh, { depth: W - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 6 });
  body.translate(0, 0, -(W - bev * 2) / 2);
  body.rotateY(-Math.PI / 2);
  // greenhouse
  const g = new THREE.Shape();
  const gw = W * 0.84;
  g.moveTo(X(T.gh[0]), T.belt - 0.02);
  g.lineTo(X(T.gh[1]), T.roof - 0.05);
  g.lineTo(X(T.gh[2]), T.roof - 0.05);
  g.lineTo(X(T.gh[3]), T.belt - 0.02);
  const green = new THREE.ExtrudeGeometry(g, { depth: gw, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 1 });
  green.translate(0, 0, -gw / 2);
  green.rotateY(-Math.PI / 2);
  // roof slab & pillars (body color)
  const parts = [];
  const roof = new THREE.BoxGeometry(gw + 0.06, 0.06, X(T.gh[2] - T.gh[1]) + 0.1);
  roof.translate(0, T.roof - 0.02, X((T.gh[1] + T.gh[2]) / 2));
  parts.push(roof);
  const pillar = (u0, y0, u1, y1) => {
    const dx = X(u1) - X(u0), dy = y1 - y0, len = Math.hypot(dx, dy);
    for (const s of [-1, 1]) {
      const p = new THREE.BoxGeometry(0.07, len, 0.1);
      p.rotateX(Math.atan2(dx, dy));
      p.translate(s * (gw / 2 + 0.02), (y0 + y1) / 2, (X(u0) + X(u1)) / 2);
      parts.push(p);
    }
  };
  pillar(T.gh[3], T.belt, T.gh[2], T.roof);
  pillar(T.gh[0], T.belt, T.gh[1], T.roof);
  const bm = (T.gh[1] + T.gh[2]) / 2;
  pillar(bm, T.belt, bm, T.roof);
  const extra = mergeGeometries(parts);
  const bodyAll = mergeGeometries([body.toNonIndexed(), extra.toNonIndexed()]);
  bodyAll.computeVertexNormals();
  // lights
  const hl = [], tl = [];
  for (const s of [-1, 1]) {
    const h = new THREE.BoxGeometry(0.36, 0.12, 0.08); h.translate(s * (W / 2 - 0.3), T.nose * 0.75, L / 2 + 0.02); hl.push(h);
    const t = new THREE.BoxGeometry(0.4, 0.12, 0.06); t.translate(s * (W / 2 - 0.28), (T.box ? 1.0 : T.belt - 0.15), -L / 2 - 0.04); tl.push(t);
  }
  // grille, bumpers, mirrors (dark)
  const dk = [];
  const gr = new THREE.BoxGeometry(W * 0.5, 0.16, 0.05); gr.translate(0, T.nose * 0.55, L / 2 + 0.03); dk.push(gr);
  const fb = new THREE.BoxGeometry(W * 0.96, 0.14, 0.12); fb.translate(0, 0.38, L / 2 + 0.02); dk.push(fb);
  const rb = new THREE.BoxGeometry(W * 0.96, 0.14, 0.12); rb.translate(0, 0.4, -L / 2 - 0.02); dk.push(rb);
  for (const s of [-1, 1]) { const m = new THREE.BoxGeometry(0.2, 0.1, 0.12); m.translate(s * (W / 2 + 0.06), T.belt + 0.08, X(T.gh[3]) - 0.1); dk.push(m); }
  // interior: seats, dash
  const seatZ = X((T.gh[0] + T.gh[3]) / 2) - 0.1;
  for (const s of [-1, 1]) {
    const seat = new THREE.BoxGeometry(0.5, 0.12, 0.5); seat.translate(s * 0.38, 0.55, seatZ); dk.push(seat);
    const back = new THREE.BoxGeometry(0.5, 0.6, 0.12); back.translate(s * 0.38, 0.85, seatZ - 0.28); dk.push(back);
  }
  const dash = new THREE.BoxGeometry(W * 0.84, 0.22, 0.4); dash.translate(0, T.belt - 0.05, X(T.gh[3]) - 0.25); dk.push(dash);
  if (T.bed) { const bed = new THREE.BoxGeometry(W * 0.86, 0.04, L * 0.38); bed.translate(0, T.belt + 0.01, -L * 0.29); dk.push(bed); }
  const res = {
    body: bodyAll, glass: green, head: mergeGeometries(hl), tail: mergeGeometries(tl), dark: mergeGeometries(dk.map((d) => d.toNonIndexed())),
    seatZ, wb,
  };
  geoCache.set('car_' + type, res);
  return res;
}

function bikeGeometries() {
  if (geoCache.has('bike')) return geoCache.get('bike');
  const parts = [];
  const tank = new THREE.CapsuleGeometry(0.17, 0.35, 4, 10).rotateX(Math.PI / 2); tank.translate(0, 0.95, 0.25); parts.push(tank);
  const fair = new THREE.BoxGeometry(0.4, 0.35, 0.5); fair.translate(0, 0.95, 0.68); fair.rotateX(0); parts.push(fair);
  const tail = new THREE.BoxGeometry(0.28, 0.16, 0.6); tail.translate(0, 0.95, -0.55); parts.push(tail);
  const body = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  body.computeVertexNormals();
  const dk = [];
  const seat = new THREE.BoxGeometry(0.3, 0.08, 0.55); seat.translate(0, 0.98, -0.18); dk.push(seat);
  const eng = new THREE.BoxGeometry(0.32, 0.32, 0.45); eng.translate(0, 0.58, 0.05); dk.push(eng);
  const frame = new THREE.BoxGeometry(0.08, 0.08, 1.1); frame.rotateX(0.25); frame.translate(0, 0.72, 0); dk.push(frame);
  const forkL = new THREE.CylinderGeometry(0.03, 0.03, 0.7); forkL.rotateX(-0.45); forkL.translate(0.09, 0.62, 0.86); dk.push(forkL);
  const forkR = forkL.clone(); forkR.translate(-0.18, 0, 0); dk.push(forkR);
  const bar = new THREE.CylinderGeometry(0.02, 0.02, 0.62).rotateZ(Math.PI / 2); bar.translate(0, 1.08, 0.62); dk.push(bar);
  const exh = new THREE.CylinderGeometry(0.05, 0.05, 0.6).rotateX(Math.PI / 2); exh.translate(0.18, 0.45, -0.45); dk.push(exh);
  const hl = new THREE.BoxGeometry(0.16, 0.1, 0.05); hl.translate(0, 0.98, 0.94);
  const tl = new THREE.BoxGeometry(0.14, 0.06, 0.04); tl.translate(0, 1.0, -0.86);
  const res = { body, dark: mergeGeometries(dk.map((d) => d.toNonIndexed())), head: hl, tail: tl, glass: null, seatZ: -0.2, wb: 0.7 };
  geoCache.set('bike', res);
  return res;
}

let VID = 1;
export class Vehicle {
  constructor(G, type, x, z, heading = 0, opts = {}) {
    this.G = G; this.id = VID++;
    this.type = type; this.T = VTYPES[type];
    const T = this.T;
    this.bike = !!T.bike;
    this.color = opts.color ?? T.colors[Math.floor(R() * T.colors.length)];
    this.group = new THREE.Group();
    this.chassis = new THREE.Group();
    this.group.add(this.chassis);
    const geo = this.bike ? bikeGeometries() : carGeometries(type);
    this.geo = geo;
    this.paint = new THREE.MeshPhysicalMaterial({ color: this.color, metalness: 0.55, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.08 });
    this.bodyMesh = new THREE.Mesh(geo.body, this.paint);
    this.chassis.add(this.bodyMesh);
    if (geo.glass) { this.glassMesh = new THREE.Mesh(geo.glass, glassMat); this.chassis.add(this.glassMesh); }
    this.darkMesh = new THREE.Mesh(geo.dark, darkMat); this.chassis.add(this.darkMesh);
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0.2, roughness: 0.1 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a0a, emissiveIntensity: 0.3, roughness: 0.2 });
    this.headMesh = new THREE.Mesh(geo.head, this.headMat); this.chassis.add(this.headMesh);
    this.tailMesh = new THREE.Mesh(geo.tail, this.tailMat); this.chassis.add(this.tailMesh);
    if (T.livery) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(T.wid + 0.02, 0.32, T.len * 0.55), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 }));
      d.position.set(0, T.belt - 0.3, 0.1); this.chassis.add(d);
    }
    if (T.sign === 'taxi') {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.25), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffee88, emissiveIntensity: 0.6 }));
      s.position.set(0, T.roof + 0.1, 0); this.chassis.add(s);
    }
    if (T.lights) {
      this.sirenMats = [new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 }), new THREE.MeshStandardMaterial({ color: 0x000022, emissive: T.lights === 'police' ? 0x1040ff : 0xff1010, emissiveIntensity: 0 })];
      const y = T.box ? T.box + 0.08 : T.roof + 0.06;
      const zz = T.box ? T.len * 0.12 : 0;
      for (let k = 0; k < 2; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.22), this.sirenMats[k]);
        b.position.set(k ? -0.32 : 0.32, y, zz); this.chassis.add(b);
      }
      if (T.box) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xd00000 })); c.position.set(T.wid / 2 + 0.04, 1.8, -1.2); this.chassis.add(c); const c2 = c.clone(); c2.position.x *= -1; this.chassis.add(c2); }
    }
    // wheels
    this.wheels = [];
    const wr = T.wheelR;
    if (this.bike) {
      for (const zz of [0.72, -0.68]) {
        const piv = new THREE.Group(); piv.position.set(0, wr, zz);
        const m = new THREE.Mesh(wheelGeo(wr, 0.14), wheelMat); piv.add(m);
        this.chassis.add(piv); this.wheels.push({ piv, m, front: zz > 0, lx: 0, lz: zz });
      }
    } else {
      const tw = T.wid / 2 - 0.2;
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const piv = new THREE.Group(); piv.position.set(sx * tw, wr, sz * geo.wb);
        const m = new THREE.Mesh(wheelGeo(wr, 0.26), wheelMat);
        piv.add(m); this.chassis.add(piv);
        this.wheels.push({ piv, m, front: sz > 0, lx: sx * tw, lz: sz * geo.wb });
      }
      // steering wheel
      this.steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), darkMat);
      this.steeringWheel.position.set(0.38, T.belt + 0.08, geo.seatZ + 0.45);
      this.steeringWheel.rotation.x = -0.4;
      this.chassis.add(this.steeringWheel);
    }
    // AI driver dummy (hidden when player drives)
    if (!opts.empty) this.addDummy();
    // headlight beams on ground (for night)
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(this.bike ? 4 : 7, 16).rotateX(-Math.PI / 2), beamMat);
    this.beam.position.set(0, 0.08, T.len / 2 + 8);
    this.beam.renderOrder = 3;
    this.group.add(this.beam);
    this.tailGlow = new THREE.Mesh(new THREE.PlaneGeometry(T.wid + 1, 2.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tailGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    this.tailGlow.position.set(0, 0.07, -T.len / 2 - 0.8); this.tailGlow.renderOrder = 3;
    this.group.add(this.tailGlow);
    this.group.traverse((o) => { if (o.isMesh && o !== this.beam && o !== this.tailGlow) { o.castShadow = true; o.receiveShadow = true; } });

    // physics state
    this.pos = new THREE.Vector3(x, groundHeight(x, z), z);
    this.heading = heading;
    this.vel = new THREE.Vector2(0, 0); // world x,z
    this.vy = 0; this.angVel = 0; this.steer = 0;
    this.pitch = 0; this.roll = 0; this.lean = 0;
    this.airborne = false;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
    this.health = 1000; this.maxHealth = 1000;
    this.engineOn = !opts.parked;
    this.lightsOn = false;
    this.headlightsAuto = true;
    this.driver = opts.parked || opts.empty ? null : 'ai';
    this.parked = !!opts.parked;
    this.burning = 0; this.destroyed = false; this.sinking = 0;
    this.sirenOn = false; this.sirenT = 0;
    this.rpm = 0; this.gear = 1; this.wheelSpin = 0;
    this.upgrades = { engine: 0, brakes: 0, armor: 0, ...(opts.upgrades || {}) };
    this.uniqueGeo = false;
    this.lastHit = 0;
    this.radius = Math.max(T.len, T.wid) / 2;
    this.dummy && (this.dummy.visible = this.driver === 'ai');
    this.syncMesh();
    G.scene.add(this.group);
  }
  addDummy() {
    const look = new THREE.Color().setHSL(R(), 0.4, 0.4).getHex();
    const skin = [0xf1c8a8, 0xc68a64, 0x6e4630][Math.floor(R() * 3)];
    const k = 'dummy_' + look + '_' + skin;
    let g = geoCache.get(k);
    if (!g) {
      const head = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.18, 0);
      const torso = new THREE.CapsuleGeometry(0.17, 0.3, 2, 6).translate(0, 0.85, -0.05);
      g = mergeGeometries([vcolor(head, skin), vcolor(torso, look)]);
      geoCache.set(k, g);
    }
    this.dummy = new THREE.Mesh(g, wheelMat);
    this.dummy.position.set(this.bike ? 0 : 0.38, this.bike ? 0.4 : 0.05, this.geo.seatZ + (this.bike ? 0 : 0.05));
    this.chassis.add(this.dummy);
  }
  get forward() { return _v.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get speed() { return this.vel.length(); }
  get fwdSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading); }
  // Door position (left side = driver side for player exits)
  doorPos(side = 1) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const lx = side * (this.T.wid / 2 + 0.75), lz = this.bike ? 0 : 0.2;
    return { x: this.pos.x + lx * c + lz * s, z: this.pos.z - lx * s + lz * c };
  }
  seatWorld(out) {
    const T = this.T;
    out.set(this.bike ? 0 : 0.38, this.bike ? 0.4 : 0.05, this.geo.seatZ + 0.05);
    return this.chassis.localToWorld(out);
  }
  toLocal(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z, c = Math.cos(this.heading), s = Math.sin(this.heading);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }
  // Is a world point inside the car footprint (with margin)?
  contains(x, z, m = 0) {
    const l = this.toLocal(x, z);
    return Math.abs(l.x) < this.T.wid / 2 + m && Math.abs(l.z) < this.T.len / 2 + m;
  }
  circles() {
    const n = this.bike ? 2 : 3, out = [];
    const r = this.bike ? 0.45 : this.T.wid / 2;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const span = this.T.len / 2 - r;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
      out.push({ x: this.pos.x + fx * t, z: this.pos.z + fz * t, r, t });
    }
    return out;
  }

  update(dt, isPlayer) {
    const T = this.T;
    if (this.destroyed) { this.vel.multiplyScalar(Math.exp(-dt * 3)); this.input.throttle = 0; }
    const inp = this.input;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let vf = this.vel.x * fx + this.vel.y * fz;
    let vl = this.vel.x * fz - this.vel.y * fx; // right lateral
    const maxSpeed = T.maxSpeed * (1 + this.upgrades.engine * 0.08) * (this.health < 250 ? 0.6 : 1);
    const accel = T.accel * (1 + this.upgrades.engine * 0.12);
    const brakeF = T.brake * (1 + this.upgrades.brakes * 0.15);
    const onGround = !this.airborne;
    const inWater = this.sinking > 0;
    // Steering (speed sensitive)
    const steerLimit = T.steer * lerp(1, 0.28, clamp(Math.abs(vf) / 45, 0, 1));
    this.steer += (inp.steer * steerLimit - this.steer) * (1 - Math.exp(-dt * (isPlayer ? 7 : 5)));
    if (onGround && !inWater && this.engineOn && !this.destroyed) {
      if (inp.throttle > 0) {
        const tf = 1 - Math.pow(clamp(vf / maxSpeed, 0, 1), 2);
        vf += inp.throttle * accel * tf * dt;
      }
      if (inp.brake > 0) {
        if (vf > 0.5) vf = Math.max(0, vf - brakeF * inp.brake * dt);
        else vf = Math.max(-T.maxSpeed * 0.3, vf - accel * 0.55 * inp.brake * dt);
      }
    }
    if (onGround) {
      // rolling resistance & drag
      const drag = 0.0028 * vf * Math.abs(vf) + Math.sign(vf) * 0.6;
      if (Math.abs(vf) < 0.25 && !inp.throttle && !inp.brake) vf *= Math.exp(-dt * 8);
      else vf -= drag * dt;
      if (inp.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * dt);
      // lateral grip
      let grip = T.grip * (1 - ENV.wet.value * 0.25);
      if (inp.handbrake && !this.bike) grip *= 0.18;
      vl *= Math.exp(-grip * dt);
      // yaw
      const wbLen = this.geo.wb * 2;
      const targetYaw = (vf * Math.tan(this.steer)) / wbLen;
      const yawResp = inp.handbrake ? 3.5 : 9;
      this.angVel += (targetYaw - this.angVel) * (1 - Math.exp(-dt * yawResp));
      if (inp.handbrake && Math.abs(vf) > 5 && !this.bike) { this.angVel += this.steer * 1.6 * dt * Math.sign(vf); vl += -this.angVel * Math.abs(vf) * 0.02; }
      // drift smoke
      const slip = Math.abs(vl);
      this.slip = slip;
      if (slip > 3.5 && this.G.fx && R() < 0.6) {
        for (const w of this.wheels) if (!w.front) { w.piv.getWorldPosition(_v2); this.G.fx.tireSmoke(_v2.x, _v2.y - T.wheelR, _v2.z, Math.min(1.5, slip / 6)); }
      }
    } else {
      this.angVel *= Math.exp(-dt * 0.5);
      this.slip = 0;
    }
    if (inWater) { vf *= Math.exp(-dt * 2); vl *= Math.exp(-dt * 2); this.angVel *= Math.exp(-dt * 2); }
    this.heading = wrapAngle(this.heading + this.angVel * dt);
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    this.vel.set(nfx * vf + nfz * vl, nfz * vf - nfx * vl);
    // Integrate position
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.y * dt;
    // Static collisions
    this.collideStatic(dt, isPlayer);
    // Ground following
    const gy = this.sampleGround();
    if (this.airborne) {
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gy.y) {
        if (this.vy < -7) { this.damage(Math.abs(this.vy) * 6); this.G.audio && this.G.audio.crash(0.4, this.pos); this.G.cam && isPlayer && this.G.cam.shake(0.3); }
        this.pos.y = gy.y; this.vy = 0; this.airborne = false;
      }
    } else {
      const prevY = this.pos.y;
      const want = gy.y;
      const vyGround = (want - prevY) / Math.max(dt, 1e-4);
      if (want < prevY - 0.25 && this.lastVy > -1 && Math.abs(vf) > 12) {
        // road falls away faster than we follow -> launch
        this.airborne = true; this.vy = Math.max(this.lastVy || 0, 0); this.pos.y = prevY;
      } else {
        this.pos.y = want;
        this.lastVy = clamp(vyGround, -20, 20);
      }
    }
    // Pitch/roll from terrain, plus dynamic body roll
    const tp = this.airborne ? this.pitch * 0.98 - 0.15 * dt : gy.pitch;
    this.pitch += (tp - this.pitch) * (1 - Math.exp(-dt * 10));
    const dynRoll = this.bike ? 0 : clamp(this.angVel * vf * 0.004, -0.06, 0.06);
    this.roll += ((this.airborne ? this.roll : gy.roll) + dynRoll - this.roll) * (1 - Math.exp(-dt * 8));
    if (this.bike) {
      const targetLean = clamp(-this.angVel * Math.abs(vf) * 0.045, -0.75, 0.75) * (this.driver ? 1 : 0);
      this.lean += (targetLean - this.lean) * (1 - Math.exp(-dt * 6));
      if (!this.driver && this.speed < 0.5) this.lean += (0.28 - this.lean) * (1 - Math.exp(-dt * 3));
    }
    // Water
    if (groundHeight(this.pos.x, this.pos.z) < WATER_Y - 0.6 && this.pos.y < WATER_Y + 0.2) {
      if (!this.sinking) { this.G.fx && this.G.fx.splash(this.pos.x, WATER_Y, this.pos.z, 40); this.G.audio && this.G.audio.splash(this.pos); }
      this.sinking += dt;
      this.engineOn = false;
      this.pos.y = Math.max(groundHeight(this.pos.x, this.pos.z), WATER_Y - 0.3 - this.sinking * 0.5);
      if (this.sinking > 5 && !this.destroyed) { this.destroyed = true; this.health = 0; }
    }
    // Damage effects
    if (!this.destroyed && this.health < 350) {
      const p = this.chassis.localToWorld(_v2.set(0, T.nose || 0.8, T.len * 0.35));
      if (R() < (this.health < 150 ? 0.7 : 0.25)) this.G.fx && this.G.fx.engineSmoke(p.x, p.y, p.z, this.health < 150);
      if (this.health <= 0 && !this.burning) this.burning = 0.01;
    }
    if (this.burning > 0 && !this.destroyed) {
      this.burning += dt;
      const p = this.chassis.localToWorld(_v2.set(0, 0.9, T.len * 0.3));
      this.G.fx && this.G.fx.fire(p.x, p.y, p.z, 1.2);
      if (this.burning > 5) this.explode();
    }
    // engine audio data
    const sp = Math.abs(vf);
    const gearMax = [0, 12, 22, 32, 44, 58, 999];
    let g = 1; while (g < 6 && sp > gearMax[g] * (maxSpeed / 64)) g++;
    this.gear = vf < -0.5 ? -1 : g;
    const lo = gearMax[g - 1] * (maxSpeed / 64), hi = gearMax[g] * (maxSpeed / 64);
    const targetRpm = this.engineOn ? clamp(0.18 + ((sp - lo) / Math.max(1, Math.min(hi, maxSpeed) - lo)) * 0.8, 0.15, 1.05) * (this.airborne ? 1.1 : 1) : 0;
    const rpmT = inp.throttle > 0 && sp < 2 ? 0.45 : targetRpm;
    this.rpm += (rpmT - this.rpm) * (1 - Math.exp(-dt * 6));
    this.wheelSpin += (vf / T.wheelR) * dt;
    this.lastHit = Math.max(0, this.lastHit - dt);
    this.syncMesh(dt);
  }
  sampleGround() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const hl = this.T.len * 0.35, hw = this.T.wid * 0.4;
    const at = (lx, lz) => groundHeight(this.pos.x + lx * c + lz * s, this.pos.z - lx * s + lz * c);
    const f = (at(hw, hl) + at(-hw, hl)) / 2, b = (at(hw, -hl) + at(-hw, -hl)) / 2;
    const l = (at(hw, hl) + at(hw, -hl)) / 2, r = (at(-hw, hl) + at(-hw, -hl)) / 2;
    const y = Math.max((f + b) / 2, groundHeight(this.pos.x, this.pos.z) - 0.05);
    return { y, pitch: -Math.atan2(f - b, hl * 2), roll: Math.atan2(l - r, hw * 2) };
  }
  collideStatic(dt, isPlayer) {
    const col = this.G.col;
    const res = { hit: false, nx: 0, nz: 0, depth: 0 };
    let hit = false, nx = 0, nz = 0, depth = 0, hitT = 0;
    for (const c of this.circles()) {
      const p = { x: c.x, z: c.z };
      col.resolveCircle(p, c.r, this.pos.y + 0.25, 1.2, res);
      if (res.hit) {
        const dx = p.x - c.x, dz = p.z - c.z;
        this.pos.x += dx; this.pos.z += dz;
        if (res.depth > depth) { depth = res.depth; nx = res.nx; nz = res.nz; hitT = c.t; }
        hit = true;
      }
    }
    if (hit) {
      const vn = this.vel.x * nx + this.vel.y * nz;
      if (vn < 0) {
        const e = 0.25;
        this.vel.x -= (1 + e) * vn * nx; this.vel.y -= (1 + e) * vn * nz;
        // friction along wall
        this.vel.multiplyScalar(1 - clamp(-vn * 0.02, 0, 0.4));
        // spin from off-center impacts
        const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
        const cross = fx * nz - fz * nx;
        this.angVel += cross * hitT * vn * 0.25;
        const impact = -vn;
        if (impact > 3) this.onImpact(impact, nx, nz, isPlayer, hitT);
      }
    }
  }
  onImpact(impact, nx, nz, isPlayer, localT = 0) {
    if (this.lastHit > 0.15 && impact < 8) return;
    this.lastHit = 0.3;
    const armor = 1 - this.upgrades.armor * 0.15;
    this.damage(impact * impact * (isPlayer ? 0.65 : 0.4) * armor);
    // deform at the contact point
    const px = this.pos.x - nx * this.T.wid * 0.5 + Math.sin(this.heading) * localT;
    const pz = this.pos.z - nz * this.T.wid * 0.5 + Math.cos(this.heading) * localT;
    this.deform(px, this.pos.y + 0.7, pz, nx, nz, Math.min(0.35, impact * 0.012));
    const G = this.G;
    if (G.fx && impact > 6) G.fx.sparks(px, this.pos.y + 0.5, pz, Math.min(30, impact * 2), nx, nz);
    if (G.audio) G.audio.crash(clamp(impact / 25, 0.1, 1), this.pos);
    if (isPlayer && G.cam) G.cam.shake(clamp(impact / 30, 0.05, 0.6));
    if (this.bike && impact > 11 && this.driver === 'player' && G.player) G.player.ejectFromBike(this, impact);
    if (impact > 9 && R() < 0.5) this.headBroken = true;
  }
  damage(n) {
    if (this.destroyed) return;
    this.health = Math.max(0, this.health - n);
  }
  deform(wx, wy, wz, nx, nz, amount) {
    if (this.bike || amount < 0.02) return;
    if (!this.uniqueGeo) { this.bodyMesh.geometry = this.bodyMesh.geometry.clone(); this.uniqueGeo = true; }
    const local = this.chassis.worldToLocal(_v2.set(wx, wy, wz));
    // impact normal into the car in local space
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const lnx = nx * c - nz * s, lnz = nx * s + nz * c;
    const pos = this.bodyMesh.geometry.attributes.position;
    const rad = 1.0;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - local.x, dy = pos.getY(i) - local.y, dz = pos.getZ(i) - local.z;
      const d = Math.sqrt(dx * dx + dy * dy * 0.5 + dz * dz);
      if (d > rad) continue;
      const f = (1 - d / rad) * amount * (0.7 + Math.random() * 0.6);
      pos.setXYZ(i, pos.getX(i) + lnx * f, pos.getY(i) - f * 0.25, pos.getZ(i) + lnz * f);
    }
    pos.needsUpdate = true;
    this.bodyMesh.geometry.computeVertexNormals();
  }
  repair() {
    this.health = this.maxHealth; this.burning = 0; this.headBroken = false;
    if (this.uniqueGeo) { this.bodyMesh.geometry.dispose(); this.bodyMesh.geometry = this.geo.body; this.uniqueGeo = false; }
  }
  setColor(c) { this.color = c; this.paint.color.set(c); }
  explode() {
    if (this.destroyed && this.exploded) return;
    this.destroyed = true; this.exploded = true; this.burning = 0; this.health = 0;
    this.paint.color.set(0x161412); this.paint.clearcoat = 0; this.paint.roughness = 0.95; this.paint.metalness = 0.2;
    this.headBroken = true; this.engineOn = false;
    const G = this.G;
    G.fx && G.fx.explosion(this.pos.x, this.pos.y + 0.8, this.pos.z);
    G.audio && G.audio.explosion(this.pos);
    G.cam && G.cam.shake(clamp(1 - G.cam.distTo(this.pos) / 60, 0, 1));
    this.vy = 5; this.airborne = true; this.angVel += (R() - 0.5) * 2;
    G.onExplosion && G.onExplosion(this.pos, this);
  }
  setSiren(on) { this.sirenOn = on; }
  // distance-based level of detail: hide far vehicles, drop shadows at range
  lod(camPos) {
    const d = Math.hypot(this.pos.x - camPos.x, this.pos.z - camPos.z);
    this.group.visible = d < 420;
    const sh = d < 90;
    if (sh !== this._sh) { this._sh = sh; this.group.traverse((o) => { if (o.isMesh && o !== this.beam && o !== this.tailGlow) o.castShadow = sh; }); }
  }
  syncMesh(dt = 0) {
    const T = this.T;
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.heading, 0);
    this.chassis.rotation.set(this.pitch, 0, this.roll + this.lean, 'YXZ');
    const night = ENV.night.value;
    const lights = (this.lightsOn || (this.headlightsAuto && night > 0.35) || (ENV.wet.value > 0.5 && this.engineOn)) && this.engineOn && !this.destroyed && this.driver;
    this.headMat.emissiveIntensity = lights && !this.headBroken ? 2 : 0.05;
    const braking = this.input.brake > 0 && this.fwdSpeed > 0.5;
    this.tailMat.emissiveIntensity = (braking ? 4 : lights ? 1.4 : 0.15) * (this.destroyed ? 0 : 1);
    this.beam.visible = !!lights && !this.headBroken && night > 0.2;
    
    this.tailGlow.material.opacity = (braking ? 0.35 : lights ? 0.07 : 0) * (night > 0.2 ? 1 : 0.2);
    this.tailGlow.visible = this.tailGlow.material.opacity > 0.01;
    for (const w of this.wheels) {
      w.m.rotation.x = this.wheelSpin;
      w.piv.rotation.y = w.front ? this.steer : 0;
    }
    if (this.steeringWheel) this.steeringWheel.rotation.z = -this.steer * 2.5;
    if (this.sirenMats) {
      this.sirenT += dt;
      const on = this.sirenOn && !this.destroyed;
      const ph = Math.floor(this.sirenT * 6) % 2;
      this.sirenMats[0].emissiveIntensity = on ? (ph ? 5 : 0.2) : 0.1;
      this.sirenMats[1].emissiveIntensity = on ? (ph ? 0.2 : 5) : 0.1;
    }
  }
  dispose() {
    this.G.scene.remove(this.group);
    if (this.uniqueGeo) this.bodyMesh.geometry.dispose();
    this.paint.dispose(); this.headMat.dispose(); this.tailMat.dispose(); this.tailGlow.material.dispose();
    if (this.sirenMats) this.sirenMats.forEach((m) => m.dispose());
  }
}

// Pairwise vehicle-vehicle collision resolution
export function collideVehicles(list, G) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const rr = a.radius + b.radius;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 2) continue;
      const ca = a.circles(), cb = b.circles();
      let best = null;
      for (const p of ca) for (const q of cb) {
        const ex = q.x - p.x, ez = q.z - p.z, d = Math.hypot(ex, ez), m = p.r + q.r;
        if (d < m && d > 1e-4 && (!best || m - d > best.pen)) best = { nx: ex / d, nz: ez / d, pen: m - d, x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
      }
      if (!best) continue;
      const ma = a.parked && !a.driver ? a.T.mass * 1.5 : a.T.mass, mb = b.parked && !b.driver ? b.T.mass * 1.5 : b.T.mass;
      const ta = mb / (ma + mb), tb = ma / (ma + mb);
      a.pos.x -= best.nx * best.pen * ta; a.pos.z -= best.nz * best.pen * ta;
      b.pos.x += best.nx * best.pen * tb; b.pos.z += best.nz * best.pen * tb;
      const rv = (b.vel.x - a.vel.x) * best.nx + (b.vel.y - a.vel.y) * best.nz;
      if (rv < 0) {
        const e = 0.3, jimp = -(1 + e) * rv / (1 / ma + 1 / mb);
        a.vel.x -= (jimp / ma) * best.nx; a.vel.y -= (jimp / ma) * best.nz;
        b.vel.x += (jimp / mb) * best.nx; b.vel.y += (jimp / mb) * best.nz;
        const impact = -rv;
        if (impact > 2.5) {
          const pa = a.driver === 'player', pb = b.driver === 'player';
          a.onImpact(impact * ta * 1.4, -best.nx, -best.nz, pa);
          b.onImpact(impact * tb * 1.4, best.nx, best.nz, pb);
          a.angVel += (R() - 0.5) * impact * 0.05; b.angVel += (R() - 0.5) * impact * 0.05;
          G.onVehicleCollision && G.onVehicleCollision(a, b, impact);
        }
      }
    }
  }
}
