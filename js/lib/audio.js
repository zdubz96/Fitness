// Shared Web Audio context, unlocked on the first user tap (required by iOS Safari before
// any sound can play, and before navigator.vibrate-less browsers have any other cue).
let ctx = null;

export function unlockAudio() {
  if (ctx) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx = new AudioCtx();
  // Play a silent blip immediately to fully unlock on iOS.
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.01);
}

export function playChime() {
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  const now = ctx.currentTime;
  [0, 0.18, 0.36].forEach((offset, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = i === 2 ? 1046.5 : 880; // A5, A5, C6
    gain.gain.setValueAtTime(0, now + offset);
    gain.gain.linearRampToValueAtTime(0.4, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.32);
  });
}

export function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}
