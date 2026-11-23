// Procedural generation of the whole Vice Coast map: roads, buildings,
// districts, landmarks, props, interiors and colliders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, fbm, smoothstep, clamp } from '../util.js';
import {
  GX, GZ, NB, STEP, GRID_MIN, GRID_MAX, lineHW, blockBounds, SPECIAL, districtOf,
  groundHeight, WATER_Y, ISLAND, BRIDGE, WORLD, COUNTRY_X, bridgeDeck, graph, isLand,
} from './layout.js';
import * as TX from './textures.js';
import { makeFacadeMaterial, makeWetMaterial, makeNightGlowMaterial, ENV } from './materials.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

// Instanced batch accumulator
class Batch {
  constructor(geometry, material, { cast = true, receive = true, style = false, color = true } = {}) {
    this.g = geometry; this.mat = material; this.items = []; this.cast = cast; this.receive = receive;
    this.style = style; this.useColor = color;
  }
  add(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, color = 0xffffff, style = null, rx = 0, rz = 0) {
    this.items.push({ x, y, z, ry, sx, sy, sz, color, style, rx, rz });
  }
  build(parent) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(this.g, this.mat, this.items.length);
    const col = new THREE.Color();
    const styles = this.style ? new Float32Array(this.items.length * 4) : null;
    this.items.forEach((it, i) => {
      _e.set(it.rx, it.ry, it.rz); _q.setFromEuler(_e);
      _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx, it.sy, it.sz));
      mesh.setMatrixAt(i, _m);
      if (this.useColor) mesh.setColorAt(i, col.set(it.color));
      if (styles) styles.set(it.style || [3, 3.5, 1, 0], i * 4);
    });
    if (styles) this.g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(styles, 4));
    mesh.castShadow = this.cast; mesh.receiveShadow = this.receive;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    return mesh;
  }
}

const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

function makePalmGeometries() {
  const trunkParts = [];
  let y = 0, x = 0;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.CylinderGeometry(0.17 - i * 0.012, 0.2 - i * 0.012, 1.6, 7, 1);
    seg.translate(x, y + 0.8, 0);
    trunkParts.push(seg);
    y += 1.55; x += 0.05 * i;
  }
  const trunk = mergeGeometries(trunkParts);
  const leaves = [];
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.PlaneGeometry(0.9, 3.6, 1, 4);
    const pos = leaf.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const ly = pos.getY(k) + 1.8; // 0..3.6 along leaf
      pos.setXYZ(k, pos.getX(k) * (1 - ly / 4.2), ly, -0.12 * ly * ly);
    }
    leaf.rotateX(-0.5);
    leaf.rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.2);
    leaf.translate(x, y, 0);
    leaves.push(leaf);
  }
  const coco = new THREE.SphereGeometry(0.35, 6, 4); coco.translate(x, y - 0.2, 0);
  leaves.push(coco.toNonIndexed ? coco : coco);
  const lg = mergeGeometries(leaves.map((g) => (g.index ? g.toNonIndexed() : g)));
  lg.computeVertexNormals();
  return { trunk, leaves: lg };
}
function makeTreeGeometries() {
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6).translate(0, 1.5, 0);
  const a = new THREE.IcosahedronGeometry(2.2, 1); a.translate(0, 4.2, 0);
  const b = new THREE.IcosahedronGeometry(1.6, 1); b.translate(0.9, 3.6, 0.5);
  const c = new THREE.IcosahedronGeometry(1.5, 1); c.translate(-0.8, 3.8, -0.6);
  const crown = mergeGeometries([a, b, c]);
  // jitter vertices for organic look
  const r = rng(4), pos = crown.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + (r() - 0.5) * 0.35, pos.getY(i) + (r() - 0.5) * 0.35, pos.getZ(i) + (r() - 0.5) * 0.35);
  crown.computeVertexNormals();
  return { trunk, crown };
}
function makeLampGeometry() {
  const pole = new THREE.CylinderGeometry(0.09, 0.14, 8, 6).translate(0, 4, 0);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 2.6).translate(0, 7.9, 1.2);
  const head = new THREE.BoxGeometry(0.45, 0.18, 0.9).translate(0, 7.85, 2.4);
  return mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed(), head.toNonIndexed()]);
}
function prismGeometry() {
  // Gable roof: unit footprint (x -0.5..0.5, z -0.5..0.5), height 1
  const g = new THREE.BufferGeometry();
  const v = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, // back tri
    0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0.5, // front tri
    -0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, -0.5, 0, 0.5, // left slope
    0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5, // right slope
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class City {
  constructor(scene, collision) {
    this.scene = scene;
    this.col = collision;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.r = rng(20260);
    this.parkedSpots = [];   // {x,z,rot,type}
    this.pedLoops = [];      // {pts:[{x,z}], district}
    this.shops = [];         // interactable markers
    this.lamps = [];
    this.collectibleSpots = [];
    this.neonMats = [];
    this.signs = [];
    this.trafficHeads = [];
    this.dance = [];
    this.build();
  }

  // ---------- Setup of materials and batches ----------
  initBatches() {
    const facade = makeFacadeMaterial();
    this.mats = {
      facade,
      solid: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.7 }),
      glow: makeNightGlowMaterial(0xffffff, 2.2, 'inst'),
      sidewalk: makeWetMaterial({ color: 0xffffff, map: TX.makeConcreteTexture(), roughness: 0.85 }, 'sidewalk', 0.25, 0.8),
      grass: makeWetMaterial({ color: 0xb8c8a8, map: TX.makeGrassTexture(), roughness: 1 }, 'grass', 0.2, 0.4),
      asphalt: makeWetMaterial({ color: 0xffffff, map: TX.makeAsphaltTexture(), roughness: 0.92 }, 'asph', 0.06),
      palmTrunk: new THREE.MeshStandardMaterial({ color: 0x8a7356, roughness: 1 }),
      palmLeaf: new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 0.8, side: THREE.DoubleSide }),
      treeTrunk: new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1 }),
      treeCrown: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.5, metalness: 0.6 }),
      bulb: makeNightGlowMaterial(0xffd9a0, 6, 'bulb'),
      pool: new THREE.MeshStandardMaterial({ color: 0x18b6d8, roughness: 0.05, metalness: 0.1, emissive: 0x0a4f66, emissiveIntensity: 0.5 }),
      tile: new THREE.MeshStandardMaterial({ map: TX.makeFloorTileTexture(), roughness: 0.4 }),
    };
    this.mats.tile.map.repeat.set(1, 1);
    const box = unitBox();
    this.B = {
      facade: new Batch(unitBox(), facade, { style: true }),
      solid: new Batch(box, this.mats.solid),
      metal: new Batch(box.clone(), this.mats.metal),
      glow: new Batch(box.clone(), this.mats.glow, { cast: false }),
      sidewalk: new Batch(box.clone(), this.mats.sidewalk, { cast: false, color: true }),
      grass: new Batch(box.clone(), this.mats.grass, { cast: false }),
      asphalt: new Batch(box.clone(), this.mats.asphalt, { cast: false }),
      roof: new Batch(prismGeometry(), this.mats.solid.clone()),
      cyl: new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 14).translate(0, 0.5, 0), this.mats.solid),
      pool: new Batch(box.clone(), this.mats.pool, { cast: false }),
    };
    const palm = makePalmGeometries();
    this.B.palmTrunk = new Batch(palm.trunk, this.mats.palmTrunk, { color: false });
    this.B.palmLeaf = new Batch(palm.leaves, this.mats.palmLeaf);
    const tree = makeTreeGeometries();
    this.B.treeTrunk = new Batch(tree.trunk, this.mats.treeTrunk, { color: false });
    this.B.treeCrown = new Batch(tree.crown, this.mats.treeCrown);
    this.B.lamp = new Batch(makeLampGeometry(), this.mats.lamp, { color: false });
    this.B.bulb = new Batch(new THREE.BoxGeometry(0.4, 0.06, 0.8), this.mats.bulb, { cast: false, color: false });
    // Ground light pools (additive decals)
    const poolTex = TX.makeRadialTexture('rgba(255,210,150,0.55)', 'rgba(255,210,150,0)');
    this.lightPoolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    this.B.lightPool = new Batch(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.lightPoolMat, { cast: false, receive: false, color: false });
  }

  // Helpers
  box(x0, z0, x1, z1, y0, h, color, { batch = 'solid', collide = true, tag = 'prop' } = {}) {
    const w = x1 - x0, d = z1 - z0;
    this.B[batch].add((x0 + x1) / 2, y0, (z0 + z1) / 2, 0, Math.abs(w), h, Math.abs(d), color);
    if (collide) this.col.add(x0, z0, x1, z1, y0, y0 + h, tag);
  }
  building(x0, z0, x1, z1, h, color, style, y0 = 0.15) {
    this.B.facade.add((x0 + x1) / 2, y0, (z0 + z1) / 2, 0, x1 - x0, h, z1 - z0, color, style);
    this.col.add(x0, z0, x1, z1, y0 - 0.2, y0 + h, 'building');
  }
  palm(x, z, s = 1) {
    const y = groundHeight(x, z) - 0.1, ry = this.r() * 6.28;
    this.B.palmTrunk.add(x, y, z, ry, s, s * (0.85 + this.r() * 0.35), s);
    const it = this.B.palmTrunk.items[this.B.palmTrunk.items.length - 1];
    this.B.palmLeaf.add(x, y, z, ry, s, it.sy, s, new THREE.Color().setHSL(0.27 + this.r() * 0.05, 0.45, 0.28 + this.r() * 0.08).getHex());
    this.col.add(x - 0.25, z - 0.25, x + 0.25, z + 0.25, y, y + 9, 'tree');
  }
  tree(x, z, s = 1, hue) {
    const y = groundHeight(x, z) - 0.1, ry = this.r() * 6.28;
    this.B.treeTrunk.add(x, y, z, ry, s, s, s);
    const c = new THREE.Color().setHSL(hue ?? 0.24 + this.r() * 0.08, 0.45, 0.22 + this.r() * 0.1);
    this.B.treeCrown.add(x, y, z, ry, s, s, s, c.getHex());
    this.col.add(x - 0.35 * s, z - 0.35 * s, x + 0.35 * s, z + 0.35 * s, y, y + 6 * s, 'tree');
  }
  lamp(x, z, ry) {
    const y = groundHeight(x, z);
    this.B.lamp.add(x, y, z, ry);
    const hx = x + Math.sin(ry) * 2.4, hz = z + Math.cos(ry) * 2.4;
    this.B.bulb.add(hx, y + 7.74, hz, ry);
    this.B.lightPool.add(hx, y + 0.06, hz, 0, 13, 1, 13);
    this.col.add(x - 0.15, z - 0.15, x + 0.15, z + 0.15, y, y + 8, 'pole');
    this.lamps.push({ x: hx, z: hz, y: y + 7.7 });
  }
  sign(text, x, y, z, ry, w, h, opts = {}) {
    const t = TX.makeTextTexture(text, opts);
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z); mesh.rotation.y = ry;
    this.group.add(mesh);
    this.neonMats.push({ mat, neon: opts.neon !== false });
    return mesh;
  }

  // ---------- Build everything ----------
  build() {
    this.initBatches();
    this.buildTerrain();
    this.buildRoads();
    this.buildBlocks();
    this.buildStreetFurniture();
    this.buildBeach();
    this.buildBridgeAndIsland();
    this.buildAirport();
    this.buildPort();
    this.buildCountryside();
    this.buildCollectibleSpots();
    for (const k in this.B) {
      const m = this.B[k].build(this.group);
      if (k === 'lightPool' && m) { m.renderOrder = 2; this.lightPoolMesh = m; }
    }
  }

  buildTerrain() {
    const res = 16;
    const w = WORLD.x1 - WORLD.x0, d = WORLD.z1 - WORLD.z0;
    const nx = Math.ceil(w / res), nz = Math.ceil(d / res);
    const geo = new THREE.PlaneGeometry(w, d, nx, nz).rotateX(-Math.PI / 2);
    geo.translate(WORLD.x0 + w / 2, 0, WORLD.z0 + d / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let h = groundHeight(x, z);
      const inCity = x > GRID_MIN - 14 && x < GRID_MAX + 14 && z > GRID_MIN - 14 && z < GRID_MAX + 14;
      if (inCity) h = -0.05;
      pos.setY(i, h);
      const n = fbm(x * 0.01, z * 0.01, 3);
      const di = Math.hypot(x - ISLAND.x, z - ISLAND.z);
      if (h < WATER_Y + 1.0 || (x > 852 && !(Math.abs(z) < 12 && x < 1110)) || (di > ISLAND.r - 25 && di < ISLAND.r + 50)) {
        c.setRGB(0.78, 0.68, 0.5).multiplyScalar(0.9 + n * 0.2); // sand
        if (h < WATER_Y - 0.5) c.multiplyScalar(0.7);
      } else if (z > GRID_MAX + 10 && z < 1260) {
        c.setRGB(0.3, 0.31, 0.32).multiplyScalar(0.85 + n * 0.3); // port concrete
      } else if (z < GRID_MIN - 10 && x > -980 && x < 620 && z > -1290) {
        c.setRGB(0.42, 0.52, 0.3).multiplyScalar(0.85 + n * 0.3); // airport grass
      } else if (x < COUNTRY_X) {
        // fields & grassland
        const fx = Math.floor((x + 3000) / 140), fz = Math.floor((z + 3000) / 110);
        const field = ((fx * 7 + fz * 13) % 5);
        if (h < 6 && field === 0) c.setRGB(0.62, 0.55, 0.3); // wheat
        else if (h < 6 && field === 1) c.setRGB(0.35, 0.5, 0.2); // crops
        else c.setRGB(0.36, 0.48, 0.24).lerp(new THREE.Color(0.5, 0.48, 0.32), clamp(h / 30, 0, 1));
        c.multiplyScalar(0.8 + n * 0.4);
      } else c.setRGB(0.4, 0.5, 0.3);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const noiseTex = TX.makeNoiseTexture();
    const mat = makeWetMaterial({ vertexColors: true, map: noiseTex, roughness: 1, color: 0xffffff }, 'terrain', 0.08, 0.5);
    // map tint should be subtle: lighten the texture by blending
    mat.onBeforeCompile = ((orig) => (sh) => { orig(sh); sh.fragmentShader = sh.fragmentShader.replace('diffuseColor *= sampledDiffuseColor;', 'diffuseColor.rgb *= mix(vec3(1.0), sampledDiffuseColor.rgb * 1.9, 0.45);'); })(mat.onBeforeCompile);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrain = mesh;
  }

  buildRoads() {
    const roadMats = {};
    const getMat = (w, lanes) => {
      const k = w + '_' + lanes;
      if (!roadMats[k]) roadMats[k] = makeWetMaterial({ map: TX.makeRoadTexture(w, lanes), roughness: 0.9, color: 0xffffff }, 'road' + k);
      return roadMats[k];
    };
    const parts = {}; // key -> geometries
    const pushSeg = (axis, v, a, b, hw, y = 0.02, follow = null) => {
      const lanes = hw >= 10 ? 2 : 1;
      const k = (hw * 2) + '_' + lanes;
      const len = Math.abs(b - a);
      const segs = follow ? Math.max(1, Math.ceil(len / 8)) : 1;
      const g = new THREE.PlaneGeometry(hw * 2, len, 1, segs).rotateX(-Math.PI / 2);
      // UV v along length in meters / 12
      const uv = g.attributes.uv, pos = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getZ(i) + len / 2) / 12);
      if (axis === 'x') g.translate(v, y, (a + b) / 2); // road along z at x=v
      else { g.rotateY(Math.PI / 2); g.translate((a + b) / 2, y, v); }
      if (follow) for (let i = 0; i < pos.count; i++) pos.setY(i, follow(pos.getX(i), pos.getZ(i)) + y);
      (parts[k] = parts[k] || []).push(g);
    };
    // City grid segments between intersections
    for (let i = 0; i < GX.length; i++) {
      const x = GX[i], hw = lineHW('x', x);
      for (let j = 0; j < GZ.length - 1; j++) {
        const a = GZ[j] + lineHW('z', GZ[j]), b = GZ[j + 1] - lineHW('z', GZ[j + 1]);
        pushSeg('x', x, a, b, hw);
      }
    }
    for (let j = 0; j < GZ.length; j++) {
      const z = GZ[j], hw = lineHW('z', z);
      for (let i = 0; i < GX.length - 1; i++) {
        const a = GX[i] + lineHW('x', GX[i]), b = GX[i + 1] - lineHW('x', GX[i + 1]);
        pushSeg('z', z, a, b, hw);
      }
    }
    // Expressway west to countryside, east to bridge; country road at z=600
    pushSeg('z', 0, -2040, GRID_MIN - lineHW('x', GRID_MIN), 11, 0.03, (x, z) => groundHeight(x, z));
    pushSeg('z', 600, -1810, GRID_MIN - 7, 7, 0.03, (x, z) => groundHeight(x, z));
    pushSeg('z', 0, GRID_MAX + 9, BRIDGE.x1 + 4, 10, 0.05, (x) => (x > BRIDGE.x0 - 20 ? bridgeDeck(x) : 0));
    // Airport access & port access roads
    pushSeg('x', -600, -1100, GRID_MIN - 7, 7);
    pushSeg('x', 360, GRID_MAX + 7, 1200, 7);
    for (const k in parts) {
      const [w, lanes] = k.split('_').map(Number);
      const mesh = new THREE.Mesh(mergeGeometries(parts[k]), getMat(w, lanes));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // Intersections (plain asphalt) + crosswalks
    const inter = [];
    const cw = [];
    for (const x of GX) for (const z of GZ) {
      const hx = lineHW('x', x), hz = lineHW('z', z);
      const g = new THREE.PlaneGeometry(hx * 2, hz * 2).rotateX(-Math.PI / 2).translate(x, 0.025, z);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * hx / 6, uv.getY(i) * hz / 6);
      inter.push(g);
      // crosswalk on each side
      cw.push({ x, z: z - hz - 2.2, ry: 0, w: hx * 2 }, { x, z: z + hz + 2.2, ry: Math.PI, w: hx * 2 },
        { x: x - hx - 2.2, z, ry: Math.PI / 2, w: hz * 2 }, { x: x + hx + 2.2, z, ry: -Math.PI / 2, w: hz * 2 });
    }
    const im = new THREE.Mesh(mergeGeometries(inter), this.mats.asphalt);
    im.receiveShadow = true; this.group.add(im);
    const cwMat = new THREE.MeshStandardMaterial({ map: TX.makeCrosswalkTexture(), transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const cwm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 4.2).rotateX(-Math.PI / 2), cwMat, cw.length);
    cw.forEach((c, i) => { _q.setFromAxisAngle(UP, c.ry); _m.compose(_p.set(c.x, 0.035, c.z), _q, _s.set(c.w * 0.9, 1, 1)); cwm.setMatrixAt(i, _m); });
    cwm.receiveShadow = true; this.group.add(cwm);
    this.buildTrafficLights();
  }

  buildTrafficLights() {
    const housing = new Batch(unitBox(), new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 }), { color: false });
    const pole = new Batch(new THREE.CylinderGeometry(0.1, 0.12, 1, 6).translate(0, 0.5, 0), this.mats.lamp, { color: false });
    const mk = (c) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0.05, roughness: 0.3 });
    this.tlMats = { ns: { r: mk(0xff2010), y: mk(0xffaa00), g: mk(0x20ff60) }, ew: { r: mk(0xff2010), y: mk(0xffaa00), g: mk(0x20ff60) } };
    const lampGeo = new THREE.SphereGeometry(0.17, 8, 6);
    const lampB = {};
    for (const ax of ['ns', 'ew']) for (const c of ['r', 'y', 'g']) lampB[ax + c] = new Batch(lampGeo, this.tlMats[ax][c], { cast: false, color: false });
    const dirs = [[0, -1], [0, 1], [1, 0], [-1, 0]];
    for (const n of graph.nodes) {
      if (!n.light) continue;
      for (const [dx, dz] of dirs) {
        const ax = dz !== 0 ? 'ns' : 'ew';
        const hwAlong = dz !== 0 ? lineHW('x', n.x) : lineHW('z', n.z);
        const hwPerp = dz !== 0 ? lineHW('z', n.z) : lineHW('x', n.x);
        const rx = -dz, rz = dx; // right vector
        // pole at the far-right corner after the intersection
        const px = n.x + dx * (hwPerp + 1.0) + rx * (hwAlong + 1.0);
        const pz = n.z + dz * (hwPerp + 1.0) + rz * (hwAlong + 1.0);
        const ry = Math.atan2(-dx, -dz); // face incoming traffic
        pole.add(px, 0.15, pz, 0, 1, 6.2, 1);
        // arm over the road
        const armLen = hwAlong * 0.8;
        const ax2 = px - rx * armLen / 2, az2 = pz - rz * armLen / 2;
        housing.add(ax2, 6.0, az2, ry + Math.PI / 2, armLen, 0.15, 0.15);
        const hx = px - rx * (armLen - 0.6), hz = pz - rz * (armLen - 0.6);
        housing.add(hx, 4.9, hz, ry, 0.5, 1.3, 0.4);
        const fx = -dx * 0.22, fz = -dz * 0.22;
        lampB[ax + 'r'].add(hx + fx, 5.95, hz + fz);
        lampB[ax + 'y'].add(hx + fx, 5.55, hz + fz);
        lampB[ax + 'g'].add(hx + fx, 5.15, hz + fz);
        this.col.add(px - 0.15, pz - 0.15, px + 0.15, pz + 0.15, 0, 6, 'pole');
      }
    }
    housing.build(this.group); pole.build(this.group);
    for (const k in lampB) lampB[k].build(this.group);
  }

  // ---------- City blocks ----------
  buildBlocks() {
    for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
      const bb = blockBounds(i, j);
      const district = districtOf(bb.cx, bb.cz);
      const special = SPECIAL[`${i},${j}`];
      // Sidewalk slab
      const swColor = district === 'beach' ? 0xe8d8c8 : district === 'ghetto' ? 0x9a978f : 0xc8c5bd;
      this.B.sidewalk.add(bb.cx, 0, bb.cz, 0, bb.x1 - bb.x0, 0.15, bb.z1 - bb.z0, swColor);
      // Ped loop around block (sidewalk), 2.2m in from edge
      const ins = 2.2;
      this.blockLoop = this.blockLoop || {};
      this.pedLoops.push(this.blockLoop[`${i},${j}`] = {
        district, block: [i, j], pts: [
          { x: bb.x0 + ins, z: bb.z0 + ins }, { x: bb.x1 - ins, z: bb.z0 + ins },
          { x: bb.x1 - ins, z: bb.z1 - ins }, { x: bb.x0 + ins, z: bb.z1 - ins }],
      });
      const inner = { x0: bb.x0 + 5, x1: bb.x1 - 5, z0: bb.z0 + 5, z1: bb.z1 - 5 };
      if (special) this.buildSpecial(special, inner, bb, i, j, district);
      else this.buildDistrictBlock(district, inner, bb);
    }
  }

  buildDistrictBlock(district, b, bb) {
    const r = this.r;
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    if (district === 'downtown') {
      const n = r() < 0.35 ? 1 : 2;
      const cw = W / n, cd = D / n;
      for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) {
        const x0 = b.x0 + a * cw + 2, z0 = b.z0 + c * cd + 2, x1 = x0 + cw - 4, z1 = z0 + cd - 4;
        const distC = Math.hypot(bb.cx - 120, bb.cz + 180);
        const h = (n === 1 ? 1.3 : 1) * (60 + r() * 130) * (1.25 - distC / 500);
        this.tower(x0, z0, x1, z1, Math.max(40, h));
      }
    } else if (district === 'midtown' || district === 'industrial') {
      if (district === 'industrial') {
        const n = r() < 0.5 ? 1 : 2;
        for (let a = 0; a < n; a++) {
          const z0 = b.z0 + a * (D / n) + 2, z1 = z0 + D / n - 6;
          const col = r.pick([0x8c8f93, 0x6f7f8c, 0x9a8a76, 0x7b8676, 0xa59f92]);
          this.building(b.x0 + 4, z0, b.x1 - 4, z1, 9 + r() * 7, col, [6, 5, 4, r() * 10]);
          // loading dock & barrels
          this.box(b.x1 - 4, z0 + 3, b.x1 - 1, z0 + 9, 0.15, 1.2, 0x555555);
        }
        // a few parked trucks/cars
        this.parkedSpots.push({ x: b.x0 + 2, z: (b.z0 + b.z1) / 2, rot: 0, type: r.pick(['pickup', 'sedan']) });
        return;
      }
      const nx = 2, nz = 2;
      const cw = W / nx, cd = D / nz;
      for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
        if (r() < 0.12) { // small plaza with trees
          this.tree(b.x0 + a * cw + cw / 2, b.z0 + c * cd + cd / 2, 1);
          continue;
        }
        const x0 = b.x0 + a * cw + 1.5, z0 = b.z0 + c * cd + 1.5, x1 = x0 + cw - 3, z1 = z0 + cd - 3;
        const h = 12 + r() * 38;
        const col = r.pick([0xd9c7a7, 0xc9a48a, 0xe5dccb, 0xa8a8a8, 0xbfb2a1, 0xd4b896, 0x9fb1b8]);
        this.building(x0, z0, x1, z1, h, col, [r.pick([2.5, 3, 3.5]), 3.4, r() < 0.3 ? 0 : 1, r() * 10]);
        this.roofStuff(x0, z0, x1, z1, h + 0.15);
      }
    } else if (district === 'beach') {
      // Art deco hotels facing the ocean (east)
      const n = 3;
      const cd = D / n;
      const names = ['The Flamingo', 'Coral Breeze', 'Ocean Grand', 'Starlite', 'Pastel Palms', 'Hotel Marisol', 'The Seabreeze', 'Neptune Inn', 'Moonwave', 'Casa Azul', 'Hotel Riviera', 'Sunray'];
      const neon = ['#ff3cac', '#36e2ff', '#ffe04a', '#7dff6b', '#c06bff'];
      for (let c = 0; c < n; c++) {
        const z0 = b.z0 + c * cd + 1.5, z1 = z0 + cd - 3;
        const x0 = b.x0 + 6, x1 = b.x1 - 2;
        const h = 10 + r() * 14;
        const col = r.pick([0xf7c6d9, 0xbff2df, 0xd9c8f2, 0xffd9b3, 0xb3e6f2, 0xfff3d1, 0xffffff]);
        this.building(x0, z0, x1, z1, h, col, [3, 3.4, 2, r() * 10]);
        // deco fins and neon strip
        this.box(x1 - 0.2, z0 + (z1 - z0) / 2 - 1, x1 + 0.6, z0 + (z1 - z0) / 2 + 1, 0.15, h + 3, col, { collide: false });
        const nc = r.pick(neon);
        this.B.glow.add(x1 + 0.08, h - 0.6, (z0 + z1) / 2, 0, 0.1, 0.25, z1 - z0 - 1, new THREE.Color(nc).getHex());
        this.sign(r.pick(names), x1 + 0.7, h - 3, (z0 + z1) / 2, Math.PI / 2, 12, 3, { color: '#ffffff', glow: nc, font: 'italic bold 64px "Brush Script MT", "Segoe Script", cursive' });
        // awning & cafe tables
        this.box(x1, z0 + 2, x1 + 3, z1 - 2, 3.2, 0.15, r.pick([0xff6f91, 0x2ec4b6, 0xffbf69]), { collide: false });
        for (let t = z0 + 4; t < z1 - 3; t += 5) this.box(x1 + 1.2, t - 0.4, x1 + 2, t + 0.4, 0.15, 0.8, 0xffffff);
      }
      // palms along Ocean Drive sidewalk
      for (let z = bb.z0 + 6; z < bb.z1; z += 14) this.palm(bb.x0 + 2, z, 1);
    } else if (district === 'suburb' || district === 'ghetto') {
      const ghetto = district === 'ghetto';
      this.B.grass.add((b.x0 + b.x1) / 2, 0.15, (b.z0 + b.z1) / 2, 0, W, 0.02, D, ghetto ? 0x8a8a62 : 0xb5d39a);
      // Houses around the perimeter facing the street, backyard in middle
      const per = ghetto ? 4 : 3;
      const lw = W / per;
      const houseCols = ghetto ? [0xa89f8d, 0x8d9aa3, 0xb59a7c, 0x9aa88b, 0xc2b8a3, 0x7d8b8f] : [0xfdf1d6, 0xe8f3f8, 0xfde2d1, 0xf4f0e6, 0xdff0d8, 0xf7e7b5];
      const roofCols = ghetto ? [0x55585b, 0x6b5f55, 0x4c4f52] : [0xb5653e, 0xa65a3a, 0x6c6f73, 0x8f4c33];
      for (const side of [0, 1]) for (let k = 0; k < per; k++) {
        const hw = lw * (ghetto ? 0.7 : 0.62), hd = ghetto ? 9 : 11;
        const cx = b.x0 + k * lw + lw / 2;
        const cz = side === 0 ? b.z0 + 3 + hd / 2 + 3 : b.z1 - 3 - hd / 2 - 3;
        if (ghetto && r() < 0.18) { // empty lot with junk
          this.box(cx - 1, cz - 1, cx + 1.5, cz + 1, 0.15, 0.9, 0x6b4f3a);
          continue;
        }
        const h = ghetto ? 3.6 : 3.8 + (r() < 0.4 ? 3 : 0);
        const col = r.pick(houseCols);
        this.building(cx - hw / 2, cz - hd / 2, cx + hw / 2, cz + hd / 2, h, col, [3, 3.4, 3, r() * 10]);
        this.B.roof.add(cx, h + 0.15, cz, 0, hw + 0.8, 2.2, hd + 0.8, r.pick(roofCols));
        // driveway + parked car
        if (!ghetto && r() < 0.6) {
          const dz = side === 0 ? b.z0 - 3.5 : b.z1 + 3.5;
          this.parkedSpots.push({ x: cx + hw / 2 + 2.6, z: (cz + dz) / 2, rot: 0, type: r.pick(['sedan', 'suv', 'pickup', 'sedan']) });
        }
        if (ghetto && r() < 0.35) this.parkedSpots.push({ x: cx, z: side === 0 ? b.z0 - 2.5 : b.z1 + 2.5, rot: Math.PI / 2, type: r.pick(['sedan', 'pickup']) });
        // fence
        const fz = side === 0 ? cz + hd / 2 + 2 : cz - hd / 2 - 2;
        this.box(cx - lw / 2 + 0.3, fz - 0.05, cx + lw / 2 - 0.3, fz + 0.05, 0.15, ghetto ? 1.8 : 1, ghetto ? 0x8a8d90 : 0xffffff, { batch: ghetto ? 'metal' : 'solid' });
        if (!ghetto && r() < 0.6) this.tree(cx + hw / 2 + 1.5, cz + (side ? 6 : -6) * 0.7, 0.8 + r() * 0.4);
        if (!ghetto && r() < 0.22) { // backyard pool
          const pz = side === 0 ? fz + 6 : fz - 6;
          this.B.pool.add(cx, 0.16, pz, 0, 6, 0.02, 3.5);
        }
      }
      // Ghetto: an apartment block "projects" on some blocks
      if (ghetto && r() < 0.4) {
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        this.building(cx - 14, cz - 7, cx + 14, cz + 7, 15, 0x9b8c7c, [3, 3, 1, r() * 10]);
      }
    }
  }

  tower(x0, z0, x1, z1, h) {
    const r = this.r;
    const glass = r() < 0.65;
    const col = glass ? r.pick([0x6d8aa1, 0x587a8a, 0x8899a6, 0x7a8f86, 0x9aa5ad, 0x8b7a6a]) : r.pick([0xcfc6b6, 0xb9b0a3, 0xd8d0c4, 0xa3a3a0]);
    const style = [glass ? 2.2 : 3, 3.6, glass ? 0 : 1, r() * 10];
    const setback = r() < 0.6;
    const h1 = setback ? h * (0.55 + r() * 0.2) : h;
    this.building(x0, z0, x1, z1, h1, col, style);
    // podium
    this.building(x0 - 1, z0 - 1, x1 + 1, z1 + 1, 6, 0x8f8a84, [4, 6, 0, r() * 10]);
    let top = h1;
    if (setback) {
      const ix = (x1 - x0) * 0.15, iz = (z1 - z0) * 0.15;
      this.building(x0 + ix, z0 + iz, x1 - ix, z1 - iz, h - h1, col, style, h1 + 0.15);
      top = h;
      if (r() < 0.5) {
        const jx = (x1 - x0) * 0.32, jz = (z1 - z0) * 0.32;
        this.building(x0 + jx, z0 + jz, x1 - jx, z1 - jz, 8 + r() * 14, col, style, top + 0.15);
        top += 10;
      }
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (r() < 0.45) { // antenna with aviation light
      this.B.metal.add(cx, top, cz, 0, 0.5, 14 + r() * 16, 0.5, 0xaaaaaa);
      const it = this.B.metal.items[this.B.metal.items.length - 1];
      this.B.glow.add(cx, top + it.sy, cz, 0, 0.7, 0.7, 0.7, 0xff2020);
    } else if (r() < 0.4) {
      // crown light strip
      const c = r.pick([0x36e2ff, 0xff3cac, 0xffffff, 0x9d6bff]);
      this.B.glow.add(cx, top + 0.2, z0 + (setback ? (z1 - z0) * 0.15 : 0) - 0.05, 0, (x1 - x0) * (setback ? 0.7 : 1), 0.4, 0.15, c);
    }
    this.roofStuff(x0 + 3, z0 + 3, x1 - 3, z1 - 3, top + 0.15, true);
    if (r() < 0.15) {
      const ads = ['WAVE FM 101.5', 'SUNNY COLA', 'LUX MOTORS', 'VICE COAST · LIVE LOUD', 'PIXEL BANK', 'CORAL MOBILE'];
      this.sign(r.pick(ads), cx, Math.min(h1, 40) - 6, z1 + 1.2, 0, 20, 5, { color: '#ffffff', glow: r.pick(['#36e2ff', '#ff3cac', '#ffe04a']), bg: 'rgba(10,10,20,0.85)' });
    }
  }
  roofStuff(x0, z0, x1, z1, y, big = false) {
    const r = this.r;
    const n = big ? 3 : 1 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const w = 2 + r() * 3, d = 2 + r() * 3;
      const x = x0 + r() * Math.max(0.1, x1 - x0 - w), z = z0 + r() * Math.max(0.1, z1 - z0 - d);
      this.B.metal.add(x + w / 2, y, z + d / 2, 0, w, 1.2 + r() * 1.5, d, 0x9a9da1);
    }
    if (r() < 0.25) { // water tank
      const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
      this.B.cyl.add(x, y + 2, z, 0, 3.5, 3.5, 3.5, 0x7a5d44);
      this.B.metal.add(x, y, z, 0, 0.2, 2, 0.2, 0x555555);
    }
  }

  // ---------- Special blocks ----------
  shop(def) {
    // Hollow building with a door gap. def: {x0,z0,x1,z1,h,door:'n'|'s'|'e'|'w',wall,name,kind,signColor,floor}
    const { x0, z0, x1, z1, h = 5, door = 's', wall = 0xe8e0d0, t = 0.4, y = 0.15 } = def;
    const dw = def.doorW || 4;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const wallB = def.batch || 'solid';
    const seg = (ax0, az0, ax1, az1) => this.box(ax0, az0, ax1, az1, y, h, wall, { batch: wallB, tag: 'building' });
    // north wall (z0), south (z1), west (x0), east (x1)
    const sides = {
      n: () => { seg(x0, z0, cx - dw / 2, z0 + t); seg(cx + dw / 2, z0, x1, z0 + t); this.box(cx - dw / 2, z0, cx + dw / 2, z0 + t, y + 3.2, h - 3.2, wall, { tag: 'building' }); },
      s: () => { seg(x0, z1 - t, cx - dw / 2, z1); seg(cx + dw / 2, z1 - t, x1, z1); this.box(cx - dw / 2, z1 - t, cx + dw / 2, z1, y + 3.2, h - 3.2, wall, { tag: 'building' }); },
      w: () => { seg(x0, z0, x0 + t, cz - dw / 2); seg(x0, cz + dw / 2, x0 + t, z1); this.box(x0, cz - dw / 2, x0 + t, cz + dw / 2, y + 3.2, h - 3.2, wall, { tag: 'building' }); },
      e: () => { seg(x1 - t, z0, x1, cz - dw / 2); seg(x1 - t, cz + dw / 2, x1, z1); this.box(x1 - t, cz - dw / 2, x1, cz + dw / 2, y + 3.2, h - 3.2, wall, { tag: 'building' }); },
    };
    for (const s of ['n', 's', 'w', 'e']) {
      if (s === door) sides[s]();
      else if (s === 'n') seg(x0, z0, x1, z0 + t);
      else if (s === 's') seg(x0, z1 - t, x1, z1);
      else if (s === 'w') seg(x0, z0, x0 + t, z1);
      else seg(x1 - t, z0, x1, z1);
    }
    // Roof (camera collides, player passes below)
    this.box(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, y + h, 0.4, def.roof || 0x8a8580, { tag: 'roof' });
    // Floor
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.2, z1 - z0 - 0.2).rotateX(-Math.PI / 2), def.floorMat || this.mats.tile);
    fl.position.set(cx, y + 0.02, cz); fl.receiveShadow = true;
    if (!def.floorMat) { const u = fl.geometry.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * (x1 - x0) / 4, u.getY(i) * (z1 - z0) / 4); }
    this.group.add(fl);
    // Ceiling light panels
    for (let px = x0 + 3; px < x1 - 2; px += 5) for (let pz = z0 + 3; pz < z1 - 2; pz += 5)
      this.B.glow.add(px, y + h - 0.12, pz, 0, 1.6, 0.08, 1.6, 0xfff4dc);
    // Sign above door (outside)
    const dpos = { n: [cx, z0 - 0.3, Math.PI], s: [cx, z1 + 0.3, 0], w: [x0 - 0.3, cz, -Math.PI / 2], e: [x1 + 0.3, cz, Math.PI / 2] }[door];
    if (def.name) {
      const isX = door === 'w' || door === 'e';
      this.sign(def.name, isX ? dpos[0] : dpos[0], y + h - 1, isX ? dpos[1] : dpos[1], dpos[2], Math.min(10, (isX ? z1 - z0 : x1 - x0) * 0.8), 2, { color: '#ffffff', glow: def.signColor || '#36e2ff', bg: def.signBg || null });
    }
    const doorPt = { n: { x: cx, z: z0 - 2 }, s: { x: cx, z: z1 + 2 }, w: { x: x0 - 2, z: cz }, e: { x: x1 + 2, z: cz } }[door];
    return { cx, cz, door: doorPt, y };
  }
  addShop(kind, name, x, z, extra = {}) {
    this.shops.push({ kind, name, x, z, r: 1.6, ...extra });
  }
  counter(x0, z0, x1, z1, y = 0.15) { this.box(x0, z0, x1, z1, y, 1.05, 0x6b4a33, { tag: 'prop' }); this.box(x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, y + 1.05, 0.06, 0xdedede, { collide: false }); }
  shelves(x0, z0, x1, z1, colors) {
    this.box(x0, z0, x1, z1, 0.15, 1.9, 0xdcdcdc, { batch: 'metal', tag: 'prop' });
    const r = this.r;
    const alongX = x1 - x0 > z1 - z0;
    for (let s = 0; s < 3; s++) {
      const y = 0.5 + s * 0.55;
      if (alongX) for (let x = x0 + 0.3; x < x1 - 0.3; x += 0.45) {
        this.box(x, z0 - 0.08, x + 0.35, z1 + 0.08, y, 0.3, r.pick(colors), { collide: false });
      } else for (let z = z0 + 0.3; z < z1 - 0.3; z += 0.45) {
        this.box(x0 - 0.08, z, x1 + 0.08, z + 0.35, y, 0.3, r.pick(colors), { collide: false });
      }
    }
  }
  clerkAt(x, z, ry, kind) { (this.clerks = this.clerks || []).push({ x, z, ry, kind }); }

  // Choose the door side facing the nearest road
  doorSideFor(bb) {
    // Prefer south unless near the coast etc.
    return 's';
  }

  buildSpecial(type, b, bb, i, j, district) {
    const r = this.r;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const productCols = [0xe63946, 0xf1c40f, 0x2a9d8f, 0x457b9d, 0xffffff, 0xf4a261, 0x8e44ad, 0x27ae60];
    switch (type) {
      case 'mall': {
        const s = this.shop({ x0: b.x0 + 4, z0: b.z0 + 4, x1: b.x1 - 4, z1: b.z1 - 22, h: 12, door: 's', doorW: 8, wall: 0xf0ebe2, name: 'VICE COAST MALL', signColor: '#ff3cac', roof: 0xcfcac2 });
        // Storefronts inside along the north & side walls
        const stores = [['THREADS', '#36e2ff'], ['SOLE SURF', '#ffe04a'], ['PIXEL TECH', '#7dff6b'], ['GLAM', '#ff3cac'], ['SUNNY MART', '#ffb347']];
        const x0 = b.x0 + 6, x1 = b.x1 - 6, z0 = b.z0 + 6;
        const sw = (x1 - x0) / stores.length;
        stores.forEach(([n, c], k) => {
          const sx = x0 + k * sw;
          this.box(sx + 0.5, z0, sx + sw - 0.5, z0 + 0.3, 0.15, 4.5, 0xffffff, { collide: false });
          this.B.glow.add(sx + sw / 2, 4.2, z0 + 0.4, 0, sw - 2, 0.6, 0.05, new THREE.Color(c).getHex());
          this.sign(n, sx + sw / 2, 5.4, z0 + 0.5, 0, sw - 2, 1.4, { color: '#ffffff', glow: c });
          this.shelves(sx + 1.5, z0 + 3, sx + sw - 1.5, z0 + 3.6, productCols);
        });
        this.addShop('clothing', 'Threads (Mall)', x0 + sw / 2, z0 + 6);
        this.clerkAt(x0 + sw / 2, z0 + 4.6, 0, 'clothing');
        this.addShop('store', 'Sunny Mart (Mall)', x0 + 4.5 * sw, z0 + 6);
        this.clerkAt(x0 + 4.5 * sw, z0 + 4.6, 0, 'store');
        // Fountain & food court
        this.B.cyl.add(cx, 0.15, cz + 6, 0, 7, 0.7, 7, 0xd8d0c0);
        this.col.add(cx - 3.3, cz + 2.7, cx + 3.3, cz + 9.3, 0, 0.85, 'prop');
        this.B.pool.add(cx, 0.86, cz + 6, 0, 5.6, 0.02, 5.6);
        for (let k = 0; k < 6; k++) {
          const tx = b.x0 + 10 + k * 8, tz = cz + 14;
          this.B.cyl.add(tx, 0.15, tz, 0, 1.2, 0.8, 1.2, 0xffffff);
        }
        this.mallInterior = { x0: b.x0 + 4, z0: b.z0 + 4, x1: b.x1 - 4, z1: b.z1 - 22 };
        // Parking strip in front
        this.B.asphalt.add(cx, 0.15, b.z1 - 9, 0, b.x1 - b.x0, 0.02, 16, 0x777777);
        for (let x = b.x0 + 5; x < b.x1 - 4; x += 5) if (r() < 0.45) this.parkedSpots.push({ x, z: b.z1 - 8, rot: 0, type: r.pick(['sedan', 'suv', 'sports', 'sedan']) });
        break;
      }
      case 'mallparking':
      case 'parking': {
        this.B.asphalt.add(cx, 0.15, cz, 0, b.x1 - b.x0 + 8, 0.03, b.z1 - b.z0 + 8, 0x8a8a8a);
        for (let row = 0; row < 4; row++) {
          const z = b.z0 + 8 + row * ((b.z1 - b.z0 - 16) / 3);
          for (let x = b.x0 + 3; x < b.x1 - 2; x += 3.2) {
            this.B.glow.add(x - 1.6, 0.19, z, 0, 0.12, 0.005, 5, 0xbbbbbb);
            if (r() < 0.38) this.parkedSpots.push({ x, z, rot: row % 2 ? Math.PI : 0, type: r.pick(['sedan', 'suv', 'sports', 'pickup', 'sedan', 'super', 'moto']), lot: true });
          }
        }
        for (let x = b.x0 + 10; x < b.x1; x += 30) for (let z = b.z0 + 20; z < b.z1; z += 40) this.lamp(x, z, 0);
        break;
      }
      case 'gas': {
        const name = r.pick(['FUEL-UP', 'SUNCOAST GAS', 'GULF STAR']);
        // canopy over pumps near south road
        const pz = b.z1 - 9;
        this.B.asphalt.add(cx, 0.15, cz + 10, 0, b.x1 - b.x0 + 8, 0.03, (b.z1 - b.z0) / 2 + 8, 0x6f6f6f);
        this.box(cx - 16, pz - 6, cx + 16, pz + 6, 5.5, 0.8, 0xffffff, { collide: false });
        this.B.glow.add(cx, 5.4, pz, 0, 30, 0.1, 10, 0xfff8e8);
        this.B.glow.add(cx, 5.7, pz + 6.05, 0, 32, 0.6, 0.05, 0xff3030);
        for (const px of [-12, 12]) for (const pzz of [-4.5, 4.5]) this.box(cx + px - 0.3, pz + pzz - 0.3, cx + px + 0.3, pz + pzz + 0.3, 0.15, 5.5, 0xdddddd);
        for (const px of [-8, 0, 8]) {
          this.box(cx + px - 0.5, pz - 0.35, cx + px + 0.5, pz + 0.35, 0.15, 1.7, 0xd23c3c, { tag: 'pump' });
          this.B.glow.add(cx + px, 1.2, pz + 0.36, 0, 0.6, 0.3, 0.02, 0x9fe8ff);
        }
        this.sign(name, cx, 8, pz + 6.2, 0, 14, 2.5, { color: '#ffffff', glow: '#ff3030', bg: 'rgba(20,20,20,0.9)' });
        // Store with interior
        const sx0 = cx - 11, sx1 = cx + 11, sz0 = b.z0 + 8, sz1 = b.z0 + 26;
        this.shop({ x0: sx0, z0: sz0, x1: sx1, z1: sz1, h: 4.5, door: 's', wall: 0xf4f1ea, name: 'SUNNY MART', signColor: '#ffb347' });
        this.counter(sx0 + 2, sz0 + 3, sx0 + 8, sz0 + 4.2);
        this.clerkAt(sx0 + 5, sz0 + 2, 0, 'store');
        this.shelves(cx - 2, sz0 + 6, cx + 8, sz0 + 6.8, productCols);
        this.shelves(cx - 2, sz0 + 11, cx + 8, sz0 + 11.8, productCols);
        this.box(sx1 - 1.2, sz0 + 1, sx1 - 0.4, sz0 + 9, 0.15, 2.1, 0xcfe8f5, { batch: 'metal' }); // fridges
        this.B.glow.add(sx1 - 1.25, 0.6, sz0 + 5, 0, 0.05, 1.4, 7.5, 0xdff6ff);
        this.addShop('store', 'Sunny Mart', sx0 + 5, sz0 + 5.4, { robbable: true, clerk: { x: sx0 + 5, z: sz0 + 2 } });
        this.addShop('fuel', 'Fuel Pump', cx, pz + 2.5, { r: 9 });
        this.lamp(b.x0 + 2, b.z1 - 2, Math.PI / 4);
        this.lamp(b.x1 - 2, b.z1 - 2, -Math.PI / 4);
        break;
      }
      case 'park': {
        this.B.grass.add(cx, 0.15, cz, 0, b.x1 - b.x0 + 8, 0.03, b.z1 - b.z0 + 8, 0xbfe0a6);
        // paths
        this.B.sidewalk.add(cx, 0.17, cz, 0, b.x1 - b.x0 + 8, 0.02, 3, 0xd9cfb8);
        this.B.sidewalk.add(cx, 0.17, cz, 0, 3, 0.02, b.z1 - b.z0 + 8, 0xd9cfb8);
        this.B.cyl.add(cx, 0.15, cz, 0, 9, 0.8, 9, 0xd0c8b8);
        this.B.pool.add(cx, 0.96, cz, 0, 7.5, 0.02, 7.5);
        this.B.cyl.add(cx, 0.15, cz, 0, 1, 3, 1, 0xd0c8b8);
        this.col.add(cx - 4.3, cz - 4.3, cx + 4.3, cz + 4.3, 0, 0.95, 'prop');
        for (let k = 0; k < 26; k++) {
          const x = b.x0 + r() * (b.x1 - b.x0), z = b.z0 + r() * (b.z1 - b.z0);
          if (Math.abs(x - cx) < 6 || Math.abs(z - cz) < 6) continue;
          if (district === 'downtown' || district === 'midtown') this.palm(x, z, 0.9 + r() * 0.3); else this.tree(x, z, 0.9 + r() * 0.5);
        }
        for (let k = -2; k <= 2; k++) if (k) { this.box(cx + k * 10 - 1, cz + 2.2, cx + k * 10 + 1, cz + 2.8, 0.15, 0.5, 0x7a5a3c); }
        this.pedLoops.push({ district: 'park', pts: [{ x: cx - 30, z: cz }, { x: cx, z: cz - 30 }, { x: cx + 30, z: cz }, { x: cx, z: cz + 30 }] });
        break;
      }
      case 'nightclub': {
        const names = j === 4 ? ['NEON FLAMINGO', '#ff3cac'] : ['PULSE', '#36e2ff'];
        const x0 = b.x0 + 4, x1 = b.x1 - 2, z0 = b.z0 + 10, z1 = b.z1 - 10;
        const s = this.shop({ x0, z0, x1, z1, h: 9, door: 'e', doorW: 5, wall: 0x2a2236, name: names[0], signColor: names[1], roof: 0x1d1826 });
        // dance floor (pulsing tiles, instanced: 2 draw calls)
        const tileMatA = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3cac, emissiveIntensity: 1.5 });
        const tileMatB = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x36e2ff, emissiveIntensity: 1.5 });
        const tg = new THREE.BoxGeometry(1.9, 0.05, 1.9);
        const ia = new THREE.InstancedMesh(tg, tileMatA, 32), ib = new THREE.InstancedMesh(tg, tileMatB, 32);
        let na = 0, nb = 0;
        for (let a = 0; a < 8; a++) for (let c = 0; c < 8; c++) {
          _m.makeTranslation(cx - 7 + a * 2, 0.2, cz - 7 + c * 2);
          if ((a + c) % 2) ia.setMatrixAt(na++, _m); else ib.setMatrixAt(nb++, _m);
        }
        this.group.add(ia, ib);
        this.dance.push({ a: tileMatA, b: tileMatB });
        this.counter(x0 + 1, z0 + 2, x0 + 2.2, z1 - 2);
        this.clerkAt(x0 + 0.8, cz, Math.PI / 2, 'bar');
        this.addShop('club', names[0], x0 + 3.2, cz);
        this.B.glow.add(x1 + 0.3, 8.5, cz, 0, 0.1, 0.5, z1 - z0, new THREE.Color(names[1]).getHex());
        this.B.glow.add(x1 + 0.3, 0.5, cz, 0, 0.1, 0.3, z1 - z0, new THREE.Color(names[1]).getHex());
        this.clubs = this.clubs || []; this.clubs.push({ x: cx, z: cz, name: names[0], door: s.door });
        // palms in front
        for (let z = bb.z0 + 6; z < bb.z1; z += 14) this.palm(bb.x0 + 2, z, 1);
        break;
      }
      case 'restaurant': {
        const names = [['COASTLINE DINER', '#ff4d4d'], ['TACO VICE', '#ffe04a'], ['CAFE SOL', '#7dff6b']];
        const [nm, col] = names[(i + j) % 3];
        const x0 = cx - 14, x1 = cx + 14, z0 = cz - 4, z1 = b.z1 - 4;
        this.shop({ x0, z0, x1, z1, h: 5, door: 's', wall: 0xdfe6ea, name: nm, signColor: col, batch: 'metal' });
        this.counter(x0 + 2, z0 + 2.5, x1 - 2, z0 + 3.5);
        this.clerkAt(cx, z0 + 1.6, 0, 'food');
        for (let k = 0; k < 4; k++) { const tx = x0 + 4 + k * 6; this.box(tx - 0.6, z1 - 5, tx + 0.6, z1 - 3.8, 0.15, 0.8, 0xc23b3b); }
        this.addShop('food', nm, cx, z0 + 5);
        // Other building on block
        this.building(b.x0 + 2, b.z0 + 2, b.x1 - 2, cz - 14, 14 + r() * 10, 0xd9c7a7, [3, 3.4, 1, r() * 10]);
        break;
      }
      case 'safehouse': {
        this.building(b.x0 + 2, b.z0 + 2, b.x1 - 2, cz - 6, 24, 0xf2e6d8, [3, 3.4, 1, 4.2]);
        // garage
        const gx0 = cx - 8, gx1 = cx + 8, gz0 = cz + 4, gz1 = b.z1 - 6;
        this.shop({ x0: gx0, z0: gz0, x1: gx1, z1: gz1, h: 5, door: 's', doorW: 7, wall: 0xb9b0a3, name: 'SAFEHOUSE GARAGE', signColor: '#7dff6b', floorMat: this.mats.asphalt });
        this.garage = { x: cx, z: (gz0 + gz1) / 2, door: { x: cx, z: gz1 + 3 }, rot: Math.PI };
        this.addShop('garage', 'Garage', cx, (gz0 + gz1) / 2 + 2, { r: 4 });
        this.addShop('save', 'Safehouse (Save / Wardrobe)', cx - 12, cz - 4);
        this.B.glow.add(cx - 12, 2.6, cz - 6 + 0.1, 0, 2.4, 0.3, 0.05, 0x7dff6b);
        this.safehouseDoor = { x: cx - 12, z: cz - 3 };
        break;
      }
      case 'police': {
        this.policePos = { x: cx, z: b.z1 - 4 };
        this.building(b.x0 + 4, b.z0 + 4, b.x1 - 4, cz + 6, 16, 0xe9edf2, [3, 3.6, 1, 2.2]);
        this.B.glow.add(cx, 14, cz + 6.2, 0, 30, 1.2, 0.1, 0x2b6cff);
        this.sign('VICE COAST POLICE', cx, 12, cz + 6.3, 0, 22, 3, { color: '#ffffff', glow: '#2b6cff', bg: 'rgba(10,20,60,0.9)' });
        this.B.asphalt.add(cx, 0.15, b.z1 - 12, 0, b.x1 - b.x0, 0.03, 22, 0x777777);
        for (let k = 0; k < 4; k++) this.parkedSpots.push({ x: b.x0 + 14 + k * 9, z: b.z1 - 12, rot: 0, type: 'police' });
        break;
      }
      case 'hospital': {
        this.hospitalPos = { x: cx, z: b.z1 - 3 };
        this.building(b.x0 + 4, b.z0 + 4, b.x1 - 4, cz + 8, 28, 0xf5f7f8, [3, 3.6, 1, 6.5]);
        this.B.glow.add(cx, 22, cz + 8.2, 0, 2, 7, 0.1, 0xff2a2a);
        this.B.glow.add(cx, 24.5, cz + 8.2, 0, 7, 2, 0.1, 0xff2a2a);
        this.sign('MERCY GENERAL', cx, 6.5, cz + 8.3, 0, 18, 2.5, { color: '#ffffff', glow: '#ff2a2a' });
        this.B.asphalt.add(cx, 0.15, b.z1 - 10, 0, b.x1 - b.x0, 0.03, 18, 0x777777);
        this.parkedSpots.push({ x: cx - 10, z: b.z1 - 10, rot: 0, type: 'ambulance' }, { x: cx + 10, z: b.z1 - 10, rot: 0, type: 'ambulance' });
        break;
      }
      case 'clothing': {
        const x0 = cx - 13, x1 = cx + 13, z0 = cz - 2, z1 = b.z1 - 3;
        this.shop({ x0, z0, x1, z1, h: 5, door: 's', wall: 0xffffff, name: 'THREADS', signColor: '#36e2ff' });
        for (let k = 0; k < 4; k++) this.box(x0 + 3 + k * 6, z0 + 6, x0 + 4.4 + k * 6, z0 + 11, 0.15, 1.5, 0xe0e0e0, { batch: 'metal' });
        for (let k = 0; k < 4; k++) for (let m = 0; m < 6; m++) this.box(x0 + 3.1 + k * 6, z0 + 6.2 + m * 0.75, x0 + 4.3 + k * 6, z0 + 6.6 + m * 0.75, 0.3, 1.2, r.pick(productCols), { collide: false });
        this.counter(x1 - 6, z0 + 2, x1 - 2, z0 + 3);
        this.clerkAt(x1 - 4, z0 + 1.2, 0, 'clothing');
        this.addShop('clothing', 'Threads', x1 - 4, z0 + 4.5);
        this.building(b.x0 + 2, b.z0 + 2, b.x1 - 2, cz - 10, 20 + r() * 15, 0xc9a48a, [3, 3.4, 1, r() * 10]);
        break;
      }
      case 'arms': {
        const x0 = cx - 10, x1 = cx + 10, z0 = cz, z1 = b.z1 - 3;
        this.shop({ x0, z0, x1, z1, h: 4.5, door: 's', wall: 0x6e6a64, name: 'COASTLINE ARMS', signColor: '#ff4d4d', signBg: 'rgba(20,20,20,0.9)' });
        this.counter(x0 + 2, z0 + 3, x1 - 2, z0 + 4);
        this.clerkAt(cx, z0 + 2, 0, 'arms');
        this.box(x0 + 1, z0 + 0.5, x1 - 1, z0 + 0.9, 1.2, 2.2, 0x3a3a3a, { collide: false });
        this.addShop('arms', 'Coastline Arms', cx, z0 + 6);
        this.building(b.x0 + 2, b.z0 + 2, b.x1 - 2, cz - 8, 9, 0x9b8c7c, [3, 3, 1, r() * 10]);
        break;
      }
      case 'customs': {
        const x0 = cx - 12, x1 = cx + 12, z0 = cz - 8, z1 = b.z1 - 6;
        this.shop({ x0, z0, x1, z1, h: 7, door: 's', doorW: 9, wall: 0x7b8676, name: 'COAST CUSTOMS', signColor: '#ffe04a', floorMat: this.mats.asphalt, batch: 'metal' });
        this.addShop('customs', 'Coast Customs', cx, (z0 + z1) / 2 + 2, { r: 4.5 });
        this.box(x0 + 1, z0 + 1, x0 + 3, z0 + 6, 0.15, 1.2, 0xd23c3c);
        break;
      }
      case 'court': {
        this.B.asphalt.add(cx, 0.15, cz, 0, 30, 0.03, 18, 0x9a5b3a);
        this.B.glow.add(cx, 0.2, cz, 0, 0.1, 0.005, 18, 0xffffff);
        for (const s of [-1, 1]) {
          this.box(cx + s * 14 - 0.15, cz - 0.15, cx + s * 14 + 0.15, cz + 0.15, 0.15, 3.5, 0x888888, { batch: 'metal' });
          this.box(cx + s * 13.6 - 0.05, cz - 0.9, cx + s * 13.6 + 0.05, cz + 0.9, 3.2, 1.1, 0xffffff, { collide: false });
        }
        this.box(cx - 16, cz - 10, cx + 16, cz - 9.9, 0.15, 3, 0x8a8d90, { batch: 'metal' });
        this.pedLoops.push({ district: 'court', pts: [{ x: cx - 10, z: cz - 6 }, { x: cx + 10, z: cz - 6 }, { x: cx + 10, z: cz + 6 }, { x: cx - 10, z: cz + 6 }] });
        this.buildDistrictBlock('ghetto', { x0: b.x0, x1: b.x1, z0: cz + 12, z1: b.z1 }, bb);
        break;
      }
    }
  }

  buildStreetFurniture() {
    const r = this.r;
    // Streetlights along every road segment, both sides alternating
    for (let i = 0; i < GX.length; i++) {
      const x = GX[i], hw = lineHW('x', x);
      for (let z = GRID_MIN + 20; z < GRID_MAX - 10; z += 40) {
        const zz = z + ((i % 2) ? 20 : 0);
        if (Math.abs(((zz - GRID_MIN) % STEP) - 0) < 14 || Math.abs(((zz - GRID_MIN) % STEP) - STEP) < 14) continue;
        if (x + hw + 1.2 < GRID_MAX) this.lamp(x + hw + 1.2, zz, -Math.PI / 2);
        if (x - hw - 1.2 > GRID_MIN) this.lamp(x - hw - 1.2, zz + 20, Math.PI / 2);
      }
    }
    for (let j = 0; j < GZ.length; j++) {
      const z = GZ[j], hw = lineHW('z', z);
      for (let x = GRID_MIN + 40; x < GRID_MAX - 10; x += 40) {
        if (Math.abs(((x - GRID_MIN) % STEP)) < 14 || Math.abs(((x - GRID_MIN) % STEP) - STEP) < 14) continue;
        if (z + hw + 1.2 < GRID_MAX) this.lamp(x, z + hw + 1.2, Math.PI);
      }
    }
    // Expressway lights in countryside
    for (let x = GRID_MIN - 60; x > -2000; x -= 60) this.lamp(x, -13, 0);
    // Palms on the boulevard and expressway sidewalks
    for (let z = GRID_MIN + 15; z < GRID_MAX; z += 22) {
      if (Math.abs(((z - GRID_MIN) % STEP)) < 14 || Math.abs(((z - GRID_MIN) % STEP) - STEP) < 14) continue;
      this.palm(-12, z, 1.1); this.palm(12, z + 11, 1.1);
    }
    for (let x = GRID_MIN + 15; x < GRID_MAX; x += 26) {
      if (Math.abs(((x - GRID_MIN) % STEP)) < 14 || Math.abs(((x - GRID_MIN) % STEP) - STEP) < 14) continue;
      this.palm(x, -13.5, 1); this.palm(x + 13, 13.5, 1);
    }
    // Benches / bins / hydrants scattered on sidewalks
    const props = [];
    for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
      const bb = blockBounds(i, j);
      for (let k = 0; k < 3; k++) {
        const side = Math.floor(r() * 4);
        let x, z;
        if (side === 0) { x = bb.x0 + 0.8; z = bb.z0 + 12 + r() * (bb.z1 - bb.z0 - 24); }
        else if (side === 1) { x = bb.x1 - 0.8; z = bb.z0 + 12 + r() * (bb.z1 - bb.z0 - 24); }
        else if (side === 2) { z = bb.z0 + 0.8; x = bb.x0 + 12 + r() * (bb.x1 - bb.x0 - 24); }
        else { z = bb.z1 - 0.8; x = bb.x0 + 12 + r() * (bb.x1 - bb.x0 - 24); }
        const t = r();
        if (t < 0.4) this.box(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0.15, 1, 0x2f5f3a, { tag: 'prop' }); // bin
        else if (t < 0.65) this.box(x - 0.18, z - 0.18, x + 0.18, z + 0.18, 0.15, 0.8, 0xd23c3c, { tag: 'prop' }); // hydrant
        else if (t < 0.8) this.box(x - 0.3, z - 0.25, x + 0.3, z + 0.25, 0.15, 1.2, 0x2a5aa8, { tag: 'prop' }); // mailbox/news box
        else { // bus stop shelter
          const alongX = side >= 2;
          const w = alongX ? 4 : 1.4, d = alongX ? 1.4 : 4;
          this.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 2.6, 0.1, 0xdddddd, { collide: false });
          this.box(x - (alongX ? w / 2 : 0.05), z - (alongX ? 0.05 : d / 2), x + (alongX ? w / 2 : 0.05), z + (alongX ? 0.05 : d / 2), 0.15, 2.5, 0x88aacc, { batch: 'metal', tag: 'prop' });
          this.B.glow.add(x, 1.5, z, 0, alongX ? 1.2 : 0.06, 1.8, alongX ? 0.06 : 1.2, 0xfff2d6);
        }
      }
    }
  }

  buildBeach() {
    const r = this.r;
    // Promenade path
    this.B.sidewalk.add(870, 0, 0, 0, 34, 0.12, GRID_MAX * 2 + 200, 0xf0e2cc);
    for (let z = GRID_MIN; z < GRID_MAX + 80; z += 18) { this.palm(858, z, 1.1 + r() * 0.2); }
    // Umbrellas, loungers, lifeguard towers
    const umb = new Batch(new THREE.ConeGeometry(1.8, 0.7, 10).translate(0, 2.3, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide }));
    for (let k = 0; k < 90; k++) {
      const x = 892 + r() * 30, z = GRID_MIN + r() * (GRID_MAX - GRID_MIN + 100);
      if (Math.abs(z) < 16) continue;
      const y = groundHeight(x, z);
      umb.add(x, y, z, 0, 1, 1, 1, r.pick([0xff5d8f, 0x36c9e2, 0xffd23f, 0xffffff, 0x7bd88f, 0xff8c42]));
      this.B.metal.add(x, y, z, 0, 0.06, 2.4, 0.06, 0xdddddd);
      if (r() < 0.7) this.box(x + 1.2, z - 0.4, x + 3, z + 0.4, y, 0.35, 0xffffff, { collide: false });
    }
    umb.build(this.group);
    const towerCols = [0xff5d8f, 0x36c9e2, 0xffd23f, 0x7bd88f];
    for (let z = GRID_MIN + 60, k = 0; z < GRID_MAX; z += 200, k++) {
      const x = 915, y = groundHeight(x, z);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.B.metal.add(x + dx * 1.2, y, z + dz * 1.2, 0, 0.15, 2.6, 0.15, 0xffffff);
      this.box(x - 1.8, z - 1.8, x + 1.8, z + 1.8, y + 2.6, 2.4, towerCols[k % 4], { tag: 'building' });
      this.B.roof.add(x, y + 5, z, Math.PI / 2, 4.2, 1, 4.2, 0xffffff);
      this.collectibleSpots.push({ x, z: z + 4, y: y + 1 });
    }
    this.pedLoops.push({ district: 'beachsand', pts: [{ x: 900, z: GRID_MIN }, { x: 910, z: GRID_MAX }, { x: 920, z: GRID_MAX }, { x: 905, z: GRID_MIN }] });
    this.pedLoops.push({ district: 'promenade', pts: [{ x: 866, z: GRID_MIN - 20 }, { x: 866, z: GRID_MAX + 60 }, { x: 874, z: GRID_MAX + 60 }, { x: 874, z: GRID_MIN - 20 }] });
  }

  buildBridgeAndIsland() {
    const r = this.r;
    // Bridge structure: pillars, railings, cable towers
    const x0 = BRIDGE.x0 - 20, x1 = BRIDGE.x1;
    for (let x = x0 + 20; x < x1 - 10; x += 22) {
      const y = bridgeDeck(x);
      this.box(x - 1.2, -8, x + 1.2, 8, -8, y - 0.6 + 8, 0xc9c4bb, { collide: false });
      this.B.solid.add(x, -8, 0, 0, 2.4, y - 0.4 + 8, 18, 0xc9c4bb);
    }
    // deck underside
    for (let x = x0; x < x1; x += 10) {
      const y = Math.min(bridgeDeck(x), bridgeDeck(x + 10));
      this.B.solid.add(x + 5, y - 1.0, 0, 0, 10.2, 1.0, 21, 0xbab5ac);
      for (const s of [-1, 1]) {
        const yy = bridgeDeck(x + 5);
        this.B.metal.add(x + 5, yy, s * 10.2, 0, 10.2, 1.1, 0.25, 0xe8e8e8);
        this.col.add(x, s * 10.2 - 0.25, x + 10.2, s * 10.2 + 0.25, yy - 2, yy + 1.1, 'rail');
      }
    }
    const mid = (x0 + x1) / 2, my = bridgeDeck(mid);
    for (const s of [-1, 1]) {
      this.box(mid - 1.5, s * 12 - 1.5, mid + 1.5, s * 12 + 1.5, my, 28, 0xf2f2f2, { tag: 'building' });
      this.B.glow.add(mid, my + 28, s * 12, 0, 1.2, 0.6, 1.2, 0xff2020);
    }
    // cables (thin metal boxes)
    for (const s of [-1, 1]) for (let k = 1; k <= 6; k++) {
      for (const dir of [-1, 1]) {
        const ex = mid + dir * k * 14, ey = bridgeDeck(ex) + 1;
        const sx = mid, sy = my + 27;
        const len = Math.hypot(ex - sx, ey - sy);
        const ang = Math.atan2(ey - sy, ex - sx);
        this.B.metal.items.push({ x: (sx + ex) / 2, y: (sy + ey) / 2, z: s * 11.5, ry: 0, rx: 0, rz: ang, sx: len, sy: 0.08, sz: 0.08, color: 0xdddddd });
      }
    }
    // Island: ring road + mansions
    const ringG = new THREE.RingGeometry(140, 152, 96).rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringG, this.mats.asphalt);
    ring.position.set(ISLAND.x, 0.43, ISLAND.z); ring.receiveShadow = true;
    this.group.add(ring);
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(ISLAND.r - 2, 64).rotateX(-Math.PI / 2), this.mats.grass);
    lawn.position.set(ISLAND.x, 0.405, ISLAND.z); lawn.receiveShadow = true;
    this.group.add(lawn);
    // connector road
    this.B.asphalt.add((BRIDGE.x1 + ISLAND.x - 146) / 2, 0.41, 0, 0, ISLAND.x - 146 - BRIDGE.x1 + 6, 0.03, 18, 0x808080);
    const places = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3;
      if (Math.abs(Math.cos(a) + 1) < 0.12) continue; // avoid bridge entry west
      places.push({ a, rr: 190 }); places.push({ a: a + 0.31, rr: 95 });
    }
    places.forEach((p, idx) => {
      const x = ISLAND.x + Math.cos(p.a) * p.rr, z = ISLAND.z + Math.sin(p.a) * p.rr;
      const w = 22 + r() * 10, d = 16 + r() * 8;
      const y = 0.4;
      this.building(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 7, 0xfafafa, [4, 3.5, 0, r() * 10], y);
      this.building(x - w / 2 + 3, z - d / 2 + 2, x + w / 4, z + d / 2 - 2, 4, 0xf0ece4, [4, 3.5, 0, r() * 10], y + 7);
      this.B.solid.add(x + w / 4 + 2, y + 7, z, 0, w / 2, 0.3, d + 4, 0xe0dcd4); // roof terrace
      const pzx = x + (Math.cos(p.a) > 0 ? 1 : -1) * (w / 2 + 6);
      this.B.pool.add(pzx, y + 0.02, z, 0, 8, 0.03, 12);
      this.B.sidewalk.add(pzx, y - 0.02, z, 0, 11, 0.03, 15, 0xf5efe4);
      for (let t = 0; t < 4; t++) this.palm(x + (r() - 0.5) * (w + 16), z + (r() - 0.5) * (d + 16), 1 + r() * 0.3);
      const toC = Math.atan2(ISLAND.z - z, ISLAND.x - x);
      this.parkedSpots.push({ x: x + Math.cos(toC) * (d / 2 + 9), z: z + Math.sin(toC) * (d / 2 + 9), rot: -toC + Math.PI / 2, type: r.pick(['super', 'sports', 'suv', 'super']), island: true });
      if (idx === 3) this.mansionMission = { x: x + Math.cos(toC) * (d / 2 + 9), z: z + Math.sin(toC) * (d / 2 + 9), rot: -toC + Math.PI / 2 };
    });
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2, rr = 205 + r() * 20;
      this.palm(ISLAND.x + Math.cos(a) * rr, ISLAND.z + Math.sin(a) * rr, 1 + r() * 0.3);
    }
    this.pedLoops.push({ district: 'island', pts: Array.from({ length: 12 }, (_, k) => ({ x: ISLAND.x + Math.cos(k / 12 * 6.283) * 158, z: ISLAND.z + Math.sin(k / 12 * 6.283) * 158 })) });
  }

  buildAirport() {
    const r = this.r;
    // Runway & taxiway
    const rwMat = makeWetMaterial({ map: TX.makeRunwayTexture(), roughness: 0.9 }, 'runway');
    rwMat.map.repeat.set(1, 30);
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(50, 1500).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), rwMat);
    rw.position.set(-150, 0.03, -1190); rw.receiveShadow = true; this.group.add(rw);
    this.B.asphalt.add(-150, 0.0, -1080, 0, 1300, 0.04, 22, 0x6c6c6c);
    this.B.asphalt.add(-200, 0.0, -940, 0, 760, 0.04, 150, 0x7a7a7a); // apron
    // edge lights along runway
    for (let x = -890; x < 590; x += 30) for (const s of [-1, 1]) this.B.glow.add(x, 0.05, -1190 + s * 26, 0, 0.4, 0.3, 0.4, s > 0 ? 0xffffff : 0x4fa3ff);
    // Terminal
    this.building(-420, -905, 20, -860, 20, 0xb9c6cf, [3.5, 4, 0, 2]);
    this.B.solid.add(-200, 20.15, -882, 0, 460, 1.2, 56, 0xf2f2f2);
    this.sign('VICE COAST INTERNATIONAL', -200, 16, -907, Math.PI, 60, 6, { color: '#ffffff', glow: '#36e2ff', bg: 'rgba(10,20,40,0.85)' });
    // Jet bridges
    for (let k = 0; k < 4; k++) this.box(-360 + k * 100 - 2, -935, -360 + k * 100 + 2, -905, 4, 3.5, 0xdddddd, { batch: 'metal' });
    // Control tower
    this.B.cyl.add(80, 0, -960, 0, 7, 48, 7, 0xe8e8e8);
    this.col.add(76.5, -963.5, 83.5, -956.5, 0, 55, 'building');
    this.B.cyl.add(80, 48, -960, 0, 15, 6, 15, 0x2a3a4a);
    this.B.glow.add(80, 50.5, -960, 0, 14, 1.5, 14, 0x9fe8ff);
    this.B.cyl.add(80, 54, -960, 0, 16, 1, 16, 0xffffff);
    // Hangars
    for (let k = 0; k < 3; k++) {
      const hx = 260 + k * 70;
      this.shop({ x0: hx - 28, z0: -1010, x1: hx + 28, z1: -960, h: 16, door: 'n', doorW: 40, wall: 0x9aa3a8, batch: 'metal', floorMat: this.mats.asphalt, name: k === 1 ? 'HANGAR 2' : null, signColor: '#ffe04a' });
    }
    this.hangar = { x: 330, z: -985 };
    // Airliners
    const planeCols = [0xffffff, 0xf2f2f2];
    const livery = [0x2b6cff, 0xff3cac, 0x2ec4b6];
    const planeAt = (px, pz, ry, s = 1, liv = 0) => this.airplane(px, pz, ry, s, planeCols[0], livery[liv]);
    planeAt(-360, -960, Math.PI / 2, 1, 0);
    planeAt(-160, -960, Math.PI / 2, 1, 1);
    planeAt(40, -1000, 0.4, 1, 2);
    planeAt(-700, -1190, 0, 1.1, 0);
    planeAt(330, -985, Math.PI, 0.4, 1); // small jet in hangar 2
    // perimeter fence
    for (const [fx0, fx1] of [[-980, -620], [-580, 620]]) this.box(fx0, -852, fx1, -851.8, 0, 3, 0x8a8d90, { batch: 'metal', tag: 'fence' });
    this.pedLoops.push({ district: 'airport', pts: [{ x: -400, z: -850 }, { x: 0, z: -850 }, { x: 0, z: -853 }, { x: -400, z: -853 }] });
  }
  airplane(x, z, ry, s, body, liv) {
    const g = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({ color: body, roughness: 0.35, metalness: 0.3 });
    const lm = new THREE.MeshStandardMaterial({ color: liv, roughness: 0.4, metalness: 0.2 });
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 36, 6, 14).rotateZ(Math.PI / 2), bm); fus.position.y = 4.2;
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 2.42, 34, 14, 1, true, Math.PI * 0.4, Math.PI * 0.2).rotateZ(Math.PI / 2), lm); stripe.position.y = 4.2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 34), bm); wing.position.set(1, 3.4, 0);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 0.4), lm); tail.position.set(-17, 8.5, 0); tail.rotation.z = -0.35;
    const stab = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.3, 12), bm); stab.position.set(-17.5, 5, 0);
    const eng1 = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4, 12).rotateZ(Math.PI / 2), lm); eng1.position.set(3, 2.4, 7);
    const eng2 = eng1.clone(); eng2.position.z = -7;
    const gearM = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const gear = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 6), gearM); gear.position.set(0, 1.1, 0);
    const ngear = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5), gearM); ngear.position.set(15, 1.1, 0);
    const winM = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 });
    const cock = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 2.4), winM); cock.position.set(19.2, 5.3, 0);
    g.add(fus, stripe, wing, tail, stab, eng1, eng2, gear, ngear, cock);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(s);
    this.group.add(g);
    // colliders (approximate, axis aligned envelope of fuselage + wings)
    const c = Math.cos(ry), sn = Math.sin(ry);
    const addRot = (lx, lz, hw, hd, y0, y1) => {
      const wx = x + (lx * c + lz * sn) * s, wz = z + (-lx * sn + lz * c) * s;
      const ex = (Math.abs(c) * hw + Math.abs(sn) * hd) * s, ez = (Math.abs(sn) * hw + Math.abs(c) * hd) * s;
      this.col.add(wx - ex, wz - ez, wx + ex, wz + ez, y0 * s, y1 * s, 'building');
    };
    for (let k = -18; k <= 18; k += 6) addRot(k, 0, 3, 2.4, 1.8, 6.6);
    addRot(1, 0, 4.5, 17, 3, 3.8);
  }

  buildPort() {
    const r = this.r;
    // Quay edge
    this.box(-900, 1248, 880, 1252, -6, 6.2, 0x6f6f6f, { tag: 'building', collide: false });
    this.col.add(-900, 1250, 880, 1253, -6, 0.6, 'quay');
    for (let x = -880; x < 880; x += 12) this.B.metal.add(x, 0, 1249, 0, 0.6, 0.7, 0.6, 0xe0c020);
    // Containers
    const contMat = new THREE.MeshStandardMaterial({ map: TX.makeContainerTexture(), roughness: 0.7, metalness: 0.3 });
    const cont = new Batch(unitBox(), contMat);
    const cc = [0xc0392b, 0x2471a3, 0x1e8449, 0xd68910, 0x7d3c98, 0x839192, 0xa04000, 0x117a65];
    for (let gx = -150; gx < 700; gx += 60) for (let gz = 900; gz < 1180; gz += 40) {
      if (Math.abs(gx - 360) < 30) continue;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
        const h = 1 + Math.floor(r() * 4);
        const x = gx + a * 13, z = gz + b * 3;
        for (let k = 0; k < h; k++) cont.add(x, k * 2.6, z, 0, 12.2, 2.6, 2.45, r.pick(cc));
        this.col.add(x - 6.1, z - 1.25, x + 6.1, z + 1.25, 0, h * 2.6, 'building');
      }
    }
    cont.build(this.group);
    // Gantry cranes
    for (let k = 0; k < 4; k++) {
      const x = -100 + k * 200, z = 1235;
      const c = 0xd35400;
      for (const dx of [-8, 8]) for (const dz of [-10, 10]) this.box(x + dx - 0.7, z + dz - 0.7, x + dx + 0.7, z + dz + 0.7, 0, 34, c, { batch: 'metal', tag: 'building' });
      this.box(x - 9, z - 40, x + 9, z + 45, 34, 3, c, { batch: 'metal', collide: false });
      this.box(x - 4, z - 2, x + 4, z + 6, 30, 4, 0x333333, { collide: false });
      this.B.glow.add(x, 37.3, z + 44, 0, 1, 1, 1, 0xff2020);
    }
    // Cargo ship
    const sx = 300, sz = 1290;
    this.box(sx - 110, sz - 16, sx + 110, sz + 16, -6, 12, 0x1f3a5f, { tag: 'building' });
    this.box(sx - 110, sz - 16.1, sx + 110, sz + 16.1, -6, 4, 0x8b1e1e, { collide: false });
    this.box(sx + 70, sz - 12, sx + 95, sz + 12, 6, 18, 0xf2f2f2, { tag: 'building' });
    this.B.glow.add(sx + 82, 20, sz - 12.1, 0, 22, 1.4, 0.1, 0xfff4dc);
    for (let a = 0; a < 12; a++) for (let b = 0; b < 8; b++) {
      const h = 1 + Math.floor(r() * 3);
      for (let k = 0; k < h; k++) cont.items.length; // noop (keep deterministic)
      this.B.solid.add(sx - 100 + a * 13.5, 6 + 0, sz - 12 + b * 3.2, 0, 13, h * 2.6, 3, r.pick(cc));
    }
    // Warehouses
    for (let k = 0; k < 4; k++) this.building(-700 + k * 130, 920, -620 + k * 130, 1000, 14, r.pick([0x8c8f93, 0x6f7f8c, 0x9a8a76]), [6, 5, 4, k]);
    this.sign('PORT OF VICE', 360, 10, 870, 0, 26, 4, { color: '#ffffff', glow: '#ffe04a', bg: 'rgba(20,30,40,0.9)' });
    this.box(345, 868, 347, 872, 0, 8, 0x555555, { batch: 'metal' }); this.box(373, 868, 375, 872, 0, 8, 0x555555, { batch: 'metal' });
    for (let x = -200; x < 800; x += 50) this.lamp(x, 1240, Math.PI);
    this.portDrop = { x: 120, z: 1200 };
    this.pedLoops.push({ district: 'port', pts: [{ x: 340, z: 880 }, { x: 340, z: 1200 }, { x: 380, z: 1200 }, { x: 380, z: 880 }] });
  }

  buildCountryside() {
    const r = this.r;
    // Forest & scattered trees
    for (let k = 0; k < 900; k++) {
      const x = WORLD.x0 + 120 + r() * (COUNTRY_X - WORLD.x0 - 150), z = WORLD.z0 + 160 + r() * (WORLD.z1 - WORLD.z0 - 260);
      if (Math.abs(z) < 25 || Math.abs(z - 600) < 20) continue;
      if (fbm(x * 0.006 + 9, z * 0.006, 2) < 0.48 && r() < 0.75) continue;
      if (z > 1240) continue;
      this.tree(x, z, 0.9 + r() * 0.8, 0.22 + r() * 0.08);
    }
    // Farms
    const farm = (x, z) => {
      const y = groundHeight(x, z);
      this.building(x - 9, z - 6, x + 9, z + 6, 7, 0xa8322d, [5, 4, 4, 1], y - 0.2);
      this.B.roof.add(x, y + 6.8, z, 0, 19, 4, 13, 0x5a5a5a);
      const hx = x + 26, hz = z + 2, hy = groundHeight(hx, hz);
      this.building(hx - 6, hz - 5, hx + 6, hz + 5, 4, 0xf1ead8, [3, 3.4, 3, 2], hy - 0.2);
      this.B.roof.add(hx, hy + 3.8, hz, 0, 13, 2.4, 11, 0x6b4a33);
      this.B.cyl.add(x - 16, y - 0.2, z, 0, 5, 14, 5, 0xcfcfcf);
      this.col.add(x - 18.5, z - 2.5, x - 13.5, z + 2.5, y - 1, y + 14, 'building');
      this.parkedSpots.push({ x: hx, z: hz + 9, rot: Math.PI / 2, type: 'pickup' });
      for (let fx = -30; fx <= 50; fx += 4) this.box(x + fx - 0.08, z + 22 - 0.08, x + fx + 0.08, z + 22 + 0.08, groundHeight(x + fx, z + 22) - 0.2, 1.3, 0x7a5a3c, { collide: false });
    };
    farm(-1250, 80); farm(-1650, -90); farm(-1400, 680); farm(-1750, 520);
    // Country gas station & diner on the expressway
    const gx = -1500, gz = -40;
    this.B.asphalt.add(gx, 0.0, gz, 0, 60, 0.05, 40, 0x6f6f6f);
    this.box(gx - 12, gz - 4, gx + 12, gz + 4, 5.5, 0.8, 0xffffff, { collide: false });
    this.B.glow.add(gx, 5.4, gz, 0, 22, 0.1, 7, 0xfff8e8);
    for (const px of [-6, 6]) this.box(gx + px - 0.5, gz - 0.35, gx + px + 0.5, gz + 0.35, 0.0, 1.7, 0xd23c3c, { tag: 'pump' });
    for (const px of [-10, 10]) this.box(gx + px - 0.3, gz - 0.3, gx + px + 0.3, gz + 0.3, 0, 5.5, 0xdddddd);
    this.shop({ x0: gx - 10, z0: gz - 30, x1: gx + 10, z1: gz - 14, h: 4.5, door: 's', wall: 0xf4f1ea, name: 'EVERGLADE STOP', signColor: '#ffb347', y: 0 });
    this.counter(gx - 8, gz - 27, gx - 2, gz - 26, 0);
    this.clerkAt(gx - 5, gz - 28, 0, 'store');
    this.shelves(gx + 1, gz - 24, gx + 8, gz - 23.3, [0xe63946, 0xf1c40f, 0x2a9d8f, 0x457b9d]);
    this.addShop('store', 'Everglade Stop', gx - 5, gz - 24.5, { robbable: true, clerk: { x: gx - 5, z: gz - 28 } });
    this.addShop('fuel', 'Fuel Pump', gx, gz + 2, { r: 8 });
    this.sign('EVERGLADE STOP', gx, 9, gz + 4.2, 0, 14, 2.5, { color: '#ffffff', glow: '#ffb347', bg: 'rgba(20,20,20,0.9)' });
    // Water tower
    const wx = -1100, wz = 300, wy = groundHeight(wx, wz);
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) this.box(wx + dx - 0.3, wz + dz - 0.3, wx + dx + 0.3, wz + dz + 0.3, wy - 0.5, 18, 0x9a9da1, { batch: 'metal' });
    this.B.cyl.add(wx, wy + 18, wz, 0, 10, 7, 10, 0xe8e8e8);
    this.sign('EVERGLADE FLATS', wx, wy + 21.5, wz + 5.1, 0, 9, 2, { color: '#1f3a5f', glow: '#ffffff', neon: false });
    this.pedLoops.push({ district: 'country', pts: [{ x: gx - 20, z: gz - 10 }, { x: gx + 20, z: gz - 10 }, { x: gx + 20, z: gz - 12 }, { x: gx - 20, z: gz - 12 }] });
  }

  buildCollectibleSpots() {
    const r = this.r;
    const fixed = [
      [80, -960 + 10], [-150, -1080], [330, -985], [1330, 0], [1500, 80], [1200, -150],
      [300, 1180], [-600, 960], [700, 1100], [-1250, 100], [-1650, -60], [-1400, 700], [-1100, 300], [-1900, 560],
      [-60, 60], [-660, -540], [-300, 420], [540, 220], [780, -500], [780, 540],
    ];
    for (const [x, z] of fixed) this.collectibleSpots.push({ x, z, y: groundHeight(x, z) + 1 });
    // alleys between towers downtown
    for (let k = 0; k < 6; k++) {
      const i = 5 + Math.floor(r() * 5), j = 2 + Math.floor(r() * 5);
      const bb = blockBounds(i, j);
      this.collectibleSpots.push({ x: (bb.x0 + bb.x1) / 2, z: bb.z0 + 3.5, y: 1.2 });
    }
  }

  update(dt, night, time) {
    // Light pools fade in at night, neon brighter at night
    this.lightPoolMat.opacity = night * 0.9;
    this.lightPoolMesh && (this.lightPoolMesh.visible = night > 0.02);
    for (const n of this.neonMats) {
      const k = n.neon ? 0.35 + night * 1.4 : 1;
      n.mat.color.setScalar(k);
    }
    for (const d of this.dance) {
      const p = Math.sin(time * 8) * 0.5 + 0.5;
      d.a.emissiveIntensity = 0.3 + p * 2.5; d.b.emissiveIntensity = 0.3 + (1 - p) * 2.5;
    }
  }
}
