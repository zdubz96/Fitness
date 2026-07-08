# Product Review — AI Fitness Tracker

**Reviewer lens:** principal product manager
**Date:** 2026-07-05 (app at "Build 10")
**Audience:** the owner first (review + prioritize), then an implementation model (Sonnet).
**Companion doc:** `docs/ENGINEERING_REVIEW.md` — items here reference its IDs (ENG-n) where a product change depends on an engineering one. The confirmed technical direction is the **Supabase multi-tenant migration** (ENG Part 3): email signup, owner-paid Anthropic tokens, Garmin optional. This review is written against that target.

## What this product is (and why it's worth sharing)

An AI personal trainer that actually closes the loop: it *knows* your training history, recovery state, and goals; writes your week; adapts when life happens; and reviews your progress. The differentiator vs. commercial apps (Fitbod, Future, Garmin Coach) is the coach's **full-context reasoning** — it reads your Garmin recovery data, your logged lifts, your feedback, and your own words, and programs accordingly with evidence-based guardrails (`js/lib/principles.js`). That's a genuinely strong core. The current weaknesses are all around the edges: setup friction, habit formation, and single-user assumptions.

---

## Journey review, stage by stage

### Stage 1 — First contact & signup (today: the biggest funnel kill)

**Current:** a new user needs a GitHub account, a fine-grained PAT with the right scopes, an Anthropic API key with billing set up, and optionally Garmin Actions secrets — ~30 minutes of developer-grade setup before any value. This filters out essentially everyone but the owner.

**After migration:** open URL → sign up with email → accept disclaimer → coach interview → first program. Time-to-first-value ~3 minutes.

Recommendations:
- **PROD-1 (P0):** Signup flow with disclaimer. Simple email+password (Supabase Auth), one screen of "this is not medical advice; consult a physician; you train at your own risk" with explicit accept stored on the profile (ENG §3.2 `disclaimer_accepted_at`). Blocking — a shared health app should not launch without it.
- **PROD-2 (P1):** Interview quick-start. The onboarding interview (`js/views/onboarding.js`) is good but long for a curious friend. Offer two paths: "Quick start" (3 questions: goal, experience, days/week — coach fills sensible defaults, profile marked `provisional: true` and the coach fleshes it out during early chats) vs. "Full interview". Provisional profiles should nudge ("2-min chat to finish your profile") until completed.
- **PROD-3 (P1):** First program with zero extra taps. After the interview completes, generate the first week automatically and land the user on Today with it ready — don't make them find the Generate button.
- **PROD-4 (P2):** Pre-signup demo. A read-only sample Today view (canned data) behind a "See what it looks like" link on the auth screen. Cheap, answers "what am I signing up for."

### Stage 2 — The no-Garmin reality (new default journey)

**Current:** the app assumes Garmin everywhere: recovery badge, sleep/RHR/load tiles, Health tab, deload logic. A user without a wearable sees dashes, empty charts, and a recovery badge that reads **green** ("all within normal range") when in truth there's *no data* — misleading.

Recommendations:
- **PROD-5 (P0):** Graceful no-wearable degradation. Recovery badge gets a fourth state ("No data" — grey) driven by ENG §3.5's `level: "unknown"`; sleep/RHR tiles show a "Connect Garmin or log how you feel" affordance instead of "—"; Health tab renders a friendly explainer + manual-data alternatives instead of empty charts; the coach context explicitly states wearable data is unavailable so it doesn't hallucinate recovery claims.
- **PROD-6 (P0):** Manual wellness check-in. A 5-second optional prompt on first open of the day: sleep quality (1–5), soreness (1–5), energy (1–5) → stored in `body_metrics`/wellness-equivalent and fed into recovery computation with honest weighting. This keeps the deload/readiness feature alive for non-Garmin users — it's the product's most differentiating loop, don't let it be Garmin-only.
- **PROD-7 (P1):** Garmin as a "power-up" page. Settings gets a dedicated "Connect Garmin" page explaining the bring-your-own-sync path (ENG §3.5) with copy-paste setup. Position: optional enhancement, not a requirement.

### Stage 3 — The daily training loop

**Current strengths:** week strip with per-day status, interactive checklist, auto rest timer with wake lock, long-press coach adjustments, post-workout feedback, weight logging with last-time hints. This loop is genuinely good.

Gaps:
- **PROD-8 (P1):** Guided "workout mode." The checklist is a list, not a flow. Add a "Start workout" button that walks exercise-by-exercise full-screen: current exercise, weight/target, big tick button, integrated rest timer, "next up" preview, elapsed session time. Checklist remains as the overview/fallback. This is the single biggest daily-UX upgrade.
- **PROD-9 (P1):** Exercise detail view. Tap an exercise name (anywhere) → history sheet: weight/est-1RM trend for that movement, last 5 sessions, coach notes/adjustment log. Data already exists in `exercise_logs`; it's pure presentation.
- **PROD-10 (P2):** Exercise how-to. A `form_cue` one-liner already comes in `notes`; add an optional "how do I do this?" that asks the coach and caches the answer per exercise name. No video library needed — the coach explains on demand.
- **PROD-11 (P2):** Streaming coach chat (depends ENG §3.3 SSE). Long replies currently appear all-at-once after ~10s of spinner; streaming makes the coach feel alive. Also add 3 quick-reply chips above the chat input ("Swap today's workout", "I'm sore from last time", "Make today shorter") — they map to the highest-frequency real requests.

### Stage 4 — Habit & retention (the backend unlock)

**Current:** zero reminders, zero celebrations; weekly review requires noticing a banner and tapping. Everything below was architecturally impossible without a backend and becomes possible with Supabase — collectively this is the **biggest product win of the migration**:

- **PROD-12 (P1):** Workout-day push reminders. Web Push (service worker already exists in `sw.js`) + a Supabase scheduled function reading each user's program: "Lower strength day today — 60 min planned." Per-user on/off + time-of-day in Settings. (Caveat to document: iOS requires the PWA installed to Home Screen for push.)
- **PROD-13 (P1):** Server-generated weekly review. Scheduled function generates each user's Coach Review Sunday night via `coach-proxy`; it's waiting on first open (banner becomes "Your review is ready →"). Removes the manual tap; pairs with a push notification.
- **PROD-14 (P2):** PRs & streaks. Detect new estimated-1RM highs and weekly-consistency streaks at logging time; celebrate inline (toast/confetti card on Today). Cheap, high delight-per-effort.
- **PROD-15 (P2):** Proactive coach nudges. Scheduled fatigue check: if recovery flags red 2+ days, coach sends one push ("Your recovery's been rough — want me to lighten this week?") deep-linking to Readjust. Must be capped (e.g. ≤1/week) and user-disableable — proactive AI is welcome exactly once.

### Stage 5 — Trust, cost & account hygiene (new obligations of hosting)

- **PROD-16 (P0):** Account lifecycle. Password reset, email change, **data export** (one-tap JSON download of all their rows), **account deletion** (hard delete via cascade, confirm dialog). Table stakes for holding other people's health data — ships with the migration, not after. Settings' token fields are replaced by an Account section.
- **PROD-17 (P0):** Quota UX. Owner pays per token, so limits must be graceful: a usage meter in Settings ("Coach energy: 62% left this month"), and when `coach-proxy` returns 429, a friendly full-screen message ("You've used this month's coaching budget — resets Aug 1. Logging and history still work.") Never a raw API error. Non-coach features must keep working at quota.
- **PROD-18 (P1):** Honest-data labels. Zone-minutes in the Health tab are avg-HR approximations of whole activities (`js/lib/zones.js` `estimateActivityZoneMinutes`) — label the card "estimated from average HR". Same for `effectiveLoad` estimates on unscored activities. Trust compounds; quiet overclaiming erodes it.
- **PROD-19 (P2):** Privacy one-pager. What's stored, that coach messages are sent to Anthropic for processing, what the owner can/can't see (be honest: a service-role owner can technically read rows), how to delete everything. Link at signup + Settings.

### Stage 6 — Shareability & growth

- Invite flow after migration is just **share the URL** — that's the pitch ("my AI coach, want one? takes 3 minutes").
- **PROD-20 (P2):** Share cards. Export a weekly review or PR as an image card (canvas render → share sheet). The organic loop: people share proof-of-progress, card carries the app name/URL.
- **Deliberately out of scope for now:** social feeds, leaderboards, public profiles. The product's voice is a private coach; social features change the psychology and demand moderation. Revisit only if a genuine "training buddies" pull emerges — and then as consent-first shared-program viewing (P2+, design doc first).

---

## Prioritized roadmap

| Priority | Items | Theme |
|---|---|---|
| **P0 — ships WITH the migration** (incomplete without) | ENG Part 3 (auth, DB, coach-proxy) + PROD-1, 5, 6, 16, 17 | Safe, honest, complete multi-tenant baseline |
| **P1 — first fast-follows** | PROD-2, 3, 7, 8, 9, 12, 13, 18 | Onboarding polish, daily-loop depth, retention |
| **P2 — delight & growth** | PROD-4, 10, 11, 14, 15, 19, 20 | Streaming, celebrations, nudges, share loops |

**Effort ballparks:** P0 ≈ the migration itself + ~4 small features (days of model-implementation work). P1 items are each hours-to-a-day. P2 items are each small except streaming (PROD-11, coupled to ENG §3.3).

## Open questions for the owner (answer before implementation)

1. **Quota default** — 300k tokens/month (~$1–3/user) is proposed in ENG §3.2. Comfortable? Want a global monthly spend ceiling too?
2. **Who can sign up** — open registration, or an invite-code gate (one `invite_codes` table; friends-only keeps costs predictable)?
3. **Push notifications** — comfortable with the iOS "must install to Home Screen" caveat, or defer PROD-12/13 push and keep in-app banners initially?
4. **App name & URL** — "AI Trainer" on `zdubz96.github.io/Fitness` is fine for friends; a custom domain (~$10/yr) makes sharing feel more legit. Worth it?
