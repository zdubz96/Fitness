# Health Tab Review & Redesign Spec

**Reviewer lens:** lead product manager
**Date:** 2026-07-11 (app at Build 11, Supabase backend live)
**Trigger:** desktop screenshot review of the Health tab with real Garmin data flowing for the first time.
**Audience:** an implementation model (Sonnet) working from this doc + the repo, without the original conversation.
**Companion docs:** `docs/PRODUCT_REVIEW.md` (this closes PROD-18), `docs/ENGINEERING_REVIEW.md`.

---

## The verdict

The Health tab has real data behind it now, and the data is good — the presentation wastes it. Every
chart is a naked squiggle: no axes, no numbers, no dates, no current value. The VO2 max chart renders
as a small floating box in the middle of a full-width card (a genuine SVG scaling bug, not a style
choice). The two most important questions a health dashboard must answer — **"where am I?"** and
**"what should I do about it?"** — are answered nowhere on the page. And when data is missing, the
page presents it as failure ("0 / 150 min") instead of absence.

A user opens this tab, sees wiggly lines with no scale, and closes it. Nothing here changes behavior,
which is the only reason a Health tab exists.

## What the screenshot shows, precisely

1. **VO2 Max card:** value "42.0" + "Average" badge (good — the only stat-first element on the page),
   but the band chart renders ~320px wide, centered, in a ~2000px card. Band labels (Excellent/Good/
   Average/Below average) overlap at the top-right of the tiny chart. The trend line itself is
   invisible — with only a few data points at the same value it degenerates to nothing.
2. **Cardio Dashboard:** two unlabeled sparklines (Resting HR, HRV). No y-values — the RHR line's
   wiggle could span 3 bpm or 30. No current value for either. No dates. HRV has never shown a number
   anywhere in the app.
3. **Zone 2 minutes: "120 / 150 min"** and **Intensity minutes: "0 / 150 min (WHO)"** — side by side,
   contradicting each other. Zone rows below show 152 + 120 = 272 active minutes; the intensity "0"
   is because Garmin's intensity-minutes fields are null in `garmin_health`, not because the user did
   nothing. The empty bar chart with a lone dashed target line reads as an indictment.
4. **Zone Distribution:** only Zone 1 and Zone 2 rows appear (zones with 0 minutes are silently
   omitted), no disclosure that these are estimates from average HR, no polarization insight.
5. **Quarterly Cardio Report:** fine as-is (LLM-generated on demand).

## Root causes (verified in code)

- **`js/lib/charts.js`** — all three helpers (`lineChart`, `lineChartWithBands`, `barChart`) emit
  `viewBox="0 0 320 H" width="100%" height="H"`. SVG's default `preserveAspectRatio="xMidYMid meet"`
  scales to the fixed height and centers horizontally, so on any card wider than ~320px the chart
  floats as a small box. **This bug affects every chart in the app, including the Progress tab.**
- Same file — no axis rendering exists at all. Series are `{value}` only; dates are discarded by the
  callers, so x-labels aren't even possible without a signature change.
- **`js/views/health.js`** — builds `vo2Series`/`rhrSeries`/`hrvSeries` as value-only arrays
  (dropping dates), sums intensity minutes without distinguishing "null data" from "zero minutes",
  and renders only zones present in `zoneMinutes`.
- **`js/lib/zones.js` → `estimateActivityZoneMinutes()`** — buckets each activity's entire duration
  into the zone containing its *average* HR. A reasonable approximation, but it's presented as fact.
  This is the honesty gap already logged as **PROD-18** in `docs/PRODUCT_REVIEW.md`.
- **`js/lib/principles.js`** instructs the coach to keep training polarized (avoid the moderate
  "gray zone"), but the Health tab never surfaces polarization — a missed differentiator that the
  data already supports.

## Design principles for the fix

Every metric card must answer, in order: **(1) What is it now? (2) Is that good? (3) Which way is it
moving? (4) What should I do?** — value, context badge, delta/trend with a readable chart, and a
plain-language insight. Estimates must say they're estimates. Absence of data must never be rendered
as a zero.

---

## Change spec

Items are `HT-n`, severity-tagged, with acceptance criteria. HT-1 and HT-2 are the foundation —
do them first; HT-3…HT-5 build on them.

### HT-1 · Fix SVG chart scaling — **P0, app-wide bug**
- **Where:** `js/lib/charts.js` (all three helpers).
- **Change:** render at a wider logical width (700) so charts fill cards: `viewBox="0 0 700 H"`.
  Keep `width="100%"`. Font sizes inside the SVG scale with the viewBox, so at 700 logical width
  text stays legible on both mobile (~375px, slight shrink) and desktop (slight grow). Do NOT use
  `preserveAspectRatio="none"` (it stretches text). Callers pass no width today (they use defaults),
  so changing the default is sufficient — verify no caller passes `width:` explicitly.
- **Acceptance:** on a 375px and a 1400px viewport, the VO2, RHR, and HRV charts span the full card
  width with no horizontal centering gap; Progress-tab charts likewise.

### HT-2 · Axes, gridlines, dates, current-value marker — **P0**
- **Where:** `js/lib/charts.js`; callers in `js/views/health.js` and `js/views/progress.js`.
- **Change:**
  - Series items gain an optional `date` field: `{date: "2026-07-11", value: 52}`. Callers stop
    discarding dates when they map rows to series.
  - `lineChart`/`lineChartWithBands`: draw 3 horizontal gridlines (subtle, e.g. `#2c3a52` 1px) with
    y-value labels at min/mid/max (left-aligned, ~10px logical font, `--text-dim` color); x-axis
    labels for first and last date (short form, e.g. "Apr 12" / "Jul 11"); a filled dot on the final
    point with the current value labeled next to it in the line color.
  - `barChart`: y-max label + target-line label (e.g. "150 target"), first/last x labels when dates
    are provided.
  - Reserve left/bottom padding inside the existing `padding` scheme so labels don't clip (increase
    default padding: left ~34, bottom ~16, top/right ~8 — switch `padding` to per-side or add a
    second option; keep the API otherwise identical).
  - Values with no data remain gaps (current behavior).
- **Acceptance:** every line chart in Health and Progress shows y-scale numbers, first/last dates,
  and a labeled current-value dot; nothing overlaps or clips at 375px width.

### HT-3 · Stat-first metric cards — **P0**
- **Where:** `js/views/health.js`.
- **Change:** each metric leads with the number, then the chart:
  - **Resting HR card:** big current value ("52 bpm"), a delta chip vs the prior-30-day average
    ("↓ 3 vs prior 30d" — green when improving [RHR down / HRV up / VO2 up], red when worsening,
    neutral gray within ±1), then the chart.
  - **HRV card:** same treatment (current nightly avg, delta chip, chart). HRV finally gets a number.
  - **VO2 Max card:** keep value + classification badge; add band position in words ("Average — 2.0
    below Good for your age/sex"), computed from `getVO2MaxBands`/`classifyVO2Max` in
    `js/lib/vo2max.js`. Chart below per HT-1/HT-2 (bands + axes).
  - Delta helper: compute mean of last 7 days vs mean of the 30 days before that; reuse the
    `daysAgo`/window pattern from `js/lib/recovery.js` (`windowValues`) rather than writing new
    date math.
- **Acceptance:** RHR, HRV, and VO2 each show current value + delta chip + readable chart; deltas
  verified against hand-computed values from `garmin_wellness`/`garmin_health` rows.

### HT-4 · Local insights strip ("This week") — **P0, the "so what"**
- **Where:** new `js/lib/health_insights.js`; rendered at the top of `js/views/health.js`.
- **Change:** a deterministic, zero-LLM-cost function `computeHealthInsights({wellness, health,
  activities, profile})` returning an array of `{level: "good"|"watch"|"info", text}` covering:
  - Zone-2 target gap: "Zone 2: 120 of 150 min this week — one more ~30-min easy session closes it."
  - RHR trend: "Resting HR trending down over 30 days (54 → 52) — good sign." (or up → watch)
  - HRV trend: same pattern.
  - VO2 trajectory: flat/up/down over the available window; if <3 data points, "Too early to call a
    VO2 max trend — keep logging."
  - Polarization: if Zone 3 (Moderate) > ~30% of the week's zone minutes → watch: "A third of your
    cardio is in the gray zone — the coach's plan favors easy Zone 2 + short hard intervals instead."
  - Missing-data notices as `info`, e.g. "Garmin isn't reporting intensity minutes — check that your
    watch tracks moderate/vigorous minutes."
  - Render as a compact bulleted card ("This week") with a colored dot per level (reuse badge colors).
  - Keep LLM interpretation where it already lives (quarterly cardio report) — this strip must be
    instant and free.
- **Acceptance:** with the owner's current data, the strip shows at least the Zone-2 gap line and one
  trend line; with empty data it shows a single friendly "connect Garmin or log activities" info line.

### HT-5 · Honest empty & estimate states — **P0** (closes PROD-18)
- **Where:** `js/views/health.js`.
- **Change:**
  - **Intensity minutes:** distinguish null from zero. If all `intensity_minutes_*` fields in the
    last 7 days of `garmin_health` are null/undefined → replace the "0 / 150" row and empty bar chart
    with: "No intensity-minutes data from Garmin yet." (+ the HT-4 info insight). Only render the
    number and chart when at least one real value exists.
  - **Zone Distribution:** always list all 5 zones from `defaultZones()` including 0-minute rows
    (0-min bars render as empty tracks); add the caption "Estimated from each activity's average
    heart rate — treat as approximate." under the card title.
  - **Sparse charts:** if a series has <3 numeric points, skip the chart and show the value(s) as
    text + "Not enough history for a trend yet."
- **Acceptance:** with intensity fields null, no "0/150" appears anywhere; Zone card always shows 5
  rows + the estimate caption; a 2-point VO2 series produces the text fallback, not an invisible line.

### HT-6 · Zone card upgrade — **P1**
- **Where:** `js/views/health.js` (+ small additions to `js/lib/zones.js` if needed).
- **Change:** color-code zone bars (Z1 gray → Z5 red, define once); move the weekly Zone-2 progress
  bar (vs 150-min target) into this card so zone data lives in one place; show a "gray zone" warning
  chip on the Zone 3 row when the HT-4 polarization flag triggers.
- **Acceptance:** five colored bars, Zone-2 progress bar with target, chip appears when Zone 3 >30%.

### HT-7 · Date-range captions — **P1**
- **Where:** `js/views/health.js` (and `js/views/progress.js` for consistency).
- **Change:** every card states its window once under the title in dim small text: "Last 90 days",
  "Last 7 days". Remove ad-hoc "(90d)" fragments from individual labels.
- **Acceptance:** each Health card shows exactly one window caption; no orphan "(90d)" strings remain.

### HT-8 · Progress-tab spillover — **P1 (verification task)**
- HT-1/HT-2 change shared chart code. Verify all call sites: `js/views/progress.js` (volume bars,
  body-weight line, 1RM lines, cardio-minutes bars, RHR line) and `js/views/health.js`. Update those
  callers to pass `{date, value}` so Progress charts gain axes too. Bump `APP_VERSION` in
  `js/version.js` when shipping.
- **Acceptance:** Progress charts fill their cards and show axes; nothing regresses visually at
  mobile width.

---

## Out of scope (deliberately)

- Interactive charts (tooltips, pinch-zoom) — SVG-string rendering doesn't support it cleanly;
  revisit only if the static upgrade proves insufficient.
- LLM-generated insights on tab load — cost + latency; the quarterly report covers narrative depth.
- Real per-second HR zone data — requires a different Garmin endpoint; the estimate + honest caption
  is the right trade-off for now.

## Suggested implementation order

HT-1 → HT-2 (foundation, one PR) → HT-3 + HT-5 (health view rewrite) → HT-4 (insights) →
HT-6/HT-7/HT-8 (polish + verification).
