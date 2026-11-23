// Wanted system & police response: crimes, witnesses, star levels, pursuit
// dispatch, cops on foot, helicopter with searchlight, search & evasion, busted.
import * as THREE from 'three';
import { clamp, R, dist2, damp, dampAngle } from '../util.js';
import { graph, nearestNode, groundHeight } from '../world/layout.js';

const CRIMES = {
  assault: { pts: 1, witness: 0.7, label: 'Assault' },
  assaultCop: { pts: 3, witness: 1, label: 'Assaulting an officer' },
  shooting: { pts: 1.2, witness: 0.9, label: 'Discharging a firearm' },
  shootPed: { pts: 2, witness: 0.9, label: 'Assault with a deadly weapon' },
  shootCop: { pts: 4, witness: 1, label: 'Shooting an officer' },
  killPed: { pts: 2.5, witness: 0.8, label: 'Homicide' },
  killCop: { pts: 5, witness: 1, label: 'Killing an officer' },
  hitPed: { pts: 1, witness: 0.6, label: 'Hit and run' },
  hitCop: { pts: 3, witness: 1, label: 'Hitting an officer' },
  carjack: { pts: 1, witness: 0.45, label: 'Grand theft auto' },
  stealCop: { pts: 3, witness: 1, label: 'Stealing a police vehicle' },
  robbery: { pts: 3.5, witness: 1, label: 'Armed robbery' },
  explosion: { pts: 2, witness: 0.8, label: 'Arson / explosion' },
  ramCop: { pts: 1.5, witness: 1, label: 'Ramming a police vehicle' },
  scripted: { pts: 0, witness: 1, label: 'Wanted' },
};
const THRESH = [0, 1, 3, 6, 10, 16];

class Helicopter {
  constructor(G) {
    this.G = G;
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.4, metalness: 0.5 });
    const w = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 2.2, 6, 12).rotateX(Math.PI / 2), m);
    const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(1.22, 1.2, 4, 12, 1).rotateX(Math.PI / 2), w); stripe.position.z = -0.5;
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8), glass); cockpit.position.set(0, 0.1, 1.5); cockpit.scale.set(1, 0.85, 0.9);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 5, 8).rotateX(Math.PI / 2), m); boom.position.set(0, 0.3, -3.8);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.8), m); fin.position.set(0, 0.9, -6.1);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.5), w); skid.position.set(0.9, -1.4, 0); const skid2 = skid.clone(); skid2.position.x = -0.9;
    this.rotor = new THREE.Group();
    for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 9), w); b.rotation.y = i * Math.PI / 2; this.rotor.add(b); }
    this.rotor.position.y = 1.4;
    this.tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 0.2), w); this.tail.position.set(0.15, 0.9, -6.2);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 })); beacon.position.set(0, -1.1, 0);
    g.add(body, stripe, cockpit, boom, fin, skid, skid2, this.rotor, this.tail, beacon);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group = g;
    this.spot = new THREE.SpotLight(0xeef4ff, 0, 160, 0.22, 0.5, 1.2);
    this.spot.position.set(0, -1.2, 1.5);
    this.spot.target.position.set(0, -40, 0);
    g.add(this.spot, this.spot.target);
    G.scene.add(g);
    g.position.set(0, -500, 0);
    this.pos = new THREE.Vector3(0, 60, 0); this.vel = new THREE.Vector3();
    this.alive = false; this.health = 100; this.heading = 0;
  }
  spawn(near) {
    this.alive = true; this.health = 100;
    this.pos.set(near.x + 200, 70, near.z + 200);
  }
  despawn() { this.alive = false; this.group.position.set(0, -500, 0); this.spot.intensity = 0; }
  damage(n) {
    this.health -= n;
    if (this.health <= 0 && this.alive) {
      const G = this.G;
      G.fx.explosion(this.pos.x, this.pos.y, this.pos.z); G.audio.explosion(this.pos);
      G.wanted.addPoints(3);
      this.despawn();
      this.cool = 40;
    }
  }
  update(dt, target, searching) {
    if (!this.alive) return;
    const G = this.G;
    const t = searching ? G.wanted.lastSeen : target;
    const orbit = G.time.total * 0.25;
    const goal = new THREE.Vector3(t.x + Math.cos(orbit) * 30, Math.max(groundHeight(t.x, t.z), 0) + 42, t.z + Math.sin(orbit) * 30);
    const dir = goal.clone().sub(this.pos);
    const d = dir.length();
    const sp = Math.min(30, d * 0.8);
    if (d > 0.1) dir.multiplyScalar(sp / d);
    this.vel.lerp(dir, 1 - Math.exp(-dt * 1.2));
    this.pos.addScaledVector(this.vel, dt);
    this.heading = dampAngle(this.heading, Math.atan2(t.x - this.pos.x, t.z - this.pos.z), 1.5, dt);
    this.group.position.copy(this.pos);
    this.group.rotation.set(clamp(this.vel.length() * 0.012, 0, 0.25), this.heading, 0);
    this.rotor.rotation.y += dt * 40; this.tail.rotation.x += dt * 50;
    // searchlight aims at target
    this.spot.target.position.copy(this.group.worldToLocal(new THREE.Vector3(t.x, 0, t.z)));
    this.spot.intensity = G.sky.night > 0.3 ? 6000 : 0;
    G.audio.heli(this.pos);
  }
}

export class Wanted {
  constructor(G) {
    this.G = G;
    this.level = 0; this.points = 0;
    this.lastSeen = { x: 0, z: 0 };
    this.searching = false; this.searchT = 0; this.seenT = 0;
    this.bustT = 0; this.dispatchT = 0;
    this.disabled = false;
    this.heli = new Helicopter(G);
  }
  get radius() { return 70 + this.level * 45; }
  crime(type, pos) {
    if (this.disabled) return;
    const c = CRIMES[type];
    if (!c) return;
    const G = this.G;
    // witnesses: police nearby always; civilians with some probability
    let witnessed = false;
    const copNear = this.copSees(pos, 80);
    if (copNear) witnessed = true;
    else if (this.level > 0 && type !== 'carjack') witnessed = true;
    else {
      const civ = G.peds.list.some((p) => !p.dead && dist2(p.pos.x, p.pos.z, pos.x, pos.z) < 900);
      const cars = G.traffic.cars.some((v) => dist2(v.pos.x, v.pos.z, pos.x, pos.z) < 1600);
      if ((civ || cars) && R() < c.witness) witnessed = true;
    }
    if (!witnessed) return;
    const before = this.level;
    this.addPoints(c.pts);
    this.lastSeen = { x: pos.x, z: pos.z };
    this.searchT = 0; this.searching = false;
    if (this.level > before) {
      G.ui.notify(`Crime reported: ${c.label}`);
      G.audio.radioChatter && G.audio.radioChatter();
    }
  }
  setLevel(l) {
    l = clamp(l, 0, 5);
    if (l > 0 && this.level === 0) this.lastSeen = { x: this.G.player.pos.x, z: this.G.player.pos.z };
    this.level = l;
    this.points = Math.max(this.points, THRESH[l]);
    if (l === 0) this.clear();
    this.G.ui.updateWanted();
  }
  addPoints(n) {
    this.points += n;
    let l = 0;
    for (let i = 1; i <= 5; i++) if (this.points >= THRESH[i]) l = i;
    if (l > this.level) {
      if (this.level === 0) this.lastSeen = { x: this.G.player.pos.x, z: this.G.player.pos.z };
      this.level = l;
      this.G.ui.updateWanted(true);
      this.G.music && this.G.audio.setMusicState('wanted');
    }
  }
  clear() {
    const G = this.G;
    this.level = 0; this.points = 0; this.searching = false; this.searchT = 0; this.bustT = 0;
    for (const v of G.traffic.cars) if (v.pursuer && v.ai) { v.pursuer = false; v.setSiren(false); this.rejoin(v); }
    for (const p of G.peds.list) if (p.isCop && p.state === 'attack') { p.state = 'walk'; p.reloop(); p.model.gun.visible = false; }
    if (this.heli) this.heli.despawn();
    G.ui.updateWanted();
  }
  rejoin(v) {
    const n = nearestNode(v.pos.x, v.pos.z);
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let best = null, bd = -2;
    for (const id of n.links) {
      const m = graph.nodes[id];
      const dx = m.x - n.x, dz = m.z - n.z, l = Math.hypot(dx, dz);
      const d = (dx * fx + dz * fz) / l;
      if (d > bd) { bd = d; best = m; }
    }
    v.ai.mode = 'cruise'; v.ai.from = n; v.ai.to = best; v.ai.laneOff = 3.4; v.ai.next = v.ai.pickNext(best, n); v.ai.buildSegment();
  }
  copSees(pos, range) {
    const G = this.G;
    for (const p of G.peds.list) if (p.isCop && !p.dead && dist2(p.pos.x, p.pos.z, pos.x, pos.z) < range * range) return true;
    for (const v of G.traffic.cars) if (v.isCop && v.driver === 'ai' && dist2(v.pos.x, v.pos.z, pos.x, pos.z) < range * range) return true;
    return false;
  }
  canSeePlayer() {
    const G = this.G, P = G.player;
    const pp = P.vehicle ? P.vehicle.pos : P.pos;
    const range = 60 + this.level * 18;
    const test = (x, y, z) => {
      if (dist2(x, z, pp.x, pp.z) > range * range) return false;
      return G.col.raycast(x, y, z, pp.x, pp.y + 1.2, pp.z) > 0.97;
    };
    for (const v of G.traffic.cars) if (v.isCop && v.driver === 'ai' && !v.destroyed && test(v.pos.x, v.pos.y + 1.4, v.pos.z)) return true;
    for (const p of G.peds.list) if (p.isCop && !p.dead && test(p.pos.x, p.pos.y + 1.6, p.pos.z)) return true;
    if (this.heli && this.heli.alive && dist2(this.heli.pos.x, this.heli.pos.z, pp.x, pp.z) < 90 * 90 && !P.indoors) return true;
    return false;
  }
  update(dt) {
    const G = this.G, P = G.player;
    if (this.heli.cool) this.heli.cool = Math.max(0, this.heli.cool - dt);
    if (this.level === 0) { this.heli.alive && this.heli.despawn(); return; }
    const pp = P.vehicle ? P.vehicle.pos : P.pos;
    // visibility & search
    this.seenCheckT = (this.seenCheckT || 0) - dt;
    if (this.seenCheckT <= 0) {
      this.seenCheckT = 0.4;
      this.seen = this.canSeePlayer();
    }
    if (this.seen) {
      this.lastSeen = { x: pp.x, z: pp.z };
      this.searching = false; this.searchT = 0;
    } else {
      this.searching = true;
      const outside = Math.hypot(pp.x - this.lastSeen.x, pp.z - this.lastSeen.z) > this.radius;
      this.searchT += dt * (outside ? 1 : 0.35);
      if (this.searchT > 7 + this.level * 3) {
        this.clear();
        G.ui.notify('You lost the cops.');
        G.audio.ui('success');
        G.onWantedCleared && G.onWantedCleared();
        return;
      }
    }
    // dispatch
    const wantCars = [0, 1, 2, 3, 5, 6][this.level];
    const pursuers = G.traffic.cars.filter((v) => v.pursuer && !v.destroyed);
    this.dispatchT -= dt;
    // convert nearby patrol cars
    for (const v of G.traffic.cars) {
      if (v.isCop && !v.pursuer && v.ai && v.driver === 'ai' && dist2(v.pos.x, v.pos.z, pp.x, pp.z) < 160 * 160 && pursuers.length < wantCars) {
        v.pursuer = true; v.ai.mode = 'pursuit'; v.setSiren(true); pursuers.push(v);
      }
    }
    if (this.dispatchT <= 0 && pursuers.length < wantCars) {
      this.dispatchT = 3.5 - this.level * 0.4;
      const ref = this.searching ? this.lastSeen : pp;
      const v = G.traffic.spawnCar('police', ref.x, ref.z, 110, 210, false);
      if (v) { v.pursuer = true; v.isCop = true; v.ai.mode = 'pursuit'; v.setSiren(true); }
    }
    // pursuers search last-seen area when player hidden
    for (const v of pursuers) {
      if (!v.ai) continue;
      v.ai.searchTarget = this.searching ? this.lastSeen : null;
      // deploy officers when player is on foot nearby
      const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      if (!P.vehicle && d < 26 && v.speed < 3 && !v.deployed) {
        v.deployed = true;
        for (const s of [1, -1]) {
          const dp = v.doorPos(s);
          const cop = G.peds.spawnAt(dp.x, dp.z, { cop: true, state: 'attack' });
          cop.say(['Freeze! Police!', 'Hands up!', 'Get on the ground!'][Math.floor(R() * 3)], true);
        }
        v.driver = null; v.ai = null; v.dummy && (v.dummy.visible = false); v.input.brake = 1;
        v.engineOn = true; v.sirenOn = true; v.parked = true;
      }
    }
    // helicopter
    if (this.level >= 3 && !this.heli.alive && !this.heli.cool) this.heli.spawn(pp);
    if (this.heli.alive) this.heli.update(dt, pp, this.searching);
    // busted
    let copClose = false;
    for (const p of G.peds.list) if (p.isCop && !p.dead && p.state === 'attack' && dist2(p.pos.x, p.pos.z, pp.x, pp.z) < (P.vehicle ? 9 : 5.5)) copClose = true;
    const slow = P.vehicle ? P.vehicle.speed < 1 : P.speedXZ < 1.8;
    if (copClose && slow && this.level <= 4) {
      this.bustT += dt;
      if (this.bustT > (P.vehicle ? 2.5 : 1.5)) { this.bustT = 0; G.onBusted && G.onBusted(); }
    } else this.bustT = Math.max(0, this.bustT - dt);
  }
}
