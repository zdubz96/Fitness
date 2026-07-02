# AI Fitness Tracker

Static SPA (vanilla JS, mobile-first, PWA) deployed to GitHub Pages. Garmin data synced via a
scheduled GitHub Action. An AI personal trainer (Claude) generates workouts, runs a persistent
coach chat, and produces weekly reviews — all calls made client-side from the browser.

## Stack
Vanilla JS (no build step), HTML, CSS. Python 3.11+ for the sync script (python-garminconnect + garth).

## Hard rules
- No backend server. All persistence is JSON files in `data/`, read/written via the GitHub REST
  API from the browser using a fine-grained PAT the user pastes into Settings (localStorage only,
  never committed).
- Anthropic API key also lives in localStorage only, never committed, never sent anywhere but
  `https://api.anthropic.com`. All calls use `anthropic-dangerous-direct-browser-access: true`.
- Garmin credentials (`GARMIN_EMAIL` / `GARMIN_PASSWORD`) are GitHub Actions secrets only, used by
  `scripts/garmin_sync.py`. Never log credentials.
- garth session token is persisted between runs (as an Actions cache / repo artifact per workflow
  design) to avoid repeated fresh logins.
- Data-sync commits from the Action use `[skip ci]` and must not trigger a Pages redeploy.
- Writes to `data/*.json` from the frontend are last-write-wins; always dedupe Garmin
  activities by activity ID on merge.

## Conventions
- One ES module per view under `js/views/`, mounted by `js/app.js`'s router.
- All GitHub REST calls go through `js/github.js`; all Claude calls go through `js/anthropic.js`.
- Keep computed health/recovery math (zones, VO2 max percentiles, recovery ratios) in `js/lib/`.

## Commands
- Local dev: serve the repo root with any static server, e.g. `python -m http.server 8000`.
- Garmin sync (local test): `python scripts/garmin_sync.py`
