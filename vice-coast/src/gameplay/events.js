// Random city events that make the world feel alive: muggings, fender benders
// with arguing drivers, police chasing a suspect, street performers with a
// crowd, and emergency responses to incidents.
import { R, dist2 } from '../util.js';
import { graph, findPath, nearestNode } from '../world/layout.js';
import { Vehicle } from '../entities/vehicle.js';

export class CityEvents {
  constructor(G) {
    this.G = G;
    this.timer = 45 + R() * 30;
    this.active = [];
    this.ambulanceCd = 0;
  }
  pickSidewalkSpot(minD = 50, maxD = 120) {
    const G = this.G, P = G.player;
    for (let i = 0; i < 20; i++) {
      const l = G.city.pedLoops[Math.floor(R() * G.city.pedLoops.length)];
      const p = l.pts[Math.floor(R() * l.pts.length)];
      const d = Math.hypot(p.x - P.pos.x, p.z - P.pos.z);
      if (d > minD && d < maxD) return { x: p.x, z: p.z, loop: l };
    }
    return null;
  }
  update(dt) {
    const G = this.G;
    this.ambulanceCd = Math.max(0, this.ambulanceCd - dt);
    this.timer -= dt;
    if (this.timer <= 0 && !G.missions.current && G.wanted.level === 0) {
      this.timer = 60 + R() * 70;
      const kinds = ['mugging', 'crash', 'chase', 'performer'];
      this[kinds[Math.floor(R() * kinds.length)]]();
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.t += dt;
      if (e.update && e.update(dt) === false) this.active.splice(i, 1);
      else if (e.t > 120) this.active.splice(i, 1);
    }
  }
  mugging() {
    const G = this.G;
    const s = this.pickSidewalkSpot(30, 70);
    if (!s) return;
    const victim = G.peds.spawnAt(s.x, s.z, { loop: s.loop });
    const mugger = G.peds.spawnAt(s.x + 2, s.z + 1, { loop: s.loop, look: { ...victim.look, shirt: 0x222222, pants: 0x111111, hat: 'beanie', hairStyle: 'buzz', sleeves: 'long', female: false } });
    mugger.state = 'flee'; mugger.threat = { x: s.x, z: s.z }; mugger.timer = 40; mugger.mugger = true;
    victim.state = 'idle'; victim.timer = 12;
    victim.say('Stop! Thief! He took my wallet!', true, true);
    G.ui.notify('You hear someone shouting <b>"Stop, thief!"</b> nearby.');
    this.active.push({
      t: 0, kind: 'mugging', blip: mugger, update: () => {
        if (mugger.dead || mugger.knock > 0) {
          G.peds.dropCash(mugger.pos.x, mugger.pos.z, 150 + Math.floor(R() * 100));
          if (!victim.dead) victim.say('My wallet! Thank you so much!', true, true);
          G.ui.notify('You stopped the mugger. Grab the wallet!');
          mugger.mugger = false;
          return false;
        }
        if (mugger.removeMe || Math.hypot(mugger.pos.x - G.player.pos.x, mugger.pos.z - G.player.pos.z) > 170) { mugger.mugger = false; return false; }
        mugger.threat = { x: G.player.pos.x, z: G.player.pos.z }; mugger.state = 'flee'; mugger.timer = 30;
      },
    });
  }
  crash() {
    const G = this.G, P = G.player;
    // two cars crashed at an intersection 70-140m away
    const nodes = graph.nodes.filter((n) => n.light && Math.hypot(n.x - P.pos.x, n.z - P.pos.z) > 70 && Math.hypot(n.x - P.pos.x, n.z - P.pos.z) < 140);
    if (!nodes.length) return;
    const n = nodes[Math.floor(R() * nodes.length)];
    const a = new Vehicle(G, 'sedan', n.x + 3, n.z - 3, 0.6, { parked: true, empty: true });
    const b = new Vehicle(G, R() < 0.5 ? 'suv' : 'pickup', n.x - 2, n.z + 3, 2.4, { parked: true, empty: true });
    for (const v of [a, b]) { v.health = 300; v.deform(v.pos.x + Math.sin(v.heading) * 2, v.pos.y + 0.7, v.pos.z + Math.cos(v.heading) * 2, -Math.sin(v.heading), -Math.cos(v.heading), 0.3); v.headlightsAuto = false; G.vehicles.push(v); }
    const d1 = G.peds.spawnAt(n.x + 6, n.z - 5, {}), d2 = G.peds.spawnAt(n.x + 7, n.z - 4, {});
    d1.state = d2.state = 'talk'; d1.talkWith = d2; d2.talkWith = d1; d1.timer = d2.timer = 40; d1.speaker = true;
    const lines = ['You ran the red light!', 'Me?! You came out of nowhere!', 'Look at my bumper!', 'I\'m calling my lawyer!', 'You\'re paying for this!'];
    let k = 0;
    this.active.push({
      t: 0, kind: 'crash', update: (dt) => {
        if (Math.floor(this.active.find((e) => e.kind === 'crash')?.t || 0) % 4 === 0 && R() < 0.02) { const p = k++ % 2 ? d1 : d2; if (!p.dead) p.say(lines[Math.floor(R() * lines.length)], true); }
        if (Math.hypot(n.x - P.pos.x, n.z - P.pos.z) > 260) {
          for (const v of [a, b]) if (v.driver === null && G.vehicles.includes(v) && P.vehicle !== v) G.traffic.remove(v);
          return false;
        }
      },
    });
    // police respond
    setTimeout(() => {
      const cop = G.traffic.spawnCar('police', n.x, n.z, 120, 200, true);
      if (cop) this.respond(cop, n.x, n.z);
    }, 8000);
  }
  chase() {
    const G = this.G, P = G.player;
    const suspect = G.traffic.spawnCar(R() < 0.5 ? 'sports' : 'sedan', P.pos.x, P.pos.z, 110, 200, true);
    if (!suspect) return;
    suspect.ai.panic = 999; suspect.ai.maxSpeedMul = 1.6;
    suspect.eventSuspect = true;
    const cop = G.traffic.spawnCar('police', suspect.pos.x, suspect.pos.z, 25, 60, false);
    if (!cop) return;
    cop.ai.mode = 'pursuit'; cop.ai.chaseTarget = suspect; cop.setSiren(true);
    this.active.push({ t: 0, kind: 'chase', update: () => { if (suspect.destroyed || !G.vehicles.includes(suspect)) return false; } });
  }
  performer() {
    const G = this.G;
    const s = this.pickSidewalkSpot(25, 60);
    if (!s) return;
    const perf = G.peds.spawnAt(s.x, s.z, { state: 'dance', noLoop: true });
    perf.state = 'dance'; perf.persistent = true;
    const crowd = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const c = G.peds.spawnAt(s.x + Math.cos(a) * 3, s.z + Math.sin(a) * 3, { loop: s.loop });
      c.state = 'idle'; c.timer = 40; c.heading = Math.atan2(-Math.cos(a), -Math.sin(a)); crowd.push(c);
    }
    perf.say('Tips appreciated, folks!', true, true);
    this.active.push({
      t: 0, kind: 'performer', update: () => {
        for (const c of crowd) if (c.state === 'idle') c.face(perf.pos, 0.1);
        const d = Math.hypot(perf.pos.x - G.player.pos.x, perf.pos.z - G.player.pos.z);
        if (d < 4 && !this.tipped && G.input.pressed('interact') && G.state.money >= 5) { this.tipped = true; G.spend(5); perf.say('Thank you kindly!', true, true); G.audio.ui('cash'); }
        if (d < 4 && !this.tipped) G.ui.help('Press <kbd>E</kbd> to tip the performer $5', 0.5);
        if (d > 160) { perf.persistent = false; perf.state = 'walk'; perf.reloop(); return false; }
      },
    });
  }
  // send an emergency vehicle to a location
  respond(v, x, z) {
    const G = this.G;
    v.setSiren(true); v.emergency = true; v.ai.maxSpeedMul = 1.5;
    const route = findPath(v.ai.to.x, v.ai.to.z, x, z).map((p) => graph.nodes.find((n) => n.x === p.x && n.z === p.z)).filter(Boolean);
    while (route.length && route[0] === v.ai.to) route.shift();
    v.ai.route = route; if (route.length) v.ai.next = route.shift();
    this.active.push({
      t: 0, kind: 'respond', update: () => {
        if (!v.ai) return false;
        if (dist2(v.pos.x, v.pos.z, x, z) < 30 * 30) { v.ai.mode = 'parkedStop'; v.parkedT = (v.parkedT || 0) + 1 / 60; if (v.parkedT > 25) { v.setSiren(false); G.wanted.rejoin(v); return false; } }
      },
    });
  }
  onPedDeath(p) {
    const G = this.G;
    if (this.ambulanceCd > 0) return;
    this.ambulanceCd = 45;
    setTimeout(() => {
      const v = G.traffic.spawnCar('ambulance', p.pos.x, p.pos.z, 120, 220, true);
      if (v) this.respond(v, p.pos.x, p.pos.z);
    }, 10000);
  }
}
