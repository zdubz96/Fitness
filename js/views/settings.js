import { getSettings, saveSettings, isConfigured, refreshAll, getLocal, save } from "../state.js";
import { triggerGarminSync } from "../github.js";
import { toast } from "../components/toast.js";
import { estimateMaxHR, defaultZones } from "../lib/zones.js";
import { cmToFtIn, ftInToCm } from "../lib/units.js";

export async function render(container) {
  const s = getSettings();
  const wasConfigured = isConfigured();
  const profile = getLocal("trainer_profile") || {};
  const age = profile.age;
  const estMaxHR = age ? estimateMaxHR(age) : null;
  const maxHR = profile.max_hr || estMaxHR || "";
  const zones = profile.zones || (maxHR ? defaultZones(maxHR) : null);
  const units = profile.units || "lb";
  const heightCm = profile.height_cm ?? null;
  const heightFtIn = heightCm != null ? cmToFtIn(heightCm) : { ft: "", inches: "" };

  container.innerHTML = `
    ${!wasConfigured ? `<div class="card"><h1>Welcome</h1><p>Enter your GitHub and Anthropic credentials to get started. Both are stored only in this browser's local storage — never committed.</p></div>` : `<h1>Settings</h1>`}

    <div class="card stack">
      <h2>GitHub</h2>
      <label for="gh-owner">Repo owner</label>
      <input id="gh-owner" type="text" placeholder="yourusername" value="${s.githubOwner || ""}" />
      <label for="gh-repo">Repo name</label>
      <input id="gh-repo" type="text" placeholder="fitness-tracker" value="${s.githubRepo || ""}" />
      <label for="gh-branch">Branch</label>
      <input id="gh-branch" type="text" placeholder="main" value="${s.githubBranch || "main"}" />
      <label for="gh-token">Fine-grained PAT (Contents + Actions: read/write)</label>
      <input id="gh-token" type="password" placeholder="github_pat_..." value="${s.githubToken || ""}" />
    </div>

    <div class="card stack">
      <h2>Anthropic</h2>
      <label for="anthropic-key">API key</label>
      <input id="anthropic-key" type="password" placeholder="sk-ant-..." value="${s.anthropicKey || ""}" />
    </div>

    <div class="card stack">
      <button id="save-settings">Save settings</button>
      <div id="save-status"></div>
    </div>

    ${wasConfigured ? `
    <div class="card stack">
      <h2>Units &amp; body</h2>
      <label for="units">Weight units</label>
      <select id="units">
        <option value="lb" ${units === "lb" ? "selected" : ""}>Pounds (lb)</option>
        <option value="kg" ${units === "kg" ? "selected" : ""}>Kilograms (kg)</option>
      </select>
      <label>Height</label>
      <div id="height-metric" style="${units === "kg" ? "" : "display:none"}">
        <input id="height-cm" type="number" inputmode="numeric" placeholder="cm" value="${heightCm != null ? Math.round(heightCm) : ""}" />
      </div>
      <div id="height-imperial" class="grid-2" style="${units === "kg" ? "display:none" : ""}">
        <input id="height-ft" type="number" inputmode="numeric" placeholder="ft" value="${heightFtIn.ft}" />
        <input id="height-in" type="number" inputmode="numeric" placeholder="in" value="${heightFtIn.inches}" />
      </div>
      <button id="save-body" class="secondary">Save units &amp; height</button>
    </div>

    <div class="card stack">
      <h2>Garmin Sync</h2>
      <p>Triggers the garmin-sync GitHub Action immediately.</p>
      <button id="sync-now" class="secondary">Sync now</button>
    </div>

    <div class="card stack">
      <h2>Heart rate zones</h2>
      <label for="max-hr">Max HR ${estMaxHR ? `(age-estimated: ${estMaxHR})` : ""}</label>
      <input id="max-hr" type="number" value="${maxHR}" />
      <div id="zone-preview"></div>
      <button id="save-zones" class="secondary">Save zones</button>
    </div>
    ` : ""}
  `;

  document.getElementById("save-settings").addEventListener("click", async () => {
    const next = {
      githubOwner: val("gh-owner"),
      githubRepo: val("gh-repo"),
      githubBranch: val("gh-branch") || "main",
      githubToken: val("gh-token"),
      anthropicKey: val("anthropic-key"),
    };
    saveSettings(next);
    const statusEl = document.getElementById("save-status");
    statusEl.innerHTML = `<div class="row"><div class="spinner"></div><span>Verifying + loading your data...</span></div>`;
    try {
      await refreshAll();
      statusEl.innerHTML = "";
      toast("Settings saved", "success");
      location.hash = "#/today";
      location.reload();
    } catch (e) {
      statusEl.innerHTML = `<p style="color:var(--bad)">${e.message}</p>`;
    }
  });

  const syncBtn = document.getElementById("sync-now");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "Triggering...";
      try {
        await triggerGarminSync();
        toast("Garmin sync triggered — check back in a minute or two", "success");
      } catch (e) {
        toast(e.message, "error");
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = "Sync now";
      }
    });
  }

  const unitsSelect = document.getElementById("units");
  if (unitsSelect) {
    unitsSelect.addEventListener("change", () => {
      const kg = unitsSelect.value === "kg";
      document.getElementById("height-metric").style.display = kg ? "" : "none";
      document.getElementById("height-imperial").style.display = kg ? "none" : "";
    });
    document.getElementById("save-body").addEventListener("click", async () => {
      const newUnits = unitsSelect.value;
      let cm = null;
      if (newUnits === "kg") {
        const v = Number(document.getElementById("height-cm").value);
        cm = v || null;
      } else {
        const ft = Number(document.getElementById("height-ft").value);
        const inches = Number(document.getElementById("height-in").value);
        cm = ft || inches ? ftInToCm(ft, inches) : null;
      }
      const updated = { ...getLocal("trainer_profile"), units: newUnits };
      if (cm != null) updated.height_cm = cm;
      try {
        await save("trainer_profile", updated, "chore: update units & height");
        toast("Saved", "success");
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }

  const maxHrInput = document.getElementById("max-hr");
  const zonePreview = document.getElementById("zone-preview");
  function renderZonePreview() {
    const mh = Number(maxHrInput.value);
    if (!mh || !zonePreview) return;
    const z = defaultZones(mh);
    zonePreview.innerHTML = `<div class="grid-2" style="margin-top:8px">${z
      .map((zone) => `<div class="card" style="margin:0;padding:8px"><strong>${zone.name}</strong><br/><span style="color:var(--text-dim)">${zone.low}-${zone.high} bpm</span></div>`)
      .join("")}</div>`;
  }
  if (maxHrInput) {
    maxHrInput.addEventListener("input", renderZonePreview);
    renderZonePreview();
    document.getElementById("save-zones").addEventListener("click", async () => {
      const mh = Number(maxHrInput.value);
      if (!mh) return toast("Enter a max HR first", "error");
      const updated = { ...profile, max_hr: mh, zones: defaultZones(mh) };
      try {
        await save("trainer_profile", updated, "chore: update HR zones");
        toast("Zones saved", "success");
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }

  function val(id) {
    return document.getElementById(id).value.trim();
  }
}
