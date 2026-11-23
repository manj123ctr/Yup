// Vice Coast — entry point. Sets up rendering & post-processing, builds the
// world, owns the game loop and glues every system together.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CollisionWorld } from './world/collision.js';
import { City } from './world/city.js';
import { Sky } from './world/sky.js';
import { Water } from './world/water.js';
import { Weather } from './world/weather.js';
import { ENV } from './world/materials.js';
import { zoneAt, groundHeight, nearestNode, graph, lanesFor, PLACES } from './world/layout.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { AudioEngine, STATIONS } from './audio.js';
import { FX } from './fx.js';
import { Player } from './entities/player.js';
import { Vehicle, collideVehicles, VTYPES } from './entities/vehicle.js';
import { TrafficManager, lightState } from './ai/traffic.js';
import { PedManager } from './ai/peds.js';
import { Wanted } from './ai/police.js';
import { HUD, renderMapImage } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { Phone } from './ui/phone.js';
import { MissionSystem, GPS } from './gameplay/missions.js';
import { CityEvents } from './gameplay/events.js';
import { newState, loadSettings, saveSettings, saveGame, loadGame, latestSlot } from './gameplay/state.js';
import { clamp, R, formatMoney, dist2, lerp } from './util.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDrunk: { value: 0 }, uSpeed: { value: 0 }, uSat: { value: 1.12 }, uVig: { value: 0.35 }, uWasted: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uDrunk, uSpeed, uSat, uVig, uWasted; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      if (uDrunk > 0.0) uv += vec2(sin(uv.y * 9.0 + uTime * 1.9), cos(uv.x * 8.0 + uTime * 1.5)) * 0.007 * uDrunk;
      vec2 d = uv - 0.5;
      float ca = uSpeed * 0.006 + uDrunk * 0.004;
      vec3 c = vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);
      if (uDrunk > 0.0) c = mix(c, texture2D(tDiffuse, uv + vec2(0.012 * uDrunk, 0.0)).rgb, 0.35 * uDrunk);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat * (1.0 - uWasted));
      c *= mix(vec3(0.94, 1.0, 1.07), vec3(1.06, 1.0, 0.93), smoothstep(0.0, 1.2, l));
      float v = smoothstep(0.9, 0.25, length(d * vec2(1.0, 0.8)));
      c *= mix(1.0 - uVig - uWasted * 0.3, 1.0, v);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

class Game {
  constructor() {
    this.canvas = $('game');
    this.settings = loadSettings();
    this.mode = 'loading';
    this.paused = false;
    this.time = { hour: 18.2, total: 0 };
    this.vehicles = [];
    this.uiBlocking = false;
    this.hudHidden = false;
    this.drunkT = 0;
    this.zoneName = 'downtown';
    window.VC = this; // handy for debugging from the console
  }

  async boot() {
    const prog = (p, t) => { $('load-fill').style.width = p + '%'; $('load-text').textContent = t; };
    prog(5, 'Starting renderer…'); await nextFrame();
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.quality >= 2, powerPreference: 'high-performance' });
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.15, 3500);
    this.camera.position.set(600, 60, 300);
    // post-processing
    const comp = this.composer = new EffectComposer(r);
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.5, 0.92);
    comp.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    comp.addPass(this.grade);
    comp.addPass(new OutputPass());
    addEventListener('resize', () => this.onResize());

    prog(12, 'Tuning in the sky…'); await nextFrame();
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine();
    this.col = new CollisionWorld();
    this.sky = new Sky(this.scene, r);
    this.weather = new Weather(this.scene, this.sky, this.audio);
    this.water = new Water(this.scene, this.sky);
    this.fx = new FX(this.scene);

    prog(25, 'Building Vice Coast — roads, towers, beaches…'); await nextFrame();
    this.city = new City(this.scene, this.col);

    prog(70, 'Drawing the map…'); await nextFrame();
    this.ui = new HUD(this); this.ui.hud = this.ui;
    this.ui.setMapImage(renderMapImage(this));

    prog(80, 'Populating the streets…'); await nextFrame();
    this.cam = new CameraRig(this, this.camera);
    this.player = new Player(this, 856, 192);
    this.peds = new PedManager(this);
    this.traffic = new TrafficManager(this);
    this.wanted = new Wanted(this);
    this.gps = new GPS(this);
    this.missions = new MissionSystem(this);
    this.events = new CityEvents(this);
    this.menus = new Menus(this);
    this.phone = new Phone(this);
    this.state = newState();
    this.audio.onStation = (st) => this.ui.showRadio(st);
    // player car headlight (single spotlight, always present to avoid shader recompiles)
    this.headlight = new THREE.SpotLight(0xfff1d6, 0, 70, 0.55, 0.45, 1.4);
    this.scene.add(this.headlight, this.headlight.target);
    // bullet tracers
    this.tracers = [];
    const tg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    for (let i = 0; i < 12; i++) {
      const l = new THREE.Line(tg.clone(), new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
      l.frustumCulled = false; this.scene.add(l); this.tracers.push({ l, t: 0 });
    }
    this.tracer = (a, b) => {
      const tr = this.tracers.reduce((x, y) => (x.t < y.t ? x : y));
      const p = tr.l.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
      tr.t = 0.08; tr.l.material.opacity = 0.9;
    };
    this.hookEvents();
    this.applySettings();

    prog(92, 'Warming up shaders…'); await nextFrame();
    this.sky.update(0.016, this.time.hour, this.weather.params, this.camera.position, this.camera, 0);
    this.renderer.compile(this.scene, this.camera);
    this.composer.render();
    prog(100, 'Ready'); await nextFrame();
    $('loading').classList.add('hidden');
    this.showTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  hookEvents() {
    // first gesture starts audio
    const kick = () => { this.audio.init(); this.audio.setVolumes({ master: this.settings.master, music: this.settings.music, sfx: this.settings.sfx }); };
    addEventListener('pointerdown', kick); addEventListener('keydown', kick);
    // title menu
    $('title-menu').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.audio.init(); this.audio.ui('select');
      const act = b.dataset.act;
      if (act === 'new') this.startGame(newState(), true);
      else if (act === 'continue') { const l = latestSlot(); const st = l && loadGame(l.slot); if (st) this.startGame(st); }
      else if (act === 'load') this.menus.openStandalone('load');
      else if (act === 'settings') this.menus.openStandalone('settings');
      else if (act === 'controls') this.menus.openStandalone('controls');
    });
    // Browsers swallow Esc while the pointer is locked: treat losing the lock as "pause"
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) return;
      if (this.mode === 'play' && !this.menus.isOpen && !this.phone.isOpen && !this.respawning) { this.audio.ui('select'); this.menus.openPause(); }
    });
    this.onPlayerDeath = () => this.wastedOrBusted('wasted');
    this.onBusted = () => this.wastedOrBusted('arrested');
    this.onEnterVehicle = (v) => {
      this.audio.setInVehicle(true);
      const st = STATIONS[this.audio.station];
      if (!v.T.lights) this.ui.showRadio(st);
      if (v.type === 'police') this.ui.help('Press <kbd>Q</kbd> to toggle the siren.', 4);
      if (!this.state.flags.carHelp) { this.state.flags.carHelp = true; this.ui.help('<kbd>R</kbd> radio station · <kbd>V</kbd> camera · <kbd>C</kbd> cinematic cam · <kbd>H</kbd> headlights · <kbd>F</kbd> exit', 7); }
    };
    this.onExitVehicle = () => { this.audio.setInVehicle(false); };
    this.onPedDeath = (p) => this.events.onPedDeath(p);
    this.onExplosion = (pos, src) => {
      for (const p of this.peds.list) { const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z); if (d < 8 && !p.dead) p.damage(200 * (1 - d / 8) + 20, null, { x: (p.pos.x - pos.x) * 2, z: (p.pos.z - pos.z) * 2 }); }
      for (const v of this.vehicles) { if (v === src) continue; const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z); if (d < 9) { v.damage(600 * (1 - d / 9)); v.vel.x += (v.pos.x - pos.x) * 1.5; v.vel.y += (v.pos.z - pos.z) * 1.5; } }
      const P = this.player, pp = P.vehicle ? P.vehicle.pos : P.pos;
      const d = Math.hypot(pp.x - pos.x, pp.z - pos.z);
      if (d < 9 && !P.vehicle) { P.hurt(120 * (1 - d / 9), 'explosion'); P.knockT = 1.5; P.vel.set((P.pos.x - pos.x) * 2, 5, (P.pos.z - pos.z) * 2); P.onGround = false; }
      if (src && (src.driver === 'player' || src.hitByPlayer)) this.wanted.crime('explosion', pos);
      this.peds.alarm(pos, 60, 'gunfire');
    };
    this.onVehicleCollision = (a, b, impact) => {
      const pv = a.driver === 'player' ? a : b.driver === 'player' ? b : null;
      if (!pv) return;
      const other = pv === a ? b : a;
      other.hitByPlayer = true;
      if (other.isCop && impact > 4) this.wanted.crime('ramCop', other.pos);
      if (other.ai && other.driver === 'ai' && !other.isCop && impact > 5) { other.ai.panic = 6; if (R() < 0.6) this.audio.horn(other.pos, other.type); }
    };
  }

  // ---------- Title ----------
  showTitle() {
    this.mode = 'title';
    this.paused = false;
    $('title').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('btn-continue').disabled = !latestSlot();
    this.time.hour = 18.6;
    this.weather.set('clear', true);
    this.titleT = 0;
    this.audio.setMusicState('title');
    this.input.wantLock = false; this.input.releaseLock();
  }
  updateTitle(dt) {
    this.titleT += dt;
    const t = this.titleT * 0.035;
    const cx = 300, cz = -150;
    const pos = new THREE.Vector3(cx + Math.cos(t) * 520, 120 + Math.sin(t * 0.7) * 30, cz + Math.sin(t) * 520);
    this.cam.override = { pos, look: new THREE.Vector3(cx + Math.cos(t + 0.9) * 100, 40, cz + Math.sin(t + 0.9) * 100), fov: 55 };
    this.time.hour = 18.4 + Math.sin(this.titleT * 0.02) * 0.3;
  }

  // ---------- Game start / end ----------
  startGame(state, isNew = false) {
    const G = this;
    $('title').classList.add('hidden');
    if (this.menus.isOpen) this.menus.close();
    $('hud').classList.remove('hidden');
    this.audio.init();
    // reset world entities
    if (this.player.vehicle) this.player.leaveVehicle(true);
    for (const v of this.vehicles) v.dispose();
    this.vehicles = []; this.traffic.cars = []; this.traffic.parked.clear();
    this.peds.clear();
    this.wanted.clear();
    if (this.missions.current) { this.missions.current = null; }
    this.gps.clear(); this.gps.waypoint = null;
    this.state = state;
    this.time.hour = state.hour;
    this.weather.set(state.weather || 'clear', true);
    const P = this.player;
    P.dead = false; P.health = state.health || 100; P.armor = state.armor || 0; P.knockT = 0;
    P.setLook(state.look);
    P.teleport(state.player.x, state.player.z, state.player.yaw);
    P.weapon = 'fists';
    this.cam.override = null;
    this.cam.yaw = P.yaw + Math.PI; this.cam.pitch = 0.15;
    this.missions.initTokens();
    this.mode = 'play'; this.paused = false;
    this.input.wantLock = true;
    this.input.requestLock();
    this.ui.weaponChanged(); this.ui.updateWanted();
    this.audio.setMusicState('explore');
    this.ui.objective('');
    if (isNew) {
      this.fadeIn();
      setTimeout(() => this.missions.start(this.missions.defs[0]), 1200);
      setTimeout(() => this.ui.help('<kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump · <kbd>C</kbd> crouch · <kbd>Mouse</kbd> look · <kbd>Esc</kbd> pause', 8), 400);
    } else {
      this.ui.notify('Game loaded. Welcome back to Vice Coast.');
    }
  }
  quitToTitle() {
    this.menus.close();
    if (this.player.vehicle) this.player.leaveVehicle(true);
    if (this.missions.current) this.missions.fail('');
    this.wanted.clear();
    this.phone.isOpen && this.phone.toggle(false);
    this.showTitle();
  }
  syncState() {
    const P = this.player, s = this.state;
    s.hour = this.time.hour; s.weather = this.weather.type;
    s.player = { x: P.pos.x, z: P.pos.z, yaw: P.yaw };
    s.health = P.health; s.armor = P.armor; s.look = s.look || P.look;
  }
  canSaveAnywhere() { return !this.missions.current && this.wanted.level === 0 && this.mode === 'play'; }
  autosave() { if (this.mode !== 'play') return; this.syncState(); saveGame('auto', this.state); }
  addMoney(n) { this.state.money += n; if (n > 0) this.audio.ui('cash'); }
  spend(n) { if (this.state.money < n) { this.ui.help(`Not enough money (${formatMoney(n)} needed).`); return false; } this.state.money -= n; return true; }
  fadeOut(cb) {
    const f = $('fade'); f.classList.remove('hidden'); requestAnimationFrame(() => f.classList.add('on'));
    setTimeout(() => { cb && cb(); setTimeout(() => this.fadeIn(), 300); }, 700);
  }
  fadeIn() { const f = $('fade'); f.classList.remove('hidden'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 50); setTimeout(() => f.classList.add('hidden'), 800); }
  toggleHudHidden() {
    this.hudHidden = !this.hudHidden;
    $('hud').style.visibility = this.hudHidden ? 'hidden' : '';
    if (this.hudHidden) setTimeout(() => this.ui.notify('Snap mode: HUD hidden. Open the phone (<kbd>T</kbd>) → Snap to restore.'), 10);
  }
  wastedOrBusted(kind) {
    if (this.respawning) return;
    this.respawning = true;
    const busted = kind === 'arrested';
    const P = this.player;
    if (busted) { this.state.stats.busted++; if (P.vehicle) P.leaveVehicle(true); P.dead = true; }
    else this.state.stats.deaths++;
    if (this.missions.current) this.missions.fail(busted ? 'You were arrested.' : 'You died.');
    $('big-msg').classList.remove('hidden');
    $('big-text').textContent = busted ? 'ARRESTED' : 'FLATLINED';
    $('big-text').style.color = busted ? '#4d8bff' : '#ff4d5e';
    const fee = Math.min(this.state.money, busted ? Math.max(100, Math.round(this.state.money * 0.08)) : 300);
    $('big-sub').textContent = busted ? `Fines: ${formatMoney(fee)} · weapons confiscated` : `Hospital bill: ${formatMoney(fee)}`;
    this.audio.ui('fail');
    this.wastedFx = 1;
    setTimeout(() => {
      this.fadeOut(() => {
        $('big-msg').classList.add('hidden');
        this.state.money -= fee;
        if (busted) { this.state.ammo = 0; this.state.clip = 0; P.weapon = 'fists'; }
        this.wanted.clear();
        const p = busted ? this.city.policePos : this.city.hospitalPos;
        P.dead = false; P.health = 100; P.armor = busted ? P.armor : 0; P.knockT = 0;
        P.teleport(p.x, p.z + 2, 0);
        this.cam.yaw = Math.PI;
        this.time.hour = (this.time.hour + 3) % 24;
        this.wastedFx = 0;
        this.respawning = false;
        this.ui.weaponChanged();
      });
    }, 3500);
  }
  spawnOwnedCar(c, atGarage) {
    let x, z, h;
    if (atGarage && this.city.garage) { x = this.city.garage.x; z = this.city.garage.z; h = 0; }
    else {
      const P = this.player;
      const n = nearestNode(P.pos.x, P.pos.z);
      const m = graph.nodes[n.links[0]];
      const t = 0.3;
      const dx = Math.sign(m.x - n.x), dz = Math.sign(m.z - n.z);
      const off = (n.z === m.z ? lanesFor('z', n.z) : lanesFor('x', n.x))[0] + 2.5;
      x = n.x + (m.x - n.x) * t - dz * off; z = n.z + (m.z - n.z) * t + dx * off; h = Math.atan2(dx, dz);
      if (Math.hypot(x - P.pos.x, z - P.pos.z) > 140) { x = P.pos.x + 4; z = P.pos.z; }
    }
    const v = new Vehicle(this, c.type, x, z, h, { color: c.color, parked: true, empty: true, upgrades: { ...c.upgrades } });
    v.owned = true;
    this.vehicles.push(v);
    this.ui.notify(`Your <b>${v.T.name}</b> is ready.`);
    return v;
  }
  syncGarageCar() { /* customizations apply to the live vehicle; stored on next garage visit */ }
  fastTravel(x, z) {
    const n = nearestNode(x, z);
    const P = this.player;
    const tx = n ? n.x + 10 : x, tz = n ? n.z + 10 : z;
    if (P.vehicle) {
      const v = P.vehicle; v.pos.set(n.x, groundHeight(n.x, n.z), n.z); v.vel.set(0, 0);
      v.heading = 0; v.syncMesh();
    } else P.teleport(tx, tz);
    this.time.hour = (this.time.hour + 0.5) % 24;
  }

  // ---------- Settings ----------
  applySettings() {
    const S = this.settings, r = this.renderer;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const pr = [Math.min(1, dpr) * 0.7, Math.min(1, dpr), Math.min(1.5, dpr), dpr][S.quality];
    r.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.onResize();
    this.sky.setShadowQuality([0, 1, 2, 3][S.quality]);
    this.sky.setShadowRange(S.quality >= 3 ? 160 : 110);
    r.shadowMap.enabled = S.quality > 0;
    this.bloom.enabled = S.bloom && S.quality > 0;
    this.cam.baseFov = S.fov;
    this.input.sensitivity = S.sensitivity; this.input.invertY = S.invertY;
    this.audio.setVolumes({ master: S.master, music: S.music, sfx: S.sfx });
    this.audio.voicesOn = S.voices;
    this.traffic.density = S.traffic; this.peds.density = S.peds;
    this.camera.far = [1400, 2200, 3000, 3500][S.quality];
    this.camera.updateProjectionMatrix();
    // material updates after shadow toggles
    this.scene.traverse((o) => { if (o.material && o.material.needsUpdate !== undefined && o.isMesh) o.material.needsUpdate = true; });
  }
  onResize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------- Interactions ----------
  updateInteractions(dt) {
    const P = this.player, inp = this.input;
    if (this.missions.promptKey || this.uiBlocking) return;
    const pp = P.vehicle ? P.vehicle.pos : P.pos;
    let near = null;
    for (const s of this.city.shops) {
      if (s.kind === 'fuel') continue;
      if (s.kind === 'save' && !this.state.flags.garage) continue;
      if (s.kind === 'garage' && !this.state.flags.garage) continue;
      const vehOk = s.kind === 'customs' || s.kind === 'garage';
      if (P.vehicle && !vehOk) continue;
      if (dist2(pp.x, pp.z, s.x, s.z) < (s.r + (P.vehicle ? 2 : 0)) ** 2) { near = s; break; }
    }
    const verbs = { store: 'shop at', food: 'order at', arms: 'browse', clothing: 'shop at', customs: 'enter', garage: 'use the', save: 'enter the', club: 'order drinks at' };
    if (near) {
      if (this.nearShop !== near) { this.nearShop = near; this.ui.help(`Press <kbd>E</kbd> to ${verbs[near.kind] || 'use'} <b>${near.name}</b>`, 999); }
      if (inp.pressed('interact')) { this.ui.clearHelp(); this.nearShop = null; this.audio.ui('select'); this.menus.openShop(near); }
    } else if (this.nearShop) { this.nearShop = null; this.ui.clearHelp(); }
    // store robbery: aim a pistol at a clerk
    if (P.aiming && P.weapon === 'pistol' && !P.vehicle) {
      for (const p of this.peds.list) {
        if (!p.isClerk || p.dead || Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) > 7) continue;
        const shop = this.city.shops.find((s) => s.robbable && s.clerk && Math.hypot(s.clerk.x - p.home.x, s.clerk.z - p.home.z) < 1);
        if (!shop || p.robbedT > 0) continue;
        const cf = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const dx = p.pos.x - this.camera.position.x, dz = p.pos.z - this.camera.position.z, d = Math.hypot(dx, dz);
        if ((dx * cf.x + dz * cf.z) / d < 0.95) continue;
        p.handsUp = 3; p.robT = (p.robT || 0) + dt;
        if (p.robT > 0.1 && p.robT < 0.2) p.say('Okay! Okay! Take the money!', true, true);
        if (p.robT > 2.5) {
          p.robbedT = 300; p.robT = 0;
          const amt = 250 + Math.floor(R() * 450);
          this.peds.dropCash(p.pos.x + Math.sin(p.heading) * 1.2, p.pos.z + Math.cos(p.heading) * 1.2, amt);
          this.state.stats.robberies++;
          this.wanted.crime('robbery', P.pos);
          this.wanted.setLevel(Math.max(this.wanted.level, 3));
          this.ui.notify('The clerk emptied the register. <b>Grab the cash and run!</b>');
        }
      }
    }
    for (const p of this.peds.list) if (p.robbedT > 0) p.robbedT -= dt;
  }

  // ---------- Main loop ----------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000; this.last = now;
    dt = clamp(dt, 0, 0.05);
    this.input.pollGamepad();
    const mouse = this.input.consumeMouse();
    if (this.mode === 'title') {
      this.updateTitle(dt);
      this.time.total += dt;
      this.updateEnvironment(dt);
      this.cam.update(dt, { x: 0, y: 0, wheel: 0 });
    } else if (this.mode === 'play') {
      this.handleGlobalKeys();
      if (!this.paused) this.updatePlay(dt, mouse);
      else this.cam.update(0.0001, { x: 0, y: 0, wheel: 0 });
    }
    this.render(dt);
    this.input.endFrame();
  }
  handleGlobalKeys() {
    const inp = this.input;
    if (this.menus.isOpen) {
      if (performance.now() - (this.menus.openedAt || 0) < 350) return;
      if (inp.pressed('pause') || (inp.pressed('inventory') && this.menus.open === 'inventory') || (inp.pressed('map') && this.menus.open === 'pause' && this.menus.pauseTab === 'map')) this.menus.close();
      return;
    }
    if (this.respawning) return;
    if (inp.pressed('pause')) { if (this.phone.isOpen) this.phone.toggle(false); else { this.audio.ui('select'); this.menus.openPause(); } return; }
    if (inp.pressed('map')) { this.audio.ui('select'); this.menus.openMap(); return; }
    if (inp.pressed('inventory')) { this.audio.ui('select'); this.menus.openInventory(); return; }
    if (inp.pressed('phone')) this.phone.toggle();
    // re-lock the pointer when clicking back into the game
    if (!this.input.locked && this.input.edge.has('Mouse0') && !this.phone.isOpen) this.input.requestLock();
  }
  updatePlay(dt, mouse) {
    const P = this.player;
    this.uiBlocking = this.phone.isOpen;
    this.time.total += dt;
    this.state.stats.playTime += dt;
    const prevHour = this.time.hour;
    this.time.hour = (this.time.hour + dt * 24 / (this.settings.dayLength * 60)) % 24;
    if (this.time.hour < prevHour) this.state.day++;
    // zone
    this.zoneT = (this.zoneT || 0) - dt;
    if (this.zoneT <= 0) { this.zoneT = 0.5; const pp = P.vehicle ? P.vehicle.pos : P.pos; this.zoneName = zoneAt(pp.x, pp.z); }
    // simulation
    const prevPos = P.pos.clone();
    if (this.phone.isOpen) { mouse.x = 0; mouse.y = 0; }
    P.update(dt);
    for (const v of this.vehicles) { v.update(dt, v.driver === 'player'); v.lod(this.camera.position); }
    collideVehicles(this.vehicles, this);
    this.traffic.update(dt);
    this.peds.update(dt);
    this.wanted.update(dt);
    this.missions.update(dt);
    this.events.update(dt);
    this.gps.update(dt);
    this.updateInteractions(dt);
    this.fx.update(dt);
    const moved = Math.hypot(P.pos.x - prevPos.x, P.pos.z - prevPos.z);
    if (moved < 20) { if (P.vehicle) this.state.stats.driven += moved; else this.state.stats.distance += moved; }
    this.state.stats.maxWanted = Math.max(this.state.stats.maxWanted, this.wanted.level);
    // music state
    const inClub = (this.city.clubs || []).some((c) => Math.abs(P.pos.x - c.x) < 22 && Math.abs(P.pos.z - c.z) < 30) && P.indoors;
    const ms = this.wanted.level > 0 ? 'wanted' : this.missions.current && this.missions.current.def.id !== 'job' ? 'mission' : inClub ? 'club' : 'explore';
    if (ms !== this.audio.musicState) this.audio.setMusicState(ms);
    this.drunkT = Math.max(0, this.drunkT - dt);
    // headlight spot for the player's car
    const v = P.vehicle;
    const hl = this.headlight;
    if (v && !v.destroyed && !v.headBroken && (v.lightsOn || (v.headlightsAuto && this.sky.night > 0.35)) && v.engineOn) {
      const f = v.forward;
      hl.position.set(v.pos.x + f.x * (v.T.len / 2), v.pos.y + 0.9, v.pos.z + f.z * (v.T.len / 2));
      hl.target.position.set(v.pos.x + f.x * 30, v.pos.y - 1, v.pos.z + f.z * 30);
      hl.intensity = 450;
    } else hl.intensity = 0;
    // tracers
    for (const t of this.tracers) if (t.t > 0) { t.t -= dt; t.l.material.opacity = Math.max(0, t.t / 0.08) * 0.9; }
    this.cam.update(dt, mouse);
    this.updateEnvironment(dt);
    this.ui.update(dt);
    this.audio.update(dt, this);
  }
  updateEnvironment(dt) {
    const focus = this.mode === 'play' ? (this.player.vehicle ? this.player.vehicle.pos : this.player.pos) : this.cam.override ? this.cam.override.look : this.camera.position;
    this.weather.update(dt, this.time.total, this.camera, this.sky.night);
    this.sky.update(dt, this.time.hour, this.weather.params, focus, this.camera, this.time.total);
    this.water.update(dt, this.time.total, this.camera, this.weather.params);
    this.city.update(dt, this.sky.night, this.time.total);
    // traffic light lamps
    const tl = this.city.tlMats, t = this.time.total;
    for (const ax of ['ns', 'ew']) {
      const st = lightState(ax, t);
      tl[ax].r.emissiveIntensity = st === 'r' ? 5 : 0.05;
      tl[ax].y.emissiveIntensity = st === 'y' ? 5 : 0.05;
      tl[ax].g.emissiveIntensity = st === 'g' ? 5 : 0.05;
    }
    if (this.mode !== 'play') this.audio.update && this.audio.ctx && this.audio.update(dt, this);
  }
  render(dt) {
    const g = this.grade.uniforms;
    g.uTime.value = this.time.total;
    g.uDrunk.value = Math.min(1, this.drunkT / 10);
    const v = this.player.vehicle;
    g.uSpeed.value = v && this.mode === 'play' ? clamp((v.speed - 25) / 40, 0, 1) : 0;
    g.uWasted.value = lerp(g.uWasted.value, this.wastedFx || 0, 0.05);
    this.bloom.strength = 0.28 + this.sky.night * 0.32;
    if (this.mode === 'title' || this.mode === 'play') this.composer.render(dt);
  }
}

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  $('load-text').textContent = 'Failed to start: ' + e.message + ' (WebGL 2 required)';
});
