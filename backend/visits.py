"""
Doctor Visit Prep Mode — Phase 1 CRUD + timeline helpers.

Fable's v2 evaluation calls this the launch-story feature. Everything
the PRD needs already exists (Handoff, labs, meds, BP log, escalation
flags, shared context). This module is the connective tissue: it lets
a user tell BackNine an appointment is coming, prepares everything for
them, and captures what came out of it after.

Shape of the story (Phase 1):
    T-14  → Card appears on Scorecard. If BP-cuff user, gentle prompt
            to take readings on ≥5 of the next 14 days (sparse BP is
            the #1 gap a doctor cares about).
    T-3   → Question drafts generated from the user's data (see
            visit_questions.py) for user review + edit.
    T-1   → Handoff finalized; print + share-link CTA; what-to-bring
            checklist.
    T+1   → "How did it go?" post-visit capture: upload new labs,
            update med changes, add "doctor's notes to self."
    T+21  → Visit closed; next physical seeded at +11 months.

We do NOT: book appointments, integrate with EHR, or give medical
advice. Explicitly out of scope in the PRD.

Public API:
    create_visit(user_id, ...)
    list_visits(user_id, status)
    get_visit(user_id, visit_id)
    update_visit(user_id, visit_id, **fields)
    complete_visit(user_id, visit_id, notes)
    cancel_visit(user_id, visit_id)
    delete_visit(user_id, visit_id)
    get_active_visit(user_id, today_iso) → visit or None
    prep_phase(visit_row, today_iso) → 'prep_open' | 't_minus_14' |
                                       't_minus_3' | 't_minus_1' |
                                       'visit_day' | 'post_visit' |
                                       'closed' | 'future'
"""

from __future__ import annotations

import logging
import os
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional


log = logging.getLogger(__name__)


_VALID_PROVIDERS = {
    "primary_care", "cardiology", "urology", "endocrinology",
    "dermatology", "orthopedics", "other",
}
_VALID_STATUSES = {"upcoming", "completed", "canceled"}


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── CRUD ────────────────────────────────────────────────────────────────

def create_visit(
    user_id:       str,
    visit_date:    str,      # YYYY-MM-DD
    provider_type: str = "primary_care",
    reason:        Optional[str] = None,
) -> dict:
    """Create a new upcoming visit. Returns the persisted row."""
    if not user_id:
        raise ValueError("user_id required")
    if not visit_date:
        raise ValueError("visit_date required")
    if provider_type not in _VALID_PROVIDERS:
        raise ValueError(f"provider_type must be one of {sorted(_VALID_PROVIDERS)}")
    sb = _sb()
    if not sb:
        raise RuntimeError("Supabase unavailable")
    row = {
        "user_id":       user_id,
        "visit_date":    visit_date,
        "provider_type": provider_type,
        "reason":        (reason or "").strip() or None,
        "status":        "upcoming",
    }
    res = sb.table("doctor_visits").insert(row).execute()
    return (res.data or [row])[0]


def list_visits(user_id: str, status: Optional[str] = None) -> list[dict]:
    """List visits for a user, newest first."""
    if not user_id:
        return []
    sb = _sb()
    if not sb:
        return []
    try:
        q = (sb.table("doctor_visits")
               .select("*")
               .eq("user_id", user_id)
               .order("visit_date", desc=True)
               .limit(200))
        if status:
            if status not in _VALID_STATUSES:
                raise ValueError(f"status must be one of {sorted(_VALID_STATUSES)}")
            q = q.eq("status", status)
        res = q.execute()
        return res.data or []
    except Exception as exc:
        log.warning("list_visits failed: %s", exc)
        return []


def get_visit(user_id: str, visit_id: str) -> Optional[dict]:
    """Fetch a single visit — enforces ownership at the query level."""
    if not (user_id and visit_id):
        return None
    sb = _sb()
    if not sb:
        return None
    try:
        res = (sb.table("doctor_visits")
                 .select("*")
                 .eq("user_id", user_id)
                 .eq("id", visit_id)
                 .limit(1).execute())
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def update_visit(user_id: str, visit_id: str, **fields) -> Optional[dict]:
    """Patch an existing visit. Only safe keys are allowed through — no
    passing user_id/id/created_at. Returns the updated row or None."""
    if not (user_id and visit_id):
        return None
    ALLOWED = {
        "visit_date", "provider_type", "reason",
        "question_drafts", "post_visit_notes", "outcome_summary",
    }
    payload = {k: v for k, v in fields.items() if k in ALLOWED}
    if not payload:
        return get_visit(user_id, visit_id)
    if "provider_type" in payload and payload["provider_type"] not in _VALID_PROVIDERS:
        raise ValueError(f"provider_type must be one of {sorted(_VALID_PROVIDERS)}")
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    sb = _sb()
    if not sb:
        return None
    try:
        res = (sb.table("doctor_visits")
                 .update(payload)
                 .eq("user_id", user_id)
                 .eq("id", visit_id)
                 .execute())
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as exc:
        log.warning("update_visit failed: %s", exc)
        return None


def complete_visit(user_id: str, visit_id: str, notes: Optional[str] = None,
                   outcome: Optional[str] = None) -> Optional[dict]:
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "status":       "completed",
        "completed_at": now,
        "updated_at":   now,
    }
    if notes is not None:
        payload["post_visit_notes"] = notes
    if outcome is not None:
        payload["outcome_summary"] = outcome
    sb = _sb()
    if not sb:
        return None
    try:
        res = (sb.table("doctor_visits")
                 .update(payload)
                 .eq("user_id", user_id)
                 .eq("id", visit_id)
                 .execute())
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as exc:
        log.warning("complete_visit failed: %s", exc)
        return None


def cancel_visit(user_id: str, visit_id: str) -> Optional[dict]:
    now = datetime.now(timezone.utc).isoformat()
    sb = _sb()
    if not sb:
        return None
    try:
        res = (sb.table("doctor_visits")
                 .update({
                     "status":      "canceled",
                     "canceled_at": now,
                     "updated_at":  now,
                 })
                 .eq("user_id", user_id)
                 .eq("id", visit_id)
                 .execute())
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as exc:
        log.warning("cancel_visit failed: %s", exc)
        return None


def delete_visit(user_id: str, visit_id: str) -> bool:
    sb = _sb()
    if not sb:
        return False
    try:
        res = (sb.table("doctor_visits")
                 .delete()
                 .eq("user_id", user_id)
                 .eq("id", visit_id)
                 .execute())
        return bool(res.data)
    except Exception:
        return False


# ── Timeline helpers ────────────────────────────────────────────────────

def _today(today_iso: Optional[str]) -> _date:
    if today_iso:
        try:
            return _date.fromisoformat(today_iso[:10])
        except Exception:
            pass
    return _date.today()


def prep_phase(visit_row: dict, today_iso: Optional[str] = None) -> str:
    """Where in the T-14 / T-3 / T-1 / visit / post timeline we are.
    Callers use this to switch card copy + which CTAs to show."""
    if not visit_row:
        return "closed"
    status = visit_row.get("status") or "upcoming"
    if status == "canceled":
        return "closed"
    if status == "completed":
        return "post_visit"
    try:
        vd = _date.fromisoformat(str(visit_row.get("visit_date"))[:10])
    except Exception:
        return "future"
    today = _today(today_iso)
    delta = (vd - today).days

    if delta > 14:                return "future"
    if delta > 3:                 return "t_minus_14"
    if delta > 1:                 return "t_minus_3"
    if delta == 1:                return "t_minus_1"
    if delta == 0:                return "visit_day"
    if delta >= -21:              return "post_visit"
    return "closed"


def get_active_visit(user_id: str, today_iso: Optional[str] = None) -> Optional[dict]:
    """Return the most relevant single visit for scorecard rendering:
    the upcoming one within 14 days, or the most-recent completed one
    within the 21-day post-visit window. Preference goes to upcoming.
    Returns None when there's nothing to surface."""
    if not user_id:
        return None
    today = _today(today_iso)
    horizon_future = (today + timedelta(days=14)).isoformat()
    horizon_past   = (today - timedelta(days=21)).isoformat()
    sb = _sb()
    if not sb:
        return None

    # Upcoming within 14 days wins.
    try:
        res = (sb.table("doctor_visits")
                 .select("*")
                 .eq("user_id", user_id)
                 .in_("status", ["upcoming"])
                 .gte("visit_date", today.isoformat())
                 .lte("visit_date", horizon_future)
                 .order("visit_date", desc=False)
                 .limit(1).execute())
        rows = res.data or []
        if rows:
            return rows[0]
    except Exception:
        pass

    # Otherwise a recently completed one worth prompting post-visit capture on.
    try:
        res = (sb.table("doctor_visits")
                 .select("*")
                 .eq("user_id", user_id)
                 .in_("status", ["upcoming", "completed"])
                 .gte("visit_date", horizon_past)
                 .lt("visit_date", today.isoformat())
                 .order("visit_date", desc=True)
                 .limit(1).execute())
        rows = res.data or []
        if rows:
            return rows[0]
    except Exception:
        pass
    return None


def context_block_for_coach(visit_row: Optional[dict], today_iso: Optional[str] = None) -> str:
    """Preformatted context block for the shared AI context service.
    Empty when there's nothing to surface. When there IS a visit,
    Coach Al must know: it's coming, when, provider type, and the
    question drafts the app has already shown the user."""
    if not visit_row:
        return ""
    phase = prep_phase(visit_row, today_iso)
    if phase in ("closed",):
        return ""

    vd    = str(visit_row.get("visit_date") or "")[:10]
    ptype = (visit_row.get("provider_type") or "primary_care").replace("_", " ")
    reason = (visit_row.get("reason") or "").strip()
    drafts = visit_row.get("question_drafts") or []

    lines = ["\n=== UPCOMING DOCTOR VISIT ==="]
    if phase == "post_visit":
        lines[0] = "\n=== RECENT DOCTOR VISIT ==="
    lines.append(
        f"Visit date: {vd} · provider: {ptype}"
        + (f" · reason: {reason}" if reason else "")
    )
    if drafts:
        lines.append("Questions the app has drafted for the user:")
        for q in drafts[:7]:
            text = ""
            if isinstance(q, dict):
                text = str(q.get("text") or "").strip()
            elif isinstance(q, str):
                text = q.strip()
            if text:
                lines.append(f"  • {text}")
    if phase in ("t_minus_1", "visit_day"):
        lines.append(
            "The visit is imminent. Avoid new training experiments; if the "
            "user asks 'what should I do today,' bias toward rest/recovery "
            "unless the visit type is unrelated to activity."
        )
    if phase == "post_visit":
        lines.append(
            "The user just had this visit. If they mention outcomes, offer "
            "to help capture: new lab PDF (already supported), medication "
            "changes, and a note about what the doctor said. Never advise "
            "on medication changes yourself — record what the doctor said."
        )
    return "\n".join(lines) + "\n"


__all__ = [
    "create_visit", "list_visits", "get_visit", "update_visit",
    "complete_visit", "cancel_visit", "delete_visit",
    "get_active_visit", "prep_phase", "context_block_for_coach",
]
