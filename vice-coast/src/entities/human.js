// Articulated low-poly human with procedural animation (walk/run/sprint/crouch,
// jump, swim, drive, talk, flee, punch, aim, dead...). Shared by player and NPCs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, R } from '../util.js';

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0 });
const geoCache = new Map();

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const cap = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg);
function cached(key, build) {
  let g = geoCache.get(key);
  if (!g) { g = build(); geoCache.set(key, g); }
  return g;
}

export const SKIN_TONES = [0xf1c8a8, 0xe0ac87, 0xc68a64, 0x9c6644, 0x6e4630, 0x4b3021];
export const HAIR_COLORS = [0x1a1210, 0x3b2416, 0x6b4423, 0xb08850, 0xd9c08a, 0x777777];
export const HAIR_STYLES = ['short', 'buzz', 'long', 'bald', 'curly', 'ponytail'];
export const HATS = ['none', 'cap', 'fedora', 'beanie'];

export function randomLook(r = R, gender) {
  const female = gender ?? r() < 0.5;
  const pick = (a) => a[Math.floor(r() * a.length)];
  return {
    female,
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_COLORS),
    hairStyle: female ? pick(['long', 'ponytail', 'curly', 'short']) : pick(['short', 'buzz', 'bald', 'curly', 'short']),
    shirt: new THREE.Color().setHSL(r(), 0.35 + r() * 0.5, 0.25 + r() * 0.5).getHex(),
    pants: pick([0x1f2a44, 0x2b2b2b, 0x4a4a4a, 0xc2b280, 0x6b4f3a, 0x37474f, 0xe8e8e8, 0x3f6fa8]),
    shoes: pick([0x111111, 0xffffff, 0x5a3b22, 0x333333, 0xc0392b]),
    sleeves: r() < 0.7 ? 'short' : 'long',
    hat: r() < 0.15 ? pick(['cap', 'fedora', 'beanie']) : 'none',
    glasses: r() < 0.25,
    build: 0.9 + r() * 0.25,
    height: female ? 0.93 + r() * 0.08 : 0.98 + r() * 0.08,
  };
}

function headGeo(look) {
  const key = `head_${look.skin}_${look.hair}_${look.hairStyle}_${look.hat}_${look.glasses}_${look.female}`;
  return cached(key, () => {
    const parts = [];
    const head = new THREE.SphereGeometry(0.115, 12, 10); head.scale(0.92, 1.08, 1); head.translate(0, 0.12, 0);
    parts.push(colored(head, look.skin));
    const neck = new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8); neck.translate(0, 0.0, 0);
    parts.push(colored(neck, look.skin));
    const nose = new THREE.BoxGeometry(0.03, 0.04, 0.04); nose.translate(0, 0.11, 0.11);
    parts.push(colored(nose, look.skin));
    for (const s of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.014, 6, 4); eye.translate(s * 0.04, 0.14, 0.1);
      parts.push(colored(eye, 0x111111));
    }
    const hs = look.hairStyle;
    if (hs !== 'bald' && look.hat !== 'beanie') {
      const top = new THREE.SphereGeometry(hs === 'buzz' ? 0.119 : 0.125, 12, 8, 0, Math.PI * 2, 0, hs === 'buzz' ? 1.3 : 1.6);
      top.scale(0.95, 1.05, 1.04); top.translate(0, 0.135, -0.01);
      if (hs === 'curly') top.scale(1.12, 1.1, 1.1);
      parts.push(colored(top, look.hair));
      if (hs === 'long') { const back = new THREE.BoxGeometry(0.22, 0.26, 0.08); back.translate(0, 0.03, -0.08); parts.push(colored(back, look.hair)); }
      if (hs === 'ponytail') { const pt = new THREE.CapsuleGeometry(0.035, 0.14, 2, 6); pt.translate(0, 0.08, -0.14); parts.push(colored(pt, look.hair)); }
    }
    if (look.hat === 'cap') {
      const c = new THREE.SphereGeometry(0.128, 12, 6, 0, Math.PI * 2, 0, 1.4); c.translate(0, 0.14, 0); parts.push(colored(c, look.shirt));
      const brim = new THREE.BoxGeometry(0.18, 0.015, 0.12); brim.translate(0, 0.19, 0.12); parts.push(colored(brim, look.shirt));
    } else if (look.hat === 'fedora') {
      const b = new THREE.CylinderGeometry(0.2, 0.2, 0.015, 14); b.translate(0, 0.2, 0); parts.push(colored(b, 0xe8dcc0));
      const t = new THREE.CylinderGeometry(0.11, 0.125, 0.11, 12); t.translate(0, 0.26, 0); parts.push(colored(t, 0xe8dcc0));
      const band = new THREE.CylinderGeometry(0.126, 0.126, 0.025, 12); band.translate(0, 0.22, 0); parts.push(colored(band, 0x222222));
    } else if (look.hat === 'beanie') {
      const c = new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, 1.6); c.scale(1, 1.15, 1); c.translate(0, 0.14, 0); parts.push(colored(c, look.shirt));
    }
    if (look.glasses) {
      const gl = new THREE.BoxGeometry(0.17, 0.035, 0.02); gl.translate(0, 0.14, 0.11); parts.push(colored(gl, 0x0a0a0a));
    }
    return mergeGeometries(parts);
  });
}
function torsoGeo(look) {
  const key = `torso_${look.shirt}_${look.pants}_${look.female}_${look.build}_${look.vest || 0}`;
  return cached(key, () => {
    const w = look.female ? 0.15 : 0.17;
    const chest = cap(w, 0.26, 10); chest.scale(1.15 * look.build, 1, 0.7 * look.build); chest.translate(0, 0.36, 0);
    const hips = cap(w * 0.95, 0.06, 10); hips.scale(1.1 * look.build, 1, 0.75 * look.build); hips.translate(0, 0.06, 0);
    const parts = [colored(chest, look.shirt), colored(hips, look.pants)];
    const belt = new THREE.CylinderGeometry(w * 1.12 * look.build, w * 1.12 * look.build, 0.04, 12); belt.scale(1, 1, 0.72); belt.translate(0, 0.14, 0);
    parts.push(colored(belt, 0x222222));
    if (look.vest) { const v = cap(w + 0.015, 0.2, 10); v.scale(1.15 * look.build, 1, 0.75 * look.build); v.translate(0, 0.38, 0); parts.push(colored(v, look.vest)); }
    if (look.badge) { const b = new THREE.BoxGeometry(0.04, 0.05, 0.01); b.translate(-0.08, 0.45, 0.12); parts.push(colored(b, 0xffd700)); }
    return mergeGeometries(parts);
  });
}
function upperArmGeo(look) {
  const c = look.sleeves === 'long' ? look.shirt : look.skin;
  return cached(`uarm_${c}_${look.shirt}`, () => {
    const a = cap(0.045, 0.2); a.translate(0, -0.14, 0);
    const sl = cap(0.052, 0.08); sl.translate(0, -0.06, 0);
    return mergeGeometries([colored(a, c), colored(sl, look.shirt)]);
  });
}
function foreArmGeo(look) {
  const c = look.sleeves === 'long' ? look.shirt : look.skin;
  return cached(`farm_${c}_${look.skin}`, () => {
    const a = cap(0.04, 0.2); a.translate(0, -0.13, 0);
    const h = new THREE.SphereGeometry(0.045, 8, 6); h.scale(0.8, 1.2, 0.6); h.translate(0, -0.3, 0);
    return mergeGeometries([colored(a, c), colored(h, look.skin)]);
  });
}
function thighGeo(look) {
  return cached(`thigh_${look.pants}`, () => { const t = cap(0.065, 0.32); t.translate(0, -0.22, 0); return colored(t, look.pants); });
}
function shinGeo(look) {
  return cached(`shin_${look.pants}_${look.shoes}`, () => {
    const s = cap(0.052, 0.32); s.translate(0, -0.21, 0);
    const f = new THREE.BoxGeometry(0.1, 0.07, 0.24); f.translate(0, -0.43, 0.05);
    return mergeGeometries([colored(s, look.pants), colored(f, look.shoes)]);
  });
}

function makePistol() {
  return cached('pistol', () => {
    const b = new THREE.BoxGeometry(0.035, 0.04, 0.2); b.translate(0, 0, 0.07);
    const g = new THREE.BoxGeometry(0.03, 0.1, 0.04); g.translate(0, -0.05, 0);
    return mergeGeometries([colored(b, 0x1a1a1a), colored(g, 0x2a2a2a)]);
  });
}

export class HumanModel {
  constructor(look) {
    this.look = look;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // allows whole-body tilt (falls)
    this.root.add(this.body);
    this.hips = new THREE.Group(); this.hips.position.y = 0.92;
    this.body.add(this.hips);
    this.spine = new THREE.Group(); this.hips.add(this.spine);
    this.torso = new THREE.Mesh(torsoGeo(look), MAT); this.spine.add(this.torso);
    this.neck = new THREE.Group(); this.neck.position.y = 0.6; this.spine.add(this.neck);
    this.head = new THREE.Mesh(headGeo(look), MAT); this.neck.add(this.head);
    const mk = (geo, parent, x, y, z) => { const grp = new THREE.Group(); grp.position.set(x, y, z); const m = new THREE.Mesh(geo, MAT); grp.add(m); parent.add(grp); grp.userData.mesh = m; return grp; };
    const sw = look.female ? 0.19 : 0.215;
    this.armL = mk(upperArmGeo(look), this.spine, sw * look.build, 0.52, 0);
    this.armR = mk(upperArmGeo(look), this.spine, -sw * look.build, 0.52, 0);
    this.elbowL = mk(foreArmGeo(look), this.armL, 0, -0.28, 0);
    this.elbowR = mk(foreArmGeo(look), this.armR, 0, -0.28, 0);
    this.legL = mk(thighGeo(look), this.hips, 0.095, 0.02, 0);
    this.legR = mk(thighGeo(look), this.hips, -0.095, 0.02, 0);
    this.kneeL = mk(shinGeo(look), this.legL, 0, -0.44, 0);
    this.kneeR = mk(shinGeo(look), this.legR, 0, -0.44, 0);
    this.gun = new THREE.Mesh(makePistol(), MAT);
    this.gun.position.set(0, -0.3, 0.03); this.gun.visible = false;
    this.elbowR.add(this.gun);
    this.root.scale.setScalar(look.height);
    this.meshes = [];
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; this.meshes.push(o); } });
    this.phase = R() * 10;
    this.blend = { walk: 0 };
    this.punchT = 0;
    this.gesture = 0;
    this.fall = 0;
  }
  setShadow(on) { for (const m of this.meshes) m.castShadow = on; }
  dispose() { /* geometries are cached/shared */ }

  // state: {speed, mode: 'idle'|'move'|'crouch'|'air'|'swim'|'drive'|'ride'|'talk'|'dead'|'cower'|'handsup'|'phone'|'dance'|'sit'|'enter', aim, sprint, steer}
  animate(dt, st) {
    const sp = st.speed || 0;
    const mode = st.mode || 'idle';
    this.phase += dt * (sp < 0.1 ? 1 : 2.1 + sp * 0.95);
    const p = this.phase;
    const L = this, s = Math.sin(p), c = Math.cos(p);
    let hipsY = 0.92, lean = 0, legAmp = 0, armAmp = 0, kneeBase = 0, bob = 0;
    let armLx = 0, armRx = 0, armLz = 0.08, armRz = -0.08, elbL = -0.15, elbR = -0.15;
    let legLx = 0, legRx = 0, kneeL = 0, kneeR = 0, headX = 0, headY = 0, spineY = 0;
    let bodyRotX = 0, bodyY = 0;
    const run = Math.min(1, Math.max(0, (sp - 2.2) / 3));
    if (mode === 'move' || mode === 'crouch') {
      const w = Math.min(1, sp / 1.6);
      legAmp = lerp(0.5, 0.95, run) * w;
      armAmp = lerp(0.35, 1.0, run) * w;
      kneeBase = 0.15 * w;
      lean = lerp(0.04, 0.22, run) * w + (st.sprint ? 0.08 : 0);
      bob = Math.abs(s) * lerp(0.03, 0.07, run) * w;
      legLx = -s * legAmp; legRx = s * legAmp;
      kneeL = kneeBase + Math.max(0, c) * lerp(0.6, 1.5, run) * w;
      kneeR = kneeBase + Math.max(0, -c) * lerp(0.6, 1.5, run) * w;
      armLx = s * armAmp; armRx = -s * armAmp;
      elbL = elbR = -lerp(0.25, 1.3, run) * w - 0.1;
      if (mode === 'crouch') { hipsY = 0.62; lean += 0.35; kneeL += 0.9; kneeR += 0.9; legLx -= 0.7; legRx -= 0.7; }
    } else if (mode === 'idle' || mode === 'phone' || mode === 'talk') {
      const br = Math.sin(this.phase * 0.8) * 0.02;
      armLx = br; armRx = -br; lean = br * 0.5;
      if (mode === 'phone') { armRx = -1.4; armRz = -0.5; elbR = -2.3; headY = 0.2; }
      if (mode === 'talk') {
        this.gesture += dt;
        const g = Math.sin(this.gesture * 2.3) * 0.5 + 0.5;
        armRx = -0.5 - g * 0.5; elbR = -1.2 - g * 0.4; armRz = -0.2;
        armLx = -0.2 * Math.sin(this.gesture * 1.7); elbL = -0.6;
        headY = Math.sin(this.gesture * 0.9) * 0.2; headX = Math.sin(this.gesture * 2.9) * 0.05;
      }
    } else if (mode === 'crouchIdle') {
      hipsY = 0.6; lean = 0.35; kneeL = kneeR = 1.6; legLx = legRx = -1.0;
      elbL = elbR = -0.8; armLx = armRx = -0.3;
    } else if (mode === 'air') {
      legLx = -0.6; legRx = 0.2; kneeL = 1.0; kneeR = 0.5; armLx = -0.9; armRx = -0.6; armLz = 0.5; armRz = -0.5; elbL = elbR = -0.5;
    } else if (mode === 'swim') {
      hipsY = 0.92; bodyRotX = 1.25; bodyY = 0.6;
      armLx = -Math.PI + s * 1.6; armRx = -Math.PI - s * 1.6; elbL = elbR = -0.3;
      legLx = Math.sin(p * 2) * 0.4; legRx = -Math.sin(p * 2) * 0.4; kneeL = kneeR = 0.2;
    } else if (mode === 'drive' || mode === 'sit') {
      hipsY = 0.5; legLx = legRx = -1.45; kneeL = kneeR = 1.45;
      if (mode === 'drive') { armLx = armRx = -1.1; elbL = elbR = -0.5; armLz = 0.25 + (st.steer || 0) * 0.3; armRz = -0.25 + (st.steer || 0) * 0.3; }
      else { armLx = armRx = -0.3; elbL = elbR = -0.9; }
    } else if (mode === 'ride') {
      hipsY = 0.62; lean = 0.45; legLx = legRx = -1.1; kneeL = kneeR = 1.7; legLx -= 0.1;
      armLx = armRx = -1.25; elbL = elbR = -0.3; armLz = 0.35; armRz = -0.35;
    } else if (mode === 'dead') {
      this.fall = Math.min(1, this.fall + dt * 3);
      bodyRotX = -Math.PI / 2 * this.fall; bodyY = 0.12 * this.fall;
      armLz = 1.2; armRz = -1.0; legLx = 0.1; legRx = -0.2; kneeL = 0.3;
    } else if (mode === 'cower') {
      hipsY = 0.55; lean = 0.5; kneeL = kneeR = 1.8; legLx = legRx = -1.1;
      armLx = armRx = -2.2; elbL = elbR = -2.2; headX = 0.4;
    } else if (mode === 'handsup') {
      armLx = armRx = -2.9; armLz = 0.3; armRz = -0.3; elbL = elbR = -0.3;
    } else if (mode === 'dance') {
      this.gesture += dt * 4;
      const g = this.gesture;
      hipsY = 0.9 - Math.abs(Math.sin(g)) * 0.06; spineY = Math.sin(g * 0.5) * 0.4;
      armLx = -1.5 + Math.sin(g) * 1.2; armRx = -1.5 - Math.sin(g) * 1.2; elbL = elbR = -1.0;
      legLx = Math.sin(g) * 0.3; legRx = -Math.sin(g) * 0.3; kneeL = 0.3 + Math.max(0, Math.sin(g)) * 0.4; kneeR = 0.3 + Math.max(0, -Math.sin(g)) * 0.4;
      headY = Math.sin(g * 0.5) * 0.3;
    } else if (mode === 'enter') {
      armRx = -1.2; elbR = -0.4; lean = 0.15;
    }
    if (mode !== 'dead') this.fall = Math.max(0, this.fall - dt * 2);
    // Upper-body overlays
    if (st.aim && mode !== 'drive' && mode !== 'swim' && mode !== 'dead') {
      armRx = -1.55 + (st.aimPitch || 0); armRz = -0.05; elbR = -0.05; spineY = 0.25;
      armLx = -1.35 + (st.aimPitch || 0); armLz = -0.45; elbL = -0.4;
    }
    if (this.punchT > 0) {
      this.punchT -= dt;
      const t = 1 - Math.max(0, this.punchT) / 0.35;
      const k = Math.sin(t * Math.PI);
      armRx = lerp(armRx, -1.6, k); elbR = lerp(elbR, -0.05, k); spineY = -0.35 * k;
      armLx = lerp(armLx, -1.2, 0.6); elbL = -1.8;
    }
    if (st.hit > 0) { lean -= 0.4 * st.hit; headX -= 0.3 * st.hit; }
    const k = 1 - Math.exp(-dt * 14);
    const set = (o, prop, v) => { o.rotation[prop] += (v - o.rotation[prop]) * k; };
    this.hips.position.y += ((hipsY + bob) - this.hips.position.y) * k;
    set(this.spine, 'x', lean); set(this.spine, 'y', spineY);
    set(this.armL, 'x', armLx); set(this.armR, 'x', armRx); set(this.armL, 'z', armLz); set(this.armR, 'z', armRz);
    set(this.elbowL, 'x', elbL); set(this.elbowR, 'x', elbR);
    set(this.legL, 'x', legLx); set(this.legR, 'x', legRx);
    set(this.kneeL, 'x', kneeL); set(this.kneeR, 'x', kneeR);
    set(this.neck, 'x', headX); set(this.neck, 'y', headY);
    set(this.body, 'x', bodyRotX);
    this.body.position.y += (bodyY - this.body.position.y) * k;
    this.gun.visible = !!st.gun;
    return { footDown: Math.sign(s) !== Math.sign(this._ls || 0) && sp > 0.5 ? (this._ls = s, true) : (this._ls = s, false) };
  }
  punch() { this.punchT = 0.35; }
}
export { MAT as HUMAN_MATERIAL };
