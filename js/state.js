// localStorage cache + GitHub sync for every data/*.json file, plus device-local settings
// (GitHub token, Anthropic key) that are never synced anywhere.
import { getFile, putFile } from "./github.js";

const SETTINGS_KEY = "ft_settings";

export const DATA_FILES = {
  garmin_activities: "data/garmin_activities.json",
  garmin_wellness: "data/garmin_wellness.json",
  garmin_health: "data/garmin_health.json",
  workouts: "data/workouts.json",
  exercise_log: "data/exercise_log.json",
  goals: "data/goals.json",
  trainer_profile: "data/trainer_profile.json",
  coach_chats: "data/coach_chats.json",
  weekly_reviews: "data/weekly_reviews.json",
  body_metrics: "data/body_metrics.json",
};

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

export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(partial) {
  const current = getSettings();
  const next = { ...current, ...partial };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function isConfigured() {
  const s = getSettings();
  return Boolean(s.githubToken && s.githubOwner && s.githubRepo && s.anthropicKey);
}

/** Read from localStorage cache synchronously (used for instant render). */
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

/** Pull the latest copy from GitHub and refresh the local cache. */
export async function refresh(name) {
  const path = DATA_FILES[name];
  if (!path) throw new Error(`Unknown data file: ${name}`);
  const { data } = await getFile(path);
  const value = data === null ? DEFAULTS[name] : data;
  setLocal(name, value);
  return value;
}

export async function refreshAll() {
  const results = {};
  for (const name of Object.keys(DATA_FILES)) {
    try {
      results[name] = await refresh(name);
    } catch (e) {
      console.warn(`refresh(${name}) failed, using cache`, e);
      results[name] = getLocal(name);
    }
  }
  return results;
}

/** Save locally immediately, then push to GitHub (last-write-wins on the remote file). */
export async function save(name, data, message) {
  const path = DATA_FILES[name];
  if (!path) throw new Error(`Unknown data file: ${name}`);
  setLocal(name, data);
  await putFile(path, data, message);
  return data;
}
