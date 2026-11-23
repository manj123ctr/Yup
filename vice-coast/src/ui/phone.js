// In-game smartphone: contacts (with working calls), messages, delivery jobs,
// map, weather forecast, car dealership (Autos), photo mode (hide HUD), quick save
// and settings. Mouse or keyboard (arrows / Enter / Backspace) navigation.
import { formatMoney, formatTime } from '../util.js';
import { WEATHER_TYPES } from '../world/weather.js';
import { VTYPES, BUYABLE } from '../entities/vehicle.js';
import { saveGame } from '../gameplay/state.js';

const $ = (id) => document.getElementById(id);

export class Phone {
  constructor(G) {
    this.G = G;
    this.el = $('phone');
    this.screen = $('phone-screen');
    this.openFlag = false;
    this.app = 'home'; this.sel = 0;
    this.messages = [{ from: 'Rico', text: 'Welcome to Vice Coast, cuz! Call me if you need anything.' }];
    $('phone-home-btn').addEventListener('click', () => this.go('home'));
    addEventListener('keydown', (e) => {
      if (!this.openFlag) return;
      const items = this.items();
      if (e.code === 'ArrowUp') { this.sel = (this.sel - (this.app === 'home' ? 3 : 1) + items.length) % items.length; this.render(); e.preventDefault(); e.stopPropagation(); }
      else if (e.code === 'ArrowDown') { this.sel = (this.sel + (this.app === 'home' ? 3 : 1)) % items.length; this.render(); e.preventDefault(); }
      else if (e.code === 'ArrowLeft' && this.app === 'home') { this.sel = (this.sel - 1 + items.length) % items.length; this.render(); }
      else if (e.code === 'ArrowRight' && this.app === 'home') { this.sel = (this.sel + 1) % items.length; this.render(); }
      else if (e.code === 'Enter') { items[this.sel] && items[this.sel].act(); }
      else if (e.code === 'Backspace') { if (this.app === 'home') this.toggle(false); else this.go('home'); }
    }, true);
  }
  get isOpen() { return this.openFlag; }
  toggle(on = !this.openFlag) {
    const G = this.G;
    this.openFlag = on;
    G.phoneOpen = on;
    this.el.classList.toggle('hidden', !on);
    if (on) { this.app = 'home'; this.sel = 0; this.render(); G.audio.ui('select'); G.input.releaseLock(); }
    else { G.audio.ui('back'); G.input.wantLock = true; }
  }
  addMessage(from, text) { this.messages.unshift({ from, text }); }
  go(app) { this.app = app; this.sel = 0; this.G.audio.ui('click'); this.render(); }
  items() {
    const G = this.G;
    if (this.app === 'home') {
      return [
        { ic: '☎', label: 'Contacts', bg: '#22c55e', act: () => this.go('contacts') },
        { ic: '✉', label: 'Messages', bg: '#3b82f6', act: () => this.go('messages') },
        { ic: '⚑', label: 'Jobs', bg: '#f59e0b', act: () => this.go('jobs') },
        { ic: '⌖', label: 'Map', bg: '#14b8a6', act: () => { this.toggle(false); G.menus.openMap(); } },
        { ic: '☀', label: 'Weather', bg: '#0ea5e9', act: () => this.go('weather') },
        { ic: '🚗', label: 'Autos', bg: '#ef4444', act: () => this.go('autos') },
        { ic: '◉', label: 'Snap', bg: '#a855f7', act: () => { this.toggle(false); G.toggleHudHidden(); } },
        { ic: '⤓', label: 'Quick Save', bg: '#64748b', act: () => this.quickSave() },
        { ic: '⚙', label: 'Settings', bg: '#334155', act: () => { this.toggle(false); G.menus.openPause('settings'); } },
      ];
    }
    if (this.app === 'contacts') {
      return [
        { label: 'Rico (cousin)', sub: 'Tips & a ride home', act: () => this.call('rico') },
        { label: 'Mechanic Manny', sub: 'Delivers a car from your garage', act: () => this.call('mechanic') },
        { label: 'Lola', sub: 'Neon Flamingo', act: () => this.call('lola') },
        { label: 'Taxi Vice', sub: 'Fast travel to your waypoint ($)', act: () => this.call('taxi') },
        { label: '911 Emergency', sub: 'Police, fire, ambulance', act: () => this.call('911') },
      ];
    }
    if (this.app === 'jobs') {
      return [{ label: 'Start a delivery job', sub: 'Pick up & deliver a package on time', act: () => { this.toggle(false); if (G.missions.current) G.ui.help('Finish your current mission first.'); else G.missions.startJob(); } }];
    }
    if (this.app === 'autos') {
      return BUYABLE.map((t) => ({ label: `${VTYPES[t].name}`, sub: `${formatMoney(VTYPES[t].price)} · delivered to garage`, act: () => this.buyCar(t) }));
    }
    if (this.app === 'messages') return this.messages.slice(0, 12).map((m) => ({ label: m.from, sub: m.text, act: () => {} }));
    return [];
  }
  render() {
    const G = this.G;
    $('ph-time').textContent = formatTime(G.time.hour);
    const items = this.items();
    if (this.app === 'home') {
      this.screen.innerHTML = `<div class="ph-clock">${formatTime(G.time.hour).replace(/ (AM|PM)/, '')}</div><div class="ph-date">Day ${G.state.day} · ${WEATHER_TYPES[G.weather.type].label}</div>
        <div class="apps">${items.map((a, i) => `<div class="app ${i === this.sel ? 'sel' : ''}" data-i="${i}"><div class="ic" style="background:${a.bg}">${a.ic}</div>${a.label}</div>`).join('')}</div>`;
    } else if (this.app === 'weather') {
      const f = G.weather.forecast;
      this.screen.innerHTML = `<div class="ph-title"><span class="ph-back" data-back>‹ Back</span>Weather</div>
        <div class="ph-big">${WEATHER_TYPES[G.weather.type].icon}</div><div style="text-align:center;margin-bottom:14px">${WEATHER_TYPES[G.weather.type].label} · Vice Coast</div>
        ${f.map((t, i) => `<div class="ph-item">Later ${i + 1}: ${WEATHER_TYPES[t].icon} ${WEATHER_TYPES[t].label}</div>`).join('')}`;
    } else {
      const title = { contacts: 'Contacts', jobs: 'Jobs', autos: 'Vice Autos', messages: 'Messages' }[this.app];
      this.screen.innerHTML = `<div class="ph-title"><span class="ph-back" data-back>‹ Back</span>${title}</div>` +
        (this.app === 'autos' ? `<div style="font-size:12px;color:#cfd6e4;margin-bottom:8px">Balance ${formatMoney(G.state.money)} · Garage ${G.state.garage.length}/4</div>` : '') +
        items.map((it, i) => `<div class="ph-item ${i === this.sel ? 'sel' : ''}" data-i="${i}"><b>${it.label}</b><div class="s">${it.sub || ''}</div></div>`).join('');
    }
    this.screen.querySelectorAll('[data-i]').forEach((n) => n.addEventListener('click', () => { this.sel = +n.dataset.i; items[this.sel].act(); }));
    const b = this.screen.querySelector('[data-back]'); if (b) b.addEventListener('click', () => this.go('home'));
  }
  call(who) {
    const G = this.G;
    G.audio.ui('phone');
    const say = (name, text, female) => { G.ui.subtitle(name, text, 4); G.audio.phoneVoice(text, female); };
    this.toggle(false);
    if (who === 'rico') {
      const tips = ['Need cash? Delivery jobs at the Port pay decent.', 'Coast Customs can repaint your ride and lose the cops for you.', 'Starfish Island has the nicest cars. And the nastiest alarms.', 'Coast Tokens are hidden all over town. Lifeguard towers, alleys… even the farms.', 'If the cops are on you, break line of sight and get out of the red circle.'];
      say('Rico', tips[Math.floor(Math.random() * tips.length)]);
    } else if (who === 'mechanic') {
      const g = G.state.garage;
      if (!g.length) { say('Manny', 'Your garage is empty, boss. Buy something on Vice Autos first.'); return; }
      if (G.player.vehicle) { say('Manny', 'You\'re already driving, boss!'); return; }
      const c = g.shift();
      say('Manny', `Bringing your ${VTYPES[c.type].name} around. Should be right next to you.`);
      setTimeout(() => G.spawnOwnedCar(c, false), 2500);
    } else if (who === 'lola') {
      say('Lola', G.state.missions.done.includes('midnight') ? 'Thanks again for that delivery, sugar. Drinks are on me next time.' : 'Rico\'s cousin? Come see me at Neon Flamingo when you\'re ready for real work.', true);
    } else if (who === 'taxi') {
      const w = G.gps.waypoint || (G.missions.current && G.missions.currentTarget());
      if (!w) { say('Dispatch', 'Set a waypoint on your map first, honey.', true); return; }
      if (G.wanted.level) { say('Dispatch', 'We don\'t pick up people with cops on their tail!', true); return; }
      const cost = Math.round(20 + Math.hypot(w.x - G.player.pos.x, w.z - G.player.pos.z) * 0.05);
      if (!G.spend(cost)) { say('Dispatch', `That\'s ${formatMoney(cost)}. Come back with cash.`, true); return; }
      say('Dispatch', `Cab is on the way. ${formatMoney(cost)}, please.`, true);
      G.fadeOut(() => G.fastTravel(w.x, w.z));
    } else if (who === '911') {
      say('Operator', '911, what\'s your emergency? … Hello? Please don\'t prank call.', true);
    }
  }
  buyCar(t) {
    const G = this.G;
    if (!G.state.flags.garage) { G.ui.help('You need a garage first. Finish "Welcome to Vice Coast".'); G.audio.ui('error'); return; }
    if (G.state.garage.length >= 4) { G.ui.help('Your garage is full.'); G.audio.ui('error'); return; }
    if (!G.spend(VTYPES[t].price)) { G.audio.ui('error'); G.ui.help('Not enough money.'); return; }
    const T = VTYPES[t];
    G.state.garage.push({ type: t, color: T.colors[Math.floor(Math.random() * T.colors.length)], upgrades: { engine: 0, brakes: 0, armor: 0 } });
    G.audio.ui('cash');
    G.ui.notify(`<b>${T.name}</b> delivered to your garage.`);
    this.addMessage('Vice Autos', `Thanks for buying the ${T.name}! It's waiting in your garage.`);
    this.render();
  }
  quickSave() {
    const G = this.G;
    if (!G.canSaveAnywhere()) { G.ui.help('You can\'t save during a mission or while wanted.'); G.audio.ui('error'); return; }
    G.syncState();
    saveGame('auto', G.state);
    G.ui.notify('Quick saved.');
    G.audio.ui('success');
    this.toggle(false);
  }
}
