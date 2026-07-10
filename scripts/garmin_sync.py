"""Sync recent Garmin Connect data into data/*.json for the fitness tracker frontend.

Run by .github/workflows/garmin-sync.yml on a cron + workflow_dispatch. Also runnable locally:

    GARMIN_EMAIL=... GARMIN_PASSWORD=... python scripts/garmin_sync.py

Exit codes:
  0  success, or a transient/rate-limit error we chose to swallow (so the cron keeps running)
  1  auth failure (bad credentials, MFA required with no way to satisfy it, session unusable)
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path


def _sanitize_session_dir() -> None:
    """Remove a corrupt cached session BEFORE importing garth.

    garth auto-resumes from GARTH_HOME at import time and crashes with a JSONDecodeError
    if any token file is empty/corrupt (e.g. a bad Actions cache restore), so validate
    every JSON file first and wipe the directory if anything is unreadable.
    """
    home = Path(os.environ.get("GARTH_HOME", str(Path(__file__).resolve().parent.parent / ".garth")))
    if not home.exists():
        return
    for f in home.glob("*.json"):
        try:
            with f.open("r", encoding="utf-8") as fh:
                json.load(fh)
        except (json.JSONDecodeError, OSError):
            print(f"[garmin_sync] corrupt session file {f.name}, clearing session dir", flush=True)
            shutil.rmtree(home, ignore_errors=True)
            return


_sanitize_session_dir()

import garth  # noqa: E402 - must come after session sanitization (garth auto-resumes on import)
from garth.exc import GarthException
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SESSION_DIR = Path(os.environ.get("GARTH_HOME", str(REPO_ROOT / ".garth")))
ACTIVITIES_LOOKBACK_DAYS = int(os.environ.get("ACTIVITIES_LOOKBACK_DAYS", "14"))
WELLNESS_LOOKBACK_DAYS = int(os.environ.get("WELLNESS_LOOKBACK_DAYS", "14"))

ACTIVITIES_FILE = DATA_DIR / "garmin_activities.json"
WELLNESS_FILE = DATA_DIR / "garmin_wellness.json"
HEALTH_FILE = DATA_DIR / "garmin_health.json"


def log(msg: str) -> None:
    print(f"[garmin_sync] {msg}", flush=True)


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        log(f"WARNING: could not parse {path}, starting fresh")
        return default


def save_json_if_changed(path: Path, data) -> bool:
    new_text = json.dumps(data, indent=2, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == new_text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new_text, encoding="utf-8")
    return True


def authenticate() -> Garmin:
    """Resume a persisted garth session if possible, else do a fresh login."""
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if not email or not password:
        log("FATAL: GARMIN_EMAIL / GARMIN_PASSWORD not set")
        sys.exit(1)

    client = Garmin(email=email, password=password)

    if SESSION_DIR.exists():
        try:
            garth.resume(str(SESSION_DIR))
            client.garth = garth.client
            # Cheap call to confirm the resumed session is actually still valid.
            client.get_full_name()
            log("resumed existing garth session")
            return client
        except Exception as e:  # noqa: BLE001 - any resume failure -> fresh login
            log(f"session resume failed ({e!r}), falling back to fresh login")

    try:
        client.login()
    except GarminConnectAuthenticationError as e:
        log(f"FATAL: authentication failed: {e}")
        sys.exit(1)
    except GarthException as e:
        log(f"FATAL: garth auth error (possibly MFA required, unsupported in CI): {e}")
        sys.exit(1)

    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    garth.save(str(SESSION_DIR))
    log("fresh login succeeded, session saved")
    return client


def fetch_activities(client: Garmin) -> list[dict]:
    raw = client.get_activities(0, 50)
    out = []
    for a in raw:
        activity_date = (a.get("startTimeLocal") or "")[:10]
        if activity_date and activity_date < str(date.today() - timedelta(days=ACTIVITIES_LOOKBACK_DAYS)):
            continue
        out.append({
            "id": a.get("activityId"),
            "date": activity_date,
            "type": (a.get("activityType") or {}).get("typeKey"),
            "name": a.get("activityName"),
            "duration_seconds": a.get("duration"),
            "distance_meters": a.get("distance"),
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "calories": a.get("calories"),
            "training_load": a.get("activityTrainingLoad"),
            "aerobic_effect": a.get("aerobicTrainingEffect"),
            "anaerobic_effect": a.get("anaerobicTrainingEffect"),
        })
    return out


def fetch_wellness(client: Garmin) -> list[dict]:
    out = []
    today = date.today()
    for i in range(WELLNESS_LOOKBACK_DAYS):
        d = today - timedelta(days=i)
        d_str = d.isoformat()
        try:
            stats = client.get_stats(d_str) or {}
            sleep = client.get_sleep_data(d_str) or {}
        except Exception as e:  # noqa: BLE001 - per-day failure shouldn't kill the whole sync
            log(f"WARNING: wellness fetch failed for {d_str}: {e!r}")
            continue
        sleep_summary = sleep.get("dailySleepDTO") or {}
        out.append({
            "date": d_str,
            "resting_hr": stats.get("restingHeartRate"),
            "steps": stats.get("totalSteps"),
            "sleep_seconds": sleep_summary.get("sleepTimeSeconds"),
            "deep_sleep_seconds": sleep_summary.get("deepSleepSeconds"),
            "light_sleep_seconds": sleep_summary.get("lightSleepSeconds"),
            "rem_sleep_seconds": sleep_summary.get("remSleepSeconds"),
            "awake_seconds": sleep_summary.get("awakeSleepSeconds"),
        })
    return out


def fetch_health(client: Garmin) -> list[dict]:
    """VO2 max, HRV, fitness age, intensity minutes — the cardiovascular health module."""
    out = []
    today = date.today()
    for i in range(WELLNESS_LOOKBACK_DAYS):
        d = today - timedelta(days=i)
        d_str = d.isoformat()
        entry = {"date": d_str}
        try:
            maxmet = client.get_max_metrics(d_str) or []
            if maxmet:
                generic = (maxmet[0] or {}).get("generic") or {}
                cycling = (maxmet[0] or {}).get("cycling") or {}
                entry["vo2max_running"] = generic.get("vo2MaxValue")
                entry["vo2max_cycling"] = cycling.get("vo2MaxValue")
                entry["fitness_age"] = (maxmet[0] or {}).get("fitnessAge")
        except Exception as e:  # noqa: BLE001
            log(f"WARNING: max metrics fetch failed for {d_str}: {e!r}")
        try:
            hrv = client.get_hrv_data(d_str) or {}
            summary = hrv.get("hrvSummary") or {}
            entry["hrv_status"] = summary.get("status")
            entry["hrv_avg_ms"] = summary.get("lastNightAvg")
        except Exception as e:  # noqa: BLE001
            log(f"WARNING: HRV fetch failed for {d_str}: {e!r}")
        try:
            im = client.get_intensity_minutes_data(d_str) or {}
            entry["intensity_minutes_moderate"] = im.get("moderateValue")
            entry["intensity_minutes_vigorous"] = im.get("vigorousValue")
        except Exception as e:  # noqa: BLE001
            log(f"WARNING: intensity minutes fetch failed for {d_str}: {e!r}")
        if len(entry) > 1:
            out.append(entry)
    return out


def merge_by_key(existing: list[dict], fresh: list[dict], key: str) -> list[dict]:
    by_key = {item[key]: item for item in existing if item.get(key) is not None}
    for item in fresh:
        if item.get(key) is not None:
            by_key[item[key]] = item
    return sorted(by_key.values(), key=lambda x: str(x.get("date") or x.get(key)))


def post_to_supabase(activities: list[dict], wellness: list[dict], health: list[dict]) -> None:
    """Optional: push the merged data to the garmin-ingest Supabase Edge Function so it lands
    in this user's Supabase-backed rows (see supabase/functions/garmin-ingest/index.ts). This
    is separate from and in addition to the local data/*.json write above — set both
    SUPABASE_INGEST_URL and GARMIN_INGEST_TOKEN to enable it; leave them unset to keep the
    script GitHub-only.
    """
    ingest_url = os.environ.get("SUPABASE_INGEST_URL")
    ingest_token = os.environ.get("GARMIN_INGEST_TOKEN")
    if not ingest_url or not ingest_token:
        log("SUPABASE_INGEST_URL/GARMIN_INGEST_TOKEN not set, skipping Supabase sync")
        return

    import requests  # imported lazily so this dependency is only needed when actually used

    payload = {"activities": activities, "wellness": wellness, "health": health}
    try:
        res = requests.post(
            ingest_url,
            headers={"X-Ingest-Token": ingest_token, "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        if not res.ok:
            log(f"WARNING: Supabase ingest failed: {res.status_code} {res.text}")
        else:
            log(f"Supabase ingest ok: {res.json()}")
    except Exception as e:  # noqa: BLE001 - never let a Supabase hiccup fail the whole sync
        log(f"WARNING: Supabase ingest request failed: {e!r}")


def main() -> None:
    client = authenticate()

    changed = False
    merged_activities, merged_wellness, merged_health = [], [], []

    try:
        activities = fetch_activities(client)
        existing_activities = load_json(ACTIVITIES_FILE, [])
        merged_activities = merge_by_key(existing_activities, activities, "id")
        if save_json_if_changed(ACTIVITIES_FILE, merged_activities):
            changed = True
            log(f"activities updated ({len(merged_activities)} total)")
    except (GarminConnectConnectionError, GarminConnectTooManyRequestsError) as e:
        log(f"WARNING: transient error fetching activities, skipping: {e!r}")
        merged_activities = load_json(ACTIVITIES_FILE, [])

    try:
        wellness = fetch_wellness(client)
        existing_wellness = load_json(WELLNESS_FILE, [])
        merged_wellness = merge_by_key(existing_wellness, wellness, "date")
        if save_json_if_changed(WELLNESS_FILE, merged_wellness):
            changed = True
            log(f"wellness updated ({len(merged_wellness)} total)")
    except (GarminConnectConnectionError, GarminConnectTooManyRequestsError) as e:
        log(f"WARNING: transient error fetching wellness, skipping: {e!r}")
        merged_wellness = load_json(WELLNESS_FILE, [])

    try:
        health = fetch_health(client)
        existing_health = load_json(HEALTH_FILE, [])
        merged_health = merge_by_key(existing_health, health, "date")
        if save_json_if_changed(HEALTH_FILE, merged_health):
            changed = True
            log(f"health updated ({len(merged_health)} total)")
    except (GarminConnectConnectionError, GarminConnectTooManyRequestsError) as e:
        log(f"WARNING: transient error fetching health data, skipping: {e!r}")
        merged_health = load_json(HEALTH_FILE, [])

    post_to_supabase(merged_activities, merged_wellness, merged_health)

    # Signal to the workflow whether there's anything to commit.
    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a", encoding="utf-8") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")

    log("done" if changed else "done (no changes)")


if __name__ == "__main__":
    main()
