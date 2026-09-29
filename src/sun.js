import * as THREE from 'three';
import { mulberry32 } from './glsl.js';

// The Sun. Radius = 109 × Earth radius (set by the caller, never rescaled).
//
// Cost model for Quest: all expensive noise lives in a small tileable 3D
// texture generated once on the CPU. Per pixel the photosphere does a
// handful of texture fetches (granulation "boiling", mottling, warp) instead
// of evaluating noise functions.

// ─── Noise volume: R = cellular granulation, G/B = smooth fBm, A = cells 2 ──
function makeNoiseVolume(size = 64) {
  const rand = mulberry32(4242);
  const data = new Uint8Array(size * size * size * 4);

  // Periodic cellular (Worley F1) with `cells` cells per tile.
  function worley(cells, seedOffset) {
    const pts = new Float32Array(cells * cells * cells * 3);
    const r = mulberry32(seedOffset);
    for (let i = 0; i < pts.length; i++) pts[i] = r();
    const out = new Float32Array(size * size * size);
    const s = cells / size;
    let k = 0;
    for (let z = 0; z < size; z++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++, k++) {
          const px = x * s, py = y * s, pz = z * s;
          const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
          let best = 9;
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const ix = (cx + dx + cells) % cells, iy = (cy + dy + cells) % cells, iz = (cz + dz + cells) % cells;
                const j = ((iz * cells + iy) * cells + ix) * 3;
                const fx = cx + dx + pts[j] - px, fy = cy + dy + pts[j + 1] - py, fz = cz + dz + pts[j + 2] - pz;
                const d = fx * fx + fy * fy + fz * fz;
                if (d < best) best = d;
              }
          out[k] = Math.min(1, Math.sqrt(best));
        }
    return out;
  }

  // Periodic value-noise fBm.
  function fbm(seed) {
    const out = new Float32Array(size * size * size);
    let amp = 0.5, norm = 0;
    for (let period = 4; period <= 32; period *= 2) {
      const lat = new Float32Array(period * period * period);
      const r = mulberry32(seed + period);
      for (let i = 0; i < lat.length; i++) lat[i] = r();
      const s = period / size;
      let k = 0;
      for (let z = 0; z < size; z++)
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++, k++) {
            const px = x * s, py = y * s, pz = z * s;
            const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
            let fx = px - x0, fy = py - y0, fz = pz - z0;
            fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
            const g = (a, b, c) => lat[(((c % period) * period + (b % period)) * period) + (a % period)];
            const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
            const v =
              ((g(x0, y0, z0) * (1 - fx) + g(x1, y0, z0) * fx) * (1 - fy) + (g(x0, y1, z0) * (1 - fx) + g(x1, y1, z0) * fx) * fy) * (1 - fz) +
              ((g(x0, y0, z1) * (1 - fx) + g(x1, y0, z1) * fx) * (1 - fy) + (g(x0, y1, z1) * (1 - fx) + g(x1, y1, z1) * fx) * fy) * fz;
            out[k] += v * amp;
          }
      norm += amp;
      amp *= 0.5;
    }
    for (let k = 0; k < out.length; k++) out[k] /= norm;
    return out;
  }

  const w1 = worley(8, Math.floor(rand() * 1e6));
  const w2 = worley(8, Math.floor(rand() * 1e6));
  const f1 = fbm(11);
  const f2 = fbm(97);
  for (let k = 0; k < w1.length; k++) {
    data[k * 4] = w1[k] * 255;
    data[k * 4 + 1] = f1[k] * 255;
    data[k * 4 + 2] = f2[k] * 255;
    data[k * 4 + 3] = w2[k] * 255;
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// ─── Photosphere ──────────────────────────────────────────────────────────
const photoVertex = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vObj = normalize(position);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const photoFragment = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform float uTime;
  uniform float uReveal;      // 0..1 photosphere dawn
  uniform float uBright;      // global brightness (fade out)
  uniform vec3 uRevealDir;    // object-space direction where the dawn starts
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vWorld;

  float cells(vec3 p) { return texture(uNoise, p).r; }

  void main() {
    vec3 p = vObj;
    float t = uTime;

    // Slow large-scale flow warps the granulation field.
    vec3 warp = texture(uNoise, p * 0.35 + vec3(0.0, t * 0.0025, 0.0)).gba - 0.5;
    vec3 q = p * 3.2 + warp * 0.18;

    // Boiling: two drifting cell fields cross-fade continuously.
    float ph = 0.5 + 0.5 * sin(t * 0.35);
    float g1 = cells(q + vec3(t * 0.004, 0.0, 0.0));
    float g2 = texture(uNoise, q * 1.13 + vec3(0.31, 0.57, t * 0.004)).a;
    float f1 = mix(g1, g2, ph);
    float gran = 1.0 - smoothstep(0.15, 0.85, f1);           // bright cells, dark lanes
    float fine = 1.0 - texture(uNoise, q * 2.7 + vec3(0.0, t * 0.006, 0.2)).r;

    // Mottling / active regions at large scale.
    float mott = texture(uNoise, p * 0.55 + vec3(t * 0.0012, 0.0, 0.0)).g;

    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    float mu = clamp(dot(N, V), 0.0, 1.0);

    // Limb darkening (quadratic law) with colour shift toward the limb.
    float limb = 1.0 - 0.62 * (1.0 - mu) - 0.18 * (1.0 - mu) * (1.0 - mu);
    vec3 core = vec3(1.0, 0.62, 0.22);
    vec3 edge = vec3(0.85, 0.22, 0.03);
    vec3 col = mix(edge, core, pow(mu, 0.45));

    float intensity = limb;
    intensity *= 0.80 + 0.22 * gran + 0.06 * fine;
    intensity *= 0.88 + 0.26 * (mott - 0.5) * 2.0 * 0.5 + 0.06;
    // Faculae: bright patches that show near the limb.
    intensity += smoothstep(0.58, 0.72, mott) * pow(1.0 - mu, 2.0) * 0.35;

    // A few sunspots (umbra + penumbra), slightly irregular.
    vec3 spotA = normalize(vec3(0.35, 0.18, 0.92));
    vec3 spotB = normalize(vec3(0.42, 0.12, 0.90));
    vec3 spotC = normalize(vec3(-0.2, -0.28, 0.94));
    float irr = (texture(uNoise, p * 4.0).g - 0.5) * 0.004;
    float sA = acos(clamp(dot(p, spotA), -1.0, 1.0)) + irr;
    float sB = acos(clamp(dot(p, spotB), -1.0, 1.0)) + irr;
    float sC = acos(clamp(dot(p, spotC), -1.0, 1.0)) + irr;
    float pen = smoothstep(0.022, 0.012, sA) + smoothstep(0.013, 0.007, sB) + smoothstep(0.016, 0.009, sC);
    float umb = smoothstep(0.010, 0.006, sA) + smoothstep(0.006, 0.003, sB) + smoothstep(0.007, 0.004, sC);
    intensity *= 1.0 - clamp(pen, 0.0, 1.0) * 0.45 - clamp(umb, 0.0, 1.0) * 0.4;

    // Dawn: the photosphere lights up progressively from one limb.
    float s = dot(p, uRevealDir);
    float sweep = mix(1.25, -1.6, uReveal);
    float dawn = smoothstep(sweep - 0.05, sweep + 0.9, s) * smoothstep(0.0, 0.35, uReveal);

    vec3 c = col * intensity * 1.2;
    c = 1.0 - exp(-c * 1.5);                                    // soft highlight roll-off
    gl_FragColor = vec4(c * dawn * uBright, 1.0);
    #include <colorspace_fragment>
  }
`;

// ─── Corona / glow (one viewer-facing quad at the Sun's centre) ────────────
const coronaVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const coronaFragment = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform float uTime;
  uniform float uGlow;
  uniform vec3 uAxis;
  varying vec3 vWorld;

  void main() {
    vec3 v = normalize(vWorld - cameraPosition);
    vec3 toC = uCenter - cameraPosition;
    float dist = length(toC);
    vec3 c = toC / dist;
    float theta = acos(clamp(dot(v, c), -1.0, 1.0));
    float alpha = asin(clamp(uRadius / dist, 0.0, 1.0));
    float rho = theta / alpha;                 // 1.0 at the visible limb
    if (rho < 0.985) discard;
    float h = max(rho - 1.0, 0.0);

    // Position angle around the disc (for streamers).
    vec3 b1 = normalize(cross(c, uAxis));
    vec3 b2 = cross(b1, c);
    float phi = atan(dot(v, b2), dot(v, b1));
    vec3 sp = vec3(cos(phi), sin(phi), 0.0) * 1.3 + vec3(0.0, 0.0, h * 0.25 - uTime * 0.0015);
    float streak = texture(uNoise, sp).g;
    streak = pow(clamp(streak * 1.25, 0.0, 1.0), 3.0);

    float inner = exp(-h * 22.0);              // thin bright chromospheric rim
    float glow = exp(-h * 9.0) * 0.4 + exp(-h * 2.6) * 0.07;
    float str = streak * exp(-h * 2.4) * 0.22;
    float fadeEdge = 1.0 - smoothstep(0.35, 0.8, h);

    vec3 col = vec3(1.0, 0.45, 0.2) * inner * 0.8
             + vec3(1.0, 0.66, 0.36) * glow
             + vec3(1.0, 0.85, 0.65) * str;
    col *= uGlow * fadeEdge;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// ─── Prominences (plasma arches at the visible limb) ───────────────────────
const promVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const promFragment = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform float uTime;
  uniform float uLife;   // 0..1 envelope
  uniform float uSeed;
  uniform float uRise;   // slow growth of the arch
  varying vec2 vUv;

  void main() {
    // uv.x in [-1,1] across the base, uv.y in [0,1] radially outward.
    vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
    float h = 0.55 + 0.35 * uRise;
    // Arch: an ellipse through the two footpoints.
    vec2 e = vec2(p.x / 0.62, (p.y - 0.06) / h);
    float r = length(e);
    float ang = atan(e.y, e.x);                           // 0..pi along the arch
    float along = clamp(ang / 3.14159, 0.0, 1.0);

    vec3 np = vec3(along * 3.0 + uSeed, r * 2.5, uTime * 0.01 + uSeed * 0.37);
    float n1 = texture(uNoise, np * 0.5).g;
    float n2 = texture(uNoise, np * 1.3 + vec3(0.0, -uTime * 0.006, 0.0)).b;
    float thick = 0.2 + 0.18 * n1;
    float band = 1.0 - smoothstep(0.0, thick, abs(r - 1.0 + (n2 - 0.5) * 0.3));
    band *= band;
    // Filaments & knots along the arch.
    float fil = 0.45 + 0.9 * pow(texture(uNoise, vec3(along * 6.0 + uSeed, r * 10.0, uTime * 0.02)).b, 2.0);
    float feet = smoothstep(0.0, 0.08, p.y);
    float edges = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(1.0, 0.8, vUv.y);
    float I = band * fil * feet * uLife * step(0.0, e.y) * 0.65;
    // Soft outer haze.
    I += exp(-pow((r - 1.0) / 0.35, 2.0)) * 0.08 * uLife * feet * step(0.0, e.y);
    I *= edges;
    vec3 col = mix(vec3(1.0, 0.32, 0.18), vec3(1.0, 0.7, 0.45), clamp(fil - 0.5, 0.0, 1.0));
    gl_FragColor = vec4(col * I, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSun({ radius }) {
  const noise = makeNoiseVolume(64);
  const group = new THREE.Group();

  const time = { value: 0 };
  const revealDir = new THREE.Vector3(1, 0, 0);
  const photo = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 128, 96),
    new THREE.ShaderMaterial({
      vertexShader: photoVertex,
      fragmentShader: photoFragment,
      uniforms: {
        uNoise: { value: noise },
        uTime: time,
        uReveal: { value: 0 },
        uBright: { value: 1 },
        uRevealDir: { value: revealDir },
      },
    }),
  );
  group.add(photo);

  const coronaU = {
    uNoise: { value: noise },
    uCenter: { value: new THREE.Vector3() },
    uRadius: { value: radius },
    uTime: time,
    uGlow: { value: 0 },
    uAxis: { value: new THREE.Vector3(0, 1, 0) },
  };
  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: coronaVertex,
      fragmentShader: coronaFragment,
      uniforms: coronaU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  corona.frustumCulled = false;
  corona.renderOrder = 3;

  // Prominences: [position angle (rad, 0 = right, CCW), width (R), period (s), phase]
  const PROMS = [
    [1.05, 0.2, 62, 0.15],
    [2.05, 0.26, 75, 0.55],
    [2.75, 0.16, 58, 0.35],
    [3.85, 0.24, 80, 0.8],
    [4.7, 0.18, 66, 0.05],
    [5.55, 0.22, 71, 0.62],
  ];
  const promGeo = new THREE.PlaneGeometry(1, 1);
  promGeo.translate(0, 0.5, 0); // base at the limb
  const proms = PROMS.map(([angle, width, period, phase], i) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: promVertex,
      fragmentShader: promFragment,
      uniforms: {
        uNoise: { value: noise },
        uTime: time,
        uLife: { value: 0 },
        uSeed: { value: i * 1.713 },
        uRise: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(promGeo, mat);
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    mesh.userData = { angle, width, period, phase };
    return mesh;
  });

  const tmp = new THREE.Vector3();
  const c = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const er = new THREE.Vector3();
  const et = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const center = new THREE.Vector3();
  const negC = new THREE.Vector3();

  return {
    group,
    corona,
    proms,
    radius,
    // eye: viewer position (world). revealTowardWorld: where the dawn starts.
    update(t, { visible, glow, reveal, bright }, eye, revealTowardWorld) {
      time.value = t;
      group.visible = visible;
      photo.material.uniforms.uReveal.value = reveal;
      photo.material.uniforms.uBright.value = bright;
      group.getWorldPosition(center);
      // Reveal direction in the photosphere's object space.
      revealDir.copy(revealTowardWorld).sub(center).normalize();
      photo.worldToLocal(tmp.copy(center).add(revealDir));
      revealDir.copy(tmp).normalize();

      // Corona quad: at the centre, facing the viewer, big enough for ~2.8 R.
      corona.visible = visible && glow > 0.001;
      coronaU.uGlow.value = glow;
      coronaU.uCenter.value.copy(center);
      const dist = center.distanceTo(eye);
      corona.position.copy(center);
      corona.lookAt(eye);
      const size = dist * 4.2; // half-size reaches ~64° from the centre
      corona.scale.set(size, size, 1);

      // Limb frame as seen from the viewer.
      c.copy(center).sub(eye).normalize();
      u.crossVectors(c, up).normalize(); // screen-right on the disc
      v.crossVectors(u, c).normalize(); // screen-up on the disc
      const rs = radius * Math.sqrt(Math.max(0, 1 - (radius / dist) ** 2));
      const silCenter = tmp.copy(center).addScaledVector(c, -(radius * radius) / dist);
      for (const p of proms) {
        const { angle, width, period, phase } = p.userData;
        // Lifecycle: slow emergence, long life, slow decay; deterministic in t.
        const x = (t / period + phase) % 1;
        const life = Math.sin(Math.PI * x) ** 1.5;
        p.visible = visible && glow > 0.01 && life > 0.01;
        p.material.uniforms.uLife.value = life * Math.min(1, glow * 1.2) * bright;
        p.material.uniforms.uRise.value = x;
        er.set(Math.cos(angle) * u.x + Math.sin(angle) * v.x, Math.cos(angle) * u.y + Math.sin(angle) * v.y, Math.cos(angle) * u.z + Math.sin(angle) * v.z);
        et.crossVectors(c, er).normalize();
        const w = width * radius;
        const hgt = radius * 0.2;
        p.position.copy(silCenter).addScaledVector(er, rs - radius * 0.012).addScaledVector(c, -radius * 0.05);
        m.makeBasis(et, er, negC.copy(c).negate());
        p.quaternion.setFromRotationMatrix(m);
        p.scale.set(w, hgt, 1);
      }
    },
  };
}
