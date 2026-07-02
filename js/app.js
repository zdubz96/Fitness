import { isConfigured, getLocal } from "./state.js";
import { toast } from "./components/toast.js";
import { unlockAudio } from "./lib/audio.js";

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
  const configured = isConfigured();
  const profile = getLocal("trainer_profile");
  let id = currentRoute();

  if (!configured) {
    id = "settings";
  } else if (!profile?.onboarding_complete && id !== "settings") {
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
  renderTabbar(configured ? tab.id : null);
  if (!configured) tabbarEl.innerHTML = "";

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

window.addEventListener("hashchange", route);
route();
