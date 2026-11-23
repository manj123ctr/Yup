// Sky dome, sun/moon lighting, day-night cycle, fog and image-based reflections.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../util.js';
import { ENV } from './materials.js';

const skyVert = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = `
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunCol;
uniform float uNight; uniform float uCloud; uniform float uTime; uniform float uFlash; uniform float uDark; uniform float uCityGlow;
varying vec3 vDir;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  // below horizon: haze
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.25, y));
  // city light pollution
  col += vec3(0.16, 0.08, 0.12) * uCityGlow * pow(1.0 - clamp(abs(y), 0.0, 1.0), 6.0);
  // sun
  float mu = dot(d, uSunDir);
  float sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
  col += uSunCol * pow(max(mu, 0.0), 6.0) * 0.35 * sunUp * (1.0 - uCloud * 0.7);
  col += uSunCol * pow(max(mu, 0.0), 120.0) * 1.2 * sunUp;
  col += uSunCol * smoothstep(0.9993, 0.9997, mu) * 30.0 * sunUp * (1.0 - uCloud * 0.9);
  // stars & moon
  if (uNight > 0.01) {
    vec2 sp = vec2(atan(d.z, d.x) * 260.0, d.y * 420.0);
    vec2 ci = floor(sp);
    vec2 fo = fract(sp) - 0.5 - (vec2(h(ci + 7.0), h(ci + 3.0)) - 0.5) * 0.6;
    float st = step(0.975, h(ci)) * smoothstep(0.2, 0.02, length(fo)) * smoothstep(0.0, 0.25, y);
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + h(ci + 1.0) * 30.0);
    col += vec3(st * tw * 1.6) * uNight * (1.0 - uCloud);
    float mm = dot(d, uMoonDir);
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9992, 0.9995, mm) * 2.2 * uNight;
    col += vec3(0.3, 0.35, 0.5) * pow(max(mm, 0.0), 90.0) * 0.18 * uNight;
  }
  // clouds
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.12);
    float c = fbm(uv * 1.2 + vec2(uTime * 0.004, uTime * 0.002));
    float c2 = fbm(uv * 3.1 - vec2(uTime * 0.006, 0.0));
    float cov = mix(0.62, 0.22, uCloud);
    float dens = smoothstep(cov, cov + 0.25, c * 0.75 + c2 * 0.35);
    vec3 lit = mix(vec3(1.0), uSunCol * 1.3, 0.45) * mix(1.0, 0.25, uNight);
    vec3 cc = mix(lit, vec3(0.32, 0.34, 0.38) * mix(1.0, 0.15, uNight), uDark * 0.85 + dens * 0.25);
    cc += uSunCol * pow(max(mu, 0.0), 8.0) * 0.6 * sunUp;
    col = mix(col, cc, dens * smoothstep(0.0, 0.12, y) * (0.55 + 0.45 * uCloud));
  }
  col = mix(col, vec3(dot(col, vec3(0.33))), uDark * 0.5);
  col *= mix(1.0, 0.45, uDark);
  col += vec3(0.8, 0.85, 1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Keyframes by sun elevation (sin of elevation)
const KEYS = [
  { e: -0.35, zen: [0.004, 0.006, 0.02], hor: [0.03, 0.04, 0.08], sun: [0.4, 0.5, 0.9], hemi: 0.18, sunI: 0 },
  { e: -0.12, zen: [0.02, 0.025, 0.09], hor: [0.2, 0.12, 0.22], sun: [0.9, 0.4, 0.5], hemi: 0.3, sunI: 0 },
  { e: 0.0, zen: [0.12, 0.16, 0.42], hor: [1.0, 0.45, 0.42], sun: [1.0, 0.45, 0.3], hemi: 0.6, sunI: 0.6 },
  { e: 0.12, zen: [0.16, 0.3, 0.68], hor: [1.0, 0.68, 0.52], sun: [1.0, 0.7, 0.45], hemi: 0.7, sunI: 2.0 },
  { e: 0.35, zen: [0.12, 0.36, 0.82], hor: [0.62, 0.78, 0.95], sun: [1.0, 0.93, 0.84], hemi: 0.75, sunI: 3.0 },
  { e: 1.0, zen: [0.08, 0.3, 0.8], hor: [0.55, 0.74, 0.95], sun: [1.0, 0.97, 0.92], hemi: 0.8, sunI: 3.4 },
];
function sampleKeys(e) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  if (e <= a.e) return a;
  if (e >= b.e) return b;
  for (let i = 0; i < KEYS.length - 1; i++) if (e >= KEYS[i].e && e <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  const t = (e - a.e) / (b.e - a.e);
  const l3 = (p, q) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
  return { zen: l3(a.zen, b.zen), hor: l3(a.hor, b.hor), sun: l3(a.sun, b.sun), hemi: lerp(a.hemi, b.hemi, t), sunI: lerp(a.sunI, b.sunI, t) };
}

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      uNight: { value: 0 }, uCloud: { value: 0.2 }, uTime: { value: 0 }, uFlash: { value: 0 }, uDark: { value: 0 }, uCityGlow: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), mat);
    this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    scene.add(this.dome);
    // environment scene for reflections
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
    this.envScene.add(this.envDome);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2), groundMat);
    this.envGround.position.y = -2;
    this.envScene.add(this.envGround);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTimer = 999; this.envRT = null;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.setShadowRange(110);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a48, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0x9fbbd6, 0.0012);
    this.fogBase = 0.0011;
    this.flash = 0;
    this.sunDir = new THREE.Vector3();
    this.night = 0;
  }
  setShadowRange(r) {
    const c = this.sun.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 900;
    c.updateProjectionMatrix();
    this.shadowRange = r;
  }
  setShadowQuality(q) {
    const size = [0, 1024, 2048, 4096][q] || 0;
    this.sun.castShadow = size > 0;
    if (size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }
  // hour: 0..24, weather: {cloud, dark, fogDensity}
  update(dt, hour, weather, focus, camera, time) {
    const theta = ((hour - 6) / 24) * Math.PI * 2;
    const sd = this.sunDir.set(Math.cos(theta), Math.sin(theta), 0.38).normalize();
    const e = sd.y;
    const k = sampleKeys(e);
    const u = this.uniforms;
    u.uSunDir.value.copy(sd);
    u.uMoonDir.value.set(-sd.x, Math.max(0.25, -sd.y), -0.3).normalize();
    const dark = weather.dark;
    u.uZenith.value.setRGB(...k.zen); u.uHorizon.value.setRGB(...k.hor); u.uSunCol.value.setRGB(...k.sun);
    const night = clamp(smoothstep(0.06, -0.14, e), 0, 1);
    this.night = night;
    u.uNight.value = night; u.uCloud.value = weather.cloud; u.uDark.value = dark; u.uTime.value = time;
    u.uCityGlow.value = night;
    this.flash = Math.max(0, this.flash - dt * 4);
    u.uFlash.value = this.flash;
    ENV.night.value = night;

    // Lights
    const sunVisible = e > -0.05;
    const L = sunVisible ? sd : u.uMoonDir.value;
    const intensity = sunVisible ? k.sunI * (1 - dark * 0.75) : 0.45 * (1 - dark * 0.7);
    this.sun.intensity = intensity + this.flash * 3;
    if (sunVisible) this.sun.color.setRGB(...k.sun); else this.sun.color.setRGB(0.55, 0.65, 1.0);
    // Shadow camera follows focus, snapped to texels
    const range = this.shadowRange;
    const texel = (range * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + L.x * 400, Math.max(30, L.y * 400), fz + L.z * 400);
    this.hemi.intensity = k.hemi * (1 - dark * 0.35) + this.flash * 2;
    this.hemi.color.setRGB(...k.zen).lerp(new THREE.Color(0.7, 0.75, 0.8), 0.5 + dark * 0.3);
    this.hemi.groundColor.setRGB(0.35, 0.3, 0.27).multiplyScalar(0.4 + 0.6 * (1 - night));
    // Fog color follows horizon
    const fc = new THREE.Color(...k.hor).lerp(new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(1 - night * 0.85), dark * 0.7);
    this.scene.fog.color.copy(fc);
    this.scene.fog.density = weather.fogDensity;
    // Dome follows camera
    this.dome.position.copy(camera.position);

    // Refresh reflections periodically
    this.envTimer += dt;
    if (this.envTimer > 2.5) {
      this.envTimer = 0;
      this.envGround.material.color.setRGB(0.2, 0.2, 0.2).multiplyScalar(1 - night * 0.85);
      const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 500);
      this.scene.environment = rt.texture;
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
    }
    this.scene.environmentIntensity = 0.35 + (1 - night) * 0.3;
  }
  lightning() { this.flash = 1.2; }
}
