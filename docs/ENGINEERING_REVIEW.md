# Engineering Review — AI Fitness Tracker

**Reviewer lens:** principal software engineer
**Date:** 2026-07-05 (app at "Build 10")
**Audience:** an implementation model (Sonnet) working from this doc + the repo, without access to the original conversation.

## How to use this document

Each finding has an ID (`ENG-n`), a severity, concrete file references, current vs. expected behavior, and acceptance criteria. Items are independent unless a dependency is noted. Part 3 (multi-tenant architecture) is the largest work item and supersedes several individual fixes — check the "obsoleted by migration?" note on each finding before implementing it standalone.

**Current architecture (for orientation):** static vanilla-JS PWA on GitHub Pages. `data/*.json` files in this repo are the database, read/written from the browser via the GitHub contents API (`js/github.js`) with a fine-grained PAT from localStorage. Claude API called directly from the browser (`js/anthropic.js`) with the user's own key. A GitHub Action (`.github/workflows/garmin-sync.yml` → `scripts/garmin_sync.py`) syncs Garmin data every 30 min. State layer: `js/state.js` (localStorage cache, last-write-wins remote sync). Views are ES modules under `js/views/`, one per tab, mounted by the hash router in `js/app.js`.

---

## Part 1 — Bugs and correctness risks

### ENG-1 · Write-conflict race on saves — **Medium** · obsoleted by migration
- **Where:** `js/github.js` → `putFile()`
- **Current:** `putFile` refetches the file's `sha` via `getFile()`, then PUTs. If any other writer commits between those two calls (most likely the Garmin sync Action, which runs every 30 min), GitHub returns **409 Conflict** and the raw error is shown to the user via toast. There is no retry.
- **Expected:** on a 409, refetch the sha once and retry the PUT. If the second attempt also 409s, surface a friendly "someone else just saved — try again" error.
- **Acceptance:** simulate by writing to the same file from two clients in quick succession; the second write succeeds via retry; no raw `409` text reaches the UI.

### ENG-2 · localStorage/remote divergence on failed save — **Medium** · obsoleted by migration
- **Where:** `js/state.js` → `save()`
- **Current:** `setLocal(name, data)` runs **before** `putFile(...)`. If the PUT throws (offline, 401, 409), the local cache already contains the "saved" data while the remote does not. The UI re-renders from cache, so the user sees their change as persisted. The next successful `refresh(name)` silently reverts it.
- **Expected:** either (a) snapshot previous local value and roll back the cache when the PUT fails, or (b) keep the optimistic local write but set a per-file dirty flag that (1) is retried on next app focus, and (2) prevents `refresh()` from clobbering unsynced local data. Option (b) is better UX for flaky mobile networks.
- **Acceptance:** turn off network, tick a set in the Today view, observe error toast; either the tick visually reverts (a) or persists and syncs when network returns without being clobbered by refresh (b).

### ENG-3 · One commit per set-tick (chatty persistence) — **Medium** · obsoleted by migration
- **Where:** `js/views/today.js` → `wireWorkout()` (checkbox change handler and weight-input change handler)
- **Current:** every set checkbox tick and every weight-field change triggers a full `save("workouts", ...)` → `getFile` + `putFile` = 2 API round-trips and **one git commit each**. A 5-exercise × 3-set workout generates ~20 commits and doubles rest-timer startup latency on slow networks.
- **Expected:** batch in-workout writes: keep changes in the localStorage cache immediately (instant UI), and flush to remote at most every ~30 s, plus a forced flush on "Mark done"/"Mark missed"/tab hide (`visibilitychange` → `hidden`).
- **Acceptance:** completing a full workout produces ≤ 3 data commits; a set ticked then app killed within a few seconds still reaches the remote (flush on `visibilitychange`).

### ENG-4 · Unbounded data-file growth — **Low now, certain later** · partially obsoleted by migration
- **Where:** `data/exercise_log.json`, `data/workouts.json`, `data/coach_chats.json`
- **Current:** append-forever. The GitHub contents API rejects files > ~1 MB (and base64 round-tripping gets slow well before that). At realistic logging volume, `exercise_log.json` crosses 1 MB in roughly 2–4 years; `workouts.json` (7 rows/week with full exercise arrays) sooner.
- **Expected:** yearly sharding: at first write in a new year, move prior-year entries to `data/exercise_log_<year>.json` (same shape), keep the live file current-year only. `js/views/progress.js` charts only need 12 weeks, so they read the live file; anything needing full history reads shards on demand.
- **Acceptance:** with a synthetic 2-year log, the live file contains only current-year rows; Progress tab renders unchanged.

### ENG-5 · XSS discipline around LLM-generated HTML — **Low likelihood / high impact** · relevant in both architectures
- **Where:** all views use `innerHTML` template literals with a hand-rolled `escapeHtml()` (duplicated per file, see ENG-9). LLM-origin strings rendered: `rationale`, `focus`, exercise `name`/`notes`, `warmup`/`cooldown` (`js/views/today.js`), chat messages (`js/views/coach.js`, `js/views/onboarding.js`), review fields (`js/views/progress.js`), baseline fields (`js/views/assessment.js`), cardio report (`js/views/health.js`).
- **Risk:** a single missed `escapeHtml` on model output is an injection vector; with credentials in localStorage (current architecture), that means token exfiltration. Two concrete gaps today: in `js/views/today.js` the timer's `nextLabel` and the recovery modal reasons pass through `escapeHtml`, but **`day.duration_min`, `ex.sets`, `ex.rest_seconds`, `ex.rpe_target` are interpolated unescaped** (they're "numbers" per the schema, but the model could return a string — `sendMessageForJSON` doesn't validate types).
- **Expected:** (1) validate/coerce LLM JSON fields to expected types at the parse boundary (in `js/lib/program.js` `toWorkoutEntry()` and equivalents: `Number(...) || null` for numerics, `String(...)` for text); (2) after coercion, ensure every string interpolation site goes through the shared escape (see ENG-9).
- **Acceptance:** a crafted workout JSON with `"sets": "<img src=x onerror=alert(1)>"` renders as inert text.

### ENG-6 · Long generations: no streaming, timeout-retry doubles cost — **Medium** · reworked by migration (proxy does streaming)
- **Where:** `js/anthropic.js` (90 s timeout, retry once on network failure), `js/lib/program.js` (`maxTokens: 8000` for 7-day generation and readjust)
- **Current:** a full-week generation can take 30–60 s; on a slow connection the 90 s abort triggers a full retry — paying for the first (possibly completed server-side) generation again. No incremental feedback for the user beyond a button label.
- **Expected (standalone fix):** use `"stream": true` and parse SSE, updating a progress indicator; abort only on stall (> 20 s with no event), not on total duration.
- **Expected (migration):** the `coach-proxy` edge function streams; same client parsing applies.
- **Acceptance:** on a throttled connection (DevTools "Slow 3G"), the week generation completes without triggering a retry, and the UI shows life during generation.

### ENG-7 · Garmin sync over-fetching — **Low** · survives migration (script becomes user-run)
- **Where:** `scripts/garmin_sync.py` → `fetch_wellness()` / `fetch_health()` (each loops `WELLNESS_LOOKBACK_DAYS = 14` days × ~5 endpoints), cron `*/30`
- **Current:** ~70 Garmin API calls per run, ~3,400/day, mostly refetching identical past-day data. Raises rate-limit/lockout risk with no benefit.
- **Expected:** lookback 2 days on scheduled runs; full 14-day backfill only when `workflow_dispatch` (manual "Sync now") or when a `FULL_BACKFILL=true` env is set; keep the merge-by-key dedupe as is.
- **Acceptance:** scheduled run log shows ≤ ~15 API calls; manual dispatch still backfills 14 days.

### ENG-8 · iOS background limits on the rest timer — **Platform limitation, document only**
- **Where:** `js/components/timer.js`
- **Current:** timestamp-based countdown correctly survives backgrounding, but iOS Safari suspends JS in background, so the chime/vibrate fires only when the app returns to foreground. This is a platform constraint, not a bug.
- **Expected:** add a note in README/help; optionally, where `Notification` permission is granted (Android/desktop), schedule a local notification as the timer-complete signal. Do not attempt hacks (silent audio loops) — battery cost and App-Store-PWA fragility outweigh benefit.

---

## Part 2 — Code-quality cleanups

### ENG-9 · Deduplicate utility functions — **Cleanup**
`escapeHtml` is defined in 8 files (`js/app.js`, `js/views/{today,coach,log,health,progress,onboarding,assessment}.js`, `js/components/timer.js`); `todayStr` in 3 (`js/lib/program.js`, `js/views/log.js` — and re-exported from program.js for today.js); `daysAgo` in 4 (`js/lib/{context,recovery}.js`, `js/views/{health,progress}.js`). Extract `js/lib/util.js` exporting `escapeHtml`, `todayStr`, `addDays`, `daysAgo`, `uid()` (the `Date.now()-random` ID pattern is also duplicated), and update imports. No behavior change.

### ENG-10 · `refreshAll()` is sequential — **Cleanup**
`js/state.js` `refreshAll()` awaits 10 files one at a time (~2–4 s total on mobile). Convert to `Promise.allSettled` over `Object.keys(DATA_FILES)`. Used on settings save; also consider using it on app start.

### ENG-11 · Data schema documentation — **Prerequisite for any future work**
No written schema exists. Add `docs/DATA_SCHEMA.md` documenting every `data/*.json` shape and invariants. Key invariants to capture: `garmin_activities` deduped by `id`, wellness/health by `date`; every stored weight carries `weight_unit` ("kg"/"lb") and is converted at render time (`js/lib/units.js`) — stored values are never rewritten on unit switch; height canonical in cm (`profiles.height_cm`); program days are rows in `workouts.json` linked by `program_id` with `status ∈ {planned, completed, missed, rest}`; `trainer_profile.active_program` points at the current `program_id` + `start_date` (valid 7 days); `exercise_log` rows carry `source ∈ {manual, planned, assessment}` and planned-day completion **replaces** prior `source: "planned"` rows for that date (idempotency — see today.js `showFeedbackModal`).

---

## Part 3 — Multi-tenant architecture (RECOMMENDED: Supabase)

**Decision context (from the owner, all CONFIRMED 2026-07-05):** Garmin becomes **optional**; the **owner pays for Anthropic tokens** with the **300k tokens/user/month default quota**; registration is **invite-code gated** (friends only); **push notifications are deferred** (in-app banners remain the delivery mechanism — do not build web-push infrastructure now); app stays "AI Trainer" on GitHub Pages (no custom domain). These are fixed requirements, not open questions.

### 3.1 Component overview

```
Browser (static PWA, unchanged hosting on GitHub Pages)
  ├── supabase-js  ──►  Supabase Auth (email+password, email confirmation)
  ├── supabase-js  ──►  Postgres (RLS: user_id = auth.uid()) — replaces data/*.json
  └── fetch        ──►  Edge Function `coach-proxy` ──► Anthropic API (owner's key, server-side)
                          └── enforces per-user token quotas (usage table)
Optional per-user Garmin path:
  User's own GitHub fork runs scripts/garmin_sync.py with THEIR credentials
  └── POSTs results to Edge Function `garmin-ingest` (per-user ingest token) ──► their rows
```

### 3.2 Database schema (SQL, to run in Supabase)

One table per current JSON file. All tables: `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `created_at timestamptz default now()`, and RLS enabled with the standard four policies (`select/insert/update/delete using/with check user_id = auth.uid()`).

```sql
-- profiles: 1 row per user (the old trainer_profile.json + account fields)
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,   -- experience, injuries, equipment, schedule, goals[],
                                             -- cardio_history, age, sex, max_hr, zones, units,
                                             -- height_cm, baseline, active_program, chat_summary,
                                             -- cardio_reports, onboarding_complete
  disclaimer_accepted_at timestamptz,
  schema_version int not null default 1,
  updated_at timestamptz default now()
);

-- workouts: one row per program day
create table workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  program_id text,
  day jsonb not null,        -- focus, is_rest_day, duration_min, warmup(+_min), cooldown(+_min),
                             -- exercises[] (incl. completed_sets, logged_weight, adjustment_log),
                             -- rationale, status, feedback
  unique (user_id, date)
);

-- exercise_logs, goals, weekly_reviews, body_metrics, coach_chats:
-- same pattern — scalar columns for query keys (date, exercise, week, role), jsonb for the rest.
create table exercise_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null, exercise text not null, source text not null default 'manual',
  entry jsonb not null
);
create table goals (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, goal jsonb not null);
create table weekly_reviews (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, week text not null, review jsonb not null, unique (user_id, week));
create table body_metrics (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, date date not null, weight numeric, weight_unit text, unique (user_id, date));
create table coach_chats (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, role text not null, content text not null, at timestamptz not null default now());

-- Garmin mirrors (optional feature)
create table garmin_activities (id bigint, user_id uuid not null references auth.users(id) on delete cascade, date date, data jsonb not null, primary key (user_id, id));
create table garmin_wellness  (user_id uuid not null references auth.users(id) on delete cascade, date date not null, data jsonb not null, primary key (user_id, date));
create table garmin_health    (user_id uuid not null references auth.users(id) on delete cascade, date date not null, data jsonb not null, primary key (user_id, date));

-- usage + quotas for the coach proxy
create table usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,               -- '2026-07'
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  requests int not null default 0,
  primary key (user_id, month)
);
create table user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_token_cap bigint not null default 300000,   -- owner-adjustable per user (CONFIRMED default)
  garmin_ingest_token text                            -- random secret for the BYO-sync path
);

-- invite gate (OWNER DECISION: registration requires a valid invite code)
create table invite_codes (
  code text primary key,                -- owner-generated, e.g. 8-char random
  created_by uuid references auth.users(id),
  used_by uuid references auth.users(id),
  used_at timestamptz,
  max_uses int not null default 1,
  uses int not null default 0
);
```

**Invite-code enforcement:** simplest robust approach — a `signup` edge function (service role) that validates the code and calls `auth.admin.createUser`, incrementing `uses`; client signup form posts email/password/code to it instead of calling `supabase.auth.signUp` directly. (Alternative: DB trigger on `auth.users` insert checking a code passed in user metadata — acceptable, but the edge function gives clearer error messages.) Owner generates codes by inserting rows via the Supabase dashboard.

RLS note: `usage` and `user_settings` are select-only for the user (writes happen with the service key inside edge functions). `garmin_*` insert policy additionally allows the `garmin-ingest` function (service role bypasses RLS anyway).

### 3.3 Edge Function `coach-proxy` (the critical piece)

- Verify the caller's JWT (Supabase does this when "enforce JWT" is on).
- Load `user_settings.monthly_token_cap` and current `usage` row; if `input+output >= cap`, return `429` with JSON `{error:"quota_exceeded", resets:"<first of next month>"}` — the client maps this to a friendly message (see PRODUCT doc, quota UX).
- Rate limit: max ~10 requests/min per user (in-memory or a `pg` counter).
- Forward the request body (model, max_tokens, system, messages, stream) to `https://api.anthropic.com/v1/messages` with `ANTHROPIC_API_KEY` from function secrets. **Pin the model server-side** (ignore client-supplied model) to prevent cost abuse.
- On response, add `usage.input_tokens/output_tokens` from the API response into the `usage` row (service-role upsert).
- Support `stream: true` passthrough (SSE) — needed for PROD streaming-chat item.

**Client change:** `js/anthropic.js` — replace URL with the function endpoint, replace `x-api-key` header with `Authorization: Bearer <supabase access token>`; delete `anthropic-dangerous-direct-browser-access`. Keep `extractJSON`, timeout, and retry logic unchanged.

### 3.4 Frontend state layer swap

`js/state.js` keeps its public API (`getLocal`, `refresh`, `refreshAll`, `save`, `getSettings`) so **views don't change**. Internals:
- `refresh(name)` → supabase select for that user (RLS scopes it); map rows back to the array/object shapes views expect (e.g. `workouts` rows → array of `day` jsonb with `date` merged in).
- `save(name, data)` → upserts. For `workouts`, upsert by `(user_id, date)`; for append-only types insert only new rows (compare by id). Per-set ticks become single-row upserts — cheap, which retires ENG-3.
- `getSettings()` shrinks to UI prefs only; tokens/owner/repo fields and `js/github.js` data usage are removed. Login state comes from `supabase.auth`.
- Auth gating: `js/app.js` route() — if no session → render new `js/views/auth.js` (sign in / sign up with **invite code field** / reset); signup posts to the `signup` edge function (see §3.2). After sign-in, the existing onboarding gate takes over.

### 3.5 Optional Garmin path (no credential custody)

- New Edge Function `garmin-ingest`: `POST` with header `X-Ingest-Token`; looks up `user_settings.garmin_ingest_token`, upserts posted arrays into `garmin_*` tables for that user. Reject payloads > ~500 KB.
- `scripts/garmin_sync.py` gains an optional mode: when `SUPABASE_INGEST_URL` + `GARMIN_INGEST_TOKEN` env vars are set, POST the merged JSON there instead of (or in addition to) writing files. Users who want Garmin fork/copy just this script + workflow into their own repo with their own secrets. Document in README.
- Graceful degradation (joint with PRODUCT doc): `js/lib/recovery.js` already returns green with "all within normal range" when data is empty — change to a distinct `level: "unknown"` when there is no wellness/HRV/load data at all, so the UI can show "no recovery data" instead of a green badge, and `js/lib/context.js` should tell the coach explicitly that wearable data is unavailable.

### 3.6 Migration & rollout

1. Stand up Supabase project; run schema; deploy `coach-proxy` (+ secrets), then `garmin-ingest`.
2. Implement `js/views/auth.js` + state-layer swap behind a build flag or branch.
3. One-off import: local Node/Python script reads this repo's `data/*.json` and inserts as the owner's user rows (map file→table per §3.2 comments).
4. Owner smoke-tests full loop (signup fresh account too). 5. Cut over `main`; keep the GitHub-mode code available in a `github-backend` branch for reference; retire the repo-committing Garmin workflow from the shared repo.
5. `schema_version` on `profiles` governs future migrations.

### 3.7 Cost & scaling notes

- Supabase free tier: 50k MAU auth / 500 MB DB — years of headroom at friends-scale.
- Anthropic: dominant cost is program generation + chat context (~10–20k input tokens per coach call at current context size). Under a 300k tokens/month cap ≈ **$1–3/user/month** worst case at Sonnet pricing. The context builder (`js/lib/context.js`) sends full 14-day JSON dumps — trimming fields (drop nulls, round numbers) is the highest-leverage token optimization if costs matter.
- Fallback distribution model (not chosen): GitHub template repo, each user brings their own PAT/key/secrets. Zero cost to owner, but ~30-min technical setup per user and no shared features. Documented here only for context.

---

## Suggested implementation order

1. ENG-11 (schema doc) → 2. ENG-9/ENG-10 (cheap cleanups) → 3. ENG-5 (type-coercion at LLM parse boundary) → 4. **Part 3 migration** (subsumes ENG-1/2/3, reworks ENG-6) → 5. ENG-7 (sync script efficiency, in the user-fork template) → 6. ENG-4 only if staying on GitHub backend longer than planned.
