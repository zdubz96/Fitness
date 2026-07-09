import { isSignedIn, refreshAll, getLocal } from "./state.js";
import { toast } from "./components/toast.js";
import { unlockAudio } from "./lib/audio.js";
import { supabase } from "./supabase/client.js";

window.addEventListener("pointerdown", unlockAudio, { once: true });

const TABS = [
  { id: "today", label: "Today", icon: "🏠", path: "./views/today.js" },
  { id: "coach", label: "Coach", icon: "💬", path: "./views/coach.js" },
  { id: "log", label: "Log", icon: "📝", path: "./views/log.js" },
  { id: "health", label: "Health", icon: "❤️", path: "./views/health.js" },
  { id: "progress", label: "Progress", icon: "📈", path: "./views/progress.js" },
  { id: "settings", label: "Settings", icon: "⚙️", path: "./views/settings.js" },
];

const app = document.getElementById("app");
app.innerHTML = `
  <main id="view"></main>
  <nav id="tabbar"></nav>
`;
const viewEl = document.getElementById("view");
const tabbarEl = document.getElementById("tabbar");

let dataLoadedForSession = false;

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  return hash || "today";
}

function renderTabbar(active) {
  tabbarEl.innerHTML = TABS.map(
    (t) => `<a href="#/${t.id}" class="${t.id === active ? "active" : ""}">
      <span class="icon">${t.icon}</span><span>${t.label}</span>
    </a>`
  ).join("");
}

async function route() {
  const signedIn = await isSignedIn();

  if (!signedIn) {
    dataLoadedForSession = false;
    tabbarEl.innerHTML = "";
    const mod = await import("./views/auth.js");
    await mod.render(viewEl, {
      onSignedIn: async () => {
        await loadDataThenRoute();
      },
    });
    return;
  }

  // First route() after a page (re)load with an existing session: populate the local cache
  // from Supabase before rendering anything that reads it (trainer_profile in particular).
  if (!dataLoadedForSession) {
    viewEl.innerHTML = `<div class="row" style="justify-content:center;padding:40px 0"><div class="spinner"></div></div>`;
    try {
      await refreshAll();
      dataLoadedForSession = true;
    } catch (e) {
      console.error(e);
      toast("Couldn't load your data — check your connection.", "error");
    }
  }

  const profile = getLocal("trainer_profile");
  let id = currentRoute();

  if (!profile?.onboarding_complete && id !== "settings") {
    tabbarEl.innerHTML = "";
    const mod = await import("./views/onboarding.js");
    await mod.render(viewEl, { onComplete: () => (location.hash = "#/today") });
    return;
  }

  if (id === "assessment") {
    renderTabbar("today");
    viewEl.innerHTML = `<div class="row" style="justify-content:center;padding:40px 0"><div class="spinner"></div></div>`;
    try {
      const mod = await import("./views/assessment.js");
      await mod.render(viewEl);
    } catch (e) {
      console.error(e);
      toast(e.message, "error");
    }
    return;
  }

  const tab = TABS.find((t) => t.id === id) || TABS[0];
  renderTabbar(tab.id);

  viewEl.innerHTML = `<div class="row" style="justify-content:center;padding:40px 0"><div class="spinner"></div></div>`;
  try {
    const mod = await import(tab.path);
    await mod.render(viewEl);
  } catch (e) {
    console.error(e);
    viewEl.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${escapeHtml(e.message)}</p></div>`;
    toast(e.message, "error");
  }
}

async function loadDataThenRoute() {
  dataLoadedForSession = false;
  await route();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Re-route on sign-out (e.g. from the Settings tab) so the auth screen appears immediately.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    dataLoadedForSession = false;
    route();
  }
});

window.addEventListener("hashchange", route);
route();
