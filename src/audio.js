import { AUDIO, ramp } from './timeline.js';

// Two-track music system driven by the narrative clock.
//
// Place the final files in /public/audio/ (see README):
//   tierra.(mp3|m4a|ogg)  → Earth piece, starts at AUDIO.earth.start
//   sol.(mp3|m4a|ogg)     → Sun piece,   starts at AUDIO.sun.start
// Missing files are simply silent: the experience runs without them.
//
// The timeline is the master clock. Every frame we compute each track's
// expected position and gain; a source is (re)started when it should be
// playing but isn't, or when it drifts > 0.25 s (after seeks/pauses).

const EXTS = ['mp3', 'm4a', 'ogg'];

export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = Ctx ? new Ctx() : null;
  const base = import.meta.env.BASE_URL;

  const tracks = [
    { name: 'tierra', cfg: AUDIO.earth, buffer: null, gain: null, src: null, srcStartCtx: 0, srcOffset: 0 },
    { name: 'sol', cfg: AUDIO.sun, buffer: null, gain: null, src: null, srcStartCtx: 0, srcOffset: 0 },
  ];

  async function loadTrack(tr) {
    for (const ext of EXTS) {
      try {
        const res = await fetch(`${base}audio/${tr.name}.${ext}`);
        const type = res.headers.get('content-type') || '';
        if (!res.ok || type.includes('text/html')) continue; // dev server SPA fallback
        tr.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        console.info(`[audio] ${tr.name}.${ext} cargado (${tr.buffer.duration.toFixed(1)} s)`);
        return;
      } catch {
        /* try next extension */
      }
    }
    console.info(`[audio] ${tr.name}: sin archivo, se reproduce en silencio`);
  }

  if (ctx) {
    for (const tr of tracks) {
      tr.gain = ctx.createGain();
      tr.gain.gain.value = 0;
      tr.gain.connect(ctx.destination);
      loadTrack(tr);
    }
  }

  function stop(tr) {
    if (!tr.src) return;
    try {
      tr.src.stop();
    } catch {
      /* already stopped */
    }
    tr.src.disconnect();
    tr.src = null;
  }

  function levels(t) {
    const e = AUDIO.earth;
    const s = AUDIO.sun;
    // Equal-power crossfade.
    const earth = ramp(t, e.fadeIn[0], e.fadeIn[1]) * Math.cos((ramp(t, e.fadeOut[0], e.fadeOut[1]) * Math.PI) / 2);
    const sun = Math.sin((ramp(t, s.fadeIn[0], s.fadeIn[1]) * Math.PI) / 2) * (1 - ramp(t, s.fadeOut[0], s.fadeOut[1]));
    return [earth, sun];
  }

  return {
    // Must be called from a user gesture (click) to allow playback.
    unlock() {
      if (ctx && ctx.state !== 'running') ctx.resume();
    },
    stopAll() {
      tracks.forEach(stop);
    },
    update(t, playing) {
      if (!ctx) return;
      const g = levels(t);
      tracks.forEach((tr, i) => {
        tr.gain.gain.setTargetAtTime(playing ? g[i] : 0, ctx.currentTime, 0.06);
        if (!tr.buffer) return;
        const offset = t - tr.cfg.start;
        const inRange = offset >= 0 && offset < tr.buffer.duration;
        if (!playing || !inRange || ctx.state !== 'running') {
          stop(tr);
          return;
        }
        const actual = tr.src ? ctx.currentTime - tr.srcStartCtx + tr.srcOffset : -1;
        if (!tr.src || Math.abs(actual - offset) > 0.25) {
          stop(tr);
          const src = ctx.createBufferSource();
          src.buffer = tr.buffer;
          src.connect(tr.gain);
          src.start(0, offset);
          tr.src = src;
          tr.srcStartCtx = ctx.currentTime;
          tr.srcOffset = offset;
        }
      });
    },
  };
}
