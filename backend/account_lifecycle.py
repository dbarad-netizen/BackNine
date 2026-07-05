"""
Account lifecycle — user-initiated data export + account deletion.

Fable Round 2 flagged both as App Store review blockers, which matches
Apple's guideline 5.1.1(v) (developers must offer in-app account
deletion) and typical GDPR/CCPA "right to portability + right to
erasure" requirements. This module is the pair of primitives the
Profile UI + `/api/account/*` endpoints call.

Design:
  • Export runs SYNCHRONOUSLY and streams a single JSON blob back to
    the caller. That's fine for the current user base sizes; if a
    user has years of data we can move it to an S3 upload with an
    email later.
  • Deletion is a TWO-STEP with a 7-day grace period:
      1. `request_delete(user_id)` stamps profiles.deleted_at with a
         future timestamp (now + 7 days) and revokes any live device
         tokens. Until deleted_at passes, the user can log in and cancel.
      2. A separate background job (not in this module) reads
         `profiles.deleted_at < now()` and does the actual cascade
         delete. Until we set that job up, admin manually purges.
  • `cancel_delete(user_id)` clears the stamp — an escape hatch during
    the grace window.

Public API:
  export(user_id) → dict
  request_delete(user_id) → { deletion_scheduled_at, grace_days }
  cancel_delete(user_id) → { canceled_at }
  pending_deletion(user_id) → { scheduled_at, grace_days_remaining } | None
"""

from __future__ import annotations

import logging
import os
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional


log = logging.getLogger(__name__)


GRACE_DAYS = 7


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── Table set to export / delete ────────────────────────────────────────
# Every table where this user could have rows keyed by user_id. Add new
# tables here as they land. Ordered roughly by "core identity" first so
# an interrupted export still gives the user the most valuable rows.
_USER_TABLES: list[str] = [
    "profiles",
    "user_goals",
    "goals",
    "daily_insights",
    "insights_feed",
    "symptom_logs",
    "mood_logs",
    "daily_checkins",
    "journal_entries",
    "user_memory",
    "coach_memory",
    "chat_history",
    "chat_messages",
    "nutrition_meals",
    "nutrition_weight",
    "nutrition_settings",
    "workouts",
    "workout_sessions",
    "exercise_history",
    "blood_pressure_log",
    "apple_health_daily",
    "oura_daily_cache",
    "oura_connections",
    "wearable_connections",
    "device_readings",
    "lab_entries",
    "user_stack",             # meds / supps / peptides if separately stored
    "referral_codes",
    "referral_credits",
    "friends",
    "friend_events",
    "onboarding_dismissed",
    "data_quality_flags",
]


# ── EXPORT ──────────────────────────────────────────────────────────────

def export(user_id: str) -> dict:
    """Return a dict of {table_name: [rows...]} across every table
    where this user has data. Best-effort — a table that doesn't exist
    or that errors comes back as an empty list, never breaks the
    export."""
    sb = _sb()
    out: dict = {
        "user_id":     user_id,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "grace_days":  GRACE_DAYS,
        "tables":      {},
    }
    if not sb or not user_id:
        return out
    for table in _USER_TABLES:
        try:
            # profiles is keyed by `id`, not `user_id`. Everything else
            # is `user_id` in this codebase.
            key = "id" if table == "profiles" else "user_id"
            res = (sb.table(table)
                     .select("*")
                     .eq(key, user_id)
                     .limit(50000).execute())
            out["tables"][table] = res.data or []
        except Exception as exc:
            log.info("export: %s skipped (%s)", table, exc)
            out["tables"][table] = []
    return out


# ── DELETE ──────────────────────────────────────────────────────────────

def request_delete(user_id: str) -> dict:
    """Stamp profiles.deleted_at = now() + GRACE_DAYS. Also stamps
    profiles.deletion_requested_at for audit. Returns the schedule.

    We don't do the cascade delete here — a separate purge job (or
    manual admin action, until the job is set up) reads
    profiles.deleted_at < now() and removes rows. This gives the user
    a real "undo" window and keeps this endpoint idempotent."""
    if not user_id:
        raise ValueError("user_id required")
    sb = _sb()
    if not sb:
        raise RuntimeError("Supabase unavailable")

    now  = datetime.now(timezone.utc)
    when = now + timedelta(days=GRACE_DAYS)
    row = {
        "id":                       user_id,
        "deletion_requested_at":    now.isoformat(),
        "deleted_at":               when.isoformat(),
    }
    try:
        sb.table("profiles").upsert(row, on_conflict="id").execute()
    except Exception as exc:
        log.warning("request_delete upsert failed: %s", exc)
        raise

    # Revoke live wearable tokens so nothing keeps writing to the
    # account during the grace window. Best-effort.
    for table in ("oura_connections", "wearable_connections"):
        try:
            sb.table(table).update(
                {"access_token": None, "refresh_token": None}
            ).eq("user_id", user_id).execute()
        except Exception:
            pass

    return {
        "deletion_scheduled_at": when.isoformat(),
        "grace_days":            GRACE_DAYS,
        "requested_at":          now.isoformat(),
    }


def cancel_delete(user_id: str) -> dict:
    """Undo request_delete — clear the two timestamps. Returns the
    cancel timestamp. No-op-safe if there's no pending deletion."""
    if not user_id:
        raise ValueError("user_id required")
    sb = _sb()
    if not sb:
        raise RuntimeError("Supabase unavailable")
    now = datetime.now(timezone.utc).isoformat()
    try:
        sb.table("profiles").update({
            "deletion_requested_at": None,
            "deleted_at":            None,
        }).eq("id", user_id).execute()
    except Exception as exc:
        log.warning("cancel_delete update failed: %s", exc)
        raise
    return {"canceled_at": now}


def pending_deletion(user_id: str) -> Optional[dict]:
    """Return { scheduled_at, grace_days_remaining } if a deletion is
    pending, else None. Used by the frontend to render the "your
    account will be deleted in N days" banner + Cancel button."""
    if not user_id:
        return None
    sb = _sb()
    if not sb:
        return None
    try:
        res = (sb.table("profiles")
                 .select("deleted_at")
                 .eq("id", user_id)
                 .limit(1).execute())
        rows = res.data or []
        if not rows:
            return None
        d = rows[0].get("deleted_at")
        if not d:
            return None
        try:
            when = datetime.fromisoformat(str(d).replace("Z", "+00:00"))
        except Exception:
            return None
        now = datetime.now(timezone.utc)
        remaining = (when - now).total_seconds() / 86400
        return {
            "scheduled_at":          d,
            "grace_days_remaining":  round(max(0.0, remaining), 2),
        }
    except Exception:
        return None


__all__ = [
    "export",
    "request_delete",
    "cancel_delete",
    "pending_deletion",
    "GRACE_DAYS",
]
