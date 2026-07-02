// Thin wrapper around the GitHub REST "contents" API. Every data/*.json file the frontend
// owns is read/written through here. Last-write-wins: we always re-fetch the current sha
// immediately before a write and just overwrite with our local copy.
import { getSettings } from "./state.js";

const API_ROOT = "https://api.github.com";

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function requireSettings() {
  const s = getSettings();
  if (!s.githubToken || !s.githubOwner || !s.githubRepo) {
    throw new Error("GitHub settings (token/owner/repo) are not configured yet.");
  }
  return s;
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

/** Fetch a JSON file's parsed contents + its sha (needed for the next write). */
export async function getFile(path) {
  const s = requireSettings();
  const url = `${API_ROOT}/repos/${s.githubOwner}/${s.githubRepo}/contents/${path}?ref=${s.githubBranch || "main"}`;
  const res = await fetch(url, { headers: apiHeaders(s.githubToken) });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const text = b64DecodeUnicode(body.content.replace(/\n/g, ""));
  return { data: JSON.parse(text), sha: body.sha };
}

/** Write a JSON file, creating or updating as needed. Returns the new sha. */
export async function putFile(path, data, message) {
  const s = requireSettings();
  const url = `${API_ROOT}/repos/${s.githubOwner}/${s.githubRepo}/contents/${path}`;
  // Re-fetch sha right before writing to minimize (not eliminate) lost-update races.
  let sha = null;
  try {
    const current = await getFile(path);
    sha = current.sha;
  } catch {
    // ignore — file may not exist yet
  }
  const content = b64EncodeUnicode(JSON.stringify(data, null, 2) + "\n");
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...apiHeaders(s.githubToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      // Data saves never need a Pages redeploy — the frontend reads data/*.json via the
      // API at runtime, so suppress CI on every app-originated commit.
      message: `${message || `chore: update ${path}`} [skip ci]`,
      content,
      sha: sha || undefined,
      branch: s.githubBranch || "main",
    }),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.content.sha;
}

/** Trigger the Garmin sync workflow via workflow_dispatch. */
export async function triggerGarminSync() {
  const s = requireSettings();
  const url = `${API_ROOT}/repos/${s.githubOwner}/${s.githubRepo}/actions/workflows/garmin-sync.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...apiHeaders(s.githubToken), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: s.githubBranch || "main" }),
  });
  if (!res.ok) throw new Error(`workflow_dispatch failed: ${res.status} ${await res.text()}`);
}
