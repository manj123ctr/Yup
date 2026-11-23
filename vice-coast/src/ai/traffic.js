// Traffic AI: lane following on the road graph, traffic lights, car following,
// turning, honking, panicking, emergency responses, plus parked cars.
import * as THREE from 'three';
import { Vehicle, VTYPES } from '../entities/vehicle.js';
import { graph, lineHW, lanesFor, GRID_MIN, GRID_MAX, findPath, groundHeight } from '../world/layout.js';
import { clamp, R, wrapAngle, dist2 } from '../util.js';

export const LIGHT_CYCLE = 28;
export function lightState(axis, t) {
  const p = t % LIGHT_CYCLE;
  if (axis === 'ns') return p < 10 ? 'g' : p < 13 ? 'y' : 'r';
  return p < 14 ? 'r' : p < 24 ? 'g' : p < 27 ? 'y' : 'r';
}

function crossHW(node, dx, dz) {
  if (!node.light) return 5;
  return dx !== 0 ? lineHW('x', node.x) : lineHW('z', node.z);
}
function roadLanes(a, b) {
  return a.z === b.z ? lanesFor('z', a.z) : lanesFor('x', a.x);
}
function speedLimit(a, b) {
  if (a.z === b.z && a.z === 0) return 25;
  if (a.x === b.x && a.x === 0) return 18;
  if (!a.light || !b.light) return 23;
  return 14;
}

// Generic AI driver that converts goals into vehicle inputs
export class AIDriver {
  constructor(G, v, mode = 'cruise') {
    this.G = G; this.v = v; this.mode = mode;
    this.wps = []; // waypoints {x,z,stop?:node,dir}
    this.from = null; this.to = null; this.lane = 0;
    this.stuckT = 0; this.reverseT = 0; this.honkCd = 0; this.blockedByPlayer = 0;
    this.panic = 0; this.maxSpeedMul = 1;
    this.route = null; this.target = null;
  }
  placeOnEdge(a, b, t) {
    this.from = a; this.to = b;
    const lanes = roadLanes(a, b);
    this.laneOff = lanes[Math.floor(R() * lanes.length)];
    const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    const rx = -dz, rz = dx;
    const x = a.x + (b.x - a.x) * t + rx * this.laneOff, z = a.z + (b.z - a.z) * t + rz * this.laneOff;
    this.v.pos.set(x, groundHeight(x, z), z);
    this.v.heading = Math.atan2(dx, dz);
    this.next = this.pickNext(b, a);
    this.buildSegment();
  }
  buildSegment() {
    const a = this.from, b = this.to;
    const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    const rx = -dz, rz = dx;
    const hw = crossHW(b, dx, dz);
    this.dir = { x: dx, z: dz };
    this.stopPt = { x: b.x - dx * (hw + 3.5) + rx * this.laneOff, z: b.z - dz * (hw + 3.5) + rz * this.laneOff };
    this.wps = [{ x: this.stopPt.x, z: this.stopPt.z, stop: true }];
    this.limit = speedLimit(a, b);
  }
  pickNext(b, a) {
    let opts = b.links.map((id) => graph.nodes[id]).filter((n) => n !== a);
    if (!opts.length) return a;
    if (this.route && this.route.length) {
      const c = this.route.shift();
      if (c && b.links.includes(c.id)) return c;
      this.route = null;
    }
    const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    const straight = opts.find((n) => Math.sign(n.x - b.x) === dx && Math.sign(n.z - b.z) === dz);
    return straight && R() < 0.5 ? straight : opts[Math.floor(R() * opts.length)];
  }
  chooseNext() {
    const b = this.to, a = this.from;
    const c = this.next || this.pickNext(b, a);
    const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    const d2x = Math.sign(c.x - b.x), d2z = Math.sign(c.z - b.z);
    const lanes2 = roadLanes(b, c);
    const off2 = lanes2[Math.floor(R() * lanes2.length)];
    const rx = -dz, rz = dx, r2x = -d2z, r2z = d2x;
    const hwIn = crossHW(b, dx, dz), hwOut = crossHW(b, d2x, d2z);
    const E = { x: b.x - dx * (hwIn + 1) + rx * this.laneOff, z: b.z - dz * (hwIn + 1) + rz * this.laneOff };
    const X = { x: b.x + d2x * (hwOut + 1) + r2x * off2, z: b.z + d2z * (hwOut + 1) + r2z * off2 };
    const pts = [];
    if (c === a) { // U-turn at dead end
      const cx = b.x + dx * 6, cz = b.z + dz * 6;
      pts.push(E, { x: cx + rx * 4, z: cz + rz * 4, turn: true }, { x: cx + dx * 4, z: cz + dz * 4, turn: true }, { x: cx - rx * 4, z: cz - rz * 4, turn: true }, X);
    } else {
      const straight = d2x === dx && d2z === dz;
      const ctrl = straight ? { x: (E.x + X.x) / 2, z: (E.z + X.z) / 2 } : (dx !== 0 ? { x: X.x, z: E.z } : { x: E.x, z: X.z });
      for (let i = 1; i <= 5; i++) {
        const t = i / 5, u = 1 - t;
        pts.push({ x: u * u * E.x + 2 * u * t * ctrl.x + t * t * X.x, z: u * u * E.z + 2 * u * t * ctrl.z + t * t * X.z, turn: !straight });
      }
    }
    this.from = b; this.to = c; this.laneOff = off2;
    this.next = this.pickNext(c, b);
    this.buildSegment();
    this.wps = [...pts, ...this.wps];
  }
  // returns desired {speed, target{x,z}}
  update(dt) {
    const G = this.G, v = this.v;
    if (v.destroyed || v.driver !== 'ai') return;
    this.honkCd = Math.max(0, this.honkCd - dt);
    this.panic = Math.max(0, this.panic - dt);
    let target, speed;
    if (this.mode === 'pursuit') ({ target, speed } = this.pursuit(dt));
    else if (this.mode === 'race') ({ target, speed } = this.race(dt));
    else if (this.mode === 'parkedStop') { target = { x: v.pos.x + Math.sin(v.heading), z: v.pos.z + Math.cos(v.heading) }; speed = 0; }
    else ({ target, speed } = this.cruise(dt));
    this.drive(dt, target, speed);
  }
  cruise(dt) {
    const v = this.v, G = this.G;
    // pop reached waypoints
    while (this.wps.length) {
      const w = this.wps[0];
      const dx = w.x - v.pos.x, dz = w.z - v.pos.z;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const d = Math.hypot(dx, dz);
      if (d < 3.2 || (d < 9 && dx * fx + dz * fz < 0)) {
        this.wps.shift();
        if (w.stop) this.chooseNext();
      } else break;
    }
    if (!this.wps.length) this.chooseNext();
    // lookahead target
    let target = this.wps[0];
    for (const w of this.wps) { if (Math.hypot(w.x - v.pos.x, w.z - v.pos.z) > 7) { target = w; break; } }
    let speed = this.limit * this.maxSpeedMul;
    if (this.wps.some((w, i) => i < 3 && w.turn)) speed = Math.min(speed, 8);
    const stopW = this.wps.find((w) => w.stop);
    if (stopW && this.next) {
      const turning = Math.sign(this.next.x - this.to.x) !== this.dir.x || Math.sign(this.next.z - this.to.z) !== this.dir.z;
      const ds = Math.hypot(stopW.x - v.pos.x, stopW.z - v.pos.z);
      if (turning && ds < 30) speed = Math.min(speed, 7 + ds * 0.35);
    }
    if (this.panic > 0) speed *= 1.5;
    // traffic light
    const stop = this.wps.find((w) => w.stop);
    if (stop && this.to.light && this.panic <= 0 && !v.sirenOn) {
      const axis = this.dir.z !== 0 ? 'ns' : 'ew';
      const st = lightState(axis, G.time.total);
      const d = Math.hypot(stop.x - v.pos.x, stop.z - v.pos.z);
      if ((st === 'r' || (st === 'y' && d > 14)) && d < 40) speed = Math.min(speed, Math.max(0, (d - 4.5) * 0.7));
    }
    speed = Math.min(speed, this.obstacleSpeed());
    return { target, speed };
  }
  obstacleSpeed() {
    const v = this.v, G = this.G;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let limit = Infinity, blockPlayer = false;
    const check = (x, z, halfW, len, sp, isPlayer) => {
      const dx = x - v.pos.x, dz = z - v.pos.z;
      const f = dx * fx + dz * fz;
      if (f <= 0 || f > 32) return;
      const l = Math.abs(dx * fz - dz * fx);
      if (l > halfW + v.T.wid / 2 + 0.2) return;
      const gap = f - v.T.len / 2 - len / 2;
      const s = Math.max(0, gap - 2.2) * 0.9 + Math.max(0, sp) * 0.8;
      if (s < limit) { limit = s; blockPlayer = isPlayer && gap < 6; }
    };
    for (const o of G.vehicles) {
      if (o === v || Math.abs(o.pos.x - v.pos.x) > 34 || Math.abs(o.pos.z - v.pos.z) > 34) continue;
      const ofs = o.vel.x * fx + o.vel.y * fz;
      check(o.pos.x, o.pos.z, o.T.wid / 2, o.T.len, ofs, o.driver === 'player');
    }
    const P = G.player;
    if (!P.vehicle) check(P.pos.x, P.pos.z, 0.6, 0.6, 0, true);
    for (const p of G.peds.list) {
      if (p.dead || Math.abs(p.pos.x - v.pos.x) > 20 || Math.abs(p.pos.z - v.pos.z) > 20) continue;
      check(p.pos.x, p.pos.z, 0.6, 0.6, 0, false);
    }
    if (blockPlayer && limit < 1) {
      this.blockedByPlayer += 1 / 60;
      if (this.blockedByPlayer > 2.5 && this.honkCd <= 0) { G.audio.horn(v.pos, v.type); this.honkCd = 2 + R() * 3; }
    } else this.blockedByPlayer = 0;
    if (this.panic > 0) limit = Math.max(limit, 4);
    return limit;
  }
  pursuit(dt) {
    const v = this.v, G = this.G, P = G.player;
    const st = this.searchTarget, cv = this.chaseTarget;
    if (cv && (cv.destroyed || cv.driver !== 'ai')) { this.chaseTarget = null; this.mode = 'parkedStop'; v.setSiren(false); }
    const tp = cv ? cv.pos : st ? { x: st.x, y: 0, z: st.z } : P.vehicle ? P.vehicle.pos : P.pos;
    const tv = cv ? cv.vel : st ? { x: 0, y: 0 } : P.vehicle ? P.vehicle.vel : { x: P.vel.x, y: P.vel.z };
    const d = Math.hypot(tp.x - v.pos.x, tp.z - v.pos.z);
    this.repath = (this.repath || 0) - dt;
    let target;
    if (d > 70) {
      if (this.repath <= 0 || !this.route || !this.route.length) {
        this.repath = 3;
        this.route = findPath(v.pos.x, v.pos.z, tp.x, tp.z).slice(1);
      }
      while (this.route.length > 1 && Math.hypot(this.route[0].x - v.pos.x, this.route[0].z - v.pos.z) < 12) this.route.shift();
      target = this.route[0] || tp;
    } else {
      target = { x: tp.x + tv.x * 0.6, z: tp.z + tv.y * 0.6 };
    }
    let speed = Math.min(v.T.maxSpeed * 0.92, d * 1.1 + Math.hypot(tv.x, tv.y));
    if ((!P.vehicle || st) && !cv && d < 14) speed = Math.max(0, (d - 7) * 0.8); // stop near suspect on foot / search area
    return { target, speed };
  }
  race(dt) {
    const v = this.v;
    const cps = this.checkpoints;
    if (!cps || this.cp >= cps.length) return { target: { x: v.pos.x + Math.sin(v.heading) * 5, z: v.pos.z + Math.cos(v.heading) * 5 }, speed: 0 };
    let c = cps[this.cp];
    if (Math.hypot(c.x - v.pos.x, c.z - v.pos.z) < 14) { this.cp++; c = cps[Math.min(this.cp, cps.length - 1)]; }
    const next = cps[Math.min(this.cp + 1, cps.length - 1)];
    // slow for sharp turns
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const tx = c.x - v.pos.x, tz = c.z - v.pos.z, td = Math.hypot(tx, tz) + 1e-3;
    const nx = next.x - c.x, nz = next.z - c.z, nd = Math.hypot(nx, nz) + 1e-3;
    const turn = 1 - (tx * nx + tz * nz) / (td * nd);
    let speed = v.T.maxSpeed * this.skill;
    if (td < 75 && turn > 0.4) speed = Math.min(speed, 11 + td * 0.32);
    speed = Math.min(speed, this.obstacleSpeed() + 6);
    return { target: c, speed };
  }
  drive(dt, target, speed) {
    const v = this.v;
    const l = v.toLocal(target.x, target.z);
    let steer = clamp(Math.atan2(l.x, l.z) / Math.max(0.2, v.T.steer) * 1.4, -1, 1);
    const vf = v.fwdSpeed;
    // stuck recovery
    if (speed > 3 && Math.abs(vf) < 0.6) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 2.5 && this.reverseT <= 0) { this.reverseT = 1.6; this.stuckT = 0; }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.input.throttle = 0; v.input.brake = 1; v.input.steer = -steer; v.input.handbrake = false;
      return;
    }
    const err = speed - vf;
    v.input.throttle = clamp(err * 0.45, 0, 1);
    v.input.brake = err < -1 ? clamp(-err * 0.25, 0, 1) : 0;
    if (speed < 0.3 && vf < 1.5) { v.input.brake = 1; v.input.throttle = 0; }
    v.input.steer = steer;
    v.input.handbrake = false;
    if (l.z < 0 && Math.abs(l.x) < 3 && this.mode === 'pursuit') { v.input.steer = l.x > 0 ? 1 : -1; }
    this.stuck = this.stuckT;
  }
}

export class TrafficManager {
  constructor(G) {
    this.G = G;
    this.cars = []; // AI-driven traffic vehicles
    this.parked = new Map(); // spot index -> vehicle
    this.density = 1;
    this.spawnT = 0;
    this.emergencyT = 40;
  }
  pickType() {
    const r = R();
    if (r < 0.3) return 'sedan'; if (r < 0.44) return 'suv'; if (r < 0.55) return 'pickup'; if (r < 0.65) return 'taxi';
    if (r < 0.75) return 'sports'; if (r < 0.78) return 'super'; if (r < 0.85) return 'moto'; if (r < 0.95) return 'police';
    return 'ambulance';
  }
  spawnCar(type, nearX, nearZ, minD = 90, maxD = 240, viewCheck = true) {
    const G = this.G;
    const cam = G.camera;
    const cf = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = graph.nodes[Math.floor(R() * graph.nodes.length)];
      if (Math.abs(a.x - nearX) > maxD || Math.abs(a.z - nearZ) > maxD) continue;
      const b = graph.nodes[a.links[Math.floor(R() * a.links.length)]];
      const t = 0.25 + R() * 0.5;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const d = Math.hypot(x - nearX, z - nearZ);
      if (d < minD || d > maxD) continue;
      if (viewCheck) {
        const dx = x - cam.position.x, dz = z - cam.position.z, dd = Math.hypot(dx, dz);
        if (dd < 160 && (dx * cf.x + dz * cf.z) / dd > 0.3) continue;
      }
      if (G.vehicles.some((v) => dist2(v.pos.x, v.pos.z, x, z) < 144)) continue;
      const v = new Vehicle(G, type, x, z, 0, {});
      const ai = new AIDriver(G, v);
      ai.placeOnEdge(a, b, t);
      v.ai = ai;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      v.vel.set(fx * ai.limit * 0.6, fz * ai.limit * 0.6);
      v.syncMesh();
      G.vehicles.push(v);
      this.cars.push(v);
      if (type === 'police') v.isCop = true;
      return v;
    }
    return null;
  }
  carjack(v, player) {
    const G = this.G;
    if (v.driver !== 'ai') return;
    const d = v.doorPos(1);
    const cop = v.type === 'police';
    const ped = G.peds.spawnAt(d.x, d.z, { cop, state: cop ? 'attack' : 'flee', fromCar: true });
    if (ped) { ped.threat = { x: player.pos.x, z: player.pos.z }; ped.say(cop ? 'Hey! Police vehicle!' : 'Hey! That\'s my car!', true); }
    v.driver = null; v.ai = null;
    v.input.throttle = 0; v.input.brake = 1; v.input.steer = 0;
    if (v.dummy) v.dummy.visible = false;
    v.setSiren(false);
    this.cars = this.cars.filter((c) => c !== v);
  }
  panicNear(pos, r) {
    for (const v of this.cars) if (v.ai && dist2(v.pos.x, v.pos.z, pos.x, pos.z) < r * r) { v.ai.panic = 8 + R() * 6; if (R() < 0.5) this.G.audio.horn(v.pos, v.type); }
  }
  update(dt) {
    const G = this.G;
    const P = G.player;
    const px = P.pos.x, pz = P.pos.z;
    const want = Math.round(24 * this.density);
    const cam = G.camera;
    const cf = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.cars.length < want) {
      this.spawnT = 0.25;
      const t = this.pickType();
      this.spawnCar(t, px, pz);
    }
    // emergency vehicle drive-bys
    this.emergencyT -= dt;
    if (this.emergencyT <= 0) {
      this.emergencyT = 70 + R() * 80;
      const v = this.spawnCar(R() < 0.5 ? 'ambulance' : 'police', px, pz, 120, 220);
      if (v) { v.setSiren(true); v.ai.maxSpeedMul = 1.6; v.emergency = true; }
    }
    // despawn
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      const dx = v.pos.x - cam.position.x, dz = v.pos.z - cam.position.z, d = Math.hypot(dx, dz);
      const inView = (dx * cf.x + dz * cf.z) / (d + 1e-3) > 0.2 && d < 260;
      const stuck = v.ai && v.ai.stuckT > 8;
      if ((d > 320 && !inView) || (d > 140 && !inView && (v.destroyed || stuck)) || d > 600) {
        if (v.pursuer || v.mission) continue;
        this.remove(v);
      }
    }
    // clean up abandoned vehicles far from the player
    this.gcT = (this.gcT || 0) - dt;
    if (this.gcT <= 0) {
      this.gcT = 3;
      const parkedSet = new Set(this.parked.values());
      for (const v of [...G.vehicles]) {
        if (v.driver || v.owned || v.mission || parkedSet.has(v) || this.cars.includes(v) || P.vehicle === v) continue;
        const d = Math.hypot(v.pos.x - cam.position.x, v.pos.z - cam.position.z);
        if (d > 280 || (v.destroyed && d > 120)) { G.vehicles = G.vehicles.filter((c) => c !== v); v.dispose(); }
      }
    }
    // AI update
    for (const v of this.cars) {
      if (v.ai && v.driver === 'ai') v.ai.update(dt);
    }
    // parked cars
    this.updateParked();
  }
  remove(v) {
    const G = this.G;
    this.cars = this.cars.filter((c) => c !== v);
    G.vehicles = G.vehicles.filter((c) => c !== v);
    v.dispose();
  }
  updateParked() {
    const G = this.G, P = G.player;
    const spots = G.city.parkedSpots;
    this._pi = ((this._pi || 0) + 1) % 4;
    for (let i = this._pi; i < spots.length; i += 4) {
      const s = spots[i];
      const d = Math.hypot(s.x - P.pos.x, s.z - P.pos.z);
      const ex = this.parked.get(i);
      if (d < 170 && ex === undefined) {
        if (G.vehicles.some((v) => dist2(v.pos.x, v.pos.z, s.x, s.z) < 9)) { this.parked.set(i, null); continue; }
        const type = s.type || 'sedan';
        const v = new Vehicle(G, type, s.x, s.z, s.rot ?? 0, { parked: true, empty: true });
        v.engineOn = false; v.input.handbrake = true;
        G.vehicles.push(v);
        this.parked.set(i, v);
      } else if (d > 230 && ex !== undefined) {
        if (ex && ex.driver === null && !ex.owned && !ex.mission && G.player.vehicle !== ex) {
          const cam = G.camera;
          G.vehicles = G.vehicles.filter((c) => c !== ex);
          ex.dispose();
        }
        this.parked.delete(i);
      }
    }
  }
}
