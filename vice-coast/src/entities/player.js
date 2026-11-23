// The player: on-foot movement, jumping, crouching, swimming, melee & pistol
// combat, entering / exiting / carjacking vehicles and driving controls.
import * as THREE from 'three';
import { HumanModel } from './human.js';
import { clamp, damp, dampAngle, lerp, wrapAngle, R } from '../util.js';
import { groundHeight, WATER_Y, WORLD } from '../world/layout.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ray = new THREE.Vector3();

export const DEFAULT_LOOK = {
  female: false, skin: 0xc68a64, hair: 0x1a1210, hairStyle: 'short', shirt: 0xf2f2f2, pants: 0x1f2a44,
  shoes: 0xffffff, sleeves: 'short', hat: 'none', glasses: true, build: 1.05, height: 1.02,
};

export class Player {
  constructor(G, x, z) {
    this.G = G;
    this.pos = new THREE.Vector3(x, groundHeight(x, z), z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.health = 100; this.maxHealth = 100; this.armor = 0;
    this.stamina = 1;
    this.vehicle = null;
    this.crouching = false; this.walking = false; this.sprinting = false;
    this.onGround = true; this.swimming = false; this.aiming = false; this.indoors = false;
    this.weapon = 'fists';
    this.ammo = 0; this.clip = 0; this.clipSize = 12;
    this.attackCd = 0; this.reloadT = 0;
    this.knockT = 0; this.enterT = 0; this.enterTarget = null;
    this.dead = false;
    this.footTimer = 0;
    this.hitFlash = 0;
    this.setLook({ ...DEFAULT_LOOK });
  }
  setLook(look) {
    this.look = look;
    if (this.model) this.model.root.parent && this.model.root.parent.remove(this.model.root);
    this.model = new HumanModel(look);
    this.G.scene.add(this.model.root);
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    for (let i = 0; i < 10; i++) this.model.animate(0.05, { mode: 'idle', speed: 0 });
    if (this.vehicle) this.attachToSeat();
  }
  teleport(x, z, yaw) {
    if (this.vehicle) this.leaveVehicle(true);
    this.pos.set(x, groundHeight(x, z), z); this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.model.root.position.copy(this.pos);
  }
  get speedXZ() { return Math.hypot(this.vel.x, this.vel.z); }

  hurt(amount, src) {
    if (this.dead || this.G.godMode) return;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.7); this.armor -= a; amount -= a; }
    this.health = Math.max(0, this.health - amount);
    this.hitFlash = 1;
    this.G.ui && this.G.ui.damageFlash();
    if (this.health <= 0) { this.dead = true; this.G.onPlayerDeath && this.G.onPlayerDeath(src); }
  }
  knockDown(vx, vz, dmg) {
    if (this.vehicle) return;
    this.knockT = 1.6; this.vel.set(vx, 4, vz); this.onGround = false;
    this.hurt(dmg, 'vehicle');
  }

  update(dt) {
    const G = this.G;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    if (this.dead) { this.model.animate(dt, { mode: 'dead' }); return; }
    // slow health regeneration up to 50%
    if (this.health < 50 && this.health > 0) this.health = Math.min(50, this.health + dt * 0.8);
    if (this.vehicle) this.updateDriving(dt);
    else this.updateOnFoot(dt);
  }

  // ---------- On foot ----------
  updateOnFoot(dt) {
    const G = this.G, inp = G.input;
    const m = this.model;
    // entering a vehicle (short walk-to-door phase)
    if (this.enterT > 0) {
      this.enterT -= dt;
      const v = this.enterTarget;
      if (!v || v.destroyed) { this.enterT = 0; this.enterTarget = null; }
      else {
        const d = v.doorPos(1);
        this.pos.x = damp(this.pos.x, d.x, 10, dt); this.pos.z = damp(this.pos.z, d.z, 10, dt);
        this.yaw = dampAngle(this.yaw, v.heading, 10, dt);
        m.root.position.copy(this.pos); m.root.rotation.y = this.yaw;
        m.animate(dt, { mode: 'enter', speed: 0 });
        if (this.enterT <= 0) this.enterVehicle(v);
        return;
      }
    }
    let mx = inp.axis('left', 'right'), mz = inp.axis('back', 'forward');
    if (this.knockT > 0) { mx = mz = 0; this.knockT -= dt; }
    if (G.uiBlocking) { mx = mz = 0; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const cy = G.cam.yaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    const dx = fx * mz + rx * mx, dz = fz * mz + rz * mx;
    if (inp.pressed('crouch') && !this.swimming) this.crouching = !this.crouching;
    if (inp.pressed('walk')) this.walking = !this.walking;
    this.aiming = inp.is('aim') && !this.swimming && this.knockT <= 0 && !G.uiBlocking;
    const wantSprint = inp.is('sprint') && len > 0.1 && !this.crouching && !this.aiming;
    if (wantSprint && this.stamina > 0.05) { this.stamina = Math.max(0, this.stamina - dt * 0.12); this.sprinting = true; }
    else { this.sprinting = false; this.stamina = Math.min(1, this.stamina + dt * 0.2); }
    let speed = this.walking ? 1.7 : 4.3;
    if (this.sprinting) speed = 7.2;
    if (this.crouching) speed = 1.7;
    if (this.aiming) speed = Math.min(speed, 2.6);
    if (this.swimming) speed = this.sprinting ? 2.6 : 1.8;
    const tvx = dx * speed * Math.min(1, len), tvz = dz * speed * Math.min(1, len);
    const acc = this.onGround || this.swimming ? 12 : 2;
    if (this.knockT <= 0) {
      this.vel.x = damp(this.vel.x, tvx, acc, dt);
      this.vel.z = damp(this.vel.z, tvz, acc, dt);
    } else { this.vel.x *= Math.exp(-dt * 3); this.vel.z *= Math.exp(-dt * 3); }
    // facing
    if (this.aiming) this.yaw = dampAngle(this.yaw, cy + Math.PI, 20, dt);
    else if (len > 0.1 && this.knockT <= 0) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 12, dt);
    // jump
    if (inp.pressed('jump') && this.onGround && !this.swimming && this.knockT <= 0 && !G.uiBlocking) {
      this.vel.y = this.crouching ? 4.5 : 6.2; this.onGround = false; this.crouching = false;
      G.audio.jump();
    }
    // gravity & integrate
    this.vel.y -= 22 * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    // world bounds
    this.pos.x = clamp(this.pos.x, WORLD.x0 + 20, WORLD.x1 + 400);
    this.pos.z = clamp(this.pos.z, WORLD.z0 + 20, WORLD.z1 + 300);
    // static collision
    const res = G.col.resolveCircle(this.pos, 0.34, this.pos.y + 0.45, this.crouching ? 0.8 : 1.3);
    // vehicles
    for (const v of G.vehicles) {
      if (Math.abs(v.pos.x - this.pos.x) > 6 || Math.abs(v.pos.z - this.pos.z) > 6) continue;
      const l = v.toLocal(this.pos.x, this.pos.z);
      const hw = v.T.wid / 2 + 0.3, hl = v.T.len / 2 + 0.3;
      if (Math.abs(l.x) < hw && Math.abs(l.z) < hl && this.pos.y < v.pos.y + (v.T.roof || 1.2)) {
        // hit by a fast car?
        if (v.speed > 6 && v.driver && v.driver !== 'player' && this.knockT <= 0) {
          this.knockDown(v.vel.x * 0.8, v.vel.y * 0.8, v.speed * 2.5);
          G.audio.thud(this.pos);
        }
        // standing on top?
        const top = v.pos.y + (v.T.box || v.T.roof || 1.2);
        if (this.pos.y > top - 0.5 && this.vel.y <= 0) { this.pos.y = top; this.vel.y = 0; this.onGround = true; this.pos.x += v.vel.x * dt; this.pos.z += v.vel.y * dt; continue; }
        const px = hw - Math.abs(l.x), pz = hl - Math.abs(l.z);
        const c = Math.cos(v.heading), s = Math.sin(v.heading);
        let lx = 0, lz = 0;
        if (px < pz) lx = Math.sign(l.x) * px; else lz = Math.sign(l.z) * pz;
        this.pos.x += lx * c + lz * s; this.pos.z += -lx * s + lz * c;
      }
    }
    // ground
    let gy = groundHeight(this.pos.x, this.pos.z);
    const top = G.col.topAt(this.pos.x, this.pos.z, this.pos.y, 0.25);
    if (top > gy && top < this.pos.y + 0.55) gy = top;
    // swimming
    const waterSurf = WATER_Y - 1.25;
    if (gy < WATER_Y - 1.3 && this.pos.y <= waterSurf + 0.05) {
      if (!this.swimming) { G.fx.splash(this.pos.x, WATER_Y, this.pos.z, 24); G.audio.splash(this.pos); }
      this.swimming = true; this.crouching = false;
      this.pos.y = damp(this.pos.y, waterSurf, 6, dt); this.vel.y = 0; this.onGround = false;
    } else {
      this.swimming = false;
      if (this.pos.y <= gy) {
        if (!this.onGround && this.vel.y < -14) this.hurt((-this.vel.y - 14) * 6, 'fall');
        if (!this.onGround && this.vel.y < -4) G.audio.footstep(this.surface(), 1.2);
        this.pos.y = gy; this.vel.y = 0; this.onGround = true;
      } else if (this.pos.y > gy + 0.3) this.onGround = false;
      else if (this.vel.y <= 0) { this.pos.y = damp(this.pos.y, gy, 20, dt); this.onGround = true; this.vel.y = 0; }
    }
    // indoors (under a roof)
    const roofs = G.col.query(this.pos.x - 0.1, this.pos.z - 0.1, this.pos.x + 0.1, this.pos.z + 0.1, this._rq || (this._rq = []));
    this.indoors = roofs.some((b) => b.tag === 'roof' && this.pos.x > b.x0 && this.pos.x < b.x1 && this.pos.z > b.z0 && this.pos.z < b.z1 && b.y0 > this.pos.y);

    // combat
    if (!G.uiBlocking && this.knockT <= 0 && !this.swimming) this.updateCombat(dt);
    if (inp.pressed('weapon1')) this.setWeapon('fists');
    if (inp.pressed('weapon2')) this.setWeapon('pistol');
    if (inp.pressed('weaponNext')) this.setWeapon(this.weapon === 'fists' ? 'pistol' : 'fists');

    // enter vehicle
    if (inp.pressed('enter') && this.knockT <= 0 && !G.uiBlocking) this.tryEnterVehicle();

    // animation
    const sp = this.speedXZ;
    let mode = 'idle';
    if (this.knockT > 0) mode = this.knockT > 0.5 ? 'dead' : 'crouchIdle';
    else if (this.swimming) mode = 'swim';
    else if (!this.onGround) mode = 'air';
    else if (this.crouching) mode = sp > 0.3 ? 'crouch' : 'crouchIdle';
    else if (sp > 0.3) mode = 'move';
    else if (G.phoneOpen) mode = 'phone';
    const pitchAim = -clamp(G.cam.pitch, -0.6, 0.8) * 0.8;
    const r = m.animate(dt, { mode, speed: sp, aim: this.aiming && this.weapon === 'pistol', aimPitch: pitchAim, gun: this.weapon === 'pistol', sprint: this.sprinting, hit: this.hitFlash });
    if (r.footDown && this.onGround && !this.swimming) G.audio.footstep(this.surface(), this.sprinting ? 1 : this.crouching ? 0.3 : 0.6);
    if (this.swimming && sp > 0.5) { this.footTimer -= dt; if (this.footTimer < 0) { this.footTimer = 0.7; G.audio.swim(); } }
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    m.root.visible = true;
  }
  surface() {
    const z = this.G.zoneName;
    if (this.indoors) return 'tile';
    if (z === 'beach' && this.pos.x > 880) return 'sand';
    if (z === 'country' || z === 'island') return 'grass';
    return 'concrete';
  }
  setWeapon(w) {
    if (w === 'pistol' && !this.G.state.inventory.pistol) { this.G.ui.help('You don\'t own a pistol. Buy one at Coastline Arms.'); return; }
    this.weapon = w;
    this.G.ui.weaponChanged();
    this.G.audio.ui('select');
  }
  updateCombat(dt) {
    const G = this.G, inp = G.input;
    const st = G.state;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = this.clipSize - st.clip;
        const take = Math.min(need, st.ammo);
        st.clip += take; st.ammo -= take;
        G.ui.weaponChanged();
      }
      return;
    }
    if (this.weapon === 'pistol' && inp.pressed('reload') && st.clip < this.clipSize && st.ammo > 0) { this.reloadT = 1.3; G.audio.reload(); return; }
    if (!inp.pressed('attack') || this.attackCd > 0) return;
    if (this.weapon === 'fists') {
      this.attackCd = 0.45;
      this.model.punch();
      G.audio.swing();
      setTimeout(() => this.meleeHit(), 150);
    } else {
      if (st.clip <= 0) {
        if (st.ammo > 0) { this.reloadT = 1.3; G.audio.reload(); } else { G.audio.ui('error'); G.ui.help('Out of ammo.'); }
        return;
      }
      this.attackCd = 0.22; st.clip--;
      G.ui.weaponChanged();
      this.shoot();
    }
  }
  meleeHit() {
    const G = this.G;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let target = null, best = 1.8;
    for (const p of G.peds.list) {
      if (p.dead) continue;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < best && (dx * fx + dz * fz) / (d + 1e-5) > 0.5) { best = d; target = p; }
    }
    if (target) {
      G.audio.punch(target.pos);
      target.damage(34, this, { x: fx * 4, z: fz * 4 });
      G.wanted.crime(target.isCop ? 'assaultCop' : 'assault', this.pos);
      G.cam.shake(0.08);
      return;
    }
    // punch vehicles
    for (const v of G.vehicles) {
      if (v.contains(this.pos.x + fx, this.pos.z + fz, 0.3)) { v.damage(5); G.audio.thud(v.pos); break; }
    }
  }
  shoot() {
    const G = this.G, cam = G.camera;
    const origin = cam.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    if (!this.aiming) {
      // hip fire: shoot where the player faces
      dir.set(Math.sin(this.yaw), -0.02, Math.cos(this.yaw));
      origin.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
    }
    dir.x += (R() - 0.5) * 0.01; dir.y += (R() - 0.5) * 0.01; dir.normalize();
    const maxD = 120;
    const end = origin.clone().addScaledVector(dir, maxD);
    let tStatic = G.col.raycast(origin.x, origin.y, origin.z, end.x, end.y, end.z) * maxD;
    let hitPed = null, hitVeh = null, tHit = tStatic;
    // peds: vertical capsule approximation
    for (const p of G.peds.list) {
      if (p.dead) continue;
      const t = rayCylinder(origin, dir, p.pos.x, p.pos.y, p.pos.z, 0.4, p.crouch ? 1.1 : 1.8);
      if (t > 0.5 && t < tHit) { tHit = t; hitPed = p; hitVeh = null; }
    }
    for (const v of G.vehicles) {
      if (v === this.vehicle) continue;
      const t = rayCylinder(origin, dir, v.pos.x, v.pos.y, v.pos.z, Math.min(v.T.len, v.T.wid * 1.4) / 2, (v.T.roof || 1.2));
      if (t > 0.5 && t < tHit) { tHit = t; hitVeh = v; hitPed = null; }
    }
    if (G.wanted.heli && G.wanted.heli.alive) {
      const h = G.wanted.heli;
      const t = raySphere(origin, dir, h.pos, 3);
      if (t > 0 && t < tHit) { tHit = t; hitPed = null; hitVeh = null; h.damage(8); }
    }
    const hp = origin.clone().addScaledVector(dir, tHit);
    const muzzle = this.model.gun.getWorldPosition(_v2).addScaledVector(dir, 0.25);
    G.fx.muzzle(muzzle.x, muzzle.y, muzzle.z);
    G.audio.gunshot(this.pos, true);
    G.cam.shake(0.05);
    G.tracer && G.tracer(muzzle, hp);
    if (hitPed) {
      hitPed.damage(55, this, { x: dir.x * 3, z: dir.z * 3 });
      G.wanted.crime(hitPed.isCop ? 'shootCop' : 'shootPed', this.pos);
    } else if (hitVeh) {
      hitVeh.damage(60); G.fx.sparks(hp.x, hp.y, hp.z, 6);
      if (hitVeh.health <= 0 && !hitVeh.burning) hitVeh.burning = 0.01;
      G.audio.ricochet(hp);
      G.wanted.crime('shooting', this.pos);
      if (hitVeh.driver === 'ai' && hitVeh.ai) hitVeh.ai.panic = 8;
    } else {
      if (tHit < maxD - 0.1) G.fx.impact(hp.x, hp.y, hp.z);
      G.wanted.crime('shooting', this.pos);
    }
    G.peds.alarm(this.pos, 45, 'gunfire');
  }

  // ---------- Vehicles ----------
  tryEnterVehicle() {
    const G = this.G;
    let best = null, bd = 4.2;
    for (const v of G.vehicles) {
      if (v.destroyed || v.sinking) continue;
      const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) - v.T.wid * 0.3;
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) return false;
    if (best.locked) { G.ui.help('This vehicle is locked.'); G.audio.ui('error'); return false; }
    if (best.driver === 'ai') {
      // carjack
      G.traffic.carjack(best, this);
      G.wanted.crime(best.type === 'police' ? 'stealCop' : 'carjack', this.pos);
    } else if (best.type === 'police') G.wanted.crime('stealCop', this.pos);
    this.enterTarget = best; this.enterT = 0.45;
    this.crouching = false; this.aiming = false;
    G.audio.door(best.pos);
    return true;
  }
  enterVehicle(v) {
    const G = this.G;
    this.enterTarget = null; this.enterT = 0;
    if (v.driver === 'ai') G.traffic.carjack(v, this);
    v.driver = 'player'; v.parked = false; v.engineOn = true; v.ai = null;
    if (v.dummy) v.dummy.visible = false;
    v.input.throttle = 0; v.input.brake = 0;
    this.vehicle = v;
    this.attachToSeat();
    G.onEnterVehicle && G.onEnterVehicle(v);
    G.audio.engineStart();
  }
  attachToSeat() {
    const v = this.vehicle;
    const root = this.model.root;
    v.chassis.add(root);
    root.position.set(v.bike ? 0 : 0.38, v.bike ? 0.4 : 0.05, v.geo.seatZ + 0.05);
    if (v.bike) root.position.set(0, 0.36, -0.2);
    root.rotation.set(0, 0, 0);
  }
  leaveVehicle(force = false, side = 1) {
    const G = this.G, v = this.vehicle;
    if (!v) return;
    v.chassis.remove(this.model.root);
    G.scene.add(this.model.root);
    v.driver = null; v.input.throttle = 0; v.input.brake = 0; v.input.handbrake = !v.bike; v.input.steer = 0;
    v.setSiren(false);
    this.vehicle = null;
    // choose an exit point that isn't inside a wall
    let p = v.doorPos(side);
    const test = { x: p.x, z: p.z };
    const r = G.col.resolveCircle(test, 0.35, v.pos.y + 0.3, 1.4);
    if (r.depth > 0.25) { p = v.doorPos(-side); }
    this.pos.set(p.x, Math.max(groundHeight(p.x, p.z), v.pos.y), p.z);
    this.vel.set(v.vel.x * 0.5, 0, v.vel.y * 0.5);
    this.yaw = v.heading;
    if (v.sinking) { this.pos.y = WATER_Y - 1.2; this.swimming = true; }
    this.model.root.position.copy(this.pos);
    G.onExitVehicle && G.onExitVehicle(v);
    if (!force) G.audio.door(v.pos);
  }
  ejectFromBike(v, impact) {
    this.leaveVehicle(true);
    this.knockT = 1.8;
    this.vel.set(v.vel.x * 0.6, 5, v.vel.y * 0.6);
    this.onGround = false;
    this.hurt(impact * 2.2, 'crash');
  }
  updateDriving(dt) {
    const G = this.G, inp = G.input, v = this.vehicle;
    const block = G.uiBlocking;
    let throttle = block ? 0 : Math.max(inp.is('forward') ? 1 : 0, inp.padAxes ? inp.padAxes.rt : 0);
    let brake = block ? 0 : Math.max(inp.is('back') ? 1 : 0, inp.padAxes ? inp.padAxes.lt : 0);
    let steer = block ? 0 : -inp.axis('left', 'right');
    v.input.throttle = throttle; v.input.brake = brake; v.input.steer = steer;
    v.input.handbrake = !block && inp.is('jump');
    if (!block) {
      if (inp.pressed('headlights')) { v.lightsOn = !v.lightsOn; v.headlightsAuto = false; G.audio.ui('click'); }
      if (inp.pressed('horn')) { if (v.T.lights) v.setSiren(!v.sirenOn); }
      v.input.horn = inp.is('horn') && !v.T.lights;
      if (inp.pressed('camera')) G.cam.cycleVehicleMode();
      if (inp.pressed('crouch')) G.cam.cinematic = !G.cam.cinematic;
      if (inp.pressed('reload')) G.audio.nextStation();
    }
    if (inp.pressed('enter') && !block) {
      const sp = v.speed;
      this.leaveVehicle();
      if (sp > 9) { // bail out of a moving vehicle
        this.knockT = 1.4; this.vel.set(v.vel.x * 0.5, 3, v.vel.y * 0.5); this.onGround = false; this.hurt(sp * 0.8, 'bail');
      }
      return;
    }
    if (v.destroyed && v.exploded) { this.leaveVehicle(true); this.hurt(200, 'explosion'); return; }
    if (v.sinking > 1.2) { this.leaveVehicle(true); return; }
    this.pos.copy(v.pos);
    this.yaw = v.heading;
    this.model.animate(dt, { mode: v.bike ? 'ride' : 'drive', steer: v.steer, speed: 0 });
    this.swimming = false; this.indoors = false; this.aiming = false;
    // first person interior: hide own head
    this.model.head.visible = !(G.cam.vehMode === 3 && !G.cam.cinematic);
  }
}

function rayCylinder(o, d, cx, cy, cz, r, h) {
  // 2D ray-circle in xz then check height
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-6) return -1;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return -1;
  const y = o.y + d.y * t;
  if (y < cy || y > cy + h) return -1;
  return t;
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  return -b - Math.sqrt(disc);
}
