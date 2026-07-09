// Supabase-backed replacement for js/state.js. Mirrors the SAME public API
// (getLocal, refresh, refreshAll, save, getSettings/saveSettings, isConfigured) so that when
// this is wired into js/app.js, view files do not need to change. NOT imported by the live
// app yet — see docs/SUPABASE_SETUP.md for the cutover step.
import { supabase, getSession } from "./client.js";

const PREFS_KEY = "ft_prefs"; // device-local UI prefs only (no secrets to store anymore)

const DEFAULTS = {
  garmin_activities: [],
  garmin_wellness: [],
  garmin_health: [],
  workouts: [],
  exercise_log: [],
  goals: [],
  trainer_profile: {},
  coach_chats: [],
  weekly_reviews: [],
  body_metrics: [],
};

function cacheKey(name) {
  return `ft_cache_${name}`;
}

export function getPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export function savePrefs(partial) {
  const next = { ...getPrefs(), ...partial };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

export async function isSignedIn() {
  return Boolean(await getSession());
}

export function getLocal(name) {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    return raw ? JSON.parse(raw) : DEFAULTS[name];
  } catch {
    return DEFAULTS[name];
  }
}

function setLocal(name, data) {
  localStorage.setItem(cacheKey(name), JSON.stringify(data));
}

async function currentUserId() {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  return session.user.id;
}

// ---- per-table row <-> app-shape mapping ----

const ADAPTERS = {
  garmin_activities: {
    table: "garmin_activities",
    toRows: (uid, arr) => arr.map((a) => ({ user_id: uid, activity_id: a.id, date: a.date, data: a })),
    fromRows: (rows) => rows.map((r) => r.data),
    conflict: "user_id,activity_id",
  },
  garmin_wellness: {
    table: "garmin_wellness",
    toRows: (uid, arr) => arr.map((w) => ({ user_id: uid, date: w.date, data: w })),
    fromRows: (rows) => rows.map((r) => r.data),
    conflict: "user_id,date",
  },
  garmin_health: {
    table: "garmin_health",
    toRows: (uid, arr) => arr.map((h) => ({ user_id: uid, date: h.date, data: h })),
    fromRows: (rows) => rows.map((r) => r.data),
    conflict: "user_id,date",
  },
  workouts: {
    table: "workouts",
    toRows: (uid, arr) => arr.map((w) => ({ user_id: uid, date: w.date, program_id: w.program_id ?? null, day: w })),
    fromRows: (rows) => rows.map((r) => ({ ...r.day, date: r.date, program_id: r.program_id })),
    conflict: "user_id,date",
  },
  exercise_log: {
    table: "exercise_logs",
    toRows: (uid, arr) =>
      arr.map((e) => ({ user_id: uid, date: e.date, exercise: e.exercise, source: e.source || "manual", entry: e })),
    fromRows: (rows) => rows.map((r) => r.entry),
    conflict: null, // append-only; see save() below
  },
  goals: {
    table: "goals",
    toRows: (uid, arr) => arr.map((g) => ({ user_id: uid, goal: g })),
    fromRows: (rows) => rows.map((r) => r.goal),
    conflict: null,
  },
  coach_chats: {
    table: "coach_chats",
    toRows: (uid, arr) => arr.map((m) => ({ user_id: uid, role: m.role, content: m.content, at: m.at })),
    fromRows: (rows) => rows.map((r) => ({ role: r.role, content: r.content, at: r.at })),
    conflict: null,
  },
  weekly_reviews: {
    table: "weekly_reviews",
    toRows: (uid, arr) => arr.map((r) => ({ user_id: uid, week: r.week, review: r })),
    fromRows: (rows) => rows.map((r) => r.review),
    conflict: "user_id,week",
  },
  body_metrics: {
    table: "body_metrics",
    toRows: (uid, arr) => arr.map((b) => ({ user_id: uid, date: b.date, weight: b.weight, weight_unit: b.weight_unit })),
    fromRows: (rows) => rows.map((r) => ({ date: r.date, weight: r.weight, weight_unit: r.weight_unit })),
    conflict: "user_id,date",
  },
};

export async function refresh(name) {
  if (name === "trainer_profile") {
    const uid = await currentUserId();
    const { data, error } = await supabase.from("profiles").select("data").eq("user_id", uid).maybeSingle();
    if (error) throw error;
    const value = data?.data ?? {};
    setLocal(name, value);
    return value;
  }

  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`Unknown data file: ${name}`);
  const uid = await currentUserId();
  const { data, error } = await supabase.from(adapter.table).select("*").eq("user_id", uid).order("created_at", { ascending: true });
  if (error) throw error;
  const value = adapter.fromRows(data || []);
  setLocal(name, value);
  return value;
}

export async function refreshAll() {
  const names = ["trainer_profile", ...Object.keys(ADAPTERS)];
  const results = await Promise.allSettled(names.map((n) => refresh(n)));
  const out = {};
  results.forEach((r, i) => {
    const name = names[i];
    if (r.status === "fulfilled") out[name] = r.value;
    else {
      console.warn(`refresh(${name}) failed, using cache`, r.reason);
      out[name] = getLocal(name);
    }
  });
  return out;
}

/**
 * Save the full array/object for `name`. For upsertable tables (unique key on
 * user+date/week/etc.) this is a single batch upsert. For append-only tables
 * (exercise_log, goals, coach_chats) we only insert rows not already present
 * (matched by their app-level id/at) to avoid duplicate rows on every save.
 */
export async function save(name, data) {
  setLocal(name, data); // optimistic local update, same as the GitHub-backed layer

  if (name === "trainer_profile") {
    const uid = await currentUserId();
    const { error } = await supabase.from("profiles").upsert(
      { user_id: uid, data, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) throw error;
    return data;
  }

  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`Unknown data file: ${name}`);
  const uid = await currentUserId();
  const rows = adapter.toRows(uid, data);
  if (!rows.length) return data;

  if (adapter.conflict) {
    const { error } = await supabase.from(adapter.table).upsert(rows, { onConflict: adapter.conflict });
    if (error) throw error;
  } else {
    // Append-only: diff against what's already stored remotely to avoid duplicate inserts on
    // every save (these views always pass the FULL array back, e.g. [...log, newEntry]).
    const { data: existing, error: selErr } = await supabase.from(adapter.table).select("*").eq("user_id", uid);
    if (selErr) throw selErr;
    const existingCount = (existing || []).length;
    const newRows = rows.slice(existingCount); // relies on callers only ever appending
    if (newRows.length) {
      const { error } = await supabase.from(adapter.table).insert(newRows);
      if (error) throw error;
    }
  }
  return data;
}
