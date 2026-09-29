import * as THREE from 'three';

// Spatial typography: each line is rasterised once into a canvas (system
// font, no external assets) and placed in the world as a thin plane.
// World-anchored — it does not follow the head — so it behaves like an
// object in space, not a HUD.

const FONT_STACK = '"Helvetica Neue", "Inter", "Roboto", "Segoe UI", Arial, sans-serif';

export function createSpatialText(renderer, text, { height = 0.05, weight = 400, tracking = 0.32 } = {}) {
  const fontPx = 112; // cap-height resolution; mipmaps handle distance
  const pad = Math.round(fontPx * 0.5);
  const font = `${weight} ${fontPx}px ${FONT_STACK}`;

  const lineHeight = fontPx * 1.9;

  // Measure with manual letter-spacing (ctx.letterSpacing isn't universal).
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const lines = text.split('\n').map((line) => {
    const chars = [...line];
    const advances = chars.map((c) => measure.measureText(c).width + fontPx * tracking);
    const width = advances.reduce((a, b) => a + b, 0) - fontPx * tracking;
    return { chars, advances, width };
  });
  const maxWidth = Math.max(...lines.map((l) => l.width));

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(maxWidth + pad * 2);
  canvas.height = Math.ceil(lineHeight * lines.length + pad);
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e9f0ff';
  lines.forEach((line, row) => {
    let x = (canvas.width - line.width) / 2; // centred
    const y = pad / 2 + lineHeight * (row + 0.5);
    line.chars.forEach((c, i) => {
      ctx.fillText(c, x, y);
      x += line.advances[i];
    });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // `height` is the world height of the glyph line (~cap height + margin).
  const worldPerPx = height / fontPx;
  const geometry = new THREE.PlaneGeometry(canvas.width * worldPerPx, canvas.height * worldPerPx);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 4;
  mesh.visible = false;

  const base = new THREE.Vector3();

  return {
    mesh,
    // Place at `position` (local to the composition) and orient toward the
    // viewer's starting point, so it is legible without tracking the head.
    place(position, lookAt = new THREE.Vector3()) {
      mesh.position.copy(position);
      base.copy(position);
      mesh.lookAt(lookAt);
    },
    // v: 0..1 visibility. drift: slow approach (metres) for depth cue.
    update(v, drift = 0) {
      mesh.visible = v > 0.002;
      material.opacity = v;
      mesh.position.set(base.x, base.y + (1 - v) * -0.015, base.z + drift);
    },
  };
}
