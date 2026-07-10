"""One-off migration: copy this repo's data/*.json into your Supabase project.

READ-ONLY against data/*.json — this script never writes, deletes, or modifies anything in
this repo. It only reads the existing files and POSTs copies of that data to Supabase. Your
live GitHub-backed app keeps working completely unaffected before, during, and after running
this.

Prerequisites (see docs/SUPABASE_SETUP.md):
  1. supabase/schema.sql has been run in the Supabase SQL Editor.
  2. You have signed up for an account in the (not-yet-cutover) Supabase auth flow at least
     once, OR you provide --user-id directly if you already know your auth.users UUID
     (Dashboard -> Authentication -> Users -> copy the UUID next to your email).

Usage:
  SUPABASE_URL=https://xxxxx.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  python scripts/migrate_to_supabase.py --user-id <your-auth-user-uuid>

  Add --dry-run to preview without writing anything to Supabase.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"


def log(msg: str) -> None:
    print(f"[migrate] {msg}", flush=True)


def load_json(name: str, default):
    path = DATA_DIR / f"{name}.json"
    if not path.exists():
        log(f"WARNING: {path} not found, using default")
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def upsert(base_url: str, headers: dict, table: str, rows: list[dict], on_conflict: str | None, dry_run: bool, user_id: str) -> None:
    """Sync `rows` into `table` for this user. data/*.json is always the FULL current
    snapshot (not an incremental diff), so re-running this script must be safe to call
    repeatedly without duplicating anything:

    - Tables with a real unique constraint (on_conflict set): a plain upsert is naturally
      idempotent — re-running just overwrites the same rows.
    - Append-only tables with no unique constraint on the migrated columns (exercise_logs,
      goals, coach_chats): upsert alone would insert duplicates on every re-run, since
      Postgres has nothing to conflict on. Instead, delete this user's existing rows in the
      table first, then insert the current full list — a full resync, matching how the
      source JSON itself works.
    """
    if not on_conflict:
        if dry_run:
            log(f"{table}: would delete existing rows for this user, then insert {len(rows)} row(s) (dry run, not sent)")
            return
        del_res = requests.delete(f"{base_url}/rest/v1/{table}", headers=headers, params={"user_id": f"eq.{user_id}"}, timeout=30)
        if not del_res.ok:
            log(f"FATAL: {table} pre-resync delete failed: {del_res.status_code} {del_res.text}")
            sys.exit(1)

    if not rows:
        log(f"{table}: nothing to migrate")
        return
    if dry_run:
        log(f"{table}: would upsert {len(rows)} row(s) (dry run, not sent)")
        return
    url = f"{base_url}/rest/v1/{table}"
    params = {"on_conflict": on_conflict} if on_conflict else {}
    req_headers = {**headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
    # Send in batches to stay well under any request-size limits.
    batch_size = 200
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        res = requests.post(url, headers=req_headers, params=params, json=batch, timeout=30)
        if not res.ok:
            log(f"FATAL: {table} batch {i}-{i+len(batch)} failed: {res.status_code} {res.text}")
            sys.exit(1)
    log(f"{table}: migrated {len(rows)} row(s)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True, help="Your auth.users UUID in Supabase")
    parser.add_argument("--dry-run", action="store_true", help="Preview counts without writing")
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        log("FATAL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables")
        sys.exit(1)

    uid = args.user_id
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    log(f"Migrating data/*.json -> Supabase user {uid} (dry_run={args.dry_run})")

    # profiles (single row)
    profile = load_json("trainer_profile", {})
    upsert(
        supabase_url, headers, "profiles",
        [{"user_id": uid, "data": profile}],
        on_conflict="user_id", dry_run=args.dry_run, user_id=uid,
    )

    # workouts
    workouts = load_json("workouts", [])
    upsert(
        supabase_url, headers, "workouts",
        [{"user_id": uid, "date": w["date"], "program_id": w.get("program_id"), "day": w} for w in workouts if w.get("date")],
        on_conflict="user_id,date", dry_run=args.dry_run, user_id=uid,
    )

    # exercise_logs (append-only in Supabase, but upsert() resyncs it fully each run — see
    # the delete-then-insert logic there — so re-running this script is safe)
    exercise_log = load_json("exercise_log", [])
    upsert(
        supabase_url, headers, "exercise_logs",
        [
            {"user_id": uid, "date": e["date"], "exercise": e["exercise"], "source": e.get("source", "manual"), "entry": e}
            for e in exercise_log if e.get("date") and e.get("exercise")
        ],
        on_conflict=None, dry_run=args.dry_run, user_id=uid,
    )

    # goals
    goals = load_json("goals", [])
    upsert(
        supabase_url, headers, "goals",
        [{"user_id": uid, "goal": g} for g in goals],
        on_conflict=None, dry_run=args.dry_run, user_id=uid,
    )

    # weekly_reviews
    reviews = load_json("weekly_reviews", [])
    upsert(
        supabase_url, headers, "weekly_reviews",
        [{"user_id": uid, "week": r["week"], "review": r} for r in reviews if r.get("week")],
        on_conflict="user_id,week", dry_run=args.dry_run, user_id=uid,
    )

    # coach_chats
    chats = load_json("coach_chats", [])
    upsert(
        supabase_url, headers, "coach_chats",
        [{"user_id": uid, "role": m["role"], "content": m["content"], "at": m.get("at")} for m in chats if m.get("role") and m.get("content")],
        on_conflict=None, dry_run=args.dry_run, user_id=uid,
    )

    # body_metrics
    body = load_json("body_metrics", [])
    upsert(
        supabase_url, headers, "body_metrics",
        [{"user_id": uid, "date": b["date"], "weight": b.get("weight"), "weight_unit": b.get("weight_unit")} for b in body if b.get("date")],
        on_conflict="user_id,date", dry_run=args.dry_run, user_id=uid,
    )

    # Garmin mirrors (optional — only if you plan to use the BYO-sync path)
    activities = load_json("garmin_activities", [])
    upsert(
        supabase_url, headers, "garmin_activities",
        [{"user_id": uid, "activity_id": a["id"], "date": a.get("date"), "data": a} for a in activities if a.get("id")],
        on_conflict="user_id,activity_id", dry_run=args.dry_run, user_id=uid,
    )
    wellness = load_json("garmin_wellness", [])
    upsert(
        supabase_url, headers, "garmin_wellness",
        [{"user_id": uid, "date": w["date"], "data": w} for w in wellness if w.get("date")],
        on_conflict="user_id,date", dry_run=args.dry_run, user_id=uid,
    )
    health = load_json("garmin_health", [])
    upsert(
        supabase_url, headers, "garmin_health",
        [{"user_id": uid, "date": h["date"], "data": h} for h in health if h.get("date")],
        on_conflict="user_id,date", dry_run=args.dry_run, user_id=uid,
    )

    log("Done. Your data/*.json files were not modified.")


if __name__ == "__main__":
    main()
