// HUD: minimap (rotating, with GPS route & blips), health/armor, money, wanted
// stars, weapon, speedometer, notifications feed, help, objectives, subtitles,
// banners, speech bubbles, area names. Also renders the static map image.
import * as THREE from 'three';
import { WORLD, GX, GZ, lineHW, GRID_MIN, GRID_MAX, isLand, zoneAt, DISTRICT_NAMES, ISLAND, BRIDGE, groundHeight, WATER_Y } from '../world/layout.js';
import { formatMoney, formatTime, clamp } from '../util.js';
import { WEATHER_TYPES } from '../world/weather.js';

const $ = (id) => document.getElementById(id);
export const MAP = { x0: WORLD.x0 - 100, z0: WORLD.z0 - 80, x1: WORLD.x1 + 150, z1: WORLD.z1 + 60, s: 0.5 };

export const BLIP_STYLE = {
  safehouse: { c: '#4ade80', t: 'S', label: 'Safehouse' }, clothing: { c: '#36e2ff', t: 'C', label: 'Clothing' },
  arms: { c: '#ff4d5e', t: 'A', label: 'Gun store' }, food: { c: '#ffb347', t: 'F', label: 'Food' },
  store: { c: '#ffe04a', t: '$', label: '24/7 Store' }, customs: { c: '#b388ff', t: 'K', label: 'Coast Customs' },
  club: { c: '#ff3cac', t: '♪', label: 'Nightclub' }, garage: { c: '#4ade80', t: 'G', label: 'Garage' },
  mission: { c: '#ffd166', t: '!', label: 'Mission' }, race: { c: '#ffffff', t: 'R', label: 'Street race' },
  job: { c: '#7dd3fc', t: 'J', label: 'Delivery jobs' }, hospital: { c: '#ffffff', t: '+', label: 'Hospital' },
  police: { c: '#4d8bff', t: 'P', label: 'Police' }, target: { c: '#ffd166', t: '●', label: 'Objective' },
  waypoint: { c: '#d946ef', t: '◆', label: 'Waypoint' }, collect: { c: '#fde68a', t: '✦', label: 'Coast Token' },
  vehicle: { c: '#36e2ff', t: '▲', label: 'Vehicle' }, enemy: { c: '#ff4d5e', t: '●', label: 'Target' },
};

export function renderMapImage(G) {
  const s = MAP.s;
  const W = Math.ceil((MAP.x1 - MAP.x0) * s), H = Math.ceil((MAP.z1 - MAP.z0) * s);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const X = (x) => (x - MAP.x0) * s, Z = (z) => (z - MAP.z0) * s;
  ctx.fillStyle = '#16465f'; ctx.fillRect(0, 0, W, H);
  // land cells
  const cell = 8;
  const zoneCol = { downtown: '#2b303a', midtown: '#2e333b', beach: '#cdb98a', industrial: '#30343a', ghetto: '#302f30', suburb: '#2f3a30', island: '#36543a', bridge: '#2b303a', country: '#3a5032', airport: '#36472f', port: '#34383e' };
  for (let z = MAP.z0; z < MAP.z1; z += cell) for (let x = MAP.x0; x < MAP.x1; x += cell) {
    const h = groundHeight(x, z);
    if (h <= WATER_Y + 0.05) {
      if (h > WATER_Y - 1.5) { ctx.fillStyle = '#1f6a86'; ctx.fillRect(X(x), Z(z), cell * s + 0.5, cell * s + 0.5); }
      continue;
    }
    let zn = zoneAt(x, z);
    let col = zoneCol[zn] || '#2e333b';
    if (zn === 'country' && h > 18) col = '#4a5a38';
    if (zn === 'beach' && x < 852) col = '#2e333b';
    ctx.fillStyle = col;
    ctx.fillRect(X(x), Z(z), cell * s + 0.5, cell * s + 0.5);
  }
  // blocks (sidewalks)
  ctx.fillStyle = '#434955';
  for (let i = 0; i < GX.length - 1; i++) for (let j = 0; j < GZ.length - 1; j++) {
    const x0 = GX[i] + lineHW('x', GX[i]), x1 = GX[i + 1] - lineHW('x', GX[i + 1]);
    const z0 = GZ[j] + lineHW('z', GZ[j]), z1 = GZ[j + 1] - lineHW('z', GZ[j + 1]);
    ctx.fillRect(X(x0), Z(z0), (x1 - x0) * s, (z1 - z0) * s);
  }
  // parks
  ctx.fillStyle = '#3f6b3a';
  for (const k of ['6,7', '1,3']) {
    const [i, j] = k.split(',').map(Number);
    ctx.fillRect(X(GX[i] + 12), Z(GZ[j] + 12), (STEPW()) * s, STEPW() * s);
  }
  function STEPW() { return 96; }
  // buildings
  ctx.fillStyle = '#5b6372';
  for (const b of G.col.boxes) {
    if (b.tag !== 'building' || b.y1 - b.y0 < 2.5) continue;
    ctx.fillRect(X(b.x0), Z(b.z0), Math.max(1, (b.x1 - b.x0) * s), Math.max(1, (b.z1 - b.z0) * s));
  }
  // roads
  const road = (x0, z0, x1, z1, hw, color) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, hw * 2 * s); ctx.beginPath(); ctx.moveTo(X(x0), Z(z0)); ctx.lineTo(X(x1), Z(z1)); ctx.stroke(); };
  ctx.lineCap = 'square';
  for (const x of GX) road(x, GRID_MIN, x, GRID_MAX, lineHW('x', x), x === 0 ? '#d8c47a' : '#b8bec9');
  for (const z of GZ) road(GRID_MIN, z, GRID_MAX, z, lineHW('z', z), z === 0 ? '#e0c36a' : '#b8bec9');
  road(-2040, 0, GRID_MIN, 0, 11, '#e0c36a');
  road(-1810, 600, GRID_MIN, 600, 7, '#b8bec9');
  road(GRID_MAX, 0, BRIDGE.x1 + 30, 0, 10, '#e0c36a');
  road(-600, -1100, -600, GRID_MIN, 7, '#b8bec9');
  road(360, GRID_MAX, 360, 1200, 7, '#b8bec9');
  // island ring
  ctx.strokeStyle = '#b8bec9'; ctx.lineWidth = 12 * s;
  ctx.beginPath(); ctx.arc(X(ISLAND.x), Z(ISLAND.z), 146 * s, 0, Math.PI * 2); ctx.stroke();
  // runway
  ctx.fillStyle = '#596070'; ctx.fillRect(X(-900), Z(-1215), 1500 * s, 50 * s);
  ctx.fillStyle = '#474d5a'; ctx.fillRect(X(-580), Z(-1015), 760 * s, 150 * s);
  // labels
  ctx.font = 'bold 22px Oswald, Impact, sans-serif'; ctx.textAlign = 'center';
  const label = (t, x, z) => { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(t.toUpperCase(), X(x), Z(z)); };
  label('Downtown', 120, -200); label('Midtown', 400, 300); label('Ocean Drive', 790, -620); label('Little Haven', -600, 520);
  label('Coral Gardens', -600, -300); label('Port of Vice', 200, 1110); label('Vice Coast Intl.', -150, -1260);
  label('Starfish Island', ISLAND.x, ISLAND.z - 250); label('Everglade Flats', -1550, 320); label('Atlantic Ocean', 1450, 700);
  return c;
}

export class HUD {
  constructor(G) {
    this.G = G;
    this.mm = $('minimap'); this.mmc = this.mm.getContext('2d');
    this.rpm = $('rpm'); this.rpmc = this.rpm.getContext('2d');
    this.feedEl = $('feed');
    this.bubbles = [];
    this.helpT = 0; this.subT = 0; this.bannerT = 0; this.radioT = 0;
    this.lastMoney = null; this.moneyDeltaT = 0;
    this.areaKey = ''; this.areaT = 0;
    this.mmZoom = 1;
    this.fpsAcc = 0; this.fpsN = 0;
    this.labels = [];
    this.starSvg = (on) => `<svg viewBox="0 0 24 24" class="${on ? 'on' : ''}"><path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="${on ? '#fff' : 'rgba(255,255,255,0.14)'}" stroke="${on ? '#fff' : 'rgba(255,255,255,0.3)'}" stroke-width="1"/></svg>`;
    this.updateWanted();
  }
  setMapImage(img) { this.mapImg = img; }
  help(html, dur = 4) { const h = $('help'); h.innerHTML = html; h.classList.remove('hidden'); this.helpT = dur; }
  clearHelp() { $('help').classList.add('hidden'); this.helpT = 0; }
  notify(html, color) {
    const d = document.createElement('div');
    d.className = 'feed-item'; d.innerHTML = html;
    if (color) d.style.borderLeftColor = color;
    this.feedEl.appendChild(d);
    while (this.feedEl.children.length > 4) this.feedEl.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, 6000);
    this.G.audio.ui('notify');
  }
  subtitle(who, text, dur = 4) {
    if (!this.G.settings.subtitles) return;
    $('subtitle').innerHTML = who ? `<span class="who">${who}:</span>${text}` : text;
    this.subT = dur;
  }
  objective(html) { $('objective').innerHTML = html || ''; }
  timer(sec) {
    const t = $('timer');
    if (sec == null) { t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    t.textContent = `${m}:${String(s).padStart(2, '0')}`;
    t.style.color = sec < 15 ? '#ff4d5e' : '#fff';
  }
  banner(top, sub, dur = 4, color) {
    $('banner').classList.remove('hidden');
    const t = $('banner-top'); t.textContent = top; t.style.color = color || '';
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    $('banner-sub').textContent = sub || '';
    this.bannerT = dur;
  }
  showRadio(st) {
    $('radio').classList.remove('hidden');
    $('radio-name').textContent = st.name; $('radio-tag').textContent = st.tag;
    this.radioT = 3;
  }
  damageFlash() { $('damage').style.opacity = 1; clearTimeout(this._df); this._df = setTimeout(() => ($('damage').style.opacity = 0), 220); }
  updateWanted(flash) {
    const lvl = this.G.wanted ? this.G.wanted.level : 0;
    const w = $('wanted');
    w.innerHTML = [1, 2, 3, 4, 5].map((i) => this.starSvg(i <= lvl)).join('');
    w.classList.toggle('hidden', lvl === 0 && !this.G.wanted?.searching);
  }
  weaponChanged() {
    const G = this.G, P = G.player, st = G.state;
    $('weapon-name').textContent = P.weapon === 'pistol' ? 'Pistol' : 'Fists';
    $('weapon-ammo').textContent = P.weapon === 'pistol' ? `${st.clip} / ${st.ammo}` : '';
  }
  bubble(ped, text, dur) {
    const el = document.createElement('div'); el.className = 'bubble'; el.textContent = text;
    $('bubbles').appendChild(el);
    const old = this.bubbles.find((b) => b.ped === ped);
    if (old) { old.el.remove(); this.bubbles = this.bubbles.filter((b) => b !== old); }
    this.bubbles.push({ ped, el, t: dur });
  }
  worldLabel(text, pos) { this.labels.push({ text, pos }); }

  update(dt) {
    const G = this.G, P = G.player, st = G.state;
    // timers
    if (this.helpT > 0) { this.helpT -= dt; if (this.helpT <= 0) $('help').classList.add('hidden'); }
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) $('subtitle').innerHTML = ''; }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) $('banner').classList.add('hidden'); }
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) $('radio').classList.add('hidden'); }
    // clock / weather
    $('time').textContent = formatTime(G.time.hour);
    const wt = WEATHER_TYPES[G.weather.type];
    $('weather-ico').textContent = wt ? wt.icon : '';
    // money with delta
    if (this.lastMoney !== null && st.money !== this.lastMoney) {
      const d = st.money - this.lastMoney;
      const el = $('money-delta'); el.textContent = (d > 0 ? '+' : '-') + formatMoney(Math.abs(d)); el.className = d > 0 ? 'pos' : 'neg'; el.style.opacity = 1;
      this.moneyDeltaT = 2.5;
    }
    if (this.moneyDeltaT > 0) { this.moneyDeltaT -= dt; if (this.moneyDeltaT <= 0) $('money-delta').style.opacity = 0; }
    this.lastMoney = st.money;
    $('money').textContent = formatMoney(st.money);
    // health
    $('hp-fill').style.width = clamp(P.health / P.maxHealth, 0, 1) * 100 + '%';
    $('hp-fill').style.background = P.health < 30 ? 'linear-gradient(90deg,#ff4d5e,#ff8d98)' : '';
    $('ar-fill').style.width = clamp(P.armor / 100, 0, 1) * 100 + '%';
    // wanted flashing during search
    const W = G.wanted;
    $('wanted').classList.toggle('flash', W.level > 0 && W.searching);
    $('wanted').classList.toggle('hidden', W.level === 0);
    // crosshair
    $('crosshair').classList.toggle('hidden', !(P.aiming && !P.vehicle));
    // speedometer
    const v = P.vehicle;
    $('speedo').classList.toggle('hidden', !v);
    if (v) this.drawSpeedo(v);
    // area name
    const zone = G.zoneName;
    if (zone !== this.areaKey) {
      this.areaKey = zone;
      $('area-zone').textContent = DISTRICT_NAMES[zone] || zone;
      this.areaT = 5;
      $('area-name').style.opacity = 1;
    }
    $('area-sub').textContent = this.streetName(P.pos.x, P.pos.z);
    if (this.areaT > 0) { this.areaT -= dt; if (this.areaT <= 0) $('area-name').style.opacity = 0.55; }
    // bubbles
    const cam = G.camera;
    const w = innerWidth, h = innerHeight;
    const v3 = new THREE.Vector3();
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t -= dt;
      if (b.t <= 0 || b.ped.removeMe) { b.el.remove(); this.bubbles.splice(i, 1); continue; }
      v3.set(b.ped.pos.x, b.ped.pos.y + 2.15, b.ped.pos.z).project(cam);
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1 && cam.position.distanceTo(b.ped.pos) < 35;
      b.el.style.display = vis ? '' : 'none';
      if (vis) { b.el.style.left = ((v3.x + 1) / 2 * w) + 'px'; b.el.style.top = ((1 - v3.y) / 2 * h) + 'px'; }
    }
    // fps
    if (G.settings.showFps) {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 0.5) { $('fps').textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS · ' + G.renderer.info.render.calls + ' draws'; this.fpsAcc = 0; this.fpsN = 0; }
    }
    $('fps').classList.toggle('hidden', !G.settings.showFps);
    this.drawMinimap(dt);
  }
  streetName(x, z) {
    const names = ['Flamingo', 'Coral', 'Palmetto', 'Collins', 'Marina', 'Bayshore', 'Hibiscus', 'Sunset', 'Orchid', 'Mango', 'Pelican', 'Seagrape', 'Magnolia', 'Banyan', 'Cypress'];
    const ix = Math.round((x - GRID_MIN) / 120), iz = Math.round((z - GRID_MIN) / 120);
    const dx = Math.abs(x - (GRID_MIN + ix * 120)), dz = Math.abs(z - (GRID_MIN + iz * 120));
    if (Math.abs(z) < 14 && (x < GRID_MIN || x > GRID_MAX)) return x > 0 ? 'Starfish Causeway' : 'Everglade Expressway';
    if (x < GRID_MIN - 20 || x > GRID_MAX + 20 || z < GRID_MIN - 20 || z > GRID_MAX + 20) return '';
    if (dz < dx) return GRID_MIN + iz * 120 === 0 ? 'Vice Expressway' : `${names[iz % names.length]} Street`;
    const lx = GRID_MIN + ix * 120;
    return lx === 0 ? 'Biscayne Boulevard' : lx === GRID_MAX ? 'Ocean Drive' : `${names[(ix + 5) % names.length]} Avenue`;
  }
  drawSpeedo(v) {
    const G = this.G;
    const kmh = G.settings.units === 'kmh';
    const sp = Math.abs(v.fwdSpeed) * (kmh ? 3.6 : 2.237);
    $('spd-num').textContent = Math.round(sp);
    $('spd-unit').textContent = kmh ? 'KM/H' : 'MPH';
    $('gear').textContent = v.gear < 0 ? 'R' : v.speed < 0.3 ? 'N' : v.gear;
    $('veh-name').textContent = v.T.name;
    $('veh-hp').style.width = (v.health / v.maxHealth * 100) + '%';
    const c = this.rpmc, W = 260;
    c.clearRect(0, 0, W, W);
    const cx = W / 2, cy = W / 2, r = 108;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    c.lineCap = 'round';
    c.lineWidth = 10; c.strokeStyle = 'rgba(10,12,20,0.65)';
    c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke();
    const rpm = clamp(v.rpm, 0, 1.05);
    const grad = c.createLinearGradient(0, W, W, 0); grad.addColorStop(0, '#36e2ff'); grad.addColorStop(0.7, '#ff3cac'); grad.addColorStop(1, '#ff4d5e');
    c.strokeStyle = grad; c.lineWidth = 8;
    c.beginPath(); c.arc(cx, cy, r, a0, a0 + (a1 - a0) * rpm / 1.05); c.stroke();
    c.fillStyle = 'rgba(10,12,20,0.55)'; c.beginPath(); c.arc(cx, cy, r - 14, 0, Math.PI * 2); c.fill();
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * i / 10;
      c.strokeStyle = i >= 8 ? '#ff4d5e' : 'rgba(255,255,255,0.6)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22)); c.lineTo(cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30)); c.stroke();
    }
  }
  blips() {
    const G = this.G, out = [];
    for (const s of G.city.shops) {
      const st = BLIP_STYLE[s.kind === 'save' ? 'safehouse' : s.kind];
      if (!st || s.kind === 'fuel') continue;
      out.push({ x: s.x, z: s.z, style: st, small: true, kind: s.kind });
    }
    out.push({ x: G.city.hospitalPos.x, z: G.city.hospitalPos.z, style: BLIP_STYLE.hospital, small: true });
    out.push({ x: G.city.policePos.x, z: G.city.policePos.z, style: BLIP_STYLE.police, small: true });
    for (const b of G.missions.blips()) out.push(b);
    for (const e of G.events.active) if (e.blip && e.blip.mugger && !e.blip.dead) out.push({ x: e.blip.pos.x, z: e.blip.pos.z, style: BLIP_STYLE.enemy, label: 'Mugger' });
    return out;
  }
  drawMinimap(dt) {
    const G = this.G, P = G.player, ctx = this.mmc, S = 420;
    if (!this.mapImg) return;
    const pp = P.vehicle ? P.vehicle.pos : P.pos;
    const speed = P.vehicle ? P.vehicle.speed : 0;
    const zoomT = P.vehicle ? clamp(1.5 - speed / 60, 0.7, 1.5) : 2.2;
    this.mmZoom += (zoomT - this.mmZoom) * (1 - Math.exp(-dt * 2));
    const z = this.mmZoom; // px per map px
    const yaw = G.cam.yaw;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#16465f'; ctx.fillRect(0, 0, S, S);
    ctx.translate(S / 2, S / 2 + 40);
    ctx.rotate(yaw);
    ctx.scale(z, z);
    const mx = (pp.x - MAP.x0) * MAP.s, mz = (pp.z - MAP.z0) * MAP.s;
    ctx.translate(-mx, -mz);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapImg, 0, 0);
    // wanted search radius
    const W = G.wanted;
    if (W.level > 0) {
      ctx.fillStyle = W.searching ? 'rgba(255,60,90,0.16)' : 'rgba(255,60,90,0.08)';
      ctx.strokeStyle = 'rgba(255,90,110,0.6)'; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc((W.lastSeen.x - MAP.x0) * MAP.s, (W.lastSeen.z - MAP.z0) * MAP.s, W.radius * MAP.s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // GPS route
    const route = G.gps.route;
    if (route && route.length > 1) {
      ctx.strokeStyle = G.gps.color || '#d946ef'; ctx.lineWidth = 6 / z * 1.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      route.forEach((p, i) => { const x = (p.x - MAP.x0) * MAP.s, y = (p.z - MAP.z0) * MAP.s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.restore();
    // blips (screen space, clamped to edge)
    const toScreen = (x, zz) => {
      const dx = (x - pp.x) * MAP.s * z, dz = (zz - pp.z) * MAP.s * z;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return { x: dx * c - dz * s, y: dx * s + dz * c + 40 };
    };
    const R0 = S / 2 - 16;
    const drawBlip = (b) => {
      let p = toScreen(b.x, b.z);
      const d = Math.hypot(p.x, p.y);
      const edge = d > R0;
      if (edge) { if (b.small) return; p = { x: p.x / d * R0, y: p.y / d * R0 }; }
      const r = b.small ? 11 : 14;
      ctx.beginPath(); ctx.arc(S / 2 + p.x, S / 2 + p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = b.style.c; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#0b0d14'; ctx.stroke();
      ctx.fillStyle = '#0b0d14'; ctx.font = `bold ${b.small ? 13 : 16}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.style.t, S / 2 + p.x, S / 2 + p.y + 1);
    };
    for (const b of this.blips()) drawBlip(b);
    // police & enemies
    for (const v of G.traffic.cars) if (v.pursuer || (v.isCop && G.wanted.level > 0)) {
      const p = toScreen(v.pos.x, v.pos.z);
      if (Math.hypot(p.x, p.y) > R0) continue;
      const flash = Math.floor(G.time.total * 4) % 2;
      ctx.fillStyle = flash ? '#ff3b4f' : '#3b6bff';
      ctx.beginPath(); ctx.arc(S / 2 + p.x, S / 2 + p.y, 8, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of G.peds.list) if (p.isCop && p.state === 'attack' && !p.dead) {
      const q = toScreen(p.pos.x, p.pos.z);
      if (Math.hypot(q.x, q.y) > R0) continue;
      ctx.fillStyle = '#ff3b4f'; ctx.beginPath(); ctx.arc(S / 2 + q.x, S / 2 + q.y, 5, 0, Math.PI * 2); ctx.fill();
    }
    if (G.wanted.heli.alive) { const q = toScreen(G.wanted.heli.pos.x, G.wanted.heli.pos.z); if (Math.hypot(q.x, q.y) < R0) { ctx.fillStyle = '#ff3b4f'; ctx.font = 'bold 20px Inter'; ctx.fillText('✚', S / 2 + q.x, S / 2 + q.y); } }
    // north indicator
    const nx = S / 2 + Math.sin(yaw) * (R0 - 2), ny = S / 2 - Math.cos(yaw) * (R0 - 2);
    ctx.fillStyle = '#0b0d14'; ctx.beginPath(); ctx.arc(nx, ny, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 1);
    // player arrow
    const h = P.vehicle ? P.vehicle.heading : P.yaw;
    const fx = Math.sin(h), fz = Math.cos(h);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ax = fx * c - fz * s, ay = fx * s + fz * c;
    const ang = Math.atan2(ay, ax);
    ctx.save(); ctx.translate(S / 2, S / 2 + 40); ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0b0d14'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(10, 11); ctx.lineTo(0, 5); ctx.lineTo(-10, 11); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }
}
