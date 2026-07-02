import { getLocal, refresh, save } from "../state.js";
import { toast } from "../components/toast.js";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export async function render(container) {
  let log = getLocal("exercise_log");
  let pendingSets = []; // sets being built for the current entry before saving

  paint();
  refresh("exercise_log").then((l) => { log = l; paint(); }).catch(() => {});

  function recentExerciseNames() {
    const seen = [];
    for (let i = log.length - 1; i >= 0 && seen.length < 8; i--) {
      const name = log[i].exercise;
      if (name && !seen.includes(name)) seen.push(name);
    }
    return seen;
  }

  function paint() {
    const today = todayStr();
    const todaysEntries = log.filter((e) => e.date === today).slice().reverse();
    const recents = recentExerciseNames();

    container.innerHTML = `
      <h1>Log</h1>

      <div class="card stack">
        <h2>New entry</h2>
        <label for="ex-name">Exercise</label>
        <input id="ex-name" type="text" list="recent-exercises" placeholder="e.g. Bench Press" />
        <datalist id="recent-exercises">
          ${recents.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("")}
        </datalist>
        ${recents.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${recents
          .map((n) => `<button type="button" class="secondary shortcut" style="min-height:36px;padding:6px 10px;font-size:13px" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`)
          .join("")}</div>` : ""}

        <div class="grid-3">
          <div>
            <label for="set-reps">Reps</label>
            <input id="set-reps" type="number" inputmode="numeric" />
          </div>
          <div>
            <label for="set-weight">Weight</label>
            <input id="set-weight" type="number" inputmode="decimal" />
          </div>
          <div>
            <label for="set-rpe">RPE</label>
            <input id="set-rpe" type="number" inputmode="numeric" step="0.5" min="1" max="10" />
          </div>
        </div>
        <button id="add-set" class="secondary">+ Add set</button>

        <div id="pending-sets">${renderPendingSets()}</div>

        <label for="ex-note">Note (optional)</label>
        <textarea id="ex-note" placeholder="How did it feel?"></textarea>

        <button id="save-entry">Save entry</button>
      </div>

      <div class="card">
        <h2>Today's log</h2>
        ${todaysEntries.length ? todaysEntries.map(renderEntry).join("") : `<p>Nothing logged yet today.</p>`}
      </div>
    `;

    container.querySelectorAll(".shortcut").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("ex-name").value = btn.dataset.name;
      });
    });

    document.getElementById("add-set").addEventListener("click", () => {
      const reps = Number(document.getElementById("set-reps").value);
      const weight = Number(document.getElementById("set-weight").value) || 0;
      const rpe = Number(document.getElementById("set-rpe").value) || null;
      if (!reps) return toast("Enter reps first", "error");
      pendingSets.push({ reps, weight, rpe });
      document.getElementById("set-reps").value = "";
      document.getElementById("set-weight").value = "";
      document.getElementById("set-rpe").value = "";
      document.getElementById("pending-sets").innerHTML = renderPendingSets();
    });

    document.getElementById("save-entry").addEventListener("click", async () => {
      const name = document.getElementById("ex-name").value.trim();
      const note = document.getElementById("ex-note").value.trim();
      if (!name) return toast("Enter an exercise name", "error");
      if (!pendingSets.length) return toast("Add at least one set", "error");
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: today,
        exercise: name,
        sets: pendingSets,
        note: note || null,
        source: "manual",
        created_at: new Date().toISOString(),
      };
      const next = [...log, entry];
      try {
        await save("exercise_log", next, `log: ${name}`);
        log = next;
        pendingSets = [];
        toast("Logged", "success");
        paint();
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }

  function renderPendingSets() {
    if (!pendingSets.length) return `<p style="font-size:13px">No sets added yet.</p>`;
    return `<div class="stack" style="gap:4px">${pendingSets
      .map((s, i) => `<div class="row" style="font-size:14px"><span>Set ${i + 1}: ${s.reps} reps${s.weight ? ` @ ${s.weight}` : ""}${s.rpe ? ` (RPE ${s.rpe})` : ""}</span></div>`)
      .join("")}</div>`;
  }

  function renderEntry(e) {
    const setsText = e.sets.map((s) => `${s.reps}${s.weight ? `@${s.weight}` : ""}`).join(", ");
    return `<div class="checklist-item">
      <div class="title">${escapeHtml(e.exercise)}</div>
      <div class="meta">${setsText}${e.note ? ` · ${escapeHtml(e.note)}` : ""}</div>
    </div>`;
  }
}
