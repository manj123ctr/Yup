// Pedestrians: routines along sidewalks, conversations, street crossing at
// lights, reactions to the player, fleeing, getting hit, cops on foot,
// shop clerks and nightclub dancers.
import * as THREE from 'three';
import { HumanModel, randomLook } from '../entities/human.js';
import { clamp, damp, dampAngle, R, dist2, wrapAngle } from '../util.js';
import { groundHeight, GX, GZ, NB, WATER_Y } from '../world/layout.js';
import { lightState } from './traffic.js';

export const LINES = {
  chat: ['Did you see the game last night?', 'This heat is unreal.', 'My cousin just bought a boat on Starfish Island.', 'Traffic on the Causeway was insane today.',
    'We should hit Neon Flamingo tonight.', 'I need a vacation from my vacation.', 'Rent went up again. Again!', 'Have you tried Taco Vice? So good.',
    'I swear the cops here never sleep.', 'Is it supposed to rain later?', 'Wave FM played my song this morning.', 'I\'m thinking of moving to Coral Gardens.',
    'Did you hear about the robbery on Ocean Drive?', 'My boss is driving me crazy.', 'They\'re building another tower downtown.', 'You look tired.',
    'Totally.', 'No way!', 'Right? That\'s what I said.', 'Ha! Seriously?', 'Mm-hmm.', 'I know, I know.'],
  bump: ['Hey, watch it!', 'Excuse you!', 'Watch where you\'re going!', 'Rude!', 'Seriously?'],
  greet: ['Nice day, huh?', 'Hey.', 'What\'s up?', 'Lookin\' sharp.', 'Morning!', 'Evening.'],
  flee: ['Help!', 'Run!', 'Somebody call the cops!', 'Oh my God!', 'Get away from me!', 'He\'s crazy!'],
  hit: ['Ow!', 'Are you crazy?!', 'Learn to drive!', 'My leg!'],
  cop: ['Freeze! Police!', 'Get on the ground!', 'Stop right there!', 'Suspect spotted!', 'Hands where I can see them!'],
  rain: ['Ugh, this rain.', 'Where\'s my umbrella?', 'I\'m soaked!'],
  night: ['The DJ tonight is fire.', 'The line\'s too long.', 'One more drink!', 'Where\'s the after-party?'],
  aimed: ['Don\'t shoot!', 'Please, I have kids!', 'Take what you want!'],
};
const pick = (a) => a[Math.floor(R() * a.length)];

const COP_LOOK = () => ({ ...randomLook(R, R() < 0.3), shirt: 0x1d2f5c, pants: 0x14213d, shoes: 0x111111, sleeves: 'short', hat: 'cap', glasses: R() < 0.5, badge: true });

export class Ped {
  constructor(G, x, z, opts = {}) {
    this.G = G;
    this.isCop = !!opts.cop;
    this.look = opts.look || (this.isCop ? COP_LOOK() : randomLook());
    if (this.isCop) this.look.shirt = 0x1d2f5c;
    this.model = new HumanModel(this.look);
    G.scene.add(this.model.root);
    this.pos = new THREE.Vector3(x, groundHeight(x, z), z);
    this.vel = new THREE.Vector3();
    this.heading = opts.heading ?? R() * Math.PI * 2;
    this.state = opts.state || 'walk';
    this.loop = opts.loop || null; this.idx = opts.idx || 0; this.dirSign = R() < 0.5 ? 1 : -1;
    this.walkSpeed = 1.1 + R() * 0.5;
    this.health = this.isCop ? 140 : 100;
    this.dead = false; this.timer = 3 + R() * 8;
    this.voice = this.look.female ? 1.2 + R() * 0.3 : 0.75 + R() * 0.3;
    this.talkWith = null; this.talkLineT = 0;
    this.threat = null;
    this.knock = 0; this.deadT = 0;
    this.sayCd = 0; this.shootCd = 1.5;
    this.persistent = !!opts.persistent;
    this.target = null; // explicit walk target
    this.home = opts.home || null;
    this.crouch = false;
    this.armed = this.isCop;
    this.model.gun.visible = false;
    this.bumpCd = 0;
  }
  say(text, loud = false, force = false) {
    if (this.sayCd > 0 && !force) return;
    this.sayCd = 3;
    const G = this.G;
    const d = Math.hypot(this.pos.x - G.player.pos.x, this.pos.z - G.player.pos.z);
    if (d < 30) G.ui.bubble(this, text, 2.6);
    if (d < (loud ? 30 : 14)) G.audio.voice(text, this.voice, this.pos, this.look.female);
  }
  damage(n, attacker, push) {
    if (this.dead) return;
    this.health -= n;
    const G = this.G;
    if (push) { this.vel.x += push.x; this.vel.z += push.z; }
    if (this.health <= 0) {
      this.die(attacker, push);
      return;
    }
    this.knock = n > 30 ? 1.4 : 0.5;
    if (this.isCop) { this.state = 'attack'; }
    else {
      this.state = 'flee'; this.threat = attacker ? { x: attacker.pos.x, z: attacker.pos.z } : { x: this.pos.x, z: this.pos.z };
      this.timer = 10;
      if (R() < 0.3 && !this.isClerk) this.state = 'fight';
      this.say(pick(LINES.flee), true, true);
    }
    G.peds.alarm(this.pos, 18, 'fight');
  }
  die(attacker, push) {
    const G = this.G;
    this.dead = true; this.health = 0; this.state = 'dead'; this.deadT = 0;
    if (push) { this.vel.set(push.x * 1.5, 2.5, push.z * 1.5); }
    G.audio.voice(pick(['Argh!', 'Ugh!', 'No!']), this.voice, this.pos, this.look.female, true);
    if (attacker === G.player || (attacker && attacker.driver === 'player')) {
      G.wanted.crime(this.isCop ? 'killCop' : 'killPed', this.pos);
      G.state.stats.kills = (G.state.stats.kills || 0) + 1;
      if (!this.isCop && R() < 0.6) G.peds.dropCash(this.pos.x, this.pos.z, 5 + Math.floor(R() * 40));
    }
    G.peds.alarm(this.pos, 40, 'death');
    G.traffic && G.onPedDeath && G.onPedDeath(this);
  }
  dispose() { this.G.scene.remove(this.model.root); }

  update(dt) {
    const G = this.G, P = G.player;
    this.sayCd = Math.max(0, this.sayCd - dt);
    this.bumpCd = Math.max(0, this.bumpCd - dt);
    const ppos = P.pos;
    const dP = Math.hypot(ppos.x - this.pos.x, ppos.z - this.pos.z);
    let mode = 'idle', speed = 0, moveX = 0, moveZ = 0;
    const night = G.sky.night;
    if (this.dead) {
      this.deadT += dt;
      this.physics(dt, 0, 0, 0, true);
      this.model.animate(dt, { mode: 'dead' });
      this.sync(); return;
    }
    if (this.knock > 0) {
      this.knock -= dt;
      this.physics(dt, 0, 0, 0, true);
      this.model.animate(dt, { mode: this.knock > 0.4 ? 'dead' : 'crouchIdle', hit: 1 });
      this.sync(); return;
    }
    this.timer -= dt;
    switch (this.state) {
      case 'walk': {
        const t = this.nextTarget();
        if (t) {
          const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
          if (t.cross && !this.crossOk(t)) { speed = 0; mode = 'idle'; this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 4, dt); break; }
          if (d < 0.8) { this.arrive(); break; }
          moveX = dx / d; moveZ = dz / d; speed = this.walkSpeed * (G.weather.cur.rain > 0.5 ? 1.5 : 1);
          mode = 'move';
        }
        if (this.timer <= 0) {
          this.timer = 8 + R() * 14;
          const r = R();
          if (r < 0.25) { this.state = 'idle'; this.timer = 3 + R() * 6; this.idleMode = R() < 0.4 ? 'phone' : 'idle'; }
          else if (r < 0.45) this.tryTalk();
        }
        break;
      }
      case 'idle':
        mode = this.idleMode || 'idle';
        if (this.timer <= 0) { this.state = 'walk'; this.timer = 8 + R() * 10; }
        if (dP < 3.5 && P.speedXZ < 0.5 && !P.vehicle && this.sayCd <= 0 && R() < 0.01) { this.say(pick(LINES.greet)); this.face(ppos, dt); }
        break;
      case 'talk': {
        mode = 'talk';
        const o = this.talkWith;
        if (!o || o.dead || o.state !== 'talk' || this.timer <= 0) { this.endTalk(); break; }
        this.face(o.pos, dt);
        this.talkLineT -= dt;
        if (this.talkLineT <= 0 && this.speaker) {
          this.talkLineT = 2.6 + R() * 1.5;
          o.talkLineT = 1.3; this.speaker = false; o.speaker = true;
          const lines = G.weather.cur.rain > 0.5 && R() < 0.3 ? LINES.rain : night > 0.6 && R() < 0.3 ? LINES.night : LINES.chat;
          this.say(pick(lines));
        }
        break;
      }
      case 'sit': mode = 'sit'; if (this.timer <= 0) { this.state = 'walk'; } break;
      case 'dance': mode = 'dance'; break;
      case 'clerk':
        mode = this.handsUp > 0 ? 'handsup' : 'idle';
        this.handsUp = Math.max(0, (this.handsUp || 0) - dt);
        if (dP < 6) this.face(ppos, dt);
        if (dP < 4 && this.sayCd <= 0 && R() < 0.005) this.say(pick(['Can I help you?', 'Welcome in!', 'Let me know if you need anything.']));
        break;
      case 'flee': {
        const th = this.threat || ppos;
        let dx = this.pos.x - th.x, dz = this.pos.z - th.z;
        const d = Math.hypot(dx, dz) + 1e-3;
        moveX = dx / d; moveZ = dz / d;
        // bias along sidewalk loops when possible
        speed = 5.6; mode = 'move';
        if (this.timer <= 0 && d > 30) { this.state = 'walk'; this.timer = 10; this.reloop(); }
        if (this.stuckT > 1.2) { this.state = 'cower'; this.timer = 4 + R() * 4; }
        if (R() < 0.004) this.say(pick(LINES.flee), true);
        break;
      }
      case 'cower':
        mode = 'cower';
        if (this.timer <= 0) { this.state = 'flee'; this.timer = 8; this.stuckT = 0; }
        break;
      case 'handsup':
        mode = 'handsup'; this.face(ppos, dt);
        if (this.timer <= 0 || !P.aiming) { this.state = 'flee'; this.timer = 10; this.threat = { x: ppos.x, z: ppos.z }; }
        break;
      case 'fight': {
        // angry ped fights back with fists
        const dx = ppos.x - this.pos.x, dz = ppos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        this.face(ppos, dt);
        if (P.vehicle || d > 25 || this.timer <= 0) { this.state = 'flee'; this.timer = 6; break; }
        if (d > 1.3) { moveX = dx / d; moveZ = dz / d; speed = 4.5; mode = 'move'; }
        else {
          this.shootCd -= dt;
          if (this.shootCd <= 0) { this.shootCd = 1.0 + R() * 0.6; this.model.punch(); setTimeout(() => { if (!this.dead && Math.hypot(ppos.x - this.pos.x, ppos.z - this.pos.z) < 1.6) { P.hurt(6, 'punch'); G.audio.punch(P.pos); } }, 150); }
        }
        break;
      }
      case 'attack': { // cop
        const tgt = P.vehicle ? P.vehicle.pos : ppos;
        const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        this.face(tgt, dt);
        if (G.wanted.level === 0) { this.state = 'walk'; this.reloop(); this.armed = false; break; }
        const lvl = G.wanted.level;
        const armed = P.weapon === 'pistol' || !!P.vehicle;
        const canShoot = lvl >= 2 && d < 38 && (lvl >= 3 || armed) && this.los(tgt);
        if (canShoot) {
          this.model.gun.visible = true;
          this.shootCd -= dt;
          const keep = P.speedXZ < 1 && !P.vehicle && lvl <= 3 ? 1.6 : 9;
          if (d > keep) { moveX = dx / d; moveZ = dz / d; speed = d > 20 ? 4.5 : 2.2; mode = 'move'; }
          if (this.shootCd <= 0) {
            this.shootCd = 1.1 + R() * 0.8 - lvl * 0.08;
            this.shoot(tgt, d);
          }
        } else {
          this.model.gun.visible = lvl >= 2;
          if (d > 1.6) { moveX = dx / d; moveZ = dz / d; speed = d > 8 ? 5.8 : 3; mode = 'move'; }
          if (d < 12 && R() < 0.006) this.say(pick(LINES.cop), true);
        }
        this.aim = canShoot;
        break;
      }
    }
    // react to the player
    if (!this.isCop && this.state !== 'flee' && this.state !== 'cower' && this.state !== 'clerk' && this.state !== 'dance') {
      if (P.aiming && P.weapon === 'pistol' && dP < 18 && this.inAimCone(P)) {
        if (this.state !== 'handsup') { this.state = 'handsup'; this.timer = 5 + R() * 4; this.say(pick(LINES.aimed), true, true); this.endTalk(); }
      }
      if (dP < 0.9 && !P.vehicle && P.speedXZ > 3 && this.bumpCd <= 0) {
        this.bumpCd = 3;
        this.say(pick(LINES.bump), false, true);
        this.knock = P.sprinting ? 0.6 : 0;
        if (this.state === 'talk') this.endTalk();
        this.vel.x += P.vel.x * 0.6; this.vel.z += P.vel.z * 0.6;
      }
    }
    // dodge incoming cars
    if (this.state !== 'clerk' && this.state !== 'dance') this.dodge(dt);
    this.physics(dt, moveX, moveZ, speed, false);
    this.model.animate(dt, { mode, speed: this.spd || 0, aim: this.aim && this.isCop, gun: this.model.gun.visible });
    this.sync();
  }
  inAimCone(P) {
    const cf = new THREE.Vector3(0, 0, -1).applyQuaternion(this.G.camera.quaternion);
    const dx = this.pos.x - this.G.camera.position.x, dz = this.pos.z - this.G.camera.position.z, d = Math.hypot(dx, dz);
    return (dx * cf.x + dz * cf.z) / d > 0.96;
  }
  los(t) {
    const G = this.G;
    return G.col.raycast(this.pos.x, this.pos.y + 1.5, this.pos.z, t.x, t.y + 1.2, t.z) >= 0.98;
  }
  shoot(tgt, d) {
    const G = this.G, P = G.player;
    const gp = this.model.gun.getWorldPosition(new THREE.Vector3());
    G.fx.muzzle(gp.x, gp.y, gp.z);
    G.audio.gunshot(this.pos, false);
    const moving = P.vehicle ? P.vehicle.speed : P.speedXZ;
    const hitChance = clamp(0.55 - d * 0.01 - moving * 0.02, 0.08, 0.6);
    const hit = R() < hitChance;
    const end = hit ? new THREE.Vector3(tgt.x, tgt.y + 1.1, tgt.z) : new THREE.Vector3(tgt.x + (R() - 0.5) * 4, tgt.y + R() * 2, tgt.z + (R() - 0.5) * 4);
    G.tracer && G.tracer(gp, end);
    if (hit) {
      if (P.vehicle) { P.vehicle.damage(30); G.fx.sparks(end.x, end.y, end.z, 5); G.audio.ricochet(end); }
      else P.hurt(7 + R() * 5, 'police');
    } else G.fx.impact(end.x, end.y, end.z);
    G.peds.alarm(this.pos, 35, 'gunfire', this);
  }
  face(p, dt) { this.heading = dampAngle(this.heading, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), 6, dt); }
  dodge(dt) {
    const G = this.G;
    for (const v of G.vehicles) {
      if (v.speed < 6) continue;
      const dx = this.pos.x - v.pos.x, dz = this.pos.z - v.pos.z;
      if (Math.abs(dx) > 16 || Math.abs(dz) > 16) continue;
      const vx = v.vel.x / v.speed, vz = v.vel.y / v.speed;
      const ahead = dx * vx + dz * vz;
      const lat = dx * vz - dz * vx;
      if (ahead > 0 && ahead < 10 && Math.abs(lat) < v.T.wid / 2 + 1.2) {
        const s = Math.sign(lat) || 1;
        this.vel.x += vz * s * 9 * dt * 6; this.vel.z += -vx * s * 9 * dt * 6;
        if (this.state !== 'flee' && !this.isCop) { this.state = 'flee'; this.threat = { x: v.pos.x, z: v.pos.z }; this.timer = 5; if (R() < 0.5) this.say(pick(['Whoa!', 'Watch it!', 'Hey!']), true); this.endTalk(); }
      }
    }
  }
  physics(dt, mx, mz, speed, passive) {
    const G = this.G;
    if (!passive) {
      const tvx = mx * speed, tvz = mz * speed;
      this.vel.x = damp(this.vel.x, tvx, 8, dt); this.vel.z = damp(this.vel.z, tvz, 8, dt);
      if (speed > 0.2) this.heading = dampAngle(this.heading, Math.atan2(mx, mz), 8, dt);
    } else { this.vel.x *= Math.exp(-dt * 3); this.vel.z *= Math.exp(-dt * 3); }
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.vel.y -= 20 * dt; this.pos.y += this.vel.y * dt;
    G.col.resolveCircle(this.pos, 0.3, this.pos.y + 0.4, 1.3);
    // vehicles: get hit or pushed
    for (const v of G.vehicles) {
      if (Math.abs(v.pos.x - this.pos.x) > 5 || Math.abs(v.pos.z - this.pos.z) > 5) continue;
      if (!v.contains(this.pos.x, this.pos.z, 0.25)) continue;
      if (v.speed > 4.5 && !this.dead) {
        const dmg = v.speed * 7;
        this.vel.set(v.vel.x * 1.1, 3 + v.speed * 0.15, v.vel.y * 1.1);
        this.say(pick(LINES.hit), true, true);
        G.audio.thud(this.pos);
        const wasPlayer = v.driver === 'player';
        if (wasPlayer) G.wanted.crime(this.isCop ? 'hitCop' : 'hitPed', this.pos);
        this.damage(dmg, wasPlayer ? v : null);
        this.knock = Math.max(this.knock, 2.2);
        v.damage(5);
      } else {
        const l = v.toLocal(this.pos.x, this.pos.z);
        const hw = v.T.wid / 2 + 0.25, hl = v.T.len / 2 + 0.25;
        const px = hw - Math.abs(l.x), pz = hl - Math.abs(l.z);
        const c = Math.cos(v.heading), s = Math.sin(v.heading);
        let lx = 0, lz = 0;
        if (px < pz) lx = Math.sign(l.x) * px; else lz = Math.sign(l.z) * pz;
        this.pos.x += lx * c + lz * s; this.pos.z += -lx * s + lz * c;
      }
    }
    // other peds (separation) handled by manager; ground
    let gy = groundHeight(this.pos.x, this.pos.z);
    const top = G.col.topAt(this.pos.x, this.pos.z, this.pos.y, 0.2);
    if (top > gy && top < this.pos.y + 0.5) gy = top;
    if (gy < WATER_Y - 1.3) gy = WATER_Y - 1.25; // float
    if (this.pos.y <= gy) { this.pos.y = gy; this.vel.y = 0; }
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
    this.spd = moved;
    this.stuckT = speed > 1 && moved < speed * 0.25 ? (this.stuckT || 0) + dt : 0;
  }
  sync() {
    const r = this.model.root;
    r.position.copy(this.pos);
    r.rotation.y = this.heading;
  }
  // ----- routines -----
  nextTarget() {
    if (this.target) return this.target;
    if (!this.loop) return null;
    return this.loop.pts[this.idx];
  }
  arrive() {
    const G = this.G;
    if (this.target) {
      const t = this.target; this.target = null;
      if (t.cross && t.loop) { this.loop = t.loop; this.idx = t.idx; }
      return;
    }
    const loop = this.loop;
    // possibly cross the street at a block corner
    if (loop.block && R() < 0.3) {
      const c = this.crossTarget(loop, this.idx);
      if (c) { this.target = c; return; }
    }
    if (loop.district === 'beachsand' && R() < 0.4 && G.sky.night < 0.3) { this.state = 'sit'; this.timer = 10 + R() * 20; }
    this.idx = (this.idx + this.dirSign + loop.pts.length) % loop.pts.length;
  }
  crossTarget(loop, idx) {
    const G = this.G;
    const [i, j] = loop.block;
    const p = loop.pts[idx];
    const opts = [];
    const west = idx === 0 || idx === 3, north = idx === 0 || idx === 1;
    const ni = west ? i - 1 : i + 1, nj = north ? j - 1 : j + 1;
    const lineX = GX[west ? i : i + 1], lineZ = GZ[north ? j : j + 1];
    if (ni >= 0 && ni < NB) opts.push({ x: 2 * lineX - p.x, z: p.z, axis: 'ns', block: `${ni},${j}`, idx: west ? (idx === 0 ? 1 : 2) : (idx === 1 ? 0 : 3) });
    if (nj >= 0 && nj < NB) opts.push({ x: p.x, z: 2 * lineZ - p.z, axis: 'ew', block: `${i},${nj}`, idx: north ? (idx === 0 ? 3 : 2) : (idx === 3 ? 0 : 1) });
    if (!opts.length) return null;
    const o = opts[Math.floor(R() * opts.length)];
    const nl = G.city.blockLoop[o.block];
    if (!nl) return null;
    return { x: o.x, z: o.z, cross: true, axis: o.axis, loop: nl, idx: o.idx };
  }
  crossOk(t) {
    // wait at the curb until cars on the crossed road have a red light
    const onRoad = Math.abs(this.pos.y - groundHeight(this.pos.x, this.pos.z)) < 0.5 && groundHeight(this.pos.x, this.pos.z) < 0.05;
    if (onRoad) return true; // already crossing
    return lightState(t.axis, this.G.time.total) === 'r' && (this.G.time.total % 28) % 14 < 9;
  }
  reloop() {
    const G = this.G;
    let best = null, bd = 1e9;
    for (const l of G.city.pedLoops) {
      for (let k = 0; k < l.pts.length; k++) {
        const d = dist2(l.pts[k].x, l.pts[k].z, this.pos.x, this.pos.z);
        if (d < bd) { bd = d; best = { l, k }; }
      }
    }
    if (best) { this.loop = best.l; this.idx = best.k; }
    this.target = null;
  }
  tryTalk() {
    const G = this.G;
    for (const o of G.peds.list) {
      if (o === this || o.dead || o.isCop || (o.state !== 'walk' && o.state !== 'idle')) continue;
      if (dist2(o.pos.x, o.pos.z, this.pos.x, this.pos.z) < 16) {
        this.state = o.state = 'talk';
        this.talkWith = o; o.talkWith = this;
        this.timer = o.timer = 8 + R() * 10;
        this.speaker = true; o.speaker = false; this.talkLineT = 0.5;
        return true;
      }
    }
    return false;
  }
  endTalk() {
    const o = this.talkWith;
    this.talkWith = null;
    if (this.state === 'talk') { this.state = 'walk'; this.timer = 8 + R() * 8; }
    if (o && o.talkWith === this) o.endTalk();
  }
}

export class PedManager {
  constructor(G) {
    this.G = G;
    this.list = [];
    this.density = 1;
    this.spawnT = 0;
    this.pickups = [];
    this.clerks = new Map();
    this.dancers = new Map();
    const cashGeo = new THREE.BoxGeometry(0.25, 0.08, 0.14);
    this.cashMat = new THREE.MeshStandardMaterial({ color: 0x3fbf5f, emissive: 0x1f8f3f, emissiveIntensity: 0.6 });
    this.cashGeo = cashGeo;
  }
  weightFor(loop, night, rain) {
    const d = loop.district;
    let w = 1;
    if (d === 'beachsand') w = night > 0.4 || rain > 0.3 ? 0 : 3;
    else if (d === 'promenade' || d === 'beach') w = night > 0.5 ? 2.2 : 1.6;
    else if (d === 'downtown') w = night > 0.6 ? 0.7 : 1.4;
    else if (d === 'suburb') w = night > 0.6 ? 0.25 : 0.7;
    else if (d === 'park') w = night > 0.6 ? 0.1 : 1.5;
    else if (d === 'ghetto') w = night > 0.6 ? 0.8 : 1;
    else if (d === 'industrial' || d === 'port') w = 0.4;
    return w * (rain > 0.5 ? 0.5 : 1);
  }
  spawnAt(x, z, opts = {}) {
    const p = new Ped(this.G, x, z, opts);
    if (!p.loop && !opts.noLoop) p.reloop();
    if (opts.state) p.state = opts.state;
    if (opts.state === 'flee') p.timer = 12;
    this.list.push(p);
    return p;
  }
  alarm(pos, r, kind, source) {
    for (const p of this.list) {
      if (p.dead || p === source) continue;
      if (dist2(p.pos.x, p.pos.z, pos.x, pos.z) > r * r) continue;
      if (p.isCop) { if (this.G.wanted.level > 0) p.state = 'attack'; continue; }
      if (p.state === 'clerk') { p.handsUp = 6; continue; }
      if (p.state === 'dance' && kind !== 'gunfire') continue;
      p.endTalk();
      p.state = R() < 0.2 ? 'cower' : 'flee';
      p.threat = { x: pos.x, z: pos.z };
      p.timer = 8 + R() * 6;
      if (R() < 0.3) p.say(pick(LINES.flee), true);
    }
    if (kind === 'gunfire' || kind === 'death') this.G.traffic.panicNear(pos, r);
  }
  dropCash(x, z, amount) {
    const m = new THREE.Mesh(this.cashGeo, this.cashMat);
    m.position.set(x, groundHeight(x, z) + 0.3, z);
    this.G.scene.add(m);
    this.pickups.push({ m, x, z, amount, t: 30 });
  }
  update(dt) {
    const G = this.G, P = G.player;
    const night = G.sky.night, rain = G.weather.cur.rain;
    const want = Math.round(38 * this.density * (night > 0.7 ? 0.65 : 1));
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.list.length < want) {
      this.spawnT = 0.15;
      this.trySpawn(night, rain);
    }
    // clerks & dancers near player
    this.updateFixed();
    const cam = G.camera;
    const cf = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
      const dx = p.pos.x - cam.position.x, dz = p.pos.z - cam.position.z, dd = Math.hypot(dx, dz);
      const inView = (dx * cf.x + dz * cf.z) / (dd + 1e-3) > 0.3;
      const remove = (!p.persistent && ((d > 190) || (d > 80 && !inView && (p.dead && p.deadT > 20)) || (p.dead && p.deadT > 60))) || p.removeMe;
      if (remove) { p.dispose(); this.list.splice(i, 1); continue; }
      // LOD
      const vis = dd < 120;
      p.model.root.visible = vis;
      if (vis) {
        p.model.setShadow(dd < 45);
        p.update(dt);
      } else if (!p.dead) {
        // cheap update when far: keep walking along loop
        const t = p.nextTarget();
        if (t && p.state === 'walk') {
          const ddx = t.x - p.pos.x, ddz = t.z - p.pos.z, l = Math.hypot(ddx, ddz);
          if (l < 1) p.arrive(); else { p.pos.x += ddx / l * p.walkSpeed * dt; p.pos.z += ddz / l * p.walkSpeed * dt; }
        }
      }
    }
    // separation between peds (cheap)
    const L = this.list;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      if (a.dead || b.dead) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.36 && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (0.6 - d) * 0.5;
        a.pos.x -= dx / d * push; a.pos.z -= dz / d * push; b.pos.x += dx / d * push; b.pos.z += dz / d * push;
      }
    }
    // player vs peds push
    if (!P.vehicle) for (const p of L) {
      if (p.dead) continue;
      const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.42 && d2 > 1e-6) { const d = Math.sqrt(d2), push = 0.65 - d; p.pos.x += dx / d * push * 0.6; p.pos.z += dz / d * push * 0.6; P.pos.x -= dx / d * push * 0.4; P.pos.z -= dz / d * push * 0.4; }
    }
    // cash pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.t -= dt; k.m.rotation.y += dt * 3;
      if (!P.vehicle && dist2(k.x, k.z, P.pos.x, P.pos.z) < 1.4) {
        G.addMoney(k.amount); G.audio.pickup(); G.ui.notify(`Picked up $${k.amount}`);
        k.t = 0;
      }
      if (k.t <= 0) { G.scene.remove(k.m); this.pickups.splice(i, 1); }
    }
  }
  trySpawn(night, rain) {
    const G = this.G, P = G.player;
    const loops = G.city.pedLoops;
    const cam = G.camera;
    const cf = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    // candidate loops near the player (refreshed every couple of seconds)
    this.nearT = (this.nearT || 0) - 0.15;
    if (!this.nearLoops || this.nearT <= 0) {
      this.nearT = 2;
      this.nearLoops = loops.filter((l) => l.pts.some((q) => Math.abs(q.x - P.pos.x) < 170 && Math.abs(q.z - P.pos.z) < 170));
    }
    if (!this.nearLoops.length) return null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const loop = this.nearLoops[Math.floor(R() * this.nearLoops.length)];
      const w = this.weightFor(loop, night, rain);
      if (R() > w / 3) continue;
      const k = Math.floor(R() * loop.pts.length);
      const a = loop.pts[k], b = loop.pts[(k + 1) % loop.pts.length];
      const t = R();
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const d = Math.hypot(x - P.pos.x, z - P.pos.z);
      if (d < 30 || d > 150) continue;
      const dx = x - cam.position.x, dz = z - cam.position.z, dd = Math.hypot(dx, dz);
      if (dd < 60 && (dx * cf.x + dz * cf.z) / dd > 0.4) continue;
      const p = this.spawnAt(x, z, { loop, idx: (k + 1) % loop.pts.length });
      p.loop = loop; p.idx = (k + 1) % loop.pts.length;
      if (loop.district === 'park' && R() < 0.2) { p.state = 'idle'; p.timer = 10; }
      return p;
    }
    return null;
  }
  updateFixed() {
    const G = this.G, P = G.player, city = G.city;
    // shop clerks
    (city.clerks || []).forEach((c, i) => {
      const d = Math.hypot(c.x - P.pos.x, c.z - P.pos.z);
      const ex = this.clerks.get(i);
      if (d < 70 && !ex) {
        const p = this.spawnAt(c.x, c.z, { state: 'clerk', heading: c.ry, persistent: true, noLoop: true });
        p.isClerk = true; p.kind = c.kind; p.home = { x: c.x, z: c.z };
        this.clerks.set(i, p);
      } else if (ex && (d > 110 || ex.dead && ex.deadT > 30)) {
        ex.removeMe = true; this.clerks.delete(i);
      }
    });
    // nightclub dancers (busier at night)
    (city.clubs || []).forEach((c, i) => {
      const d = Math.hypot(c.x - P.pos.x, c.z - P.pos.z);
      const list = this.dancers.get(i);
      if (d < 60 && !list) {
        const n = G.sky.night > 0.5 ? 10 : 4;
        const arr = [];
        for (let k = 0; k < n; k++) {
          const p = this.spawnAt(c.x - 6 + R() * 12, c.z - 6 + R() * 12, { state: 'dance', persistent: true, noLoop: true });
          arr.push(p);
        }
        this.dancers.set(i, arr);
      } else if (list && d > 100) {
        list.forEach((p) => (p.removeMe = true));
        this.dancers.delete(i);
      }
    });
  }
  clear() {
    for (const p of this.list) p.dispose();
    this.list = []; this.clerks.clear(); this.dancers.clear();
  }
}
