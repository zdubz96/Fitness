import { playChime, vibrate } from "../lib/audio.js";

/**
 * Shows a full-screen rest timer overlay. Countdown is derived from a fixed end timestamp
 * (not setInterval ticks) so it stays correct across backgrounding/throttling.
 *
 * @param {object} opts
 * @param {number} opts.seconds - prescribed rest_seconds
 * @param {string} opts.exerciseLabel - e.g. "Bench Press"
 * @param {string} [opts.nextLabel] - e.g. "Set 3 of 4"
 * @returns {Promise<"done"|"skipped">}
 */
export function showRestTimer({ seconds, exerciseLabel, nextLabel }) {
  return new Promise((resolve) => {
    let endAt = Date.now() + seconds * 1000;
    let rafId = null;
    let wakeLock = null;
    let finished = false;

    const overlay = document.createElement("div");
    overlay.className = "timer-overlay";
    overlay.innerHTML = `
      <div class="timer-label">Resting — up next</div>
      <div style="font-weight:700;font-size:20px">${escapeHtml(exerciseLabel)}</div>
      ${nextLabel ? `<div class="timer-label">${escapeHtml(nextLabel)}</div>` : ""}
      <div class="timer-display" id="timer-display">--:--</div>
      <div class="timer-actions">
        <button class="secondary" id="timer-add30">+30s</button>
        <button class="secondary" id="timer-skip">Skip</button>
      </div>
    `;
    document.body.appendChild(overlay);

    async function acquireWakeLock() {
      try {
        if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
      } catch {
        // wake lock not available/denied — timer still works, screen may just dim
      }
    }
    acquireWakeLock();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        acquireWakeLock();
        tick(); // recompute immediately from timestamp on resume
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    function format(s) {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}:${String(sec).padStart(2, "0")}`;
    }

    function finish() {
      if (finished) return;
      finished = true;
      vibrate([300, 100, 300]);
      playChime();
      cleanup();
      resolve("done");
    }

    function cleanup() {
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (wakeLock) wakeLock.release().catch(() => {});
      overlay.remove();
    }

    function tick() {
      const remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      const display = overlay.querySelector("#timer-display");
      if (display) display.textContent = format(remaining);
      if (remaining <= 0) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(() => setTimeout(tick, 200));
    }
    tick();

    overlay.querySelector("#timer-add30").addEventListener("click", () => {
      endAt += 30000;
    });
    overlay.querySelector("#timer-skip").addEventListener("click", () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve("skipped");
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
