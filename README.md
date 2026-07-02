# AI Trainer

A mobile-first PWA fitness tracker with an AI personal trainer (Claude), Garmin data synced
automatically via GitHub Actions, and no backend server — just static files on GitHub Pages plus
JSON files in this repo as the database.

## How it works

- **Frontend**: vanilla JS SPA (`index.html`, `js/`), deployed to GitHub Pages by
  `.github/workflows/deploy.yml`.
- **Data**: JSON files in `data/`. The Garmin sync script writes `garmin_activities.json`,
  `garmin_wellness.json`, `garmin_health.json`. The frontend reads/writes all `data/*.json` files
  directly via the GitHub REST API using a personal access token you paste into Settings.
- **Garmin sync**: `.github/workflows/garmin-sync.yml` runs `scripts/garmin_sync.py` every 30
  minutes (and on demand from the app's Settings tab), committing changes with `[skip ci]` so it
  never triggers a Pages redeploy.
- **AI trainer**: every Claude call happens directly from your browser to
  `https://api.anthropic.com`, using an API key stored only in `localStorage` on your device.

## One-time setup

1. **Create the GitHub repo** and push this code:
   ```sh
   git remote add origin https://github.com/<you>/fitness-tracker.git
   git add -A
   git commit -m "Initial commit"
   git push -u origin main
   ```

2. **Enable GitHub Pages**: repo Settings → Pages → Source → "GitHub Actions". The `deploy.yml`
   workflow will publish the site on the next push to `main`.

3. **Add Garmin Actions secrets**: repo Settings → Secrets and variables → Actions →
   New repository secret:
   - `GARMIN_EMAIL`
   - `GARMIN_PASSWORD`

   Garmin Connect may prompt for MFA on a first login from an unfamiliar location — if the
   scheduled sync fails with an auth error, run `python scripts/garmin_sync.py` locally once
   (with those two env vars set) to complete any MFA challenge and warm up a session; the
   workflow's own session cache takes over from there.

4. **Create a fine-grained GitHub PAT** (github.com → Settings → Developer settings → Fine-grained
   tokens) scoped to just this repo, with:
   - Contents: Read and write
   - Actions: Read and write (needed for the "Sync now" button's `workflow_dispatch`)

5. **Get an Anthropic API key** from the [Anthropic Console](https://console.anthropic.com).

6. Open the deployed site on your phone, add it to your home screen (PWA install prompt / Share →
   Add to Home Screen), and open Settings to paste in: GitHub owner, repo name, branch, the PAT,
   and the Anthropic key. These are saved to `localStorage` only — never committed.

7. On first launch after configuring, you'll go through an onboarding interview with your AI
   trainer, which produces `data/trainer_profile.json`.

## Local development

No build step. Serve the repo root with any static file server:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. Note: the GitHub API and Anthropic API both require HTTPS-ish
CORS-friendly origins in practice they work fine from `localhost`.

## Repo layout

```
index.html, manifest.json, sw.js   — PWA shell
css/styles.css                     — mobile-first styles
js/app.js                          — router + bottom tab nav
js/state.js                        — localStorage cache + GitHub sync (last-write-wins)
js/github.js                       — GitHub REST API wrapper
js/anthropic.js                    — Claude API wrapper
js/views/                          — one module per tab (today, coach, log, health, progress, settings, onboarding)
js/components/                     — rest timer, toast
js/lib/                            — recovery indicators, zones, VO2 max bands, charts, workout/coach context assembly
data/                              — the JSON "database"
scripts/garmin_sync.py             — Garmin Connect → data/*.json
.github/workflows/                 — garmin-sync.yml (cron), deploy.yml (Pages)
```
