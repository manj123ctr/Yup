// Shared materials with custom shader patches: procedural building facades
// (windows that light up at night) and wet-able ground surfaces.
import * as THREE from 'three';

export const ENV = {
  night: { value: 0 },   // 0 = day, 1 = full night
  wet: { value: 0 },     // 0 dry, 1 soaked
  time: { value: 0 },
};

const GLSL_HASH = `
float vcHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vcNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(vcHash(i), vcHash(i+vec2(1,0)), u.x), mix(vcHash(i+vec2(0,1)), vcHash(i+vec2(1,1)), u.x), u.y); }
`;

function patchWorldVaryings(shader, extraAttr = '') {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;\n${extraAttr}`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 vcwp = vec4(transformed, 1.0);
      vec3 vcn = objectNormal;
      #ifdef USE_INSTANCING
        vcwp = instanceMatrix * vcwp;
        vcn = mat3(instanceMatrix) * vcn;
      #endif
      vcwp = modelMatrix * vcwp;
      vWPos = vcwp.xyz;
      vWN = normalize(mat3(modelMatrix) * vcn);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;\nuniform float uNight;\nuniform float uWet;\n${GLSL_HASH}`);
  shader.uniforms.uNight = ENV.night;
  shader.uniforms.uWet = ENV.wet;
}

// Instanced building material. Requires instanced attribute aStyle (vec4):
// x = window width (m), y = floor height (m), z = type, w = seed
export function makeFacadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
  m.onBeforeCompile = (shader) => {
    patchWorldVaryings(shader, 'attribute vec4 aStyle;\nvarying vec4 vStyle;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStyle = aStyle;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vStyle;\nfloat vcWin; float vcLit; vec3 vcLitCol;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 N = normalize(vWN);
        float isWall = 1.0 - step(0.6, abs(N.y));
        vec2 fc = abs(N.x) > abs(N.z) ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
        float ww = vStyle.x, fh = vStyle.y, type = vStyle.z, seed = vStyle.w;
        vec2 cell = vec2(fc.x / ww, (fc.y - 0.3) / fh);
        vec2 id = floor(cell); vec2 f = fract(cell);
        float win = 0.0;
        if (type < 0.5) { // glass tower
          win = step(0.06, f.x) * step(f.x, 0.94) * step(0.12, f.y) * step(f.y, 0.92);
          diffuseColor.rgb *= 0.9;
        } else if (type < 1.5) { // concrete office / apartments
          win = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.82);
        } else if (type < 2.5) { // art deco ribbon windows + bands
          win = step(0.08, f.x) * step(f.x, 0.92) * step(0.36, f.y) * step(f.y, 0.74);
          float band = step(0.86, f.y) * step(f.y, 0.94);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), band * 0.6);
        } else if (type < 3.5) { // house
          win = step(0.3, f.x) * step(f.x, 0.7) * step(0.32, f.y) * step(f.y, 0.78) * step(0.45, vcHash(id + seed));
        } else { // warehouse corrugation
          diffuseColor.rgb *= 0.85 + 0.15 * step(0.5, fract(fc.x * 1.5));
          win = step(0.4, f.x) * step(f.x, 0.6) * step(0.55, f.y) * step(f.y, 0.75) * step(0.7, vcHash(id + seed));
        }
        // ground floor storefronts
        if (id.y < 0.5 && type < 2.5) win = step(0.04, f.x) * step(f.x, 0.96) * step(0.0, f.y) * step(f.y, 0.85);
        // fade the window grid to its average at a distance to avoid shimmering
        float vcAA = clamp(1.6 - max(fwidth(cell.x), fwidth(cell.y)) * 2.2, 0.0, 1.0);
        win = mix(type < 0.5 ? 0.7 : type < 2.5 ? 0.3 : 0.1, win, vcAA);
        win *= isWall * step(0.5, vWPos.y);
        // roofs: darker gravel/membrane
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.32, 0.33) + diffuseColor.rgb * 0.15, (1.0 - isWall) * step(0.0, N.y));
        vcWin = win;
        float h = vcHash(id * 1.37 + seed * 7.1);
        vcLit = step(0.6 - 0.25 * float(id.y < 0.5), h) * (0.55 + 0.45 * vcHash(id + 1.7));
        vcLitCol = mix(vec3(1.0, 0.78, 0.48), vec3(0.75, 0.85, 1.0), step(0.75, vcHash(id + 3.3)));
        vec3 glass = mix(vec3(0.06, 0.09, 0.13), vec3(0.18, 0.24, 0.3), vcHash(id + 9.0) * 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
        // ambient occlusion near ground & roof edge tint
        diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 5.0, vWPos.y));
        // grime streaks
        diffuseColor.rgb *= 0.92 + 0.08 * vcNoise(vec2(fc.x * 0.7, fc.y * 0.08));
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.06, vcWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.85, vcWin);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vcLitCol * vcWin * vcLit * uNight * 0.75;`);
  };
  m.customProgramCacheKey = () => 'facade';
  return m;
}

// Ground material that becomes darker and glossier (with puddles) in rain.
export function makeWetMaterial(params, key, worldUV = 0, wetStrength = 1) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    patchWorldVaryings(shader);
    if (worldUV) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 vcUv = abs(vWN.y) > 0.5 ? vWPos.xz : (abs(vWN.x) > 0.5 ? vWPos.zy : vWPos.xy);
          vec4 sampledDiffuseColor = texture2D(map, vcUv * ${worldUV.toFixed(4)});
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float vcP = smoothstep(0.45, 0.75, vcNoise(vWPos.xz * 0.11) * 0.7 + vcNoise(vWPos.xz * 0.5) * 0.3);
        float vcWetAmt = uWet * ${wetStrength.toFixed(3)} * (0.55 + 0.45 * vcP) * step(0.5, vWN.y);
        diffuseColor.rgb *= mix(1.0, 0.5, vcWetAmt);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.04, vcWetAmt);`);
  };
  m.customProgramCacheKey = () => 'wet_' + key;
  return m;
}

// Emissive material that fades in at night
export function makeNightGlowMaterial(color, strength = 2, key = 'glow') {
  const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: strength, roughness: 0.4 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = ENV.night;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= (0.08 + 0.92 * uNight);\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif');
  };
  m.customProgramCacheKey = () => 'nglow_' + key;
  return m;
}
