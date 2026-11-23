// Procedurally generated canvas textures (no external image assets needed).
import * as THREE from 'three';
import { rng } from '../util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function speckle(ctx, w, h, n, colors, r, size = [1, 3]) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = size[0] + r() * (size[1] - size[0]);
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

function asphaltBase(ctx, w, h, r) {
  ctx.fillStyle = '#3a3b3e';
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, w * h / 10, ['#2e2f32', '#45464a', '#353639', '#4c4c50', '#292a2c'], r, [1, 2.5]);
  // Tire wear tracks and patches
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = r() < 0.5 ? '#1c1c1e' : '#5a5a5e';
    ctx.beginPath();
    ctx.ellipse(r() * w, r() * h, 10 + r() * 40, 10 + r() * 60, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Road texture: u across width, v along length (tile = `tileLen` meters).
export function makeRoadTexture(widthM, lanes) {
  const r = rng(widthM * 13);
  const W = 512, H = 512;
  const [c, ctx] = canvas(W, H);
  asphaltBase(ctx, W, H, r);
  const px = W / widthM;
  const line = (xm, wm, color, dashed) => {
    ctx.fillStyle = color;
    const x = W / 2 + xm * px - (wm * px) / 2;
    if (!dashed) ctx.fillRect(x, 0, wm * px, H);
    else for (let y = 0; y < H; y += H / 2) ctx.fillRect(x, y, wm * px, H / 4);
  };
  ctx.globalAlpha = 0.85;
  // Center double yellow
  line(-0.18, 0.12, '#d9b23a'); line(0.18, 0.12, '#d9b23a');
  // Edge lines
  line(-widthM / 2 + 0.6, 0.15, '#dcdcdc'); line(widthM / 2 - 0.6, 0.15, '#dcdcdc');
  if (lanes > 1) { line(-widthM / 4 - 0.2, 0.14, '#e0e0e0', true); line(widthM / 4 + 0.2, 0.14, '#e0e0e0', true); }
  ctx.globalAlpha = 1;
  // Gutter darkening
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.05, 'rgba(0,0,0,0)');
  g.addColorStop(0.95, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return tex(c);
}
export function makeAsphaltTexture() {
  const [c, ctx] = canvas(512, 512);
  asphaltBase(ctx, 512, 512, rng(77));
  return tex(c);
}
export function makeCrosswalkTexture() {
  const [c, ctx] = canvas(256, 64);
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(230,230,230,0.85)';
  for (let x = 6; x < 256; x += 22) ctx.fillRect(x, 6, 12, 40);
  ctx.fillRect(0, 54, 256, 6); // stop line
  return tex(c, false);
}
export function makeConcreteTexture() {
  const r = rng(5);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#a9a7a0'; ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 5000, ['#9d9b94', '#b4b2ab', '#a2a099', '#8f8d87'], r, [1, 2]);
  ctx.strokeStyle = 'rgba(60,60,60,0.35)'; ctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  return tex(c);
}
export function makeGrassTexture() {
  const r = rng(9);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#4f7a35'; ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 9000, ['#5b8a3c', '#476d2f', '#3f6229', '#66943f', '#557f36'], r, [1, 3]);
  return tex(c);
}
export function makeSandTexture() {
  const r = rng(21);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#dcc79a'; ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 9000, ['#e6d3a8', '#cfb886', '#d8c292', '#efdfb8', '#c4ac7a'], r, [1, 2]);
  return tex(c);
}
export function makeDirtTexture() {
  const r = rng(31);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#6f7d45'; ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 9000, ['#7d8a4c', '#62703c', '#8a8a55', '#596838', '#77703f'], r, [1, 4]);
  return tex(c);
}
export function makeRadialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return tex(c, false);
}
export function makeConeTexture() {
  // Headlight beam on ground (pointing +y in texture)
  const [c, ctx] = canvas(128, 256);
  const g = ctx.createRadialGradient(64, 250, 0, 64, 250, 250);
  g.addColorStop(0, 'rgba(255,245,220,0.9)'); g.addColorStop(1, 'rgba(255,245,220,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(52, 256); ctx.lineTo(0, 0); ctx.lineTo(128, 0); ctx.lineTo(76, 256); ctx.fill();
  return tex(c, false);
}
export function makeTextTexture(text, { color = '#ff3cac', glow = '#ff3cac', font = 'bold 72px "Segoe UI", Arial', w = 512, h = 128, bg = null } = {}) {
  const [c, ctx] = canvas(w, h);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = glow; ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  ctx.shadowBlur = 0; ctx.fillText(text, w / 2, h / 2);
  return tex(c, false);
}
export function makeContainerTexture() {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 8) { ctx.fillStyle = x % 16 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)'; ctx.fillRect(x, 0, 4, 128); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, 256, 6); ctx.fillRect(0, 122, 256, 6);
  return tex(c, true);
}
export function makeRunwayTexture() {
  const [c, ctx] = canvas(256, 512);
  asphaltBase(ctx, 256, 512, rng(88));
  ctx.fillStyle = 'rgba(240,240,240,0.9)';
  ctx.fillRect(124, 0, 8, 200);
  ctx.fillRect(10, 0, 4, 512); ctx.fillRect(242, 0, 4, 512);
  return tex(c);
}
export function makeWallTexture(base = '#d8cfc0') {
  const r = rng(3);
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 128, 1500, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.06)'], r, [1, 3]);
  return tex(c);
}
export function makeFloorTileTexture() {
  const [c, ctx] = canvas(256, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#e8e4dc' : '#cfc9bd';
    ctx.fillRect(x * 32, y * 32, 32, 32);
  }
  return tex(c);
}

export function makeNoiseTexture() {
  const r = rng(41);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 12000, ['#6e6e6e', '#8c8c8c', '#787878', '#949494', '#666666'], r, [1, 4]);
  return tex(c);
}
