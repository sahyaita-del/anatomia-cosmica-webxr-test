import * as THREE from 'three';
import { SNOISE } from './glsl.js';

// Earth: NASA Blue Marble surface, city lights on the night side, ocean
// glint, procedural cloud layer (separate sphere, own rotation) and a thin
// atmosphere. Lit by a single direction: the Sun.

const surfaceVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const surfaceFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uWater;
  uniform vec3 uSunDir;
  uniform float uFade;
  uniform float uExposure;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = uSunDir;
    float ndl = dot(N, L);
    float lambert = max(ndl, 0.0);
    float dayMix = smoothstep(-0.10, 0.18, ndl);

    vec3 day = texture2D(uDay, vUv).rgb;
    float water = texture2D(uWater, vUv).r;
    vec3 night = texture2D(uNight, vUv).rgb;
    // City lights: the warm, bright part of the night image only.
    float lights = smoothstep(0.12, 0.55, night.r - night.b * 0.35);

    vec3 col = day * (lambert * 1.35 + 0.012);

    // Ocean glint (sun reflection), only on water.
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 70.0) * water * lambert;
    col += vec3(1.0, 0.92, 0.8) * spec * 0.55;

    // Night side: sparse warm city lights.
    col += vec3(1.0, 0.72, 0.42) * lights * (1.0 - dayMix) * 0.55;

    // Twilight: a warm hint along the terminator.
    float twilight = exp(-pow(ndl / 0.1, 2.0));
    col += vec3(0.35, 0.12, 0.04) * twilight * 0.12;

    // Atmosphere seen inside the disc: blue haze toward the limb, lit side.
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
    col = mix(col, vec3(0.25, 0.5, 1.0) * (0.15 + lambert), rim * smoothstep(-0.25, 0.35, ndl) * 0.55);

    gl_FragColor = vec4(col * uFade * uExposure, 1.0);
    #include <colorspace_fragment>
  }
`;

const cloudFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uFade;
  uniform float uTime;
  varying vec3 vObj;
  varying vec3 vNormalW;
  ${SNOISE}

  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * snoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 p = vObj;
    // Domain warp gives swirls / weather fronts instead of blobs.
    vec3 w = vec3(snoise(p * 1.6 + 11.0), snoise(p * 1.6 + 23.0), snoise(p * 1.6 - 7.0));
    float n = fbm(p * 2.6 + w * 0.55 + vec3(0.0, 0.0, uTime * 0.004));
    // Climate belts: cloudy tropics & storm tracks, clearer subtropics.
    float lat = abs(p.y);
    float belt = 0.55 + 0.35 * exp(-pow((lat - 0.02) / 0.12, 2.0))
                      + 0.35 * exp(-pow((lat - 0.8) / 0.18, 2.0))
                      - 0.30 * exp(-pow((lat - 0.42) / 0.12, 2.0));
    float d = smoothstep(0.08, 0.55, n * belt + (belt - 0.55) * 0.35);

    vec3 N = normalize(vNormalW);
    float ndl = dot(N, uSunDir);
    float light = smoothstep(-0.08, 0.35, ndl) * (0.25 + 0.75 * max(ndl, 0.0));
    vec3 col = vec3(1.0, 0.99, 0.97) * light * 1.1;
    float a = d * 0.92 * uFade;
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }
`;

const cloudVertex = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vNormalW;
  void main() {
    vObj = normalize(position);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const atmoVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const atmoFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uFade;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    float d = clamp(dot(-N, V), 0.0, 1.0);
    // Thin shell (2.5% of radius): glow peaks right at the limb.
    float glow = smoothstep(0.0, 0.2, d) * (1.0 - smoothstep(0.2, 0.34, d));
    float lit = smoothstep(-0.35, 0.5, dot(-N, uSunDir));
    float a = glow * lit * uFade * 0.85;
    gl_FragColor = vec4(vec3(0.3, 0.58, 1.0) * a, a);
    #include <colorspace_fragment>
  }
`;

export function createEarth(renderer, { radius = 0.24 } = {}) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (url, srgb) => {
    const t = loader.load(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = aniso;
    return t;
  };
  const base = import.meta.env.BASE_URL;

  const sunDir = new THREE.Vector3(-1, 0, 0);
  const fade = { value: 0 };
  const exposure = { value: 1 };

  const group = new THREE.Group(); // positioned by the choreography
  const tilt = new THREE.Group();
  tilt.rotation.z = 0.41; // 23.4° axial tilt
  group.add(tilt);

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
      uniforms: {
        uDay: { value: load(`${base}textures/earth-day.jpg`, true) },
        uNight: { value: load(`${base}textures/earth-night.jpg`, true) },
        uWater: { value: load(`${base}textures/earth-water.png`, false) },
        uSunDir: { value: sunDir },
        uFade: fade,
        uExposure: exposure,
      },
    }),
  );
  tilt.add(surface);

  const cloudUniforms = { uSunDir: { value: sunDir }, uFade: fade, uTime: { value: 0 } };
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.008, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      uniforms: cloudUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, // premultiplied: clouds occlude the surface
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }),
  );
  clouds.renderOrder = 5;
  tilt.add(clouds);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.025, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: atmoVertex,
      fragmentShader: atmoFragment,
      uniforms: { uSunDir: { value: sunDir }, uFade: fade },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  atmo.renderOrder = 6;
  group.add(atmo);

  return {
    group,
    radius,
    // lightDirWorld: unit vector from Earth toward the Sun (world space).
    update(t, visibility, lightDirWorld, exp = 1) {
      exposure.value = exp;
      group.visible = visibility > 0.001;
      fade.value = visibility;
      sunDir.copy(lightDirWorld);
      // Very slow rotation (deterministic in t). Starts over Africa/Atlantic.
      surface.rotation.y = -1.75 + t * 0.012;
      clouds.rotation.y = -1.75 + t * 0.0145;
      cloudUniforms.uTime.value = t;
    },
  };
}
