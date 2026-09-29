import * as THREE from 'three';

// ~1500 stars as real 3D points (one draw call). They sit at very different
// distances — from a few metres to ~90 m — so physical head movement produces
// genuine parallax instead of a painted skybox.
//
// The shader also reacts to the expanding waves: a star brightens briefly as
// a wavefront crosses it, and stays faintly "touched" by the first signal.

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aDelay;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPxScale;
  uniform vec3 uCenter;     // Earth, world space (origin of the waves)
  uniform vec4 uWaveR;      // radius of up to 4 active wavefronts
  uniform vec4 uWaveI;      // intensity of each wavefront
  uniform float uFirstR;    // radius of the first (historic) wave

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;

    float dist = max(-mv.z, 0.001);
    float reveal = smoothstep(aDelay, aDelay + 1.6, uTime);

    // Wavefront crossing: a soft gaussian around each shell radius.
    float d = distance(world.xyz, uCenter);
    vec4 x = (vec4(d) - uWaveR) / 0.9;
    float hit = dot(uWaveI, exp(-x * x));
    float touched = step(d, uFirstR) * 0.12;

    // Constant-ish angular size, slightly larger when very close.
    float size = aSize * uPxScale * clamp(pow(14.0 / dist, 0.3), 0.75, 1.6);
    size *= 1.0 + hit * 0.8;

    // Sub-pixel points shimmer on XR displays: keep >= 1.5 px and trade the
    // missing size for opacity instead.
    float alphaComp = clamp((size * size) / (1.5 * 1.5), 0.0, 1.0);
    gl_PointSize = max(size, 1.5);

    vColor = mix(aColor, vec3(0.55, 0.78, 1.0), clamp(hit * 0.7 + touched, 0.0, 1.0));
    vAlpha = reveal * alphaComp * (1.0 + hit * 1.4 + touched);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    // Soft core + gentle falloff: reads as a point of light, not a disc.
    float a = exp(-r2 * 4.0) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
    #include <colorspace_fragment>
  }
`;

// Deterministic PRNG so the sky is identical on every run.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Star colour by rough stellar temperature, kept desaturated.
const PALETTE = [
  [0.78, 0.86, 1.0], // blue-white
  [0.92, 0.95, 1.0], // white
  [1.0, 0.97, 0.92], // warm white
  [1.0, 0.88, 0.74], // pale orange (rare)
];

export function createStars({ count = 1500, startDelay = 0.4, revealSpan = 4.2 } = {}) {
  const rand = mulberry32(1977); // Voyager
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const delays = new Float32Array(count);

  const earthDir = new THREE.Vector3(0, 0, -1);
  const v = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    // Uniform direction on the sphere.
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    v.set(s * Math.cos(phi), u, s * Math.sin(phi));

    // Distance: a thin shell of "near dust" (2.6–10 m) gives strong parallax,
    // the rest recede to 90 m for depth and scale.
    const near = rand() < 0.18;
    let r = near ? 2.6 + Math.pow(rand(), 0.8) * 7.4 : 10 + Math.pow(rand(), 0.7) * 80;

    // Keep the line of sight to the Earth clean (no star between eye and it).
    if (r < 4.5 && v.angleTo(earthDir) < 0.2) r += 4.5;

    positions[i * 3] = v.x * r;
    positions[i * 3 + 1] = v.y * r;
    positions[i * 3 + 2] = v.z * r;

    const pick = rand();
    const c = PALETTE[pick < 0.3 ? 0 : pick < 0.72 ? 1 : pick < 0.94 ? 2 : 3];
    // Brightness follows a steep power law: many faint, a few bright.
    const mag = 0.45 + Math.pow(rand(), 4) * 0.9;
    colors[i * 3] = c[0] * mag;
    colors[i * 3 + 1] = c[1] * mag;
    colors[i * 3 + 2] = c[2] * mag;

    sizes[i] = 1.1 + Math.pow(rand(), 5) * 2.6 + (mag > 0.9 ? 0.6 : 0);
    // Brighter stars tend to appear first, like eyes adapting to the dark.
    delays[i] = startDelay + Math.pow(rand(), 0.8 + (1.25 - mag)) * revealSpan;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
  // The field surrounds the viewer; never let it be frustum-culled.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uPxScale: { value: 1 },
      uCenter: { value: new THREE.Vector3() },
      uWaveR: { value: new THREE.Vector4(-100, -100, -100, -100) },
      uWaveI: { value: new THREE.Vector4() },
      uFirstR: { value: -1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
  return points;
}
