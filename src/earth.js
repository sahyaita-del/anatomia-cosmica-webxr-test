import * as THREE from 'three';

// A small, stylised blue Earth. Continents come from 3D simplex noise
// evaluated in object space (no textures, no seams), lit by a single soft
// "sun" plus a thin additive atmosphere shell.

const noiseGLSL = /* glsl */ `
  // Ashima Arts / Stefan Gustavson 3D simplex noise (MIT).
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
`;

const earthVertex = /* glsl */ `
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

const earthFragment = /* glsl */ `
  uniform float uReveal;
  uniform vec3 uLightDir;
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  ${noiseGLSL}

  void main() {
    vec3 p = vObj * 1.25;
    float n = snoise(p) * 0.62 + snoise(p * 2.1 + 7.1) * 0.26 + snoise(p * 4.7 - 3.7) * 0.12;
    n += smoothstep(0.8, 0.97, abs(vObj.y)) * 0.7; // pale polar caps
    // Coastline anti-aliased by screen-space derivative: no shimmer at 3 m.
    float aa = max(fwidth(n) * 1.5, 0.02);
    float land = smoothstep(0.16 - aa, 0.16 + aa, n);

    vec3 ocean = vec3(0.006, 0.035, 0.16);
    vec3 shallow = vec3(0.02, 0.10, 0.34);
    vec3 continent = vec3(0.16, 0.42, 0.85);
    vec3 col = mix(ocean, shallow, smoothstep(-0.25, 0.08, n));
    col = mix(col, continent, land);

    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    // Wrapped lambert: a gentle terminator instead of a hard shadow.
    float diff = clamp((dot(N, uLightDir) + 0.25) / 1.25, 0.0, 1.0);
    float light = 0.05 + diff * 1.15;
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

    col = col * light + vec3(0.12, 0.38, 1.0) * rim * (0.35 + diff * 0.9);
    gl_FragColor = vec4(col * uReveal, 1.0);
    #include <colorspace_fragment>
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
  uniform float uReveal;
  uniform vec3 uLightDir;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    // Back faces of a slightly larger sphere: glow peaks just outside the limb.
    float d = clamp(dot(-N, V), 0.0, 1.0);
    float glow = pow(smoothstep(0.0, 0.55, d) * (1.0 - smoothstep(0.55, 1.0, d)), 1.6);
    float lit = 0.35 + 0.65 * clamp(dot(-N, uLightDir) * 0.5 + 0.6, 0.0, 1.0);
    float a = glow * lit * uReveal * 0.9;
    gl_FragColor = vec4(vec3(0.18, 0.48, 1.0) * a, a);
    #include <colorspace_fragment>
  }
`;

export function createEarth({ radius = 0.2 } = {}) {
  const group = new THREE.Group();
  // Side light (sun to the right, slightly behind): a readable terminator.
  const lightDir = new THREE.Vector3(1, 0.3, 0.2).normalize();

  const earthMat = new THREE.ShaderMaterial({
    vertexShader: earthVertex,
    fragmentShader: earthFragment,
    uniforms: { uReveal: { value: 0 }, uLightDir: { value: new THREE.Vector3() } },
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), earthMat);
  earth.rotation.z = 0.41; // axial tilt, 23.4°
  group.add(earth);

  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: atmoVertex,
    fragmentShader: atmoFragment,
    uniforms: { uReveal: { value: 0 }, uLightDir: earthMat.uniforms.uLightDir },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.22, 48, 32), atmoMat);
  atmo.renderOrder = 2;
  group.add(atmo);

  const spinAxis = new THREE.Vector3(0, 1, 0);

  return {
    group,
    globe: earth,
    radius,
    update(reveal, dt, worldQuaternion) {
      group.visible = reveal > 0.001;
      earthMat.uniforms.uReveal.value = reveal;
      atmoMat.uniforms.uReveal.value = reveal;
      // Light is defined relative to the composition, so rotate it with it.
      earthMat.uniforms.uLightDir.value.copy(lightDir).applyQuaternion(worldQuaternion);
      earth.rotateOnAxis(spinAxis, dt * 0.035);
    },
  };
}
