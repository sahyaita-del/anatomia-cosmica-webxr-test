// Narrative timeline (seconds). Every visual and audio level is a pure
// function of `t`, so the dev scrubber can jump anywhere deterministically.

export const DURATION = 85;

export const T = {
  spaceIn: [0.5, 6.0], // black → deep space
  earthIn: [4.5, 11.0], // Earth emerges
  recede: [25.0, 34.0], // Earth moves away: the world opens
  lightTurn: [25.0, 40.0], // Earth's light turns toward the real Sun position
  coronaIn: [31.5, 40.0], // first: a warm presence, the Sun's light
  sunVisible: 31.5, // silhouette of the (still dark) sphere starts eclipsing stars
  photoIn: [35.0, 45.5], // the photosphere dawns across the sphere
  adapt: [33.0, 46.0], // eye adaptation: stars and sky dim beside the Sun
  spaceOut: [70.0, 79.0],
  sunOut: [72.0, 82.5],
  earthOut: [77.0, 84.0], // home is the last thing to leave
};

// Audio sync (see README → Música).
export const AUDIO = {
  earth: { start: 0, fadeIn: [0, 3], fadeOut: [27, 32] },
  sun: { start: 27, fadeIn: [27, 32], fadeOut: [78, 85] },
};

export const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Smootherstep between a and b: zero velocity and acceleration at both ends.
export function ramp(t, a, b) {
  const x = clamp01((t - a) / (b - a));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export const rampR = (t, r) => ramp(t, r[0], r[1]);
