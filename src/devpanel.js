import { DURATION } from './timeline.js';

// Desktop-only development panel (DOM overlay: never rendered inside VR).
export function createDevPanel({ getTime, isPlaying, onPlayPause, onRestart, onSeek }) {
  const el = document.getElementById('devpanel');
  const play = el.querySelector('[data-act="play"]');
  const restart = el.querySelector('[data-act="restart"]');
  const range = el.querySelector('input[type="range"]');
  const timeLabel = el.querySelector('[data-out="time"]');
  const fpsLabel = el.querySelector('[data-out="fps"]');
  range.max = String(DURATION);

  let scrubbing = false;
  play.addEventListener('click', onPlayPause);
  restart.addEventListener('click', onRestart);
  range.addEventListener('input', () => {
    scrubbing = true;
    onSeek(parseFloat(range.value));
  });
  range.addEventListener('change', () => (scrubbing = false));
  el.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => onSeek(parseFloat(b.dataset.jump))));

  let frames = 0;
  let last = performance.now();

  return {
    show(v) {
      el.classList.toggle('visible', v);
    },
    tick() {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        fpsLabel.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
        frames = 0;
        last = now;
      }
      const t = getTime();
      timeLabel.textContent = `${t.toFixed(1)} s`;
      if (!scrubbing) range.value = String(t);
      play.textContent = isPlaying() ? 'Pausa' : 'Play';
    },
  };
}
