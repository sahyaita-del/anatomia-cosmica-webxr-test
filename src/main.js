import * as THREE from 'three';
import { T, ramp, envelope } from './timeline.js';
import { createStars } from './stars.js';
import { createEarth } from './earth.js';
import { createWaves, radiusAt } from './wave.js';
import { createSpatialText } from './text.js';
import './style.css';

// ─── Renderer ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1); // fixed foveated rendering on Quest (cheap peripheral pixels)
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const EYE_HEIGHT = 1.6;
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400);
camera.position.set(0, EYE_HEIGHT, 0);
camera.rotation.order = 'YXZ';
scene.add(camera);

// ─── Composition ─────────────────────────────────────────────────────────────
// Everything lives in `world`, whose origin is the viewer's head at the start.
// In VR it is re-anchored to the real head pose, so the Earth always appears
// 3 m in front of wherever the user is looking — standing or seated.
const world = new THREE.Group();
world.position.set(0, EYE_HEIGHT, 0);
scene.add(world);

const stars = createStars({ count: 1500, startDelay: T.starsIn[0], revealSpan: T.starsIn[1] - T.starsIn[0] - 1.2 });
world.add(stars);

const earth = createEarth({ radius: 0.2 });
earth.group.position.set(0, 0, -3);
world.add(earth.group);

const waves = createWaves({ slots: 4, startRadius: 0.2 });
scene.add(waves.group); // positioned in world coordinates each frame

// Text: slightly below the eye line (the comfortable reading zone), layered
// in depth. The final question floats behind the Earth, among the stars.
// Sizes target ~1.3–1.6° cap height: comfortably legible on Quest 3S.
const text1 = createSpatialText(renderer, 'DESDE HACE APENAS UN SIGLO', { height: 0.08, tracking: 0.28 });
const text2 = createSpatialText(renderer, 'NUESTRAS SEÑALES VIAJAN\nHACIA LAS ESTRELLAS', { height: 0.08, tracking: 0.28 });
const text3 = createSpatialText(renderer, '¿QUIÉN PODRÍA ESTAR\nESCUCHANDO?', { height: 0.2, weight: 300, tracking: 0.3 });
text1.place(new THREE.Vector3(0, -0.4, -2.75));
text2.place(new THREE.Vector3(0.0, -0.66, -2.5));
text3.place(new THREE.Vector3(0, 0.82, -5.6));
world.add(text1.mesh, text2.mesh, text3.mesh);

// ─── Timeline state ──────────────────────────────────────────────────────────
let time = 0;
let playing = false;
let nextEcho = T.echoStart;
let firstWaveEmitted = false;

function restart() {
  time = 0;
  playing = true;
  nextEcho = T.echoStart;
  firstWaveEmitted = false;
  waves.reset();
}

// ─── Desktop preview controls (look + walk, to feel the parallax) ───────────
let yaw = 0;
let pitch = 0;
const keys = new Set();
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', () => (dragging = false));
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging || renderer.xr.isPresenting) return;
  yaw += e.movementX * 0.0025;
  pitch = THREE.MathUtils.clamp(pitch + e.movementY * 0.0025, -1.3, 1.3);
});
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR' && !renderer.xr.isPresenting) restart();
  if (e.code === 'Escape' && !renderer.xr.isPresenting) showOverlay(true);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

const move = new THREE.Vector3();
function updateDesktopCamera(dt) {
  camera.rotation.set(-pitch, -yaw, 0);
  move.set((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), 0, (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0));
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(dt * 0.8).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
    camera.position.add(move);
    // Stay within a room-sized area around the start point, like in VR.
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -1.5, 1.5);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -1.5, 1.5);
  }
}

function resetDesktopCamera() {
  yaw = 0;
  pitch = 0;
  camera.position.set(0, EYE_HEIGHT, 0);
  camera.rotation.set(0, 0, 0);
  world.position.set(0, EYE_HEIGHT, 0);
  world.rotation.set(0, 0, 0);
}

// ─── WebXR session ───────────────────────────────────────────────────────────
const overlay = document.getElementById('overlay');
const vrButton = document.getElementById('enter-vr');
const previewButton = document.getElementById('preview');
const status = document.getElementById('status');
const hint = document.getElementById('hint');

let recenterFrames = 0;

function showOverlay(visible) {
  overlay.classList.toggle('hidden', !visible);
  if (visible) {
    playing = false;
    time = 0;
    waves.reset();
  }
}

async function setupVRButton() {
  if (!window.isSecureContext) {
    status.textContent = 'WebXR requiere HTTPS. Abre la dirección https:// (ver README).';
    return;
  }
  if (!('xr' in navigator)) {
    status.textContent = 'Este navegador no tiene WebXR. Usa la vista previa o Meta Quest Browser.';
    return;
  }
  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported('immersive-vr');
  } catch {
    supported = false;
  }
  if (!supported) {
    status.textContent = 'Realidad virtual no disponible aquí. Usa la vista previa.';
    return;
  }
  vrButton.disabled = false;
  vrButton.addEventListener('click', enterVR);
}

async function enterVR() {
  if (renderer.xr.isPresenting) return;
  vrButton.disabled = true;
  try {
    // Must be called directly from the click (user activation).
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'layers'],
    });
    const features = session.enabledFeatures;
    renderer.xr.setReferenceSpaceType(features && !features.includes('local-floor') ? 'local' : 'local-floor');
    session.addEventListener('end', onSessionEnd);
    await renderer.xr.setSession(session);
    showOverlay(false);
    restart();
    recenterFrames = 3; // wait for a valid head pose, then anchor the scene
  } catch (err) {
    console.error(err);
    status.textContent = 'No se pudo iniciar la sesión VR: ' + (err?.message ?? err);
  } finally {
    vrButton.disabled = false;
  }
}

function onSessionEnd() {
  resetDesktopCamera();
  onResize();
  showOverlay(true);
}

const headPos = new THREE.Vector3();
const headDir = new THREE.Vector3();
function recenterToHead() {
  // `camera` holds the last XR head pose (three copies it after rendering).
  camera.getWorldPosition(headPos);
  camera.getWorldDirection(headDir);
  world.position.copy(headPos);
  world.rotation.set(0, Math.atan2(-headDir.x, -headDir.z), 0);
}

previewButton.addEventListener('click', () => {
  resetDesktopCamera();
  showOverlay(false);
  restart();
  hint.classList.add('visible');
  setTimeout(() => hint.classList.remove('visible'), 7000);
});

function onResize() {
  if (renderer.xr.isPresenting) return; // the XR compositor owns the size
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ─── Frame loop ──────────────────────────────────────────────────────────────
let lastFrame = -1;
const earthWorld = new THREE.Vector3();
const eyeWorld = new THREE.Vector3();
const spinAxis = new THREE.Vector3();
// Deep-space blue the void takes on while a wavefront passes through you
// (a clear-colour change: zero rendering cost).
const WASH = new THREE.Color().setRGB(0.0012, 0.0035, 0.015);
const su = stars.material.uniforms;
const tmpQ = new THREE.Quaternion();

function pixelScale() {
  if (renderer.xr.isPresenting) {
    const eye = renderer.xr.getCamera().cameras[0];
    const h = eye?.viewport?.w;
    return (h > 0 ? h : 1800) / 1000;
  }
  return renderer.domElement.height / 1000;
}

renderer.setAnimationLoop((now) => {
  // Clamp dt: if the headset pauses rendering (system menu), the story pauses.
  const dt = lastFrame < 0 ? 0 : Math.min(Math.max((now - lastFrame) / 1000, 0), 0.1);
  lastFrame = now;
  if (playing) time += dt;

  if (renderer.xr.isPresenting) {
    if (recenterFrames > 0 && --recenterFrames === 0) recenterToHead();
  } else {
    updateDesktopCamera(dt);
  }

  // Sequence
  if (playing && !firstWaveEmitted && time >= T.waveStart) {
    waves.emit(T.waveStart, 1.0);
    firstWaveEmitted = true;
  }
  if (playing && time >= nextEcho) {
    // After the narrative, the planet keeps broadcasting — quieter echoes.
    waves.emit(nextEcho, 0.45);
    nextEcho += T.echoEvery;
  }

  world.updateMatrixWorld();
  earth.group.getWorldPosition(earthWorld);

  earth.update(ramp(time, T.earthIn[0], T.earthIn[1]), dt, world.quaternion);
  waves.setAxis(spinAxis.set(0, 1, 0).applyQuaternion(earth.globe.getWorldQuaternion(tmpQ)));
  waves.update(time, earthWorld, su);

  camera.getWorldPosition(eyeWorld);
  scene.background.copy(WASH).multiplyScalar(waves.crossing(eyeWorld, earthWorld));

  su.uTime.value = time;
  su.uPxScale.value = pixelScale();
  su.uCenter.value.copy(earthWorld);
  su.uFirstR.value = firstWaveEmitted ? radiusAt(time - T.waveStart, 0.2) : -1;

  text1.update(envelope(time, T.text1In, T.textsOut), time > T.text1In[0] ? (time - T.text1In[0]) * 0.004 : 0);
  text2.update(envelope(time, T.text2In, T.textsOut), time > T.text2In[0] ? (time - T.text2In[0]) * 0.004 : 0);
  text3.update(envelope(time, T.text3In), Math.min(Math.max(time - T.text3In[0], 0), 40) * 0.003);

  renderer.render(scene, camera);
});

setupVRButton();

// Review helper: `?t=20` opens the desktop preview already at second 20.
const jump = parseFloat(new URLSearchParams(location.search).get('t'));
if (Number.isFinite(jump)) {
  showOverlay(false);
  restart();
  time = Math.max(0, jump);
}
