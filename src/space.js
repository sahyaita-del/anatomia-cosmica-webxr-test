import * as THREE from 'three';
import { SNOISE, mulberry32 } from './glsl.js';

// Deep space in two layers:
//  1. A sky cubemap BAKED ONCE at startup from a procedural shader: faint
//     Milky Way band with dust lanes, whisper-level nebulosity and thousands
//     of unresolved micro-stars. Runtime cost: one texture fetch per pixel.
//  2. ~4000 real 3D point stars at several depths (parallax + sparkle).

const bakeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bakeFragment = /* glsl */ `
  varying vec3 vDir;
  ${SNOISE}
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 6; i++) { s += a * snoise(p); p = p * 2.07 + 3.1; a *= 0.5; }
    return s;
  }
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

  // Unresolved stars: one candidate per direction cell.
  float microStars(vec3 d, float scale, float threshold) {
    vec3 q = d * scale;
    vec3 cell = floor(q);
    float h = hash(cell);
    if (h < threshold) return 0.0;
    vec3 jitter = vec3(hash(cell + 1.3), hash(cell + 7.1), hash(cell + 3.7));
    float r = length(q - cell - jitter);
    return smoothstep(0.35, 0.0, r) * (h - threshold) / (1.0 - threshold);
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 gN = normalize(vec3(0.32, 0.82, 0.47));     // galactic pole
    vec3 gC = normalize(vec3(0.8, -0.1, 0.55));       // galactic centre
    float b = dot(d, gN);
    float band = exp(-b * b / (2.0 * 0.11 * 0.11));
    float bulge = pow(max(dot(d, gC), 0.0), 6.0) * exp(-b * b / (2.0 * 0.2 * 0.2));
    float n = fbm(d * 3.2);
    float dust = smoothstep(0.05, 0.45, fbm(d * 5.5 + 9.0)) * exp(-b * b / (2.0 * 0.045 * 0.045));
    float mw = (band * (0.55 + 0.45 * n) + bulge * 0.9) * (1.0 - 0.75 * dust);

    vec3 col = vec3(0.0);
    col += mix(vec3(0.75, 0.8, 1.0), vec3(1.0, 0.86, 0.7), bulge * 2.0 + n * 0.3) * mw * 0.020;

    // Whisper-level nebulosity: a violet and a reddish region, mostly off-band.
    float neb = smoothstep(0.15, 0.7, fbm(d * 1.8 + 21.0));
    col += vec3(0.45, 0.3, 0.8) * neb * 0.0035;
    float neb2 = smoothstep(0.3, 0.8, fbm(d * 2.4 - 13.0)) * (0.3 + band);
    col += vec3(0.8, 0.28, 0.25) * neb2 * 0.0028;

    // Micro-stars, denser along the band.
    float s = microStars(d, 180.0, 0.93 - band * 0.05) * 0.25
            + microStars(d, 420.0, 0.955 - band * 0.06) * 0.12;
    vec3 tint = mix(vec3(0.8, 0.87, 1.0), vec3(1.0, 0.9, 0.78), hash(floor(d * 180.0) + 5.0));
    col += tint * s;

    // Dither to avoid banding in the very dark gradients.
    col += (hash(d * 1000.0) - 0.5) / 255.0 * 0.6;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <colorspace_fragment>
  }
`;

export function bakeSky(renderer, size = 1024) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: false });
  rt.texture.colorSpace = THREE.SRGBColorSpace; // sRGB storage: precision in the darks
  rt.texture.minFilter = THREE.LinearFilter;
  const scene = new THREE.Scene();
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(10, 64, 32),
      new THREE.ShaderMaterial({ vertexShader: bakeVertex, fragmentShader: bakeFragment, side: THREE.BackSide }),
    ),
  );
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  cam.update(renderer, scene);
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return rt.texture;
}

// ─── Point stars ─────────────────────────────────────────────────────────
const starVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPxScale;
  uniform float uBright;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aSize * uPxScale;
    float alphaComp = clamp((size * size) / (1.5 * 1.5), 0.0, 1.0);
    gl_PointSize = max(size, 1.5);
    vColor = aColor;
    vAlpha = alphaComp * uBright;
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 4.5) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
    #include <colorspace_fragment>
  }
`;

const PALETTE = [
  [0.72, 0.82, 1.0], // hot blue-white
  [0.9, 0.94, 1.0],
  [1.0, 0.97, 0.92],
  [1.0, 0.86, 0.7], // K
  [1.0, 0.72, 0.52], // M (rare)
];

// avoidDirs: [{dir, cosAngle}] cones where NEAR stars must not appear
// (e.g. in front of the Sun).
export function createStars({ count = 4000, avoid = [] } = {}) {
  const rand = mulberry32(1609); // Galileo
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    v.set(s * Math.cos(phi), u, s * Math.sin(phi));
    const layer = rand();
    // 8% near (parallax layer), 35% mid, rest very far.
    let r = layer < 0.08 ? 14 + rand() * 60 : layer < 0.43 ? 160 + rand() * 300 : 500 + rand() * 900;
    if (r < 120 && avoid.some((a) => v.dot(a.dir) > a.cosAngle)) r += 400;
    pos.set([v.x * r, v.y * r, v.z * r], i * 3);
    const pick = rand();
    const c = PALETTE[pick < 0.22 ? 0 : pick < 0.6 ? 1 : pick < 0.85 ? 2 : pick < 0.97 ? 3 : 4];
    const mag = 0.28 + Math.pow(rand(), 5) * 1.0;
    col.set([c[0] * mag, c[1] * mag, c[2] * mag], i * 3);
    size[i] = 0.9 + Math.pow(rand(), 6) * 3.0 + (layer < 0.08 ? 0.4 : 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: { uPxScale: { value: 1 }, uBright: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 1;
  return points;
}
