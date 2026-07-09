# Supabase Multi-Tenant Setup & Cutover Guide

Implements the P0 items from `docs/ENGINEERING_REVIEW.md` §3 and `docs/PRODUCT_REVIEW.md`.
All code for this lives in new, additive files: `supabase/`, `js/supabase/`, `js/views/auth.js`.
**Nothing in `data/*.json`, `js/state.js`, `js/github.js`, or `js/app.js` has been touched.**
Your live GitHub-backed app keeps working exactly as it does today through every step below,
right up until you deliberately do the cutover in Part 5 — and even then, your GitHub data
stays in the repo untouched (this only adds a second, parallel backend).

---

## Part 1 — Run the database schema

1. Supabase Dashboard → your project → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` in this repo, copy the entire contents, paste into the editor.
3. Click **Run**. You should see "Success. No rows returned."
4. Verify: **Table Editor** in the sidebar should now show `profiles`, `workouts`,
   `exercise_logs`, `goals`, `weekly_reviews`, `body_metrics`, `coach_chats`,
   `garmin_activities`, `garmin_wellness`, `garmin_health`, `usage`, `user_settings`,
   `invite_codes`.

This is idempotent — safe to re-run if you make schema changes later (uses `if not exists`
and `drop policy if exists` throughout).

## Part 2 — Deploy the edge functions

You have two options; pick whichever is available to you.

### Option A — Dashboard (no CLI needed)
For each of `coach-proxy`, `signup`, `garmin-ingest`, `delete-account`:
1. Dashboard → **Edge Functions** → **Deploy a new function** → name it exactly as above.
2. Paste the contents of `supabase/functions/<name>/index.ts` into the editor.
3. Deploy.

### Option B — Supabase CLI (if you install Node/Deno + the CLI later)
```
supabase functions deploy coach-proxy
supabase functions deploy signup
supabase functions deploy garmin-ingest
supabase functions deploy delete-account
```

### Set secrets (once, applies to all functions)
Dashboard → **Edge Functions** → **Manage secrets** (or `supabase secrets set` with the CLI):

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key. **This becomes the shared key for every invited user** — see cost note below. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into every edge
function — you don't set those yourself.

**Cost note:** every user's coach usage now bills to this one Anthropic key, capped at
300,000 tokens/user/month (`user_settings.monthly_token_cap`, confirmed default — adjustable
per user by updating that row in the Table Editor). At Sonnet pricing that's roughly $1–3 per
active user per month worst-case. Budget for `(number of people you invite) × $3/month` as a
ceiling.

## Part 3 — Configure the client

1. Dashboard → **Project Settings** → **API**.
2. Copy **Project URL** and the **anon / public** key.
3. Open `js/supabase/config.js` in this repo and replace the two placeholder strings.
4. Commit and push this file — the anon key is *designed* to be public (it's meaningless
   without the Row Level Security policies `schema.sql` set up, which restrict every table to
   `user_id = auth.uid()`).

## Part 4 — Generate your first invite code

Table Editor → `invite_codes` → **Insert row**:
- `code`: pick something like `FRIENDS2026` (must be unique)
- `max_uses`: how many people can use it (e.g. `5`), or create one code per friend with `max_uses: 1`
- leave `used_by`/`used_at` blank

Repeat to make more codes as needed. There's no admin UI for this yet (PROD-19/roadmap) —
direct table edits in the dashboard are the intended workflow at this scale.

## Part 5 — Test in isolation (before touching anything live)

The new auth screen (`js/views/auth.js`) and Supabase state layer (`js/supabase/state.js`)
are **not wired into the live app** yet. To test them without any risk to your current app:

1. Serve the repo locally: `python -m http.server 8000` from the repo root.
2. Temporarily create a throwaway `test.html` (do not commit) that loads `js/views/auth.js`
   and calls `render(document.body, { onSignedIn: () => console.log("signed in!") })` — or ask
   your Sonnet implementation session to wire up a temporary `#/auth-test` route in a local
   branch for manual testing.
3. Sign up with one of your invite codes, confirm the email, sign in.
4. Confirm a row appeared in `profiles` and `user_settings` for your new user (the
   `handle_new_user` trigger in `schema.sql` creates these automatically).

## Part 6 — Migrate your existing data (still non-destructive)

Once you've signed up for real (Part 5) and have your Supabase user UUID (Dashboard →
Authentication → Users → copy the UUID next to your email):

```
pip install -r scripts/requirements-migrate.txt

SUPABASE_URL=https://xxxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<your service_role key, from Project Settings > API> \
python scripts/migrate_to_supabase.py --user-id <your-uuid> --dry-run
```

Review the dry-run output (row counts per table), then re-run **without** `--dry-run` to
actually copy the data. This only *reads* `data/*.json` — your GitHub-backed live app is
completely unaffected; you can run this migration script as many times as you want (it
upserts, so re-running is safe) while continuing to use the live app normally.

## Part 7 — The cutover (only when you're ready)

This is the one step that changes what the live app actually does. Do this in a **new git
branch**, test thoroughly, and only merge to `main` when you're confident:

1. In `js/app.js`, replace the `isConfigured()`-based gate with a Supabase session check
   (`import { isSignedIn } from "./supabase/state.js"`) that renders `js/views/auth.js` when
   there's no session.
2. Swap every view's import of `../state.js` → `../supabase/state.js` and `../anthropic.js` →
   `../supabase/anthropic.js`. The function signatures are identical by design (see
   `ENGINEERING_REVIEW.md` §3.4), so this should be close to a pure import-path change.
3. Wire the no-Garmin degradation (PROD-5) and manual check-in (`js/lib/wellness_checkin.js`,
   PROD-6) into `js/views/today.js` and `js/lib/recovery.js`.
4. Add an Account section to `js/views/settings.js` using `js/supabase/account.js`
   (`exportAllData`, `deleteAccount`, `signOut`) — PROD-16.
5. Add quota-UX handling (PROD-17): catch `QuotaExceededError` from
   `js/supabase/anthropic.js` wherever coach calls happen, show the friendly message instead
   of a raw error.
6. Test the full loop end-to-end as a **second, brand-new invited user** (not your migrated
   account) to make sure the invite-gated signup → onboarding → first program flow works for
   someone with zero existing data.
7. Only once satisfied: merge to `main`. Your original `data/*.json` files can stay in the
   repo indefinitely as a backup/reference — nothing requires deleting them, and the Garmin
   sync workflow can be disabled (`.github/workflows/garmin-sync.yml` → add `if: false` to the
   job, or delete the file) once you've moved to the optional BYO-Garmin path described in
   `ENGINEERING_REVIEW.md` §3.5.

## Rollback

Because the cutover is isolated to a few import-path changes in a branch, rolling back is
just: don't merge the branch (or `git revert` it). The GitHub-backed code never gets deleted
by this migration, so you can always fall back to it.
