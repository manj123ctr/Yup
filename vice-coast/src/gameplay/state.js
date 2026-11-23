// Game state, settings and save/load (localStorage, 3 slots + autosave).
import { DEFAULT_LOOK } from '../entities/player.js';

export function newState() {
  return {
    version: 1,
    money: 800,
    inventory: { pistol: false, snacks: 1, armor: 0, repairKit: 0, medkit: 0 },
    ammo: 0, clip: 0,
    look: { ...DEFAULT_LOOK },
    ownedClothes: ['shirt_f2f2f2', 'pants_1f2a44', 'shoes_ffffff', 'hat_none', 'glasses_on', 'glasses_off', 'hair_short', 'hair_buzz', 'hairColor_1a1210', 'sleeves_short'],
    garage: [],
    missions: { done: [], current: null },
    collected: [],
    stats: { distance: 0, driven: 0, kills: 0, crimes: 0, missions: 0, playTime: 0, maxWanted: 0, races: 0, jobs: 0, robberies: 0, deaths: 0, busted: 0 },
    hour: 9.5, weather: 'clear', day: 1,
    player: { x: 856, z: 192, yaw: -Math.PI / 2 },
    health: 100, armor: 0,
    flags: {},
  };
}

export const DEFAULT_SETTINGS = {
  quality: 2, // 0 low, 1 medium, 2 high, 3 ultra
  fov: 65, sensitivity: 1, invertY: false,
  master: 0.8, music: 0.55, sfx: 0.9, voices: true,
  traffic: 1, peds: 1, dayLength: 24, // minutes per in-game day
  units: 'kmh', showFps: false, bloom: true, subtitles: true,
};

const KEY = 'vicecoast_';
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY + 'settings') || '{}') }; } catch (e) { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY + 'settings', JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }

export function saveGame(slot, state) {
  try {
    const data = { ...state, savedAt: Date.now() };
    localStorage.setItem(KEY + 'slot_' + slot, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}
export function loadGame(slot) {
  try {
    const raw = localStorage.getItem(KEY + 'slot_' + slot);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const base = newState();
    return { ...base, ...d, inventory: { ...base.inventory, ...d.inventory }, stats: { ...base.stats, ...d.stats }, missions: { ...base.missions, ...d.missions }, flags: { ...d.flags } };
  } catch (e) { return null; }
}
export function slotInfo(slot) {
  try {
    const raw = localStorage.getItem(KEY + 'slot_' + slot);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { savedAt: d.savedAt, money: d.money, missions: (d.missions && d.missions.done.length) || 0, collected: (d.collected || []).length, playTime: d.stats ? d.stats.playTime : 0 };
  } catch (e) { return null; }
}
export function deleteSlot(slot) { try { localStorage.removeItem(KEY + 'slot_' + slot); } catch (e) { /* ignore */ } }
export function latestSlot() {
  let best = null;
  for (const s of ['auto', 1, 2, 3]) { const i = slotInfo(s); if (i && (!best || i.savedAt > best.savedAt)) best = { slot: s, ...i }; }
  return best;
}
