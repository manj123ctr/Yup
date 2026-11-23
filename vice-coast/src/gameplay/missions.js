// Mission framework, story missions, side activities (street races, delivery
// jobs), collectibles, 3D markers and GPS targets.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { AIDriver } from '../ai/traffic.js';
import { groundHeight, findPath, graph } from '../world/layout.js';
import { BLIP_STYLE } from '../ui/hud.js';
import { R, clamp, dist2, formatMoney } from '../util.js';

// ---------- 3D markers ----------
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
const ringGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
function makeMarker(color, r = 1.6, h = 3) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(beamGeo, m); beam.scale.set(r, h, r);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  ring.scale.set(r, 1, r); ring.position.y = 0.08;
  const chev = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color }));
  chev.position.y = h + 1.2;
  g.add(beam, ring, chev);
  g.userData = { chev, beam };
  g.renderOrder = 4;
  return g;
}

export class MissionSystem {
  constructor(G) {
    this.G = G;
    this.current = null;
    this.markers = new THREE.Group();
    G.scene.add(this.markers);
    this.giverMarkers = new Map();
    this.objMarker = makeMarker(0xffd166, 2, 4); this.objMarker.visible = false; this.markers.add(this.objMarker);
    this.cpMarker = makeMarker(0x36e2ff, 6, 8); this.cpMarker.visible = false; this.markers.add(this.cpMarker);
    this.vehArrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0x36e2ff }));
    this.vehArrow.visible = false; G.scene.add(this.vehArrow);
    this.tokens = [];
    this.defs = this.buildDefs();
    this.side = this.buildSide();
    this.promptKey = null;
  }

  // ---------- Definitions ----------
  buildDefs() {
    const G = this.G, city = G.city;
    const safe = city.garage ? { x: city.garage.door.x, z: city.garage.door.z } : { x: 540, z: 230 };
    const safeDoor = city.safehouseDoor;
    const club = city.clubs ? city.clubs[0] : { x: 780, z: -360, door: { x: 838, z: -360 } };
    const threads = city.shops.find((s) => s.kind === 'clothing' && s.name === 'Threads');
    return [
      {
        id: 'intro', title: 'Welcome to Vice Coast', giver: null, requires: [], reward: 500,
        desc: 'Your cousin Rico left you his car on Ocean Drive. Drive it to his safehouse in Midtown.',
        steps: (M) => [
          M.dialog([['Rico', 'Cuz! You made it to Vice Coast! Sun, sand and opportunity, baby.', 4], ['Rico', 'I left my Cruiser parked right there on Ocean Drive. Keys are in it.', 4.5], ['Rico', 'Bring it to my place in Midtown. I\'ll set the GPS for you.', 4]], { phone: true }),
          M.enterVehicle(() => M.data.car, 'Get in Rico\'s <span class="hl">Cruiser</span>.', '<kbd>F</kbd> enter / exit vehicles'),
          M.driveTo(() => M.data.car, safe.x, safe.z, 'Drive to <span class="hl">Rico\'s safehouse</span>.', { help: '<kbd>W</kbd>/<kbd>S</kbd> accelerate & brake · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>Space</kbd> handbrake · <kbd>V</kbd> camera · <kbd>H</kbd> lights' }),
          M.driveTo(() => M.data.car, city.garage.x, city.garage.z, 'Park the car inside the <span class="hl">garage</span>.', { radius: 4, stop: true }),
          M.exitVehicle('Get out of the car.'),
          M.dialog([['Rico', 'Nice wheels, right? The garage is yours now. Store up to four rides in there.', 4.5], ['Rico', 'Walk to the green door to save your progress any time. Welcome home.', 4]]),
        ],
        setup: (M) => {
          M.data.car = M.spawnVehicle('sedan', 845, 182, Math.PI, { color: 0x1b4f72 });
        },
        onPass: () => { G.state.flags.garage = true; },
      },
      {
        id: 'threads', title: 'Fresh Threads', giver: { x: safeDoor.x + 3, z: safeDoor.z + 1 }, requires: ['intro'], reward: 300,
        desc: 'Rico says you look like a tourist. Get some new clothes at Threads.',
        steps: (M) => [
          M.dialog([['Rico', 'No offense cuz, but you dress like a tourist.', 3.5], ['Rico', 'Hit up Threads on Flamingo. Get something with style. Here\'s some cash.', 4]]),
          M.custom({ text: 'Go to <span class="hl">Threads</span> and buy some clothes.', target: () => threads, start: () => { G.addMoney(200); G.state.flags.boughtClothes = false; }, done: () => G.state.flags.boughtClothes, help: 'Stand in the marker and press <kbd>E</kbd> to shop.' }),
          M.dialog([['Rico', 'Now THAT is a Vice Coast look. People are gonna remember you.', 4]], { phone: true }),
        ],
      },
      {
        id: 'island', title: 'Island Hopper', giver: { x: safeDoor.x - 3, z: safeDoor.z + 1 }, requires: ['intro'], reward: 2500,
        desc: 'A buyer at the port wants a Vortex supercar. One just happens to be parked on Starfish Island.',
        steps: (M) => [
          M.dialog([['Rico', 'I got a buyer at the Port who wants a Vortex. Orange, mint condition.', 4], ['Rico', 'Some rich guy on Starfish Island leaves his in the driveway. Go get it.', 4], ['Rico', 'Careful — those mansions have alarms. The cops will come running.', 4]]),
          M.goTo(() => M.data.target, 'Head to the mansion on <span class="hl">Starfish Island</span>.', { radius: 25, anyMode: true }),
          M.enterVehicle(() => M.data.car, 'Steal the <span class="hl">Vortex</span>.'),
          M.custom({ text: 'The alarm tripped! <span class="hl">Lose the cops.</span>', start: () => { G.wanted.setLevel(2); G.ui.notify('<b>Alarm!</b> Police have been alerted.'); G.audio.setMusicState('wanted'); }, done: () => G.wanted.level === 0, failIf: () => M.data.car.destroyed && 'The Vortex was destroyed.', help: 'Break line of sight and get outside the red search area on the mini-map.' }),
          M.driveTo(() => M.data.car, G.city.portDrop.x, G.city.portDrop.z, 'Deliver the Vortex to the <span class="hl">Port of Vice</span>.', { radius: 6, stop: true }),
          M.exitVehicle('Leave the car for the buyer.'),
          M.dialog([['Rico', 'The buyer loves it. Cash is on the way, cuz. You\'re a natural.', 4]], { phone: true }),
        ],
        setup: (M) => {
          const t = G.city.mansionMission;
          M.data.target = { x: t.x, z: t.z };
          M.data.car = M.spawnVehicle('super', t.x, t.z, t.rot, { color: 0xff6b00 });
        },
        cleanup: (M) => { if (M.data.car && G.player.vehicle !== M.data.car) M.data.car.mission = false; },
        onPass: (M) => { const c = M.data.car; if (c) { c.locked = true; setTimeout(() => G.traffic.remove && G.vehicles.includes(c) && G.player.vehicle !== c && G.traffic.remove(c), 15000); } },
      },
      {
        id: 'midnight', title: 'Midnight Run', giver: { x: club.door.x + 1, z: club.door.z + 6 }, requires: ['island'], reward: 4000,
        desc: 'Lola at Neon Flamingo needs a package delivered to a private jet at the airport — fast.',
        steps: (M) => [
          M.dialog([['Lola', 'You\'re Rico\'s cousin? Good. I need someone fast and quiet.', 4], ['Lola', 'Package is in the back of the club. A jet leaves Hangar 2 in three minutes.', 4.5], ['Lola', 'Don\'t be late, sugar.', 2.5]]),
          M.goTo(() => ({ x: club.x - 10, z: club.z + 4 }), 'Grab the <span class="hl">package</span> inside the club.', { radius: 2.2, onFoot: true }),
          M.custom({ text: 'Get a vehicle.', done: () => !!G.player.vehicle, start: () => { M.startTimer(180); G.ui.notify('Package collected. <b>The clock is ticking!</b>'); } }),
          M.driveTo(() => G.player.vehicle, G.city.hangar.x, G.city.hangar.z - 38, 'Deliver the package to <span class="hl">Hangar 2</span> at the airport.', { radius: 10, anyVehicle: true }),
          M.dialog([['Lola', 'Right on time. I knew I liked you. I\'ll be in touch.', 4]], { phone: true }),
        ],
      },
      {
        id: 'kingpin', title: 'Coastal Kingpin', giver: { x: 360, z: 905 }, requires: ['midnight', 'threads'], reward: 10000,
        desc: 'The Port Authority boss wants a rival smuggler\'s car destroyed before it reaches the Causeway.',
        steps: (M) => [
          M.dialog([['Marco', 'So you\'re the new name everyone is talking about.', 3.5], ['Marco', 'A rival crew is moving product in a black Ranger XL. Stop them before they reach the Causeway.', 5], ['Marco', 'Do that and Vice Coast is yours.', 3]]),
          M.custom({
            text: 'Destroy the smugglers\' <span class="hl">Ranger XL</span>.', start: () => {
              const v = M.spawnVehicle('suv', 120, 840, Math.PI / 2, { color: 0x111111, ai: true });
              v.health = 700; M.data.target = v; v.ai.maxSpeedMul = 1.6; v.ai.panic = 999;
              const route = findPath(v.ai.to.x, v.ai.to.z, 840, 0).map((p) => graph.nodes.find((n) => n.x === p.x && n.z === p.z)).filter(Boolean);
              while (route.length && route[0] === v.ai.to) route.shift();
              v.ai.route = route; v.ai.next = route.shift() || v.ai.next;
              M.startTimer(240);
            },
            target: () => M.data.target, enemy: true,
            done: () => M.data.target.destroyed,
            failIf: () => (M.data.target.pos.x > 900 && Math.abs(M.data.target.pos.z) < 20 && 'The smugglers escaped over the Causeway.'),
            help: 'Ram it until it catches fire, or shoot it with a pistol.',
          }),
          M.dialog([['Marco', 'Boom. That\'s how you send a message. Welcome to the top, kingpin.', 4]], { phone: true }),
        ],
      },
    ];
  }
  buildSide() {
    const G = this.G;
    return [
      { id: 'race1', kind: 'race', title: 'Ocean Drive Sprint', x: 832, z: -330, reward: [1500, 600, 250],
        route: [[840, -480], [840, -720], [600, -720], [360, -720], [360, -480], [360, -240], [360, 0], [600, 0], [840, 0], [840, -240], [832, -320]] },
      { id: 'race2', kind: 'race', title: 'Everglade Run', x: -870, z: -6, reward: [2500, 900, 400],
        route: [[-1080, 0], [-1320, 0], [-1560, 0], [-1800, 0], [-2020, 0], [-1800, 600], [-1560, 600], [-1320, 600], [-1080, 600], [-840, 600], [-840, 360], [-840, 120], [-870, 6]],
        fixRoute: true },
      { id: 'jobs', kind: 'job', title: 'Port Deliveries', x: 352, z: 900 },
    ];
  }

  // ---------- Step factories ----------
  makeRunner(def) {
    const G = this.G;
    const M = { G, def, data: {}, i: 0, steps: [], timer: null, sys: this };
    M.dialog = (lines, opts = {}) => ({
      text: '', start() {
        this.q = lines.slice(); this.t = 0;
        if (opts.phone) { G.audio.ui('phone'); G.ui.notify(`<b>Incoming call:</b> ${lines[0][0]}`); }
      },
      update(dt) {
        this.t -= dt;
        if (this.t <= 0) {
          if (!this.q.length) return true;
          const [who, text, d] = this.q.shift();
          G.ui.subtitle(who, text, d);
          G.audio.phoneVoice(text, who === 'Lola');
          this.t = d;
        }
        return false;
      },
    });
    M.enterVehicle = (get, text, help) => ({
      text, help, target: () => { const v = get(); return v ? v.pos : null; }, vehicleTarget: get,
      update() { const v = get(); if (!v || v.destroyed) return 'The vehicle was destroyed.'; return G.player.vehicle === v; },
    });
    M.exitVehicle = (text) => ({ text, update() { return !G.player.vehicle; } });
    M.goTo = (get, text, o = {}) => ({
      text, help: o.help, target: get, radius: o.radius || 3,
      update() {
        const t = get(); const P = G.player; const p = P.vehicle ? P.vehicle.pos : P.pos;
        if (o.onFoot && P.vehicle) return false;
        return dist2(p.x, p.z, t.x, t.z) < (o.radius || 3) ** 2;
      },
    });
    M.driveTo = (getV, x, z, text, o = {}) => ({
      text, help: o.help, target: () => ({ x, z }), radius: o.radius || 8,
      update() {
        const v = getV(); const P = G.player;
        if (!o.anyVehicle && (!v || v.destroyed)) return 'The vehicle was destroyed.';
        if (!P.vehicle || (!o.anyVehicle && P.vehicle !== v)) { this.textNow = o.anyVehicle ? 'Get a <span class="hl">vehicle</span>.' : 'Get back in the <span class="hl">vehicle</span>.'; return false; }
        this.textNow = null;
        const pv = P.vehicle;
        const ok = dist2(pv.pos.x, pv.pos.z, x, z) < (o.radius || 8) ** 2 && (!o.stop || pv.speed < 2.5);
        if (ok && G.wanted.level > 0 && !o.allowWanted) { this.textNow = '<span class="hl">Lose the cops</span> first.'; return false; }
        return ok;
      },
    });
    M.custom = (o) => ({
      text: o.text, help: o.help, target: o.target, enemy: o.enemy,
      start() { o.start && o.start(); },
      update() { if (o.failIf) { const f = o.failIf(); if (f) return f; } return o.done(); },
    });
    M.spawnVehicle = (type, x, z, rot, opts = {}) => {
      const v = new Vehicle(G, type, x, z, rot, { color: opts.color, parked: !opts.ai, empty: !opts.ai });
      v.mission = true;
      if (opts.ai) {
        const ai = new AIDriver(G, v); v.ai = ai; v.driver = 'ai';
        const n = graph.nodes.reduce((b, n) => (dist2(n.x, n.z, x, z) < dist2(b.x, b.z, x, z) ? n : b));
        const m = graph.nodes[n.links[0]];
        ai.placeOnEdge(n, m, 0.4);
        G.traffic.cars.push(v);
      }
      G.vehicles.push(v);
      (M.data.vehicles = M.data.vehicles || []).push(v);
      return v;
    };
    M.startTimer = (sec) => { M.timer = sec; };
    return M;
  }

  available(def) {
    const done = this.G.state.missions.done;
    return !done.includes(def.id) && def.requires.every((r) => done.includes(r));
  }
  start(def) {
    const G = this.G;
    if (this.current) return;
    const M = this.makeRunner(def);
    this.current = M;
    def.setup && def.setup(M);
    M.steps = def.steps(M);
    M.i = -1;
    G.ui.banner(def.title, def.kind === 'race' ? 'Street race' : 'Mission', 3.5);
    G.audio.setMusicState('mission');
    G.audio.ui('mission');
    this.nextStep();
  }
  nextStep() {
    const M = this.current;
    M.i++;
    if (M.i >= M.steps.length) return this.pass();
    const s = M.steps[M.i];
    s.start && s.start();
    if (s.help) this.G.ui.help(s.help, 8);
    this.refreshObjective();
  }
  refreshObjective() {
    const M = this.current;
    if (!M) { this.G.ui.objective(''); return; }
    const s = M.steps[M.i];
    this.G.ui.objective(s && (s.textNow || s.text) || '');
    this.updateGps();
  }
  updateGps(force) {
    const G = this.G;
    const t = this.currentTarget();
    if (t) G.gps.setTarget(t.x, t.z, '#ffd166', force);
    else if (!G.gps.waypoint) G.gps.clear();
  }
  currentTarget() {
    const M = this.current;
    if (!M) return null;
    if (M.race) return M.race.cps[Math.min(M.race.cp, M.race.cps.length - 1)];
    const s = M.steps[M.i];
    if (!s || !s.target) return null;
    const t = s.target();
    return t ? { x: t.x, z: t.z } : null;
  }
  pass() {
    const G = this.G, M = this.current;
    const def = M.def;
    this.current = null;
    if (!def.repeatable) G.state.missions.done.push(def.id);
    G.state.stats.missions++;
    const reward = M.reward ?? def.reward;
    if (reward) G.addMoney(reward);
    G.ui.banner('Mission passed', reward ? `+${formatMoney(reward)}` : '', 5, '#ffd166');
    G.audio.ui('success');
    def.onPass && def.onPass(M);
    this.cleanup(M);
    G.autosave && G.autosave();
    const nextAvail = this.defs.filter((d) => this.available(d) && d.giver);
    if (nextAvail.length && def.id !== 'kingpin') setTimeout(() => G.ui.notify(`New mission available: <b>${nextAvail.map((d) => d.title).join(', ')}</b>. Look for <b style="color:#ffd166">!</b> on the map.`), 3500);
    if (def.id === 'kingpin') setTimeout(() => G.ui.notify('<b>Story complete!</b> Keep exploring, racing and collecting Coast Tokens.'), 5000);
  }
  fail(reason) {
    const G = this.G, M = this.current;
    if (!M) return;
    this.current = null;
    G.ui.banner('Mission failed', reason || '', 5, '#ff4d5e');
    G.audio.ui('fail');
    this.cleanup(M);
  }
  cleanup(M) {
    const G = this.G;
    G.ui.objective(''); G.ui.timer(null);
    G.audio.setMusicState(G.wanted.level ? 'wanted' : 'explore');
    this.objMarker.visible = false; this.cpMarker.visible = false; this.vehArrow.visible = false;
    if (!G.gps.waypoint) G.gps.clear(); else G.gps.setTarget(G.gps.waypoint.x, G.gps.waypoint.z, '#d946ef', true);
    M.def.cleanup && M.def.cleanup(M);
    if (M.racers) for (const r of M.racers) { if (r.ai) r.ai.mode = 'parkedStop'; r.mission = false; }
    for (const v of M.data.vehicles || []) { if (G.player.vehicle !== v) v.mission = false; }
  }
  abort() { if (this.current) this.fail('Mission aborted.'); }

  // ---------- Side activities ----------
  startRace(side) {
    const G = this.G, P = G.player;
    if (!P.vehicle) { G.ui.help('You need a vehicle to enter the race.'); return; }
    const def = { id: side.id, title: side.title, kind: 'race', repeatable: true, requires: [], reward: 0 };
    const M = this.makeRunner(def);
    const cps = side.route.map(([x, z]) => ({ x, z }));
    M.race = { cps, cp: 0, countdown: 3.5, started: false, side };
    // racers alongside
    M.racers = [];
    const v0 = P.vehicle;
    const fx = Math.sin(v0.heading), fz = Math.cos(v0.heading), rx = -fz, rz = fx;
    const types = ['sports', 'super', 'sports'];
    for (let k = 0; k < 3; k++) {
      const off = (k % 2 ? 3.6 : -3.6) * (k === 2 ? 0 : 1);
      const back = k === 2 ? -8 : 0;
      const x = v0.pos.x + rx * off + fx * back, z = v0.pos.z + rz * off + fz * back;
      const v = new Vehicle(G, types[k], x, z, v0.heading, {});
      const ai = new AIDriver(G, v, 'race');
      ai.checkpoints = cps.map((c) => ({ x: c.x + (R() - 0.5) * 3, z: c.z + (R() - 0.5) * 3 }));
      ai.cp = 0; ai.skill = 0.78 + k * 0.05;
      v.ai = ai; v.driver = 'ai'; v.mission = true;
      ai.mode = 'parkedStop';
      G.vehicles.push(v); G.traffic.cars.push(v);
      M.racers.push(v);
    }
    M.steps = [{ text: 'Get ready…', update: () => false }];
    M.i = 0;
    this.current = M;
    G.ui.banner(side.title, 'Street race · finish 1st to win ' + formatMoney(side.reward[0]), 3.5);
    G.audio.setMusicState('mission');
    this.updateGps(true);
  }
  updateRace(dt, M) {
    const G = this.G, P = G.player, race = M.race;
    if (!race.started) {
      race.countdown -= dt;
      const n = Math.ceil(race.countdown);
      if (n !== race.lastN && n > 0 && n <= 3) { race.lastN = n; G.ui.banner(String(n), '', 0.9); G.audio.ui('checkpoint'); }
      if (P.vehicle) { P.vehicle.input.throttle = 0; P.vehicle.vel.multiplyScalar(0.8); }
      if (race.countdown <= 0) {
        race.started = true; G.ui.banner('GO!', '', 1, '#4ade80'); G.audio.ui('success');
        for (const r of M.racers) r.ai.mode = 'race';
        M.steps[0].text = 'Win the race!';
        race.t0 = G.time.total;
      }
      return;
    }
    if (!P.vehicle) { race.offT = (race.offT || 0) + dt; M.steps[0].textNow = 'Get back in a vehicle!'; if (race.offT > 15) return this.fail('You left the race.'); }
    else { race.offT = 0; M.steps[0].textNow = null; }
    const pv = P.vehicle;
    const c = race.cps[race.cp];
    if (pv && dist2(pv.pos.x, pv.pos.z, c.x, c.z) < 15 * 15) {
      race.cp++; G.audio.ui('checkpoint');
      if (race.cp >= race.cps.length) {
        // finish — compute place
        const ahead = M.racers.filter((r) => r.ai && r.ai.cp >= race.cps.length).length;
        const place = ahead + 1;
        const reward = race.side.reward[place - 1] || 0;
        M.reward = reward;
        G.state.stats.races++;
        G.ui.notify(`Race finished: <b>${['1st', '2nd', '3rd', '4th'][place - 1]}</b> place in ${(G.time.total - race.t0).toFixed(1)}s`);
        if (place === 1) return this.pass();
        this.fail(`You finished ${['1st', '2nd', '3rd', '4th'][place - 1]}.` + (reward ? ` Consolation: ${formatMoney(reward)}` : ''));
        if (reward) G.addMoney(reward);
        return;
      }
    }
    // position display
    const prog = (v, cp) => cp * 10000 - Math.hypot(race.cps[Math.min(cp, race.cps.length - 1)].x - v.pos.x, race.cps[Math.min(cp, race.cps.length - 1)].z - v.pos.z);
    const me = pv ? prog(pv, race.cp) : -1e9;
    const pos = 1 + M.racers.filter((r) => r.ai && prog(r, r.ai.cp) > me).length;
    M.steps[0].text = `Win the race! &nbsp; Position <span class="hl">${pos}/4</span> &nbsp; Checkpoint <span class="hl">${race.cp + 1}/${race.cps.length}</span>`;
  }
  startJob() {
    const G = this.G;
    const shops = G.city.shops.filter((s) => s.kind !== 'fuel' && s.kind !== 'garage' && s.kind !== 'save');
    const pick = shops[Math.floor(R() * shops.length)];
    const drop = shops.filter((s) => dist2(s.x, s.z, pick.x, pick.z) > 300 * 300)[0] || shops[0];
    const dropPt = { x: drop.x, z: drop.z + 3 };
    const dist = Math.hypot(drop.x - pick.x, drop.z - pick.z);
    const reward = Math.round(200 + dist * 0.6);
    const def = { id: 'job', title: 'Delivery Job', kind: 'job', repeatable: true, requires: [], reward };
    const M = this.makeRunner(def);
    M.steps = [
      M.goTo(() => ({ x: pick.x, z: pick.z + 3 }), `Pick up the package at <span class="hl">${pick.name}</span>.`, { radius: 6 }),
      M.custom({ text: `Deliver the package to <span class="hl">${drop.name}</span>.`, target: () => dropPt, start: () => { M.startTimer(Math.round(40 + dist / 9)); G.audio.ui('checkpoint'); }, done: () => { const P = G.player, p = P.vehicle ? P.vehicle.pos : P.pos; return dist2(p.x, p.z, dropPt.x, dropPt.z) < 49; } }),
    ];
    M.i = -1;
    this.current = M;
    G.ui.banner('Delivery Job', `Reward ${formatMoney(reward)}`, 3);
    G.state.stats.jobs++;
    this.nextStep();
  }

  // ---------- Collectibles ----------
  initTokens() {
    const G = this.G;
    const geo = new THREE.CylinderGeometry(0.45, 0.45, 0.08, 20).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffaa00, emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.25 });
    for (const t of this.tokens) G.scene.remove(t.m);
    this.tokens = G.city.collectibleSpots.map((s, i) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, s.y + 0.3, s.z);
      const collected = G.state.collected.includes(i);
      m.visible = !collected;
      G.scene.add(m);
      return { m, i, x: s.x, z: s.z, collected };
    });
  }

  // ---------- Per-frame ----------
  update(dt) {
    const G = this.G, P = G.player, inp = G.input;
    const t = G.time.total;
    // tokens
    for (const k of this.tokens) {
      if (k.collected) continue;
      if (Math.abs(k.x - P.pos.x) > 120 || Math.abs(k.z - P.pos.z) > 120) { k.m.visible = false; continue; }
      k.m.visible = true;
      k.m.rotation.y = t * 2.5; k.m.position.y += Math.sin(t * 3 + k.i) * 0.003;
      const pp = P.vehicle ? P.vehicle.pos : P.pos;
      if (dist2(pp.x, pp.z, k.x, k.z) < (P.vehicle ? 9 : 2.5) && Math.abs(pp.y - k.m.position.y) < 4) {
        k.collected = true; k.m.visible = false;
        G.state.collected.push(k.i);
        const n = G.state.collected.length, total = this.tokens.length;
        G.addMoney(100);
        G.audio.pickup();
        G.ui.notify(`Coast Token collected <b>${n}/${total}</b> (+$100)`);
        if (n === total) { G.addMoney(10000); G.ui.banner('All Coast Tokens found!', '+$10,000', 5); }
      }
    }
    // giver markers
    const playerFree = !this.current;
    for (const def of this.defs) {
      let mk = this.giverMarkers.get(def.id);
      const show = def.giver && this.available(def) && playerFree;
      if (show && !mk) { mk = makeMarker(0xffd166, 1.4, 2.6); mk.position.set(def.giver.x, groundHeight(def.giver.x, def.giver.z), def.giver.z); this.markers.add(mk); this.giverMarkers.set(def.id, mk); }
      if (mk) mk.visible = !!show;
    }
    for (const s of this.side) {
      let mk = this.giverMarkers.get(s.id);
      if (!mk) { mk = makeMarker(s.kind === 'race' ? 0xffffff : 0x7dd3fc, s.kind === 'race' ? 3 : 1.4, 2.6); mk.position.set(s.x, groundHeight(s.x, s.z), s.z); this.markers.add(mk); this.giverMarkers.set(s.id, mk); }
      mk.visible = playerFree;
    }
    for (const mk of this.giverMarkers.values()) if (mk.visible) { mk.userData.chev.rotation.y = t * 2; mk.userData.chev.position.y = 3.6 + Math.sin(t * 3) * 0.2; }
    // start prompts
    let prompt = null;
    if (playerFree && !G.uiBlocking) {
      const pp = P.vehicle ? P.vehicle.pos : P.pos;
      for (const def of this.defs) if (def.giver && this.available(def) && dist2(pp.x, pp.z, def.giver.x, def.giver.z) < 4) prompt = { def, text: `Press <kbd>E</kbd> to start <b>${def.title}</b><br><span style="color:#9aa3b5">${def.desc}</span>` };
      for (const s of this.side) if (dist2(pp.x, pp.z, s.x, s.z) < (s.kind === 'race' ? 16 : 5)) prompt = { side: s, text: s.kind === 'race' ? `Press <kbd>E</kbd> to start the <b>${s.title}</b> street race${P.vehicle ? '' : ' (vehicle required)'}` : `Press <kbd>E</kbd> to take a <b>delivery job</b>` };
    }
    if (prompt) {
      if (this.promptKey !== (prompt.def ? prompt.def.id : prompt.side.id)) { this.promptKey = prompt.def ? prompt.def.id : prompt.side.id; G.ui.help(prompt.text, 999); }
      if (inp.pressed('interact')) {
        G.ui.clearHelp(); this.promptKey = null;
        if (prompt.def) {
          if (G.wanted.level > 0) G.ui.help('Lose the cops before starting a mission.');
          else this.start(prompt.def);
        } else if (prompt.side.kind === 'race') this.startRace(prompt.side);
        else this.startJob();
      }
    } else if (this.promptKey) { this.promptKey = null; G.ui.clearHelp(); }

    // current mission
    const M = this.current;
    if (!M) { this.objMarker.visible = false; this.cpMarker.visible = false; this.vehArrow.visible = false; return; }
    if (M.timer != null) {
      M.timer -= dt; G.ui.timer(Math.max(0, M.timer));
      if (M.timer <= 0) return this.fail('You ran out of time.');
    }
    if (M.race) {
      this.updateRace(dt, M);
      if (!this.current) return;
      const c = M.race.cps[Math.min(M.race.cp, M.race.cps.length - 1)];
      this.cpMarker.visible = true; this.cpMarker.position.set(c.x, groundHeight(c.x, c.z), c.z);
      this.objMarker.visible = false;
      this.refreshObjective();
      this.gpsT = (this.gpsT || 0) - dt; if (this.gpsT <= 0) { this.gpsT = 1; this.updateGps(); }
      return;
    }
    const s = M.steps[M.i];
    const r = s.update(dt);
    if (typeof r === 'string') return this.fail(r);
    if (r === true) { this.nextStep(); return; }
    // markers
    const tgt = s.target ? s.target() : null;
    if (tgt && !s.vehicleTarget && !s.enemy) {
      this.objMarker.visible = true;
      this.objMarker.position.set(tgt.x, groundHeight(tgt.x, tgt.z), tgt.z);
      const rr = s.radius || 2;
      this.objMarker.scale.set(rr / 2, 1, rr / 2);
      this.objMarker.userData.chev.rotation.y = t * 2;
    } else this.objMarker.visible = false;
    if (tgt && (s.vehicleTarget || s.enemy)) {
      this.vehArrow.visible = true;
      this.vehArrow.position.set(tgt.x, (tgt.y || groundHeight(tgt.x, tgt.z)) + 3 + Math.sin(t * 4) * 0.2, tgt.z);
      this.vehArrow.material.color.set(s.enemy ? 0xff4d5e : 0x36e2ff);
      this.vehArrow.rotation.y = t * 2;
    } else this.vehArrow.visible = false;
    this.refreshObjective();
    this.gpsT = (this.gpsT || 0) - dt;
    if (this.gpsT <= 0) { this.gpsT = 1.2; this.updateGps(); }
  }
  blips() {
    const G = this.G, out = [];
    if (!this.current) {
      for (const def of this.defs) if (def.giver && this.available(def)) out.push({ x: def.giver.x, z: def.giver.z, style: BLIP_STYLE.mission, label: def.title });
      for (const s of this.side) out.push({ x: s.x, z: s.z, style: BLIP_STYLE[s.kind], small: false, label: s.title });
    }
    const t = this.currentTarget();
    if (t) {
      const s = this.current && this.current.steps[this.current.i];
      out.push({ x: t.x, z: t.z, style: s && s.enemy ? BLIP_STYLE.enemy : s && s.vehicleTarget ? BLIP_STYLE.vehicle : BLIP_STYLE.target });
    }
    if (G.gps.waypoint) out.push({ x: G.gps.waypoint.x, z: G.gps.waypoint.z, style: BLIP_STYLE.waypoint });
    return out;
  }
}

// GPS: shortest path on road graph to a target, refreshed periodically
export class GPS {
  constructor(G) { this.G = G; this.route = null; this.target = null; this.waypoint = null; this.t = 0; this.color = '#d946ef'; }
  setTarget(x, z, color, force) {
    const changed = !this.target || Math.abs(this.target.x - x) > 1 || Math.abs(this.target.z - z) > 1;
    this.target = { x, z }; this.color = color || '#d946ef';
    if (changed || force) this.recompute();
  }
  setWaypoint(x, z) { this.waypoint = { x, z }; if (!this.G.missions.current) this.setTarget(x, z, '#d946ef', true); this.G.audio.ui('select'); }
  clearWaypoint() { this.waypoint = null; if (!this.G.missions.current) this.clear(); }
  clear() { this.route = null; this.target = null; }
  recompute() {
    const P = this.G.player, p = P.vehicle ? P.vehicle.pos : P.pos;
    if (!this.target) return;
    const d = Math.hypot(this.target.x - p.x, this.target.z - p.z);
    this.route = d < 40 ? [{ x: p.x, z: p.z }, this.target] : findPath(p.x, p.z, this.target.x, this.target.z);
  }
  update(dt) {
    if (!this.target) return;
    this.t -= dt;
    if (this.t <= 0) { this.t = 1.5; this.recompute(); }
    const P = this.G.player, p = P.vehicle ? P.vehicle.pos : P.pos;
    if (this.waypoint && !this.G.missions.current && Math.hypot(this.waypoint.x - p.x, this.waypoint.z - p.z) < 12) { this.G.ui.notify('Waypoint reached.'); this.clearWaypoint(); }
    if (this.route && this.route.length) this.route[0] = { x: p.x, z: p.z };
  }
}
