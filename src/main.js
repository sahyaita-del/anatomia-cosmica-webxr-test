import * as THREE from 'three';
import { T, DURATION, rampR } from './timeline.js';
import { bakeSky, createStars } from './space.js';
import { createEarth } from './earth.js';
import { createSun } from './sun.js';
import { createAudio } from './audio.js';
import { createDevPanel } from './devpanel.js';
import './style.css';

// ─── Scale (the one rule that is never bent) ────────────────────────────────
const R_EARTH = 0.24; // metres in the scene
const R_SUN = 109 * R_EARTH; // 26.16 m — true diameter ratio 109:1

// Final composition: Earth and the Sun's centre at the SAME distance from the
// viewer, so their apparent sizes keep the real ratio (~62° vs ~0.55°).
// Only the Earth–Sun separation is compressed (the real one would make the
// Earth invisible); sizes are never scaled.
const D = 50.8;
const deg = THREE.MathUtils.degToRad;
const dirFrom = (az, el) => new THREE.Vector3(Math.sin(deg(az)) * Math.cos(deg(el)), Math.sin(deg(el)), -Math.cos(deg(az)) * Math.cos(deg(el)));
const SUN_POS = dirFrom(-24, 0).multiplyScalar(D);
const EARTH_NEAR = new THREE.Vector3(0, -0.06, -2.2); // intimate: ~12.5° wide
const EARTH_FAR = dirFrom(14, 2).multiplyScalar(D); // ~7° outside the solar limb
const LIGHT_ACT1 = new THREE.Vector3(-0.72, 0.22, 0.62).normalize(); // lit from front-left

// ─── Renderer ───────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = bakeSky(renderer, 1024);
scene.backgroundIntensity = 0;

const EYE_HEIGHT = 1.6;
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 2500);
camera.position.set(0, EYE_HEIGHT, 0);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Everything lives in `world`, whose origin is the viewer's head at start.
const world = new THREE.Group();
world.position.set(0, EYE_HEIGHT, 0);
scene.add(world);

const sunDirLocal = SUN_POS.clone().normalize();
const stars = createStars({ count: 4000, avoid: [{ dir: sunDirLocal, cosAngle: Math.cos(deg(40)) }] });
world.add(stars);

const earth = createEarth(renderer, { radius: R_EARTH });
world.add(earth.group);

const sun = createSun({ radius: R_SUN });
sun.group.position.copy(SUN_POS);
world.add(sun.group);
scene.add(sun.corona, ...sun.proms); // placed in world coordinates each frame

const audio = createAudio();

// ─── Playback state ─────────────────────────────────────────────────────────
let time = 0;
let playing = false;
let mode = 'idle'; // 'idle' | 'preview' | 'xr'

function seek(t) {
  time = THREE.MathUtils.clamp(t, 0, DURATION);
  audio.stopAll(); // audio.update() restarts sources at the new offset
}
function restart() {
  seek(0);
  playing = true;
}

// ─── Desktop preview controls ───────────────────────────────────────────────
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
  if (mode !== 'preview') return;
  if (e.code === 'KeyR') restart();
  if (e.code === 'Space') togglePlay();
  if (e.code === 'Escape') showOverlay(true);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

const move = new THREE.Vector3();
function updateDesktopCamera(dt) {
  camera.rotation.set(-pitch, -yaw, 0);
  move.set((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), 0, (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0));
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(dt * 0.8).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
    camera.position.add(move);
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

// ─── UI ─────────────────────────────────────────────────────────────────────
const overlay = document.getElementById('overlay');
const vrButton = document.getElementById('enter-vr');
const previewButton = document.getElementById('preview');
const status = document.getElementById('status');

function togglePlay() {
  if (time >= DURATION) restart();
  else playing = !playing;
}

const dev = createDevPanel({
  getTime: () => time,
  isPlaying: () => playing,
  // Every panel action is a user gesture: use it to unlock audio playback.
  onPlayPause: () => (audio.unlock(), togglePlay()),
  onRestart: () => (audio.unlock(), restart()),
  onSeek: (t) => {
    audio.unlock();
    if (mode !== 'preview') enterPreview(false);
    seek(t);
  },
});

function showOverlay(visible) {
  overlay.classList.toggle('hidden', !visible);
  if (visible) {
    playing = false;
    mode = 'idle';
    seek(0);
    dev.show(false);
  }
}

function enterPreview(autoplay = true) {
  audio.unlock();
  resetDesktopCamera();
  overlay.classList.add('hidden');
  mode = 'preview';
  dev.show(true);
  if (autoplay) restart();
}
previewButton.addEventListener('click', () => enterPreview(true));

// ─── WebXR ──────────────────────────────────────────────────────────────────
let recenterFrames = 0;

async function setupVRButton() {
  if (!window.isSecureContext) {
    status.textContent = 'WebXR requiere HTTPS (ver README).';
    return;
  }
  if (!('xr' in navigator)) {
    status.textContent = 'Este navegador no tiene WebXR. Usa la vista previa.';
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
  audio.unlock(); // same user gesture
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'layers'],
    });
    const features = session.enabledFeatures;
    renderer.xr.setReferenceSpaceType(features && !features.includes('local-floor') ? 'local' : 'local-floor');
    session.addEventListener('end', onSessionEnd);
    // Headset removed / system menu: pause story and music.
    session.addEventListener('visibilitychange', () => {
      if (mode === 'xr') playing = session.visibilityState === 'visible';
    });
    await renderer.xr.setSession(session);
    overlay.classList.add('hidden');
    dev.show(false);
    mode = 'xr';
    restart();
    recenterFrames = 3;
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
  camera.getWorldPosition(headPos);
  camera.getWorldDirection(headDir);
  world.position.copy(headPos);
  world.rotation.set(0, Math.atan2(-headDir.x, -headDir.z), 0);
}

function finish() {
  playing = false;
  time = DURATION;
  if (mode === 'xr') renderer.xr.getSession()?.end();
  else showOverlay(true);
}

function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ─── Choreography ───────────────────────────────────────────────────────────
const nearDir = EARTH_NEAR.clone().normalize();
const farDir = EARTH_FAR.clone().normalize();
const nearDist = EARTH_NEAR.length();
const qDir = new THREE.Quaternion().setFromUnitVectors(nearDir, farDir);
const qId = new THREE.Quaternion();
const qTmp = new THREE.Quaternion();
const lightLocal = new THREE.Vector3();
const lightFinal = new THREE.Vector3();
const lightWorld = new THREE.Vector3();
const earthFarWorld = new THREE.Vector3();
const eye = new THREE.Vector3();

function placeEarth(t) {
  // Exponential recession: the apparent size shrinks at a steady visual rate.
  const k = rampR(t, T.recede);
  const dist = nearDist * Math.pow(D / nearDist, k);
  qTmp.slerpQuaternions(qId, qDir, k);
  earth.group.position.copy(nearDir).applyQuaternion(qTmp).multiplyScalar(dist);
}

function pixelScale() {
  if (renderer.xr.isPresenting) {
    const h = renderer.xr.getCamera().cameras[0]?.viewport?.w;
    return (h > 0 ? h : 1800) / 1000;
  }
  return renderer.domElement.height / 1000;
}

let lastFrame = -1;
renderer.setAnimationLoop((now) => {
  const dt = lastFrame < 0 ? 0 : Math.min(Math.max((now - lastFrame) / 1000, 0), 0.1);
  lastFrame = now;
  if (playing) time += dt;
  if (playing && time >= DURATION) finish();
  const t = time;

  if (renderer.xr.isPresenting) {
    if (recenterFrames > 0 && --recenterFrames === 0) recenterToHead();
  } else {
    updateDesktopCamera(dt);
  }
  scene.backgroundRotation.set(0, world.rotation.y, 0);

  // Space
  const spaceVis = rampR(t, T.spaceIn) * (1 - rampR(t, T.spaceOut));
  const adapt = rampR(t, T.adapt); // eye adapting to the Sun
  scene.backgroundIntensity = spaceVis * (1 - 0.6 * adapt);
  stars.material.uniforms.uBright.value = spaceVis * (1 - 0.5 * adapt);
  stars.material.uniforms.uPxScale.value = pixelScale();

  // Earth
  placeEarth(t);
  world.updateMatrixWorld();
  lightFinal.copy(SUN_POS).sub(earth.group.position).normalize();
  lightLocal.copy(LIGHT_ACT1).lerp(lightFinal, rampR(t, T.lightTurn)).normalize();
  lightWorld.copy(lightLocal).applyQuaternion(world.quaternion);
  earth.update(t, rampR(t, T.earthIn) * (1 - rampR(t, T.earthOut)), lightWorld, 1 + 1.4 * rampR(t, T.recede));

  // Sun
  camera.getWorldPosition(eye);
  earthFarWorld.copy(EARTH_FAR).applyMatrix4(world.matrixWorld);
  const bright = 1 - rampR(t, T.sunOut);
  sun.update(
    t,
    {
      visible: t >= T.sunVisible && bright > 0.001,
      glow: rampR(t, T.coronaIn) * bright,
      reveal: rampR(t, T.photoIn),
      bright,
    },
    eye,
    earthFarWorld,
  );

  audio.update(t, playing);
  if (mode === 'preview') dev.tick();
  renderer.render(scene, camera);
});

setupVRButton();

// Review helper: `?t=45` opens the desktop preview paused at second 45.
const jump = parseFloat(new URLSearchParams(location.search).get('t'));
if (Number.isFinite(jump)) {
  enterPreview(false);
  seek(jump);
}
