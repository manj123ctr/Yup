// Animated ocean with Gerstner-style waves, fresnel sky reflection, sun glints,
// shallow-water coloring near beaches and foam lines.
import * as THREE from 'three';
import { WATER_Y, ISLAND } from './layout.js';

const vert = `
uniform float uTime; uniform float uWave;
varying vec3 vW; varying vec3 vN;
#include <fog_pars_vertex>
vec3 wave(vec2 p, vec2 dir, float len, float amp, float spd, inout vec3 tb, inout vec3 bn){
  float k = 6.2831 / len; float c = sqrt(9.8 / k) * spd;
  vec2 d = normalize(dir); float f = k * (dot(d, p) - c * uTime);
  float a = amp * uWave;
  float q = 0.5;
  tb += vec3(-q*d.x*d.x*a*k*sin(f), d.x*a*k*cos(f), -q*d.x*d.y*a*k*sin(f));
  bn += vec3(-q*d.x*d.y*a*k*sin(f), d.y*a*k*cos(f), -q*d.y*d.y*a*k*sin(f));
  return vec3(q*d.x*a*cos(f), a*sin(f), q*d.y*a*cos(f));
}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 tb = vec3(1,0,0), bn = vec3(0,0,1);
  vec3 off = vec3(0);
  off += wave(wp.xz, vec2(1.0, 0.3), 38.0, 0.35, 1.0, tb, bn);
  off += wave(wp.xz, vec2(0.7, -0.6), 21.0, 0.18, 1.0, tb, bn);
  off += wave(wp.xz, vec2(-0.3, 1.0), 13.0, 0.09, 1.0, tb, bn);
  off += wave(wp.xz, vec2(0.9, 0.9), 7.0, 0.05, 1.0, tb, bn);
  wp.xyz += off;
  vW = wp.xyz;
  vN = normalize(cross(bn, tb));
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const frag = `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uZenith; uniform vec3 uHorizon; uniform float uNight; uniform float uTime;
uniform float uRain; uniform float uSunI; uniform vec3 uIsland;
varying vec3 vW; varying vec3 vN;
#include <fog_pars_fragment>
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
void main(){
  vec3 V = normalize(cameraPosition - vW);
  // detail normal from animated noise
  vec2 p = vW.xz * 0.35;
  float e = 0.15;
  float t = uTime * 0.6;
  float h0 = n(p + t) + 0.5 * n(p * 2.3 - t * 1.3);
  float hx = n(p + vec2(e, 0) + t) + 0.5 * n((p + vec2(e, 0)) * 2.3 - t * 1.3);
  float hz = n(p + vec2(0, e) + t) + 0.5 * n((p + vec2(0, e)) * 2.3 - t * 1.3);
  float rip = 0.25 + uRain * 0.6;
  vec3 N = normalize(vN + vec3(h0 - hx, 0.0, h0 - hz) * rip);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(ry, 0.5));
  sky += vec3(0.16, 0.08, 0.12) * uNight * (1.0 - ry);
  // depth color: shallow near beach and island
  float shoreX = smoothstep(1060.0, 935.0, vW.x) * step(vW.z, 1240.0);
  float di = length(vW.xz - uIsland.xz);
  float shoreI = smoothstep(uIsland.y + 60.0, uIsland.y, di);
  float shallow = max(shoreX, shoreI);
  vec3 deep = vec3(0.01, 0.07, 0.12);
  vec3 shal = vec3(0.05, 0.42, 0.45);
  vec3 body = mix(deep, shal, shallow) * (0.25 + 0.75 * (1.0 - uNight)) * (0.3 + 0.7 * clamp(uSunI / 3.0 + 0.2, 0.0, 1.0));
  vec3 col = mix(body, sky, fres);
  // sun / moon glint
  vec3 Hs = normalize(uSunDir + V);
  float spec = pow(max(dot(N, Hs), 0.0), 400.0) * 6.0 * step(0.0, uSunDir.y);
  col += uSunCol * spec * clamp(uSunI, 0.0, 3.0);
  // foam near shore
  float foamBand = smoothstep(945.0, 935.0, vW.x) * smoothstep(925.0, 935.0, vW.x) + smoothstep(uIsland.y + 8.0, uIsland.y + 2.0, di) * smoothstep(uIsland.y - 4.0, uIsland.y + 2.0, di);
  float foam = foamBand * smoothstep(0.45, 0.8, n(vW.xz * 0.6 + uTime * 0.4));
  col = mix(col, vec3(0.9) * (1.0 - uNight * 0.8), foam * 0.8);
  gl_FragColor = vec4(col, 0.92 - shallow * 0.12);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Water {
  constructor(scene, sky) {
    this.sky = sky;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWave: { value: 1 }, uRain: { value: 0 }, uSunI: { value: 3 },
      uIsland: { value: new THREE.Vector3(ISLAND.x, ISLAND.r + 12, ISLAND.z) },
    }]);
    // share sky uniforms by reference
    const su = sky.uniforms;
    this.uniforms.uSunDir = su.uSunDir; this.uniforms.uSunCol = su.uSunCol;
    this.uniforms.uZenith = su.uZenith; this.uniforms.uHorizon = su.uHorizon; this.uniforms.uNight = su.uNight;
    this.uniforms.uIsland.value.set(ISLAND.x, ISLAND.r + 12, ISLAND.z);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, fog: true, transparent: true });
    const geo = new THREE.PlaneGeometry(2400, 2400, 220, 220).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_Y;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    // far ocean (flat, cheap)
    const far = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000, 1, 1).rotateX(-Math.PI / 2), mat);
    far.position.set(0, WATER_Y - 0.4, 0);
    far.renderOrder = 0;
    scene.add(far);
  }
  update(dt, time, camera, weather) {
    this.uniforms.uTime.value = time;
    this.uniforms.uRain.value = weather.rain;
    this.uniforms.uWave.value = 0.8 + weather.wind * 1.2;
    this.uniforms.uSunI.value = this.sky.sun.intensity;
    // keep the detailed grid under the camera (snapped to grid spacing)
    const s = 2400 / 220;
    this.mesh.position.x = Math.round(camera.position.x / s) * s;
    this.mesh.position.z = Math.round(camera.position.z / s) * s;
  }
}
