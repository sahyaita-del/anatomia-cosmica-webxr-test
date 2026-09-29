// Narrative timeline (seconds). Every visual reads from here, so the whole
// piece can be re-timed from a single place.

export const T = {
  starsIn: [0.4, 5.0], // stars appear progressively
  earthIn: [5.0, 10.0], // Earth emerges from darkness
  waveStart: 10.0, // first electromagnetic wave leaves Earth
  text1In: [11.0, 14.5], // "DESDE HACE APENAS UN SIGLO"
  text2In: [18.5, 22.0], // "NUESTRAS SEÑALES VIAJAN HACIA LAS ESTRELLAS"
  textsOut: [26.0, 28.8], // both texts dissolve
  text3In: [29.0, 34.5], // "¿QUIÉN PODRÍA ESTAR ESCUCHANDO?"
  echoStart: 42.0, // afterwards: Earth keeps broadcasting, softly
  echoEvery: 18.0,
};

export const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Smooth 0→1 between a and b (smootherstep: zero velocity and acceleration at
// both ends — reads as "cinematic" rather than mechanical).
export function ramp(t, a, b) {
  const x = clamp01((t - a) / (b - a));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// Fade in over [in0,in1] and optionally out over [out0,out1].
export function envelope(t, inRange, outRange) {
  const v = ramp(t, inRange[0], inRange[1]);
  return outRange ? v * (1 - ramp(t, outRange[0], outRange[1])) : v;
}
