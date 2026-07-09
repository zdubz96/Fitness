import { getLocal, save } from "../state.js";
import { toast } from "../components/toast.js";
import { estimateMaxHR, defaultZones } from "../lib/zones.js";
import { cmToFtIn, ftInToCm } from "../lib/units.js";
import { APP_VERSION } from "../version.js";
import { supabase, getSession } from "../supabase/client.js";
import { exportAllData, deleteAccount, signOut } from "../supabase/account.js";

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function render(container) {
  const profile = getLocal("trainer_profile") || {};
  const age = profile.age;
  const estMaxHR = age ? estimateMaxHR(age) : null;
  const maxHR = profile.max_hr || estMaxHR || "";
  const units = profile.units || "lb";
  const heightCm = profile.height_cm ?? null;
  const heightFtIn = heightCm != null ? cmToFtIn(heightCm) : { ft: "", inches: "" };

  const session = await getSession();
  const email = session?.user?.email ?? "—";

  let usageHtml = `<p style="font-size:13px">Loading...</p>`;
  const month = currentMonthKey();
  const [{ data: usageRow }, { data: settingsRow }] = await Promise.all([
    supabase.from("usage").select("input_tokens, output_tokens").eq("user_id", session.user.id).eq("month", month).maybeSingle(),
    supabase.from("user_settings").select("monthly_token_cap").eq("user_id", session.user.id).maybeSingle(),
  ]);
  const used = (usageRow?.input_tokens ?? 0) + (usageRow?.output_tokens ?? 0);
  const cap = settingsRow?.monthly_token_cap ?? 300000;
  const pct = Math.min(100, Math.round((used / cap) * 100));

  container.innerHTML = `
    <h1>Settings</h1>

    <div class="card stack">
      <h2>Account</h2>
      <p style="font-size:13px;color:var(--text-dim)">${email}</p>
      <div>
        <div class="row" style="font-size:13px"><span>Coach usage this month</span><span>${pct}%</span></div>
        <div style="background:var(--bg-elev-2);border-radius:6px;height:8px;overflow:hidden;margin-top:4px">
          <div style="width:${pct}%;background:${pct >= 90 ? "var(--bad)" : pct >= 70 ? "var(--warn)" : "var(--accent)"};height:100%"></div>
        </div>
        <p style="font-size:11px;color:var(--text-dim);margin:4px 0 0">${used.toLocaleString()} / ${cap.toLocaleString()} tokens — resets on the 1st</p>
      </div>
      <button id="export-data" class="secondary">Export my data</button>
      <button id="sign-out" class="secondary">Sign out</button>
      <button id="delete-account" class="danger">Delete account</button>
    </div>

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
      <h2>Heart rate zones</h2>
      <label for="max-hr">Max HR ${estMaxHR ? `(age-estimated: ${estMaxHR})` : ""}</label>
      <input id="max-hr" type="number" value="${maxHR}" />
      <div id="zone-preview"></div>
      <button id="save-zones" class="secondary">Save zones</button>
    </div>

    <div class="card stack">
      <h2>Garmin</h2>
      <p style="font-size:13px">Optional. Bring-your-own sync is coming soon — for now, log body weight and workouts manually in the Log tab.</p>
    </div>

    <p style="font-size:11px;color:var(--text-dim);margin:0;text-align:center">Build ${APP_VERSION}</p>
  `;

  document.getElementById("export-data").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Exporting...";
    try {
      await exportAllData();
      toast("Export downloaded", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Export my data";
    }
  });

  document.getElementById("sign-out").addEventListener("click", async () => {
    await signOut();
  });

  document.getElementById("delete-account").addEventListener("click", async (e) => {
    const confirmed = confirm(
      "Permanently delete your account and all your data (workouts, logs, chats, everything)? This cannot be undone."
    );
    if (!confirmed) return;
    e.target.disabled = true;
    e.target.textContent = "Deleting...";
    try {
      await deleteAccount();
      toast("Account deleted", "success");
    } catch (err) {
      toast(err.message, "error");
      e.target.disabled = false;
      e.target.textContent = "Delete account";
    }
  });

  const unitsSelect = document.getElementById("units");
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
      await save("trainer_profile", updated);
      toast("Saved", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  const maxHrInput = document.getElementById("max-hr");
  const zonePreview = document.getElementById("zone-preview");
  function renderZonePreview() {
    const mh = Number(maxHrInput.value);
    if (!mh) return;
    const z = defaultZones(mh);
    zonePreview.innerHTML = `<div class="grid-2" style="margin-top:8px">${z
      .map((zone) => `<div class="card" style="margin:0;padding:8px"><strong>${zone.name}</strong><br/><span style="color:var(--text-dim)">${zone.low}-${zone.high} bpm</span></div>`)
      .join("")}</div>`;
  }
  maxHrInput.addEventListener("input", renderZonePreview);
  renderZonePreview();
  document.getElementById("save-zones").addEventListener("click", async () => {
    const mh = Number(maxHrInput.value);
    if (!mh) return toast("Enter a max HR first", "error");
    const updated = { ...getLocal("trainer_profile"), max_hr: mh, zones: defaultZones(mh) };
    try {
      await save("trainer_profile", updated);
      toast("Zones saved", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}
