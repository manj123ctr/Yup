// Fully synthesized audio (Web Audio API): engine, ambience, weather, traffic,
// sirens, footsteps, weapons, impacts, UI, NPC voices and an adaptive
// procedural music system with in-car radio stations.
import { clamp, R } from './util.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// Chord progressions (MIDI root + chord tones)
const STYLES = {
  title: { bpm: 84, chords: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 66]], drums: 0, arp: 1, pad: 1, bass: 0.6, swing: 0 },
  explore: { bpm: 82, chords: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [57, 60, 64, 67]], drums: 1, arp: 0, keys: 1, pad: 0.6, bass: 0.8, swing: 0.12, vinyl: 1 },
  night: { bpm: 74, chords: [[52, 55, 59, 62], [48, 52, 55, 59], [53, 57, 60, 64], [55, 59, 62, 65]], drums: 1, arp: 0, keys: 1, pad: 1, bass: 0.7, swing: 0.15, vinyl: 1 },
  synthwave: { bpm: 104, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], drums: 2, arp: 1, pad: 1, bass: 1, swing: 0 },
  house: { bpm: 122, chords: [[53, 56, 60, 63], [56, 60, 63, 67], [51, 55, 58, 62], [49, 53, 56, 60]], drums: 3, arp: 0, stabs: 1, pad: 0.4, bass: 1, swing: 0 },
  tension: { bpm: 128, chords: [[52, 55, 59], [52, 55, 60], [50, 53, 57], [48, 52, 55]], drums: 4, arp: 1, pad: 0.7, bass: 1.2, swing: 0, minorArp: 1 },
  mission: { bpm: 112, chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], drums: 2, arp: 1, pad: 0.8, bass: 1.1, swing: 0 },
};
export const STATIONS = [
  { name: 'WAVE FM 101.5', style: 'synthwave', tag: 'Synthwave classics' },
  { name: 'VICE CHILL 88.3', style: 'explore', tag: 'Lo-fi beats to cruise to' },
  { name: 'PULSE 99', style: 'house', tag: 'Non-stop club house' },
  { name: 'Radio Off', style: null, tag: '' },
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.55, sfx: 0.9 };
    this.voicesOn = true;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.station = 0;
    this.musicState = 'title';
    this.curStyle = null;
    this.sirenSrc = null; this.heliPos = null; this.heliT = 0;
    this.lastVoice = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.vol.master;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.vol.music; this.musicBus.connect(this.master);
    this.musicFade = ctx.createGain(); this.musicFade.gain.value = 0; this.musicFade.connect(this.musicBus);
    // radio filter (in-car feel) applied to music
    this.musicIn = ctx.createGain(); this.musicIn.connect(this.musicFade);
    // delay for arps
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2500;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay); dl.connect(this.musicIn);
    // buffers
    const sr = ctx.sampleRate;
    this.white = ctx.createBuffer(1, sr * 2, sr);
    const w = this.white.getChannelData(0); for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, sr * 4, sr);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < b.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.crackle = ctx.createBuffer(1, sr * 2, sr);
    const c = this.crackle.getChannelData(0); for (let i = 0; i < c.length; i++) c[i] = Math.random() < 0.0008 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * 0.01;
    this.setupAmbient();
    this.setupEngine();
    this.setupSiren();
    this.startMusic();
  }
  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master; this.sfx.gain.value = this.vol.sfx; this.musicBus.gain.value = this.vol.music;
  }
  loopNoise(buf, type, freq, q = 1, gain = 0) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(0, Math.random() * 1.5);
    return { s, f, g };
  }
  setupAmbient() {
    this.amb = {
      city: this.loopNoise(this.brown, 'lowpass', 380, 0.7),
      traffic: this.loopNoise(this.brown, 'bandpass', 140, 0.8),
      wind: this.loopNoise(this.white, 'bandpass', 500, 0.6),
      rain: this.loopNoise(this.white, 'highpass', 1400, 0.5),
      rainLow: this.loopNoise(this.brown, 'lowpass', 900, 0.5),
      waves: this.loopNoise(this.brown, 'lowpass', 700, 0.5),
      heli: this.loopNoise(this.brown, 'lowpass', 220, 1.2),
    };
    // helicopter chop LFO
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 17;
    const lg = this.ctx.createGain(); lg.gain.value = 0;
    lfo.connect(lg); lg.connect(this.amb.heli.g.gain); lfo.start();
    this.heliLfo = lg;
    // crickets
    const cr = this.ctx.createOscillator(); cr.type = 'sine'; cr.frequency.value = 4700;
    // chirp modulator (0..1) feeds a separate output gain that stays at 0 unless it's a cricket-y night
    const chirp = this.ctx.createGain(); chirp.gain.value = 0.5;
    const am = this.ctx.createOscillator(); am.frequency.value = 28; const amg = this.ctx.createGain(); amg.gain.value = 0.5;
    am.connect(amg); amg.connect(chirp.gain);
    const cg = this.ctx.createGain(); cg.gain.value = 0;
    cr.connect(chirp); chirp.connect(cg); cg.connect(this.sfx); cr.start(); am.start();
    this.cricket = cg;
    this.birdT = 2;
  }
  setupEngine() {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); }
    shaper.curve = curve;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    o1.connect(shaper); o2.connect(g2); g2.connect(shaper); o3.connect(shaper);
    shaper.connect(f); f.connect(g); g.connect(this.sfx);
    o1.start(); o2.start(); o3.start();
    const intake = this.loopNoise(this.white, 'bandpass', 1200, 1.5);
    this.eng = { o1, o2, o3, f, g, intake };
    this.skid = this.loopNoise(this.white, 'bandpass', 2400, 4);
  }
  setupSiren() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square';
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35; lfo.type = 'triangle';
    const lg = ctx.createGain(); lg.gain.value = 380;
    lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 1050;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    o.connect(f); f.connect(g); g.connect(pan); pan.connect(this.sfx);
    o.start(); lfo.start();
    this.siren = { o, g, pan, lfo };
  }
  spatial(pos, ref = 40) {
    if (!pos) return { gain: 1, pan: 0 };
    const L = this.listener;
    const dx = pos.x - L.x, dz = pos.z - L.z, dy = (pos.y || 0) - L.y;
    const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
    const gain = clamp(ref / (ref + d * d * 0.08), 0, 1);
    // camera right vector
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = clamp((dx * rx + dz * rz) / (d + 1), -0.9, 0.9);
    return { gain, pan, d };
  }
  // one-shot helpers
  env(node, t, a, peak, dec, sus = 0) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(peak, t + a); g.exponentialRampToValueAtTime(Math.max(0.0001, sus || 0.0001), t + a + dec);
  }
  noiseShot({ pos, type = 'bandpass', freq = 1000, q = 1, dur = 0.15, vol = 0.5, attack = 0.002, rate = 1, buf, ref = 40, sweep }) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, ref);
    if (sp.gain < 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = buf || this.white; s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = sp.pan;
    s.connect(f); f.connect(g); g.connect(p); p.connect(this.sfx);
    this.env(g, t, attack, vol * sp.gain, dur);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }
  tone({ pos, type = 'sine', freq = 440, to, dur = 0.2, vol = 0.3, attack = 0.005, ref = 40, delay = 0, dest }) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, ref);
    if (sp.gain < 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = sp.pan;
    o.connect(g); g.connect(p); p.connect(dest || this.sfx);
    this.env(g, t, attack, vol * sp.gain, dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
  footstep(surface, k = 0.6) {
    const m = { concrete: [1700, 2.2, 0.12], sand: [500, 0.7, 0.18], grass: [900, 1, 0.16], tile: [2600, 3, 0.09] }[surface] || [1500, 2, 0.12];
    this.noiseShot({ type: 'bandpass', freq: m[0] * (0.85 + Math.random() * 0.3), q: m[1], dur: m[2], vol: 0.18 * k + 0.04, ref: 80 });
  }
  jump() { this.noiseShot({ freq: 700, q: 0.8, dur: 0.1, vol: 0.1 }); }
  swim() { this.noiseShot({ type: 'lowpass', freq: 900, dur: 0.4, vol: 0.18, attack: 0.05 }); }
  splash(pos) { this.noiseShot({ pos, type: 'lowpass', freq: 2500, sweep: 400, dur: 0.9, vol: 0.6, ref: 80 }); }
  door(pos) { this.noiseShot({ pos, type: 'lowpass', freq: 500, dur: 0.12, vol: 0.5 }); this.tone({ pos, type: 'square', freq: 120, to: 60, dur: 0.08, vol: 0.12, delay: 0.02 }); }
  engineStart() { this.noiseShot({ type: 'lowpass', freq: 300, dur: 0.6, vol: 0.4, attack: 0.05 }); this.tone({ type: 'sawtooth', freq: 40, to: 90, dur: 0.6, vol: 0.15 }); }
  punch(pos) { this.noiseShot({ pos, type: 'lowpass', freq: 600, dur: 0.12, vol: 0.7 }); this.tone({ pos, freq: 120, to: 50, dur: 0.1, vol: 0.4 }); }
  swing() { this.noiseShot({ type: 'bandpass', freq: 900, sweep: 300, q: 1.5, dur: 0.18, vol: 0.12, attack: 0.04 }); }
  thud(pos) { this.noiseShot({ pos, type: 'lowpass', freq: 300, dur: 0.25, vol: 0.8, ref: 60 }); this.tone({ pos, freq: 90, to: 40, dur: 0.2, vol: 0.5 }); }
  gunshot(pos, player) {
    this.noiseShot({ pos, type: 'lowpass', freq: 4000, sweep: 300, dur: 0.35, vol: player ? 0.9 : 0.8, ref: 300 });
    this.tone({ pos, freq: 160, to: 40, dur: 0.18, vol: 0.6, ref: 300 });
    this.noiseShot({ pos, type: 'bandpass', freq: 600, dur: 1.2, vol: 0.12, attack: 0.05, ref: 400 }); // echo tail
  }
  ricochet(pos) { this.tone({ pos, type: 'sine', freq: 2400, to: 900, dur: 0.25, vol: 0.15 }); }
  reload() { this.noiseShot({ freq: 3000, q: 4, dur: 0.05, vol: 0.3 }); setTimeout(() => this.noiseShot({ freq: 2200, q: 4, dur: 0.06, vol: 0.35 }), 600); setTimeout(() => this.noiseShot({ freq: 3500, q: 5, dur: 0.05, vol: 0.4 }), 1100); }
  crash(k, pos) {
    this.noiseShot({ pos, type: 'lowpass', freq: 1500 + k * 3000, sweep: 200, dur: 0.3 + k * 0.5, vol: 0.4 + k * 0.6, ref: 80 });
    for (let i = 0; i < 3; i++) this.tone({ pos, type: 'square', freq: 300 + Math.random() * 900, to: 100 + Math.random() * 200, dur: 0.15 + k * 0.3, vol: 0.08 * k, delay: i * 0.03 });
    if (k > 0.4) setTimeout(() => this.noiseShot({ pos, type: 'highpass', freq: 5000, dur: 0.4, vol: 0.2 * k }), 60); // glass
  }
  explosion(pos) {
    this.noiseShot({ pos, buf: this.brown, type: 'lowpass', freq: 800, sweep: 60, dur: 2.5, vol: 1.2, attack: 0.01, ref: 600 });
    this.noiseShot({ pos, type: 'lowpass', freq: 5000, sweep: 200, dur: 0.6, vol: 0.8, ref: 600 });
    this.tone({ pos, freq: 70, to: 25, dur: 1.2, vol: 0.9, ref: 600 });
  }
  thunder(k = 1) {
    if (!this.ctx) return;
    this.noiseShot({ buf: this.brown, type: 'lowpass', freq: 400, sweep: 50, dur: 4, vol: 0.9 * clamp(k, 0.3, 1), attack: 0.08 });
    this.noiseShot({ type: 'lowpass', freq: 2500, sweep: 200, dur: 0.6, vol: 0.4 * k });
  }
  horn(pos, type) {
    const f = type === 'pickup' || type === 'suv' ? 330 : type === 'moto' ? 520 : 410;
    this.tone({ pos, type: 'square', freq: f, dur: 0.45, vol: 0.18, ref: 120 });
    this.tone({ pos, type: 'square', freq: f * 1.26, dur: 0.45, vol: 0.14, ref: 120 });
  }
  pickup() { [72, 76, 79, 84].forEach((n, i) => this.tone({ type: 'triangle', freq: NOTE(n), dur: 0.15, vol: 0.2, delay: i * 0.06 })); }
  ui(kind) {
    if (!this.ctx) return;
    const m = {
      click: [[80, 0.05, 'triangle']], select: [[76, 0.06, 'triangle'], [83, 0.08, 'triangle', 0.04]], back: [[72, 0.08, 'triangle'], [67, 0.1, 'triangle', 0.05]],
      error: [[52, 0.15, 'square'], [49, 0.2, 'square', 0.1]], success: [[72, 0.1], [76, 0.1, 'sine', 0.08], [79, 0.1, 'sine', 0.16], [84, 0.3, 'sine', 0.24]],
      cash: [[88, 0.05, 'square'], [93, 0.15, 'square', 0.05]], notify: [[81, 0.08], [88, 0.12, 'sine', 0.07]], phone: [[76, 0.12], [79, 0.12, 'sine', 0.15], [76, 0.12, 'sine', 0.3]],
      mission: [[64, 0.3, 'sawtooth'], [67, 0.3, 'sawtooth', 0.15], [71, 0.3, 'sawtooth', 0.3], [76, 0.8, 'sawtooth', 0.45]],
      fail: [[64, 0.3, 'sawtooth'], [60, 0.3, 'sawtooth', 0.2], [55, 0.8, 'sawtooth', 0.4]],
      checkpoint: [[84, 0.08, 'square'], [91, 0.12, 'square', 0.06]],
    }[kind] || [[80, 0.05]];
    for (const [n, d, type, delay] of m) this.tone({ freq: NOTE(n), dur: d, type: type || 'sine', vol: 0.12, delay: delay || 0 });
  }
  voice(text, pitch = 1, pos, female, force = false) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 30);
    if (sp.gain < 0.05 && !force) return;
    const now = performance.now();
    if (now - this.lastVoice < 900 && !force) return;
    this.lastVoice = now;
    if (this.voicesOn && 'speechSynthesis' in window && window.SpeechSynthesisUtterance) {
      try {
        if (speechSynthesis.pending || speechSynthesis.speaking) { if (!force) return; speechSynthesis.cancel(); }
        const u = new SpeechSynthesisUtterance(text);
        u.pitch = clamp(pitch * (female ? 1.25 : 0.85), 0.1, 2); u.rate = 1.05 + Math.random() * 0.15;
        u.volume = clamp(sp.gain * this.vol.sfx * this.vol.master * 1.5, 0.05, 1);
        const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
        if (vs.length) u.voice = vs[Math.floor(Math.random() * vs.length)];
        speechSynthesis.speak(u);
        return;
      } catch (e) { /* fall through to babble */ }
    }
    // babble fallback: formant-ish blips per syllable
    const syl = Math.min(8, Math.ceil(text.length / 4));
    const base = (female ? 220 : 130) * pitch;
    for (let i = 0; i < syl; i++) this.tone({ pos, type: 'sawtooth', freq: base * (0.9 + Math.random() * 0.3), to: base * (0.8 + Math.random() * 0.3), dur: 0.09, vol: 0.06, delay: i * 0.11, ref: 30 });
  }
  phoneVoice(text, female) { this.voice(text, 1, null, female, true); }
  heli(pos) { this.heliPos = pos; this.heliT = 0.3; }
  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    this.ui('click');
    this.onStation && this.onStation(STATIONS[this.station]);
    this.refreshMusic();
  }
  setMusicState(s) { this.musicState = s; this.refreshMusic(); }
  setInVehicle(v) { this.inVehicle = v; this.refreshMusic(); }
  refreshMusic() {
    let style;
    if (this.musicState === 'title') style = 'title';
    else if (this.musicState === 'club') style = 'house';
    else if (this.inVehicle && STATIONS[this.station].style && this.musicState !== 'wanted') style = STATIONS[this.station].style;
    else if (this.musicState === 'wanted') style = 'tension';
    else if (this.musicState === 'mission') style = 'mission';
    else if (this.inVehicle && !STATIONS[this.station].style) style = null;
    else style = this.night ? 'night' : 'explore';
    this.wantStyle = style;
  }

  // ---------- Music sequencer ----------
  startMusic() {
    this.step = 0; this.nextT = this.ctx.currentTime + 0.1;
    this.wantStyle = 'title';
    this.timer = setInterval(() => this.schedule(), 25);
  }
  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // style changes at bar boundaries with crossfade
    const fadeG = this.musicFade.gain;
    if (this.wantStyle !== this.curStyle) {
      if (this.step % 16 === 0 || this.curStyle === null) {
        fadeG.cancelScheduledValues(ctx.currentTime);
        fadeG.setValueAtTime(fadeG.value, ctx.currentTime);
        fadeG.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
        this.curStyle = this.wantStyle; this.step = 0; this.bar = 0;
        this.nextT = ctx.currentTime + 0.55;
        if (this.curStyle) fadeG.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);
      }
    }
    if (!this.curStyle) return;
    const S = STYLES[this.curStyle];
    const spb = 60 / S.bpm / 4; // seconds per 16th
    while (this.nextT < ctx.currentTime + 0.15) {
      const swing = this.step % 2 ? S.swing * spb : 0;
      this.playStep(S, this.step, this.nextT + swing, spb);
      this.nextT += spb;
      this.step = (this.step + 1) % 64;
    }
  }
  playStep(S, step, t, spb) {
    const ctx = this.ctx;
    const bar = Math.floor(step / 16), s = step % 16;
    const chord = S.chords[bar % S.chords.length];
    const out = this.musicIn;
    const note = (type, n, dur, vol, { cutoff = 3000, attack = 0.005, release = 0.1, detune = 0, delay = false } = {}) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = NOTE(n); o.detune.value = detune;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
      o.connect(f); f.connect(g); g.connect(out); if (delay) g.connect(this.delay);
      o.start(t); o.stop(t + dur + release + 0.05);
    };
    const drum = (kind, vol = 1) => {
      if (kind === 'kick') {
        const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.9 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.32);
      } else {
        const src = ctx.createBufferSource(); src.buffer = this.white;
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        let dur = 0.05;
        if (kind === 'hat') { f.type = 'highpass'; f.frequency.value = 7000; dur = 0.04; }
        else if (kind === 'ohat') { f.type = 'highpass'; f.frequency.value = 6000; dur = 0.18; }
        else if (kind === 'snare') { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.6; dur = 0.18; }
        else if (kind === 'clap') { f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 1.2; dur = 0.15; }
        else if (kind === 'tom') { f.type = 'lowpass'; f.frequency.value = 400; dur = 0.25; }
        g.gain.setValueAtTime(0.5 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f); f.connect(g); g.connect(out); src.start(t, Math.random()); src.stop(t + dur + 0.02);
      }
    };
    // drums
    if (S.drums === 1) { // lofi
      if (s === 0 || s === 10) drum('kick', 0.7);
      if (s === 4 || s === 12) drum('snare', 0.35);
      if (s % 2 === 0) drum('hat', 0.15);
    } else if (S.drums === 2) { // synthwave
      if (s % 4 === 0) drum('kick', 0.8);
      if (s === 4 || s === 12) drum('snare', 0.55);
      if (s % 2 === 0) drum('hat', 0.18);
    } else if (S.drums === 3) { // house
      if (s % 4 === 0) drum('kick', 1);
      if (s % 4 === 2) drum('ohat', 0.22);
      if (s === 4 || s === 12) drum('clap', 0.4);
      drum('hat', 0.07);
    } else if (S.drums === 4) { // tension
      if (s % 4 === 0 || s === 14) drum('kick', 0.9);
      if (s === 4 || s === 12) drum('snare', 0.5);
      drum('hat', s % 2 ? 0.08 : 0.16);
      if (s === 15 && bar % 2) drum('tom', 0.6);
    }
    // bass
    if (S.bass) {
      const root = chord[0] - 24;
      if (S.drums === 3) { if (s % 4 === 2) note('sawtooth', root + 12, spb * 1.5, 0.22 * S.bass, { cutoff: 600 }); }
      else if (S.drums === 4 || this.curStyle === 'mission') note('sawtooth', root + (s % 8 === 7 ? 12 : 0), spb * 0.8, 0.2 * S.bass, { cutoff: 500 + (s % 4) * 150 });
      else if (S.drums === 2) { if (s % 2 === 0) note('sawtooth', root + (s % 8 === 6 ? 12 : 0), spb * 1.6, 0.2 * S.bass, { cutoff: 700 }); }
      else if (s === 0 || s === 6 || s === 10) note('triangle', root + 12, spb * 3, 0.3 * S.bass, { cutoff: 900 });
    }
    // pads
    if (S.pad && s === 0) for (const n of chord) for (const d of [-8, 8]) note('sawtooth', n, spb * 15, 0.035 * S.pad, { cutoff: 1300, attack: 0.4, release: 0.6, detune: d });
    // keys (lofi rhodes)
    if (S.keys && (s === 0 || s === 7 || s === 11)) for (const n of chord) note('triangle', n + 12, spb * 3, 0.05, { cutoff: 2000, attack: 0.01, release: 0.4 });
    // stabs
    if (S.stabs && (s === 3 || s === 6 || s === 11)) for (const n of chord) note('square', n + 12, spb * 0.8, 0.04, { cutoff: 2200 });
    // arp
    if (S.arp) {
      const seq = S.minorArp ? [0, 1, 2, 1, 0, 2, 1, 2] : [0, 1, 2, 3, 2, 1, 0, 2];
      if (S.drums === 0 ? s % 2 === 0 : true) {
        const i = seq[s % seq.length] % chord.length;
        note('square', chord[i] + 12 + (s >= 8 && S.drums ? 12 : 0), spb * 0.9, S.drums === 0 ? 0.035 : 0.028, { cutoff: 2600, delay: true });
      }
    }
    // vinyl crackle
    if (S.vinyl && s === 0 && bar === 0) {
      const src = ctx.createBufferSource(); src.buffer = this.crackle; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0.25;
      src.connect(g); g.connect(out); src.start(t); src.stop(t + spb * 64);
    }
  }

  // ---------- Per-frame update ----------
  update(dt, G) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const cam = G.camera;
    this.listener.x = cam.position.x; this.listener.y = cam.position.y; this.listener.z = cam.position.z;
    this.listener.yaw = G.cam.yaw;
    this.night = G.sky.night > 0.6;
    const set = (param, v, k = 0.15) => { if (Number.isFinite(v)) param.setTargetAtTime(v, t, k); };
    const P = G.player, v = P.vehicle;
    const zone = G.zoneName;
    const playing = G.state && G.mode === 'play';
    // engine
    if (v && playing && !v.destroyed) {
      const rpm = v.rpm;
      const base = (v.bike ? 55 : 32) * (v.T.engine || 1);
      const f = base + rpm * base * 3.2;
      set(this.eng.o1.frequency, f, 0.05); set(this.eng.o2.frequency, f * 0.5, 0.05); set(this.eng.o3.frequency, f * 1.006, 0.05);
      set(this.eng.f.frequency, 300 + rpm * 1800 + v.input.throttle * 900, 0.05);
      set(this.eng.g.gain, v.engineOn ? 0.08 + v.input.throttle * 0.1 + rpm * 0.05 : 0, 0.08);
      set(this.eng.intake.g.gain, v.engineOn ? v.input.throttle * 0.05 * rpm : 0, 0.1);
      set(this.eng.intake.f.frequency, 600 + rpm * 2500, 0.1);
      set(this.skid.g.gain, v.slip > 3.5 && !v.airborne ? clamp((v.slip - 3.5) * 0.05, 0, 0.25) : 0, 0.05);
      if (v.input.horn && !this.hornOn) { this.hornOn = true; this.horn(null, v.type); this.hornT = 0.35; }
      if (this.hornOn) { this.hornT -= dt; if (this.hornT <= 0) { this.hornOn = false; } }
    } else {
      set(this.eng.g.gain, 0, 0.1); set(this.eng.intake.g.gain, 0, 0.1); set(this.skid.g.gain, 0, 0.05);
    }
    // ambience
    const a = this.amb;
    const urban = zone === 'country' || zone === 'ocean' ? 0.1 : zone === 'island' ? 0.3 : 1;
    const inside = P.indoors ? 0.35 : 1;
    const nearCars = G.traffic.cars.filter((c) => Math.abs(c.pos.x - cam.position.x) < 60 && Math.abs(c.pos.z - cam.position.z) < 60).length;
    set(a.city.g.gain, playing ? 0.12 * urban * inside * (this.night ? 0.6 : 1) : 0.03);
    set(a.traffic.g.gain, playing ? clamp(nearCars * 0.025, 0, 0.18) * inside : 0);
    const rain = G.weather.cur.rain, wind = G.weather.cur.wind;
    set(a.rain.g.gain, rain * 0.22 * (P.indoors ? 0.4 : 1));
    set(a.rainLow.g.gain, rain * 0.25);
    set(a.wind.g.gain, (0.02 + wind * 0.08 + (v ? clamp(v.speed / 60, 0, 1) * 0.12 : 0)) * (P.indoors ? 0.3 : 1));
    set(a.wind.f.frequency, 400 + Math.sin(t * 0.3) * 200 + wind * 300);
    const beachD = Math.max(0, 1 - Math.abs(cam.position.x - 960) / 160) + (zone === 'island' ? 0.6 : 0);
    set(a.waves.g.gain, clamp(beachD, 0, 1) * 0.18 * (0.6 + 0.4 * Math.sin(t * 0.5)));
    set(this.cricket.gain, this.night && (zone === 'country' || zone === 'suburb' || zone === 'island') && rain < 0.2 ? 0.012 : 0, 0.5);
    // birds by day
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 2 + R() * 6;
      if (!this.night && rain < 0.2 && playing && !P.indoors && zone !== 'downtown') {
        const f0 = 2200 + R() * 1800;
        for (let i = 0; i < 3; i++) this.tone({ type: 'sine', freq: f0, to: f0 * (1.3 + R() * 0.4), dur: 0.07, vol: 0.03, delay: i * 0.1 });
      }
      if (playing && urban > 0.5 && R() < 0.25 && !P.indoors) this.horn({ x: cam.position.x + (R() - 0.5) * 200, y: 0, z: cam.position.z + (R() - 0.5) * 200 }, 'sedan');
    }
    // siren: nearest active siren
    let best = null, bd = 1e9;
    for (const c of G.vehicles) if (c.sirenOn && !c.destroyed) { const d = (c.pos.x - cam.position.x) ** 2 + (c.pos.z - cam.position.z) ** 2; if (d < bd) { bd = d; best = c; } }
    if (best && playing) {
      const sp = this.spatial(best.pos, 200);
      set(this.siren.g.gain, sp.gain * 0.12, 0.1); set(this.siren.pan.pan, sp.pan, 0.1);
      this.siren.lfo.frequency.value = best.type === 'ambulance' ? 0.6 : 0.35;
    } else set(this.siren.g.gain, 0, 0.2);
    // helicopter
    this.heliT -= dt;
    if (this.heliT > 0 && this.heliPos) {
      const sp = this.spatial(this.heliPos, 300);
      set(a.heli.g.gain, sp.gain * 0.25); this.heliLfo.gain.setTargetAtTime(sp.gain * 0.2, t, 0.1);
    } else { set(a.heli.g.gain, 0); this.heliLfo.gain.setTargetAtTime(0, t, 0.1); }
    // music duck / radio muffle when indoors
    this.refreshMusic();
  }
}
