import * as THREE from 'three';

// Expanding electromagnetic shells emitted by the Earth.
//
// Each wave is a translucent sphere: nearly invisible face-on, brighter at
// grazing angles (fresnel), so it reads as a volume boundary rather than a
// solid ball. Additive blending → order-independent, no sorting artefacts.
// The shell fades near the viewer's eyes so crossing it is a soft passage,
// never a flash. Once a shell is too faint to see it is hidden (saving
// full-screen overdraw), but its radius keeps driving the star highlights.

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uAxis;
  uniform float uAlpha;
  varying vec3 vWorld;

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float camDist = length(toCam);
    vec3 V = toCam / camDist;
    vec3 N = normalize(vWorld - uCenter);
    float f = 1.0 - abs(dot(N, V));
    float rim = f * f * f;
    // Radiation pattern of a dipole antenna: strongest at the equator,
    // fading toward the poles. Physically motivated structure that also
    // keeps the shell legible from inside, where there is no silhouette.
    float c = dot(N, uAxis);
    float dipole = 1.0 - c * c;
    float a = (rim * (0.45 + 0.55 * dipole) * 0.85 + 0.09 * (0.25 + 0.75 * dipole)) * uAlpha;
    a *= smoothstep(0.2, 1.6, camDist); // soft passage through the viewer
    vec3 col = mix(vec3(0.05, 0.22, 0.85), vec3(0.45, 0.75, 1.0), rim);
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }
`;

// Speed eases in from rest to a constant velocity (m/s): a signal, once
// launched, keeps going at "the speed of light" of this little universe.
const SPEED = 0.48;
const EASE = 4.0;
const MAX_VISIBLE_R = 20; // caps concurrent full-screen shells at ~3
const MAX_TRACKED_R = 95;

export function radiusAt(age, r0) {
  if (age <= 0) return r0;
  return r0 + SPEED * (age - EASE * (1 - Math.exp(-age / EASE)));
}

export function createWaves({ slots = 4, startRadius = 0.2 } = {}) {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 64, 40);
  const waves = [];
  const axis = new THREE.Vector3(0, 1, 0); // shared by all shells; set via setAxis()

  for (let i = 0; i < slots; i++) {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uCenter: { value: new THREE.Vector3() }, uAxis: { value: axis }, uAlpha: { value: 0 } },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false; // it will surround the viewer
    mesh.renderOrder = 3;
    group.add(mesh);
    waves.push({ mesh, material, birth: Infinity, strength: 0, radius: -100, intensity: 0 });
  }

  let next = 0;

  return {
    group,
    emit(time, strength) {
      const w = waves[next];
      next = (next + 1) % slots;
      w.birth = time;
      w.strength = strength;
    },
    setAxis(v) {
      axis.copy(v).normalize();
    },
    // How strongly a wavefront is passing through `point` right now (0..1).
    crossing(point, centerWorld) {
      const d = point.distanceTo(centerWorld);
      let k = 0;
      for (const w of waves) {
        if (w.intensity <= 0) continue;
        const x = (w.radius - d) / 1.1;
        k = Math.max(k, w.strength * Math.exp(-x * x));
      }
      return k;
    },
    reset() {
      for (const w of waves) {
        w.birth = Infinity;
        w.mesh.visible = false;
        w.radius = -100;
        w.intensity = 0;
      }
      next = 0;
    },
    // centerWorld: Earth's world position. Writes star uniforms.
    update(time, centerWorld, starUniforms) {
      for (let i = 0; i < slots; i++) {
        const w = waves[i];
        const age = time - w.birth;
        if (!(age >= 0)) {
          w.mesh.visible = false;
          w.radius = -100;
          w.intensity = 0;
          continue;
        }
        const r = radiusAt(age, startRadius);
        const birthFade = Math.min(1, age / 2.5);
        // Energy spreads over the shell: fade with distance, but gently
        // enough that it is still clearly present when it reaches the viewer.
        const falloff = 1 / (1 + r * 0.32);
        const edgeFade = 1 - Math.min(1, Math.max(0, (r - MAX_VISIBLE_R * 0.6) / (MAX_VISIBLE_R * 0.4)));
        const alpha = w.strength * birthFade * falloff * edgeFade;

        w.mesh.visible = alpha > 0.004;
        w.mesh.position.copy(centerWorld);
        w.mesh.scale.setScalar(r);
        w.material.uniforms.uCenter.value.copy(centerWorld);
        w.material.uniforms.uAlpha.value = alpha;

        w.radius = r;
        w.intensity = r < MAX_TRACKED_R ? w.strength * birthFade * (0.6 + 0.4 * falloff) : 0;
      }
      starUniforms.uWaveR.value.set(waves[0].radius, waves[1 % slots].radius, waves[2 % slots].radius, waves[3 % slots].radius);
      starUniforms.uWaveI.value.set(waves[0].intensity, waves[1 % slots].intensity, waves[2 % slots].intensity, waves[3 % slots].intensity);
    },
  };
}
