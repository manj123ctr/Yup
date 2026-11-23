// The static layout of Vice Coast: road grid, districts, terrain height, water,
// special locations, and the road graph used by traffic AI and GPS.
import { clamp, smoothstep, fbm, lerp } from '../util.js';

export const WATER_Y = -1.0;
export const STEP = 120;
export const GRID_MIN = -840, GRID_MAX = 840;
export const GX = [], GZ = [];
for (let v = GRID_MIN; v <= GRID_MAX; v += STEP) { GX.push(v); GZ.push(v); }
export const NB = GX.length - 1; // blocks per axis (14)

export const ISLAND = { x: 1330, z: 0, r: 230 };
export const BRIDGE = { x0: 900, x1: 1110, hw: 10 };
export const COUNTRY_X = -930; // west of here is countryside
export const WORLD = { x0: -2150, x1: 1700, z0: -1420, z1: 1500 };

// Road half width for a grid line.
export function lineHW(axis, v) {
  if (axis === 'z' && v === 0) return 11; // Expressway (E-W)
  if (axis === 'x' && v === 0) return 10; // Biscayne-style boulevard (N-S)
  if (axis === 'x' && v === GRID_MAX) return 9; // Ocean Drive
  return 7;
}
export function lanesFor(axis, v) {
  return lineHW(axis, v) >= 10 ? [3.2, 7.4] : [3.4];
}

// Block bounds (inside the road edges)
export function blockBounds(i, j) {
  return {
    x0: GX[i] + lineHW('x', GX[i]), x1: GX[i + 1] - lineHW('x', GX[i + 1]),
    z0: GZ[j] + lineHW('z', GZ[j]), z1: GZ[j + 1] - lineHW('z', GZ[j + 1]),
    cx: (GX[i] + GX[i + 1]) / 2, cz: (GZ[j] + GZ[j + 1]) / 2,
  };
}

// Special blocks — keyed "i,j"
export const SPECIAL = {
  '4,10': 'mall',
  '3,10': 'mallparking',
  '2,6': 'gas',
  '9,12': 'gas',
  '12,3': 'gas',
  '8,4': 'parking',
  '6,7': 'park',
  '1,3': 'park',
  '13,4': 'nightclub',
  '13,9': 'nightclub',
  '7,2': 'restaurant',
  '10,8': 'restaurant',
  '2,11': 'restaurant',
  '11,8': 'safehouse',
  '5,5': 'police',
  '10,2': 'hospital',
  '7,9': 'clothing',
  '3,9': 'arms',
  '6,11': 'customs',
  '12,10': 'parking',
  '0,12': 'court',
};

export function districtOf(cx, cz) {
  if (cx > 700) return 'beach';
  if (Math.abs(cx - 120) < 310 && Math.abs(cz + 180) < 310) return 'downtown';
  if (cz > 560) return 'industrial';
  if (cx < -360 && cz > 120) return 'ghetto';
  if (cx < -360) return 'suburb';
  return 'midtown';
}
export const DISTRICT_NAMES = {
  beach: 'Ocean Drive', downtown: 'Downtown Vice', industrial: 'Port District',
  ghetto: 'Little Haven', suburb: 'Coral Gardens', midtown: 'Midtown',
  island: 'Starfish Island', airport: 'Vice Coast International', country: 'Everglade Flats',
  port: 'Port of Vice', bridge: 'Starfish Causeway', ocean: 'Atlantic',
};

export function zoneAt(x, z) {
  if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND.r + 30) return 'island';
  if (x > BRIDGE.x0 && x < BRIDGE.x1 && Math.abs(z) < 14) return 'bridge';
  if (x < COUNTRY_X) return 'country';
  if (z < GRID_MIN - 20) return 'airport';
  if (z > GRID_MAX + 20) return 'port';
  if (x > GRID_MAX + 12) return isLand(x, z) ? 'beach' : 'ocean';
  if (!isLand(x, z)) return 'ocean';
  return districtOf(x, z);
}

// ---- Terrain ----
export function isLand(x, z) {
  return groundHeight(x, z) > WATER_Y + 0.05;
}

export function countryHills(x, z) {
  const blend = smoothstep(COUNTRY_X, COUNTRY_X - 220, x);
  if (blend <= 0) return 0;
  const roadFlat = smoothstep(16, 70, Math.abs(z)) * smoothstep(14, 60, Math.abs(z - 600));
  let h = (fbm(x * 0.004, z * 0.004, 4) - 0.35) * 46;
  h = Math.max(h, -2);
  // Edge walls
  const edge = smoothstep(WORLD.x0 + 160, WORLD.x0, x) * 80;
  return h * blend * roadFlat + edge;
}

export function bridgeDeck(x) {
  const t = clamp((x - (BRIDGE.x0 - 20)) / (BRIDGE.x1 - BRIDGE.x0 + 20), 0, 1);
  return 0.4 * t + 7 * Math.sin(Math.PI * t);
}

// Ground height (top surface) at a point, including curbs.
export function groundHeight(x, z) {
  // Bridge deck
  if (x > BRIDGE.x0 - 20 && x < BRIDGE.x1 && Math.abs(z) < BRIDGE.hw) return bridgeDeck(x);
  // Island
  const di = Math.hypot(x - ISLAND.x, z - ISLAND.z);
  if (di < ISLAND.r + 40) {
    if (di < ISLAND.r) return 0.4;
    return lerp(0.4, -4, clamp((di - ISLAND.r) / 40, 0, 1));
  }
  // Ocean beyond beach
  if (x > 880) {
    if (z > 1250) return -6;
    return lerp(0.15, -3.2, clamp((x - 890) / 120, 0, 1));
  }
  if (z > 1250) return -7;
  // North edge walls
  let h = 0;
  if (z < WORLD.z0 + 140) h += smoothstep(WORLD.z0 + 140, WORLD.z0, z) * 70;
  if (z > WORLD.z1 - 100) h += 0;
  if (x < COUNTRY_X) return h + countryHills(x, z);
  if (z < GRID_MIN - 12 || z > GRID_MAX + 12 || x < GRID_MIN - 12) return h;
  // Inside city grid: curb if inside a block
  if (onRoad(x, z)) return 0;
  return 0.15;
}

// Is point on a city road surface?
export function onRoad(x, z) {
  if (x >= GRID_MIN - 11 && x <= GRID_MAX + 11 && z >= GRID_MIN - 11 && z <= GRID_MAX + 11) {
    const ix = Math.round((x - GRID_MIN) / STEP), iz = Math.round((z - GRID_MIN) / STEP);
    const lx = GRID_MIN + ix * STEP, lz = GRID_MIN + iz * STEP;
    if (ix >= 0 && ix <= NB && Math.abs(x - lx) <= lineHW('x', lx)) return true;
    if (iz >= 0 && iz <= NB && Math.abs(z - lz) <= lineHW('z', lz)) return true;
  }
  if (Math.abs(z) < 11 && (x < GRID_MIN || x > GRID_MAX)) return true; // expressway extensions
  if (Math.abs(z - 600) < 7 && x < GRID_MIN) return true; // country road
  return false;
}

// ---- Road graph ----
// nodes: {id, x, z, links:[nodeId...], light:boolean}
export const graph = { nodes: [], byKey: new Map() };
function addNode(x, z, light) {
  const key = `${x},${z}`;
  if (graph.byKey.has(key)) return graph.byKey.get(key);
  const n = { id: graph.nodes.length, x, z, links: [], light };
  graph.nodes.push(n); graph.byKey.set(key, n);
  return n;
}
function link(a, b) { if (!a.links.includes(b.id)) a.links.push(b.id); if (!b.links.includes(a.id)) b.links.push(a.id); }

(function buildGraph() {
  for (const z of GZ) for (const x of GX) addNode(x, z, true);
  for (let j = 0; j < GZ.length; j++) for (let i = 0; i < GX.length; i++) {
    const n = graph.byKey.get(`${GX[i]},${GZ[j]}`);
    if (i + 1 < GX.length) link(n, graph.byKey.get(`${GX[i + 1]},${GZ[j]}`));
    if (j + 1 < GZ.length) link(n, graph.byKey.get(`${GX[i]},${GZ[j + 1]}`));
  }
  // Country expressway west
  let prev = graph.byKey.get(`${GRID_MIN},0`);
  for (let x = GRID_MIN - 240; x >= -2040; x -= 240) {
    const n = addNode(x, 0, false); link(prev, n); prev = n;
  }
  prev = graph.byKey.get(`${GRID_MIN},600`);
  for (let x = GRID_MIN - 240; x >= -1800; x -= 240) {
    const n = addNode(x, 600, false); link(prev, n); prev = n;
  }
  // Airport access road and taxiway
  const ap0 = addNode(-600, -1080, false); link(graph.byKey.get(`-600,${GRID_MIN}`), ap0);
  const ap1 = addNode(-150, -1080, false); link(ap0, ap1);
  const ap2 = addNode(330, -1080, false); link(ap1, ap2);
  // Port access road
  const pt0 = addNode(360, 1180, false); link(graph.byKey.get(`360,${GRID_MAX}`), pt0);
  // Bridge east to island
  const b0 = addNode(1110, 0, false);
  link(graph.byKey.get(`${GRID_MAX},0`), b0);
})();

export function nearestNode(x, z, maxD = Infinity) {
  let best = null, bd = maxD * maxD;
  for (const n of graph.nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// A* over the road graph. Returns array of {x,z}.
export function findPath(fromX, fromZ, toX, toZ) {
  const s = nearestNode(fromX, fromZ), t = nearestNode(toX, toZ);
  if (!s || !t) return [];
  const N = graph.nodes.length;
  const g = new Float64Array(N).fill(Infinity), f = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const h = (n) => Math.abs(n.x - t.x) + Math.abs(n.z - t.z);
  g[s.id] = 0; f[s.id] = h(s);
  const open = [s.id];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === t.id) break;
    closed[cur] = 1;
    const cn = graph.nodes[cur];
    for (const nid of cn.links) {
      if (closed[nid]) continue;
      const nn = graph.nodes[nid];
      const ng = g[cur] + Math.abs(nn.x - cn.x) + Math.abs(nn.z - cn.z);
      if (ng < g[nid]) {
        g[nid] = ng; f[nid] = ng + h(nn); came[nid] = cur;
        if (!open.includes(nid)) open.push(nid);
      }
    }
  }
  const out = [{ x: toX, z: toZ }];
  let c = t.id;
  if (came[c] === -1 && c !== s.id) return [{ x: fromX, z: fromZ }, { x: toX, z: toZ }];
  while (c !== -1) { out.push({ x: graph.nodes[c].x, z: graph.nodes[c].z }); c = came[c]; }
  out.push({ x: fromX, z: fromZ });
  return out.reverse();
}

// Notable places (used by missions, map, blips)
export const PLACES = {
  safehouse: { x: 540, z: 180 + 8, name: 'Safehouse' },
  hospital: { x: 420, z: -540 + 40, name: 'Mercy General' },
  police: { x: -180, z: -180 + 40, name: 'VCPD HQ' },
  airport: { x: -200, z: -1120, name: 'Vice Coast Intl.' },
  port: { x: 300, z: 1080, name: 'Port of Vice' },
  island: { x: 1330, z: 0, name: 'Starfish Island' },
};
