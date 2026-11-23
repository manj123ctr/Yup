// Dynamic weather: clear / cloudy / rain / storm / fog, with GPU rain streaks,
// wet surfaces and lightning.
import * as THREE from 'three';
import { lerp, R, clamp } from '../util.js';
import { ENV } from './materials.js';

export const WEATHER_TYPES = {
  clear: { cloud: 0.12, rain: 0, fog: 0.0005, dark: 0, wind: 0.2, label: 'Clear', icon: '☀' },
  cloudy: { cloud: 0.65, rain: 0, fog: 0.0009, dark: 0.25, wind: 0.4, label: 'Cloudy', icon: '☁' },
  rain: { cloud: 0.9, rain: 0.7, fog: 0.0022, dark: 0.55, wind: 0.6, label: 'Rain', icon: '🌧' },
  storm: { cloud: 1.0, rain: 1.0, fog: 0.003, dark: 0.75, wind: 1.0, label: 'Thunderstorm', icon: '⛈' },
  fog: { cloud: 0.5, rain: 0, fog: 0.009, dark: 0.3, wind: 0.05, label: 'Fog', icon: '🌫' },
};
const SEQUENCE = { clear: ['clear', 'cloudy', 'clear', 'fog'], cloudy: ['clear', 'rain', 'cloudy'], rain: ['storm', 'cloudy', 'rain'], storm: ['rain'], fog: ['clear', 'cloudy'] };

const rainVert = `
uniform float uTime; uniform vec3 uCam; uniform float uWind;
attribute vec4 aSeed; attribute float aEnd;
varying float vA;
void main(){
  vec3 box = vec3(70.0, 40.0, 70.0);
  vec3 p = aSeed.xyz * box;
  p.y = mod(p.y - uTime * (22.0 + aSeed.w * 6.0), box.y);
  vec3 base = uCam - box * 0.5 + vec3(0.0, -6.0, 0.0);
  vec3 wp = base + mod(p - (uCam - box * 0.5), box);
  wp.y = uCam.y - 14.0 + p.y;
  vec3 dir = normalize(vec3(uWind * 0.35, -1.0, uWind * 0.12));
  wp += dir * aEnd * 0.9;
  vA = 1.0 - aEnd * 0.6;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const rainFrag = `
uniform float uAmount; uniform vec3 uColor; varying float vA;
void main(){ gl_FragColor = vec4(uColor, uAmount * 0.38 * vA); }`;

export class Weather {
  constructor(scene, sky, audio) {
    this.sky = sky; this.audio = audio;
    this.type = 'clear';
    this.target = { ...WEATHER_TYPES.clear };
    this.cur = { ...WEATHER_TYPES.clear };
    this.timer = 240 + R() * 200;
    this.lightningTimer = 5;
    this.forecast = [];
    this.locked = false;
    const N = 7000;
    const seeds = new Float32Array(N * 2 * 4), ends = new Float32Array(N * 2), pos = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      seeds.set(s, i * 8); seeds.set(s, i * 8 + 4);
      ends[i * 2] = 0; ends[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uWind: { value: 0.3 }, uColor: { value: new THREE.Color(0.75, 0.8, 0.9) } };
    this.rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: this.rainU, vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.makeForecast();
  }
  makeForecast() {
    this.forecast = [];
    let t = this.type;
    for (let i = 0; i < 4; i++) { t = SEQUENCE[t][Math.floor(R() * SEQUENCE[t].length)]; this.forecast.push(t); }
  }
  set(type, instant = false) {
    this.type = type;
    this.target = { ...WEATHER_TYPES[type] };
    if (instant) this.cur = { ...this.target };
    this.timer = 200 + R() * 260;
  }
  update(dt, time, camera, night) {
    if (!this.locked) {
      this.timer -= dt;
      if (this.timer <= 0) { this.set(this.forecast.shift() || 'clear'); this.forecast.push(SEQUENCE[this.type][0]); }
    }
    const k = 1 - Math.exp(-dt * 0.12);
    for (const key of ['cloud', 'rain', 'fog', 'dark', 'wind']) this.cur[key] = lerp(this.cur[key], this.target[key], k);
    // wetness builds up in rain, dries slowly
    const w = ENV.wet.value;
    ENV.wet.value = clamp(this.cur.rain > 0.15 ? w + dt * 0.05 : w - dt * 0.006, 0, 1);
    this.rainU.uTime.value = time;
    this.rainU.uCam.value.copy(camera.position);
    this.rainU.uAmount.value = this.cur.rain;
    this.rainU.uWind.value = this.cur.wind;
    this.rainU.uColor.value.setRGB(0.75, 0.8, 0.9).multiplyScalar(1 - night * 0.6);
    this.rain.visible = this.cur.rain > 0.02;
    // lightning in storms
    if (this.type === 'storm' && this.cur.rain > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 6 + R() * 14;
        this.sky.lightning();
        const delay = 0.4 + R() * 2.5;
        setTimeout(() => this.audio && this.audio.thunder(1 - delay / 4), delay * 1000);
      }
    }
  }
  get params() { return { cloud: this.cur.cloud, rain: this.cur.rain, fogDensity: this.cur.fog, dark: this.cur.dark, wind: this.cur.wind }; }
}
