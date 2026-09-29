import { AUDIO } from './timeline.js';

// Soundtrack: two stereo tracks, NOT positional. They connect straight to the
// output (no panner, no 3D object), like cinematic background music.
//
//   earth.mp3   plays 0 → 30 s
//   (silence)   30 → 31 s
//   sun.mp3     plays 31 → 85 s, with a volume fade 75 → 85 s
//
// The narrative timeline is the master clock. Each frame we check where each
// track *should* be; a source is (re)started at the right file offset when it
// should be playing but isn't, or when it drifted > 0.25 s. Starts, stops and
// the fade are scheduled on the AudioContext clock, so they land on the exact
// timeline second rather than on the next video frame.

const RESYNC = 0.25; // s of drift tolerated before re-seeking
const LOOKAHEAD = 0.1; // s: schedule a start slightly before it's due
const SNAP = 0.12; // s: late starts closer than this to the file start snap to 0
const TAIL = 0.2; // s: let a source reach its own scheduled end

// Smooth 1 → 0 fade curve (cosine / equal-power shape).
const FADE_CURVE = Float32Array.from({ length: 256 }, (_, i) => Math.cos(((i / 255) * Math.PI) / 2));

export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = Ctx ? new Ctx() : null;
  const base = import.meta.env.BASE_URL;

  const tracks = [AUDIO.earth, AUDIO.sun].map((cfg) => ({ cfg, buffer: null, gain: null, src: null, anchor: 0 }));

  async function load(tr) {
    try {
      const res = await fetch(`${base}audio/${tr.cfg.file}`);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || type.includes('text/html')) throw new Error(`HTTP ${res.status}`);
      tr.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      console.info(`[audio] ${tr.cfg.file} listo (${tr.buffer.duration.toFixed(3)} s)`);
    } catch (err) {
      console.warn(`[audio] no se pudo cargar ${tr.cfg.file}:`, err.message ?? err);
    }
  }

  if (ctx) {
    for (const tr of tracks) {
      tr.gain = ctx.createGain();
      tr.gain.connect(ctx.destination);
      load(tr);
    }
  }

  function stop(tr) {
    if (!tr.src) return;
    try {
      tr.src.stop();
    } catch {
      /* not started yet / already stopped */
    }
    tr.src.disconnect();
    tr.src = null;
    tr.gain.gain.cancelScheduledValues(0);
  }

  // Start `tr` so that timeline second `t` corresponds to ctx time `now`.
  function start(tr, t, now) {
    const { start: t0, end: t1, fadeOut } = tr.cfg;
    let offset = t - t0; // may be slightly negative (look-ahead start)
    // Just past the start (Play/Restart lands one video frame late): begin at
    // the file's first sample so its built-in micro-fade is never clipped.
    if (offset > 0 && offset < SNAP) offset = 0;
    const when = now + Math.max(0, -offset);
    const src = ctx.createBufferSource();
    src.buffer = tr.buffer;
    src.connect(tr.gain);
    src.start(when, Math.max(0, offset));
    src.stop(when + (t1 - t0 - Math.max(0, offset))); // ends at the track's end second
    tr.src = src;
    tr.anchor = offset === 0 && t > t0 ? now - t0 : now - t; // ctx time of timeline second 0

    // Gain automation, aligned to the timeline.
    const g = tr.gain.gain;
    g.cancelScheduledValues(0);
    if (!fadeOut) {
      g.setValueAtTime(1, now);
      return;
    }
    const [f0, f1] = fadeOut;
    if (t < f0) {
      g.setValueAtTime(1, now);
      g.setValueCurveAtTime(FADE_CURVE, now + (f0 - t), f1 - f0);
    } else if (t < f1) {
      // Mid-fade (after a seek): continue from the current point of the curve.
      const x = (t - f0) / (f1 - f0);
      const i = Math.floor(x * (FADE_CURVE.length - 1));
      const rest = FADE_CURVE.slice(i);
      if (rest.length >= 2) g.setValueCurveAtTime(rest, now, f1 - t);
      else g.setValueAtTime(0, now);
    } else {
      g.setValueAtTime(0, now);
    }
  }

  return {
    // Call from a user gesture (VISTA PREVIA / ENTER VR click): autoplay policy.
    unlock() {
      if (ctx && ctx.state !== 'running') ctx.resume();
    },
    stopAll() {
      tracks.forEach(stop);
    },
    update(t, playing) {
      if (!ctx) return;
      const now = ctx.currentTime;
      for (const tr of tracks) {
        if (!tr.buffer) continue;
        const { start: t0, end: t1 } = tr.cfg;
        if (!playing || ctx.state !== 'running') {
          stop(tr);
          continue;
        }
        const due = t >= t0 - LOOKAHEAD && t < t1;
        if (!due) {
          // Past the end: the source stops itself at its scheduled end second.
          if (!(tr.src && t >= t1 && t < t1 + TAIL)) stop(tr);
          continue;
        }
        if (tr.src) {
          const drift = now - tr.anchor - t; // + means audio is ahead
          if (Math.abs(drift) <= RESYNC) continue;
          stop(tr);
        }
        start(tr, t, now);
      }
    },
  };
}
