// All overlay menus: pause (map, missions, stats, settings, save/load, controls),
// shops, clothing store with live preview, Coast Customs, garage, safehouse,
// inventory and confirm dialogs.
import * as THREE from 'three';
import { BINDINGS, BINDING_LABELS } from '../input.js';
import { formatMoney, formatTime, clamp } from '../util.js';
import { MAP, BLIP_STYLE } from './hud.js';
import { saveGame, loadGame, slotInfo, deleteSlot, saveSettings } from '../gameplay/state.js';
import { VTYPES, BUYABLE } from '../entities/vehicle.js';
import { SKIN_TONES, HAIR_COLORS } from '../entities/human.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const keyName = (k) => k.replace('Key', '').replace('Digit', '').replace('Mouse0', 'LMB').replace('Mouse2', 'RMB').replace('ShiftLeft', 'Shift').replace('ShiftRight', 'R-Shift').replace('ControlLeft', 'Ctrl').replace('Arrow', '↑↓←→'.includes('x') ? '' : 'Arrow ');

export const SHOP_ITEMS = {
  store: [
    { id: 'snack', name: 'Sunny Chips', desc: 'Restores 25 health when eaten from the inventory.', price: 5, give: (G) => G.state.inventory.snacks++ },
    { id: 'medkit', name: 'First Aid Kit', desc: 'Restores full health. Use from the inventory.', price: 60, give: (G) => G.state.inventory.medkit++ },
    { id: 'repair', name: 'Repair Kit', desc: 'Partially repairs your current vehicle.', price: 120, give: (G) => G.state.inventory.repairKit++ },
    { id: 'soda', name: 'Sunny Cola', desc: 'Drink now: +15 health and full stamina.', price: 3, give: (G) => { G.player.health = Math.min(100, G.player.health + 15); G.player.stamina = 1; } },
  ],
  arms: [
    { id: 'pistol', name: '9mm Pistol', desc: 'Semi-automatic sidearm. Includes 24 rounds.', price: 500, once: (G) => G.state.inventory.pistol, give: (G) => { G.state.inventory.pistol = true; G.state.ammo += 12; G.state.clip = 12; G.player.setWeapon('pistol'); } },
    { id: 'ammo', name: 'Pistol Ammo ×24', desc: 'Two magazines of 9mm rounds.', price: 60, need: (G) => G.state.inventory.pistol, give: (G) => { G.state.ammo += 24; } },
    { id: 'armor', name: 'Body Armor', desc: 'Absorbs 70% of incoming damage. 100 armor.', price: 250, give: (G) => { G.player.armor = 100; } },
  ],
  food: [
    { id: 'meal', name: 'House Special', desc: 'A big meal. Restores full health.', price: 15, give: (G) => { G.player.health = 100; } },
    { id: 'coffee', name: 'Cuban Coffee', desc: 'Restores stamina and +10 health.', price: 4, give: (G) => { G.player.stamina = 1; G.player.health = Math.min(100, G.player.health + 10); } },
    { id: 'togo', name: 'Meal To-Go', desc: 'Adds a snack to your inventory.', price: 8, give: (G) => G.state.inventory.snacks++ },
  ],
  club: [
    { id: 'drink', name: 'Neon Martini', desc: 'The world gets a little wobbly…', price: 12, give: (G) => { G.drunkT = 30; } },
    { id: 'vip', name: 'VIP Table', desc: 'Dance the night away (skip 2 hours).', price: 150, give: (G) => { G.time.hour = (G.time.hour + 2) % 24; G.ui.notify('You partied for two hours.'); } },
  ],
};

const CLOTHES = {
  shirt: { label: 'Shirts', price: 80, colors: [0xf2f2f2, 0x111111, 0xff3cac, 0x36e2ff, 0xffd166, 0x2ec4b6, 0xd62828, 0x6a4c93, 0xf4a261, 0x8ecae6, 0x95d5b2, 0xffafcc] },
  pants: { label: 'Pants', price: 70, colors: [0x1f2a44, 0x111111, 0xe8e8e8, 0xc2b280, 0x6b4f3a, 0x37474f, 0x3f6fa8, 0x9d0208] },
  shoes: { label: 'Shoes', price: 60, colors: [0xffffff, 0x111111, 0xc0392b, 0x5a3b22, 0x36e2ff, 0xffd166] },
  sleeves: { label: 'Sleeves', price: 30, options: ['short', 'long'] },
  hat: { label: 'Hats', price: 50, options: ['none', 'cap', 'fedora', 'beanie'] },
  glasses: { label: 'Glasses', price: 40, options: ['off', 'on'] },
  hair: { label: 'Hair (barber)', price: 25, options: ['short', 'buzz', 'long', 'bald', 'curly', 'ponytail'] },
  hairColor: { label: 'Hair color', price: 20, colors: HAIR_COLORS },
};
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class Menus {
  constructor(G) {
    this.G = G;
    this.el = $('overlay');
    this.open = null;
    this.mapView = { cx: 0, cz: 0, zoom: 1 };
    this.pauseTab = 'map';
  }
  get isOpen() { return !!this.open; }
  show(html, name) {
    this.el.innerHTML = html;
    this.el.classList.remove('hidden');
    this.el.classList.toggle('clear', name === 'clothing');
    if (!this.open) this.openedAt = performance.now();
    this.open = name;
    this.G.input.releaseLock();
  }
  close() {
    const G = this.G;
    if (this.open === 'clothing') { G.cam.override = null; G.player.setLook(G.state.look); }
    this.el.classList.add('hidden');
    this.el.classList.remove('clear');
    this.el.style.justifyContent = '';
    this.el.innerHTML = '';
    this.open = null;
    if (G.mode === 'play') { G.paused = false; G.input.wantLock = true; G.input.requestLock(); }
    G.audio.ui('back');
    this.onClose && this.onClose(); this.onClose = null;
  }
  bind(sel, ev, fn) { this.el.querySelectorAll(sel).forEach((n) => n.addEventListener(ev, (e) => fn(e, n))); }
  head(title, sub, extra = '') {
    return `<div class="panel-head"><h2>${title}</h2><div class="sub">${sub || ''}</div><div class="spacer"></div>${extra}<div class="money">${formatMoney(this.G.state.money)}</div><button class="pbtn" data-close>✕</button></div>`;
  }

  // ---------- Pause ----------
  openPause(tab) {
    const G = this.G;
    G.paused = true;
    this.pauseTab = tab || this.pauseTab;
    const tabs = [['map', 'Map'], ['missions', 'Missions'], ['stats', 'Stats'], ['settings', 'Settings'], ['save', 'Save / Load'], ['controls', 'Controls']];
    const html = `<div class="panel">
      <div class="panel-head"><h2>Paused</h2><div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === this.pauseTab ? 'on' : ''}">${l}</button>`).join('')}</div><div class="spacer"></div>
      <div class="money">${formatMoney(G.state.money)}</div></div>
      <div class="panel-body" id="pause-body"></div>
      <div class="panel-foot"><span style="flex:1">Day ${G.state.day} · ${formatTime(G.time.hour)} · ${esc(document.getElementById('area-zone').textContent)}</span><button class="pbtn danger" data-act="quit">Quit to title</button><button class="pbtn primary" data-act="resume">Resume</button></div></div>`;
    this.show(html, 'pause');
    this.bind('[data-tab]', 'click', (e, n) => { this.pauseTab = n.dataset.tab; G.audio.ui('click'); this.openPause(); });
    this.bind('[data-act=resume]', 'click', () => this.close());
    this.bind('[data-act=quit]', 'click', () => this.confirm('Quit to title?', 'Unsaved progress since your last save will be lost.', () => G.quitToTitle()));
    const body = $('pause-body');
    ({ map: () => this.renderMap(body), missions: () => this.renderMissions(body), stats: () => this.renderStats(body), settings: () => this.renderSettings(body), save: () => this.renderSave(body, true), controls: () => this.renderControls(body) })[this.pauseTab]();
  }
  openMap() { this.openPause('map'); }

  renderMap(body) {
    const G = this.G;
    const P = G.player, pp = P.vehicle ? P.vehicle.pos : P.pos;
    if (!this.mapView.init) { this.mapView = { cx: pp.x, cz: pp.z, zoom: 0.9, init: true }; }
    else { this.mapView.cx = pp.x; this.mapView.cz = pp.z; }
    body.innerHTML = `<div class="map-wrap" id="map-wrap"><canvas id="bigmap"></canvas>
      <div class="map-legend">${['safehouse', 'mission', 'race', 'job', 'clothing', 'arms', 'food', 'store', 'customs', 'club', 'hospital', 'police', 'waypoint'].map((k) => `<span class="dot" style="background:${BLIP_STYLE[k].c}">${BLIP_STYLE[k].t}</span><span>${BLIP_STYLE[k].label}</span>`).join('')}</div>
      <div class="map-hint">Drag to pan · Scroll to zoom · Click to set a GPS waypoint · Right-click to clear</div></div>`;
    const cv = $('bigmap'), wrap = $('map-wrap');
    const draw = () => {
      const r = wrap.getBoundingClientRect();
      cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio;
      const ctx = cv.getContext('2d');
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      const v = this.mapView, s = MAP.s * v.zoom;
      ctx.fillStyle = '#16465f'; ctx.fillRect(0, 0, r.width, r.height);
      const ox = r.width / 2 - (v.cx - MAP.x0) * s, oz = r.height / 2 - (v.cz - MAP.z0) * s;
      ctx.drawImage(G.ui.hud.mapImg, ox, oz, G.ui.hud.mapImg.width * v.zoom, G.ui.hud.mapImg.height * v.zoom);
      const toS = (x, z) => [ox + (x - MAP.x0) * s, oz + (z - MAP.z0) * s];
      if (G.gps.route) {
        ctx.strokeStyle = G.gps.color; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath();
        G.gps.route.forEach((p, i) => { const [x, y] = toS(p.x, p.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      }
      for (const b of G.ui.hud.blips()) {
        const [x, y] = toS(b.x, b.z);
        ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fillStyle = b.style.c; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#0b0d14'; ctx.stroke();
        ctx.fillStyle = '#0b0d14'; ctx.font = 'bold 11px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.style.t, x, y + 1);
        if (b.label && v.zoom > 0.7) { ctx.fillStyle = '#fff'; ctx.font = '600 11px Inter'; ctx.fillText(b.label, x, y - 16); }
      }
      // player
      const [px, py] = toS(pp.x, pp.z);
      const h = P.vehicle ? P.vehicle.heading : P.yaw;
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(Math.cos(h), Math.sin(h)) + Math.PI / 2);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
    };
    draw();
    let drag = null, moved = false;
    cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.mapView.cx, cz: this.mapView.cz }; moved = false; });
    window.addEventListener('mousemove', this._mm = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      this.mapView.cx = drag.cx - dx / (MAP.s * this.mapView.zoom); this.mapView.cz = drag.cz - dy / (MAP.s * this.mapView.zoom);
      draw();
    });
    window.addEventListener('mouseup', this._mu = (e) => {
      if (drag && !moved && e.button === 0 && e.target === cv) {
        const r = cv.getBoundingClientRect(), s = MAP.s * this.mapView.zoom;
        const x = this.mapView.cx + (e.clientX - r.left - r.width / 2) / s, z = this.mapView.cz + (e.clientY - r.top - r.height / 2) / s;
        G.gps.setWaypoint(x, z); draw();
      }
      drag = null;
    }, { once: false });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); G.gps.clearWaypoint(); draw(); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.mapView.zoom = clamp(this.mapView.zoom * (e.deltaY < 0 ? 1.15 : 0.87), 0.3, 4); draw(); }, { passive: false });
    this.onClose = () => { window.removeEventListener('mousemove', this._mm); window.removeEventListener('mouseup', this._mu); };
  }
  renderMissions(body) {
    const G = this.G, M = G.missions;
    const done = G.state.missions.done;
    const rows = M.defs.map((d) => {
      const st = M.current && M.current.def.id === d.id ? 'active' : done.includes(d.id) ? 'done' : M.available(d) ? 'avail' : 'locked';
      const label = { active: 'IN PROGRESS', done: 'COMPLETE', avail: 'AVAILABLE', locked: 'LOCKED' }[st];
      return `<div class="mission-row"><div class="st ${st}">${label}</div><div style="flex:1"><b>${d.title}</b><div class="sub" style="color:var(--muted);font-size:13px">${d.desc}</div></div><div class="price" style="font-family:var(--display);color:#7dffa1">${formatMoney(d.reward)}</div></div>`;
    }).join('');
    const side = `<div class="section" style="margin-top:20px"><h3>Side activities</h3>
      <div class="mission-row"><div class="st avail">RACES</div><div style="flex:1">Street races: <b>Ocean Drive Sprint</b> &amp; <b>Everglade Run</b>. Look for <b>R</b> on the map.</div><div>${G.state.stats.races} won/finished</div></div>
      <div class="mission-row"><div class="st avail">JOBS</div><div style="flex:1">Delivery jobs at the Port (<b>J</b>) or from the phone's Jobs app.</div><div>${G.state.stats.jobs} taken</div></div>
      <div class="mission-row"><div class="st avail">TOKENS</div><div style="flex:1">Coast Tokens hidden around the map: lifeguard towers, alleys, airport, port, countryside farms, island…</div><div>${G.state.collected.length}/${G.missions.tokens.length}</div></div>
      <div class="mission-row"><div class="st avail">CRIME</div><div style="flex:1">Rob a store by aiming a pistol at the clerk. Expect a 3-star response.</div><div>${G.state.stats.robberies} robberies</div></div></div>`;
    const cur = M.current ? `<div style="margin-bottom:14px" class="rowflex"><span>Current: <b>${M.current.def.title}</b></span><button class="pbtn danger" id="abort">Abort mission</button></div>` : '';
    body.innerHTML = cur + rows + side;
    const ab = $('abort'); if (ab) ab.onclick = () => { M.abort(); this.close(); };
  }
  renderStats(body) {
    const G = this.G, s = G.state.stats;
    const t = Math.floor(s.playTime);
    const items = [['Play time', `${Math.floor(t / 3600)}h ${Math.floor(t / 60) % 60}m`], ['Money', formatMoney(G.state.money)], ['Missions passed', s.missions], ['Distance on foot', (s.distance / 1000).toFixed(1) + ' km'],
      ['Distance driven', (s.driven / 1000).toFixed(1) + ' km'], ['Coast Tokens', `${G.state.collected.length}/${G.missions.tokens.length}`], ['Max wanted level', '★'.repeat(s.maxWanted) || '—'], ['Crimes committed', s.crimes],
      ['People knocked out', s.kills], ['Races', s.races], ['Jobs', s.jobs], ['Robberies', s.robberies], ['Times flatlined', s.deaths], ['Times arrested', s.busted], ['Vehicles in garage', G.state.garage.length + '/4'], ['Day', G.state.day]];
    body.innerHTML = `<div class="stat-grid">${items.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>`;
  }
  renderSettings(body) {
    const G = this.G, S = G.settings;
    const row = (label, input) => `<label>${label}</label><div class="rowflex">${input}</div>`;
    const range = (k, min, max, step, fmt = (v) => v) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}"><span class="val" data-v="${k}">${fmt(S[k])}</span>`;
    const sel = (k, opts) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(S[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const chk = (k) => `<input type="checkbox" data-k="${k}" ${S[k] ? 'checked' : ''}>`;
    body.innerHTML = `<div class="section"><h3>Graphics</h3><div class="settings-grid">
      ${row('Quality preset', sel('quality', [[0, 'Low'], [1, 'Medium'], [2, 'High'], [3, 'Ultra']]))}
      ${row('Bloom / glow', chk('bloom'))}
      ${row('Field of view', range('fov', 50, 90, 1))}
      ${row('Show FPS', chk('showFps'))}
      </div></div>
      <div class="section"><h3>Audio</h3><div class="settings-grid">
      ${row('Master volume', range('master', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'))}
      ${row('Music volume', range('music', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'))}
      ${row('Effects volume', range('sfx', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'))}
      ${row('NPC voices (speech synthesis)', chk('voices'))}
      ${row('Subtitles', chk('subtitles'))}
      </div></div>
      <div class="section"><h3>Gameplay</h3><div class="settings-grid">
      ${row('Mouse sensitivity', range('sensitivity', 0.2, 3, 0.1))}
      ${row('Invert Y axis', chk('invertY'))}
      ${row('Traffic density', range('traffic', 0, 2, 0.1))}
      ${row('Pedestrian density', range('peds', 0, 2, 0.1))}
      ${row('Day length (real minutes)', range('dayLength', 6, 96, 2))}
      ${row('Speed units', sel('units', [['kmh', 'km/h'], ['mph', 'mph']]))}
      </div></div>`;
    body.querySelectorAll('[data-k]').forEach((n) => {
      const k = n.dataset.k;
      const apply = () => {
        let v = n.type === 'checkbox' ? n.checked : n.type === 'range' ? parseFloat(n.value) : n.value;
        if (k === 'quality') v = parseInt(v);
        S[k] = v;
        const lab = body.querySelector(`[data-v="${k}"]`);
        if (lab) lab.textContent = ['master', 'music', 'sfx'].includes(k) ? Math.round(v * 100) + '%' : v;
        G.applySettings();
        saveSettings(S);
      };
      n.addEventListener('input', apply); n.addEventListener('change', apply);
    });
  }
  renderSave(body, allowSave) {
    const G = this.G;
    const canSave = allowSave && G.canSaveAnywhere();
    const slots = ['auto', 1, 2, 3].map((s) => {
      const i = slotInfo(s);
      const meta = i ? `${new Date(i.savedAt).toLocaleString()} · ${formatMoney(i.money)} · ${i.missions} missions · ${i.collected} tokens` : 'Empty slot';
      return `<div class="slot"><div><b>${s === 'auto' ? 'Autosave' : 'Slot ' + s}</b><div class="meta">${meta}</div></div><div class="rowflex">
        ${s !== 'auto' && allowSave ? `<button class="pbtn" data-save="${s}" ${canSave ? '' : 'disabled'}>Save</button>` : ''}
        <button class="pbtn primary" data-load="${s}" ${i ? '' : 'disabled'}>Load</button>
        ${i && s !== 'auto' ? `<button class="pbtn danger" data-del="${s}">Delete</button>` : ''}</div></div>`;
    }).join('');
    body.innerHTML = (allowSave && !canSave ? `<p style="color:var(--gold)">You can't save during a mission or while wanted by the police.</p>` : '') + slots;
    body.querySelectorAll('[data-save]').forEach((n) => n.onclick = () => { const slot = +n.dataset.save; G.syncState(); if (saveGame(slot, G.state)) { G.ui.notify(`Game saved to slot ${slot}.`); G.audio.ui('success'); } this.renderSave(body, allowSave); });
    body.querySelectorAll('[data-load]').forEach((n) => n.onclick = () => { const slot = n.dataset.load === 'auto' ? 'auto' : +n.dataset.load; const st = loadGame(slot); if (st) { this.close(); G.startGame(st); } });
    body.querySelectorAll('[data-del]').forEach((n) => n.onclick = () => this.confirm('Delete save?', 'This cannot be undone.', () => { deleteSlot(+n.dataset.del); }, () => this.renderSave(body, allowSave)));
  }
  renderControls(body) {
    const groups = [['On foot', ['forward', 'back', 'left', 'right', 'sprint', 'walk', 'jump', 'crouch', 'enter', 'interact', 'attack', 'aim', 'reload', 'weapon1', 'weapon2', 'weaponNext']], ['Driving', ['forward', 'back', 'left', 'right', 'jump', 'enter', 'headlights', 'horn', 'camera', 'crouch', 'reload', 'lookBack']], ['Interface', ['map', 'phone', 'inventory', 'pause']]];
    const drivingLabel = { forward: 'Accelerate', back: 'Brake / reverse', left: 'Steer left', right: 'Steer right', jump: 'Handbrake', crouch: 'Cinematic camera', reload: 'Next radio station', horn: 'Horn (siren in emergency vehicles)' };
    body.innerHTML = groups.map(([g, acts]) => `<div class="section"><h3>${g}</h3><table class="controls-table">${acts.map((a) => `<tr><td>${g === 'Driving' && drivingLabel[a] ? drivingLabel[a] : BINDING_LABELS[a]}</td><td>${BINDINGS[a].map((k) => `<kbd>${keyName(k)}</kbd>`).join(' ')}</td></tr>`).join('')}</table></div>`).join('') +
      `<div class="section"><h3>Other</h3><table class="controls-table"><tr><td>Camera look / zoom</td><td><kbd>Mouse</kbd> <kbd>Wheel</kbd></td></tr><tr><td>Gamepad</td><td>Left stick move · Right stick look · RT/LT throttle/brake · A jump/handbrake · Y enter vehicle · X interact</td></tr></table></div>`;
  }
  openStandalone(kind) {
    const G = this.G;
    const titles = { settings: 'Settings', controls: 'Controls', load: 'Load game' };
    this.show(`<div class="panel"><div class="panel-head"><h2>${titles[kind]}</h2><div class="spacer"></div><button class="pbtn" data-close>✕</button></div><div class="panel-body" id="sa-body"></div></div>`, kind);
    this.bind('[data-close]', 'click', () => this.close());
    const b = $('sa-body');
    if (kind === 'settings') this.renderSettings(b);
    else if (kind === 'controls') this.renderControls(b);
    else this.renderSave(b, false);
  }
  confirm(title, text, yes, after) {
    const prev = this.el.innerHTML, prevName = this.open;
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:60;background:#0008';
    box.innerHTML = `<div class="panel small"><div class="panel-head"><h2>${title}</h2></div><div class="panel-body">${text}</div><div class="panel-foot"><button class="pbtn" data-no>Cancel</button><button class="pbtn primary" data-yes>Confirm</button></div></div>`;
    document.body.appendChild(box);
    box.querySelector('[data-no]').onclick = () => { box.remove(); after && after(); };
    box.querySelector('[data-yes]').onclick = () => { box.remove(); yes(); after && after(); };
  }

  // ---------- Shops ----------
  openShop(shop) {
    const G = this.G;
    const k = shop.kind;
    if (k === 'clothing') return this.openClothing(shop);
    if (k === 'customs') return this.openCustoms(shop);
    if (k === 'garage') return this.openGarage(shop);
    if (k === 'save') return this.openSafehouse(shop);
    const items = SHOP_ITEMS[k] || [];
    G.paused = true;
    const render = () => {
      const cards = items.map((it) => {
        const owned = it.once && it.once(G);
        const locked = it.need && !it.need(G);
        const afford = G.state.money >= it.price;
        return `<div class="card ${owned || locked || !afford ? 'disabled' : ''}" data-buy="${it.id}"><h4>${it.name}</h4><div class="desc">${it.desc}</div><div class="price">${owned ? 'OWNED' : locked ? 'Requires pistol' : formatMoney(it.price)}</div></div>`;
      }).join('');
      const rob = shop.robbable && G.state.inventory.pistol ? `<div class="panel-foot" style="justify-content:flex-start">Tip: aim your pistol at the clerk (outside this menu) to rob the register.</div>` : '';
      this.show(`<div class="panel small">${this.head(esc(shop.name), 'Click an item to buy')}<div class="panel-body"><div class="grid">${cards}</div></div>${rob}</div>`, 'shop');
      this.bind('[data-close]', 'click', () => this.close());
      this.bind('[data-buy]', 'click', (e, n) => {
        const it = items.find((i) => i.id === n.dataset.buy);
        if ((it.once && it.once(G)) || (it.need && !it.need(G))) return G.audio.ui('error');
        if (!G.spend(it.price)) return G.audio.ui('error');
        it.give(G); G.audio.ui('cash'); G.ui.weaponChanged();
        G.ui.notify(`Purchased <b>${it.name}</b>`);
        render();
      });
    };
    render();
  }
  openClothing(shop) {
    const G = this.G, P = G.player;
    G.paused = true;
    const look = { ...G.state.look };
    this.previewLook = look;
    const owned = new Set(G.state.ownedClothes);
    const keyOf = (cat, v) => `${cat}_${typeof v === 'number' ? v.toString(16) : v}`;
    // orbit preview camera
    const camAng = { a: 0 };
    const updateCam = () => {
      const p = P.pos;
      const a = P.yaw + 0.4 + camAng.a;
      G.cam.override = { pos: new THREE.Vector3(p.x + Math.sin(a) * 2.6, p.y + 1.4, p.z + Math.cos(a) * 2.6), look: new THREE.Vector3(p.x, p.y + 1.0, p.z), fov: 45 };
    };
    updateCam();
    const valueOf = (cat) => cat === 'glasses' ? (look.glasses ? 'on' : 'off') : cat === 'hair' ? look.hairStyle : cat === 'hairColor' ? look.hair : look[cat];
    const setVal = (cat, v) => {
      if (cat === 'glasses') look.glasses = v === 'on';
      else if (cat === 'hair') look.hairStyle = v;
      else if (cat === 'hairColor') look.hair = v;
      else look[cat] = v;
    };
    const cost = () => {
      let c = 0;
      for (const cat in CLOTHES) {
        const v = valueOf(cat), cur = cat === 'glasses' ? (G.state.look.glasses ? 'on' : 'off') : cat === 'hair' ? G.state.look.hairStyle : cat === 'hairColor' ? G.state.look.hair : G.state.look[cat];
        if (v !== cur && !owned.has(keyOf(cat, v))) c += CLOTHES[cat].price;
      }
      return c;
    };
    const render = () => {
      const secs = Object.entries(CLOTHES).map(([cat, d]) => {
        const v = valueOf(cat);
        const inner = d.colors ? `<div class="swatches">${d.colors.map((c) => `<div class="sw ${c === v ? 'sel' : ''}" data-cat="${cat}" data-val="${c}" style="background:${hex(c)}">${owned.has(keyOf(cat, c)) ? '' : `<span class="lock">$${d.price}</span>`}</div>`).join('')}</div>`
          : `<div class="opt-row">${d.options.map((o) => `<div class="chip ${o === v ? 'sel' : ''}" data-cat="${cat}" data-val="${o}">${o}${owned.has(keyOf(cat, o)) ? '' : ` · $${d.price}`}</div>`).join('')}</div>`;
        return `<div class="section"><h3>${d.label}</h3>${inner}</div>`;
      }).join('');
      const c = cost();
      this.show(`<div class="panel" style="width:min(520px,94vw);margin-left:auto;margin-right:4vw;max-height:92vh">${this.head(esc(shop.name), 'Live preview')}<div class="panel-body">${secs}
        <div class="section"><h3>Skin tone (free)</h3><div class="swatches">${SKIN_TONES.map((s) => `<div class="sw ${s === look.skin ? 'sel' : ''}" data-skin="${s}" style="background:${hex(s)}"></div>`).join('')}</div></div></div>
        <div class="panel-foot"><button class="pbtn" data-rot="-1">⟲</button><button class="pbtn" data-rot="1">⟳</button><span style="flex:1"></span><button class="pbtn" data-reset>Reset</button><button class="pbtn primary" data-buy ${c > G.state.money ? 'disabled' : ''}>${c ? 'Buy & wear · ' + formatMoney(c) : 'Wear'}</button></div></div>`, 'clothing');
      this.el.style.justifyContent = 'flex-end';
      this.bind('[data-close]', 'click', () => { this.el.style.justifyContent = ''; this.close(); });
      this.bind('[data-cat]', 'click', (e, n) => {
        const cat = n.dataset.cat; const d = CLOTHES[cat];
        const val = d.colors ? parseInt(n.dataset.val) : n.dataset.val;
        if (shop.kind === 'wardrobe' && !owned.has(keyOf(cat, val))) { G.ui.help('You don\'t own that yet — buy it at Threads.'); return G.audio.ui('error'); }
        setVal(cat, val); P.setLook({ ...look }); G.audio.ui('click'); render(); });
      this.bind('[data-skin]', 'click', (e, n) => { look.skin = parseInt(n.dataset.skin); P.setLook({ ...look }); render(); });
      this.bind('[data-rot]', 'click', (e, n) => { camAng.a += 0.8 * +n.dataset.rot; updateCam(); });
      this.bind('[data-reset]', 'click', () => { Object.assign(look, G.state.look); P.setLook({ ...look }); render(); });
      this.bind('[data-buy]', 'click', () => {
        const c2 = cost();
        if (c2 && !G.spend(c2)) return G.audio.ui('error');
        for (const cat in CLOTHES) owned.add(keyOf(cat, valueOf(cat)));
        G.state.ownedClothes = [...owned];
        G.state.look = { ...look };
        G.state.flags.boughtClothes = G.state.flags.boughtClothes || c2 > 0 || shop.kind === 'clothing';
        G.audio.ui('cash');
        G.ui.notify(c2 ? `New outfit purchased (${formatMoney(c2)})` : 'Outfit changed.');
        this.el.style.justifyContent = '';
        this.close();
      });
    };
    render();
  }
  openCustoms(shop) {
    const G = this.G, P = G.player, v = P.vehicle;
    if (!v) { G.ui.help('Drive a vehicle into Coast Customs to modify it.'); return; }
    G.paused = true;
    const colors = [0xd62828, 0x00a6fb, 0xffd60a, 0x111111, 0xf5f5f5, 0xff5d8f, 0x2ec4b6, 0xff6b00, 0x8338ec, 0x06d6a0, 0x3a86ff, 0x6c757d, 0x7b2d26, 0x1b4f72];
    const up = v.upgrades;
    const upPrices = [2000, 5000, 10000];
    const render = () => {
      const repairCost = Math.round((1 - v.health / v.maxHealth) * 400) + (v.uniqueGeo ? 100 : 0);
      const wantedFee = G.wanted.level ? 250 * G.wanted.level : 0;
      const upCard = (k, label, desc) => {
        const lvl = up[k] || 0;
        return `<div class="card ${lvl >= 3 ? 'disabled' : ''}" data-up="${k}"><h4>${label} ${'▮'.repeat(lvl)}${'▯'.repeat(3 - lvl)}</h4><div class="desc">${desc}</div><div class="price">${lvl >= 3 ? 'MAXED' : formatMoney(upPrices[lvl])}</div></div>`;
      };
      this.show(`<div class="panel">${this.head('Coast Customs', `${v.T.name} · Health ${Math.round(v.health / 10)}%`)}<div class="panel-body">
        <div class="section"><h3>Service</h3><div class="grid">
          <div class="card ${repairCost === 0 ? 'disabled' : ''}" data-act="repair"><h4>Repair & Panel beat</h4><div class="desc">Fix all damage and dents.</div><div class="price">${repairCost ? formatMoney(repairCost) : 'NOT NEEDED'}</div></div>
          ${wantedFee ? `<div class="card" data-act="spray"><h4>Quick respray — lose the heat</h4><div class="desc">New paint & plates. Clears your wanted level.</div><div class="price">${formatMoney(wantedFee)}</div></div>` : ''}
        </div></div>
        <div class="section"><h3>Respray · $350</h3><div class="swatches">${colors.map((c) => `<div class="sw ${c === v.color ? 'sel' : ''}" data-col="${c}" style="background:${hex(c)}"></div>`).join('')}</div></div>
        <div class="section"><h3>Performance</h3><div class="grid">${upCard('engine', 'Engine', '+top speed and acceleration.')}${upCard('brakes', 'Brakes', 'Stronger braking.')}${upCard('armor', 'Armor', 'Reduces collision damage.')}</div></div>
      </div></div>`, 'customs');
      this.bind('[data-close]', 'click', () => this.close());
      this.bind('[data-act=repair]', 'click', () => { if (!repairCost || !G.spend(repairCost)) return G.audio.ui('error'); v.repair(); G.audio.ui('cash'); render(); });
      this.bind('[data-act=spray]', 'click', () => { if (!G.spend(wantedFee)) return G.audio.ui('error'); G.wanted.clear(); G.ui.notify('Fresh paint, new plates. <b>The cops lost your trail.</b>'); G.audio.ui('success'); render(); });
      this.bind('[data-col]', 'click', (e, n) => { const c = parseInt(n.dataset.col); if (c === v.color || !G.spend(350)) return G.audio.ui('error'); v.setColor(c); G.audio.ui('cash'); G.syncGarageCar(v); render(); });
      this.bind('[data-up]', 'click', (e, n) => { const k = n.dataset.up; const l = up[k] || 0; if (l >= 3 || !G.spend(upPrices[l])) return G.audio.ui('error'); up[k] = l + 1; G.audio.ui('cash'); G.syncGarageCar(v); render(); });
    };
    render();
  }
  openGarage(shop) {
    const G = this.G, P = G.player;
    G.paused = true;
    const render = () => {
      const g = G.state.garage;
      const cur = P.vehicle;
      const list = g.map((c, i) => `<div class="slot"><div><b>${VTYPES[c.type].name}</b> <span class="sw" style="display:inline-block;width:14px;height:14px;vertical-align:middle;background:${hex(c.color)}"></span><div class="meta">Engine ${c.upgrades?.engine || 0} · Brakes ${c.upgrades?.brakes || 0} · Armor ${c.upgrades?.armor || 0}</div></div><div class="rowflex"><button class="pbtn primary" data-take="${i}" ${cur ? 'disabled' : ''}>Take out</button><button class="pbtn danger" data-sell="${i}">Sell ${formatMoney(Math.round((VTYPES[c.type].price || 8000) * 0.3))}</button></div></div>`).join('') || '<p style="color:var(--muted)">Your garage is empty. Drive a vehicle in and store it here.</p>';
      const canStore = cur && !cur.destroyed && g.length < 4 && cur.type !== 'police' && !cur.mission && !cur.garageIdx;
      this.show(`<div class="panel small">${this.head('Safehouse Garage', `${g.length}/4 spaces`)}<div class="panel-body">
        ${cur ? `<div class="slot"><div><b>Current: ${cur.T.name}</b><div class="meta">${cur.type === 'police' ? 'Police vehicles can\'t be stored.' : cur.mission ? 'Mission vehicles can\'t be stored.' : g.length >= 4 ? 'Garage full.' : 'Store this vehicle for later.'}</div></div><button class="pbtn primary" data-store ${canStore ? '' : 'disabled'}>Store</button></div>` : ''}
        ${list}</div></div>`, 'garage');
      this.bind('[data-close]', 'click', () => this.close());
      this.bind('[data-store]', 'click', () => {
        const v = P.vehicle;
        g.push({ type: v.type, color: v.color, upgrades: { ...v.upgrades } });
        P.leaveVehicle(true);
        G.traffic.remove(v);
        G.ui.notify(`<b>${v.T.name}</b> stored in the garage.`);
        G.autosave();
        render();
      });
      this.bind('[data-take]', 'click', (e, n) => {
        const c = g.splice(+n.dataset.take, 1)[0];
        this.close();
        G.spawnOwnedCar(c, true);
      });
      this.bind('[data-sell]', 'click', (e, n) => {
        const c = g[+n.dataset.sell];
        this.confirm('Sell vehicle?', `Sell the ${VTYPES[c.type].name} for ${formatMoney(Math.round((VTYPES[c.type].price || 8000) * 0.3))}?`, () => { g.splice(+n.dataset.sell, 1); G.addMoney(Math.round((VTYPES[c.type].price || 8000) * 0.3)); }, render);
      });
    };
    render();
  }
  openSafehouse(shop) {
    const G = this.G;
    G.paused = true;
    const can = G.canSaveAnywhere();
    this.show(`<div class="panel small">${this.head('Safehouse', 'Home sweet home')}<div class="panel-body">
      <div class="grid">
        <div class="card ${can ? '' : 'disabled'}" data-act="sleep"><h4>Sleep</h4><div class="desc">Skip 6 hours, restore health and save.</div></div>
        <div class="card" data-act="wardrobe"><h4>Wardrobe</h4><div class="desc">Change into clothes you own (free).</div></div>
      </div>
      <div class="section" style="margin-top:18px"><h3>Save game</h3><div id="sf-save"></div></div></div></div>`, 'safehouse');
    this.bind('[data-close]', 'click', () => this.close());
    this.bind('[data-act=sleep]', 'click', () => {
      if (!can) return G.audio.ui('error');
      this.close();
      G.fadeOut(() => { G.time.hour = (G.time.hour + 6) % 24; if (G.time.hour < 6) G.state.day++; G.player.health = 100; G.autosave(); G.ui.notify('You slept for 6 hours. Game saved.'); });
    });
    this.bind('[data-act=wardrobe]', 'click', () => this.openClothing({ kind: 'wardrobe', name: 'Wardrobe' }));
    this.renderSave($('sf-save'), true);
  }
  openInventory() {
    const G = this.G, inv = G.state.inventory, P = G.player;
    G.paused = true;
    const items = [
      { id: 'snacks', name: 'Sunny Chips', n: inv.snacks, desc: '+25 health', use: () => { inv.snacks--; P.health = Math.min(100, P.health + 25); } },
      { id: 'medkit', name: 'First Aid Kit', n: inv.medkit, desc: 'Full health', use: () => { inv.medkit--; P.health = 100; } },
      { id: 'repairKit', name: 'Repair Kit', n: inv.repairKit, desc: 'Repair nearby / current vehicle +50%', use: () => {
        const v = P.vehicle || G.vehicles.find((x) => Math.hypot(x.pos.x - P.pos.x, x.pos.z - P.pos.z) < 5 && !x.destroyed);
        if (!v) { G.ui.help('No vehicle nearby to repair.'); return false; }
        inv.repairKit--; v.health = Math.min(v.maxHealth, v.health + 500); v.burning = 0;
      } },
    ];
    const render = () => {
      const weapons = `<div class="card ${P.weapon === 'fists' ? 'sel' : ''}" data-w="fists"><h4>Fists</h4><div class="desc">Melee attack</div></div>` +
        (inv.pistol ? `<div class="card ${P.weapon === 'pistol' ? 'sel' : ''}" data-w="pistol"><h4>9mm Pistol</h4><div class="desc">${G.state.clip} in clip · ${G.state.ammo} reserve</div></div>` : '');
      const its = items.map((it) => `<div class="card ${it.n > 0 ? '' : 'disabled'}" data-use="${it.id}"><h4>${it.name} <span class="tag">×${it.n}</span></h4><div class="desc">${it.desc}</div></div>`).join('');
      this.show(`<div class="panel small">${this.head('Inventory', `Health ${Math.round(P.health)} · Armor ${Math.round(P.armor)}`)}<div class="panel-body">
        <div class="section"><h3>Weapons</h3><div class="grid">${weapons}</div></div>
        <div class="section"><h3>Items</h3><div class="grid">${its}</div></div>
        <div class="section"><h3>Coast Tokens</h3>${G.state.collected.length}/${G.missions.tokens.length} found</div></div></div>`, 'inventory');
      this.bind('[data-close]', 'click', () => this.close());
      this.bind('[data-w]', 'click', (e, n) => { P.setWeapon(n.dataset.w); render(); });
      this.bind('[data-use]', 'click', (e, n) => { const it = items.find((i) => i.id === n.dataset.use); if (it.n <= 0) return G.audio.ui('error'); if (it.use() !== false) { G.audio.ui('select'); it.n = inv[it.id]; } render(); });
    };
    render();
  }
}
