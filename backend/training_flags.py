"""
Daily injury/discomfort flags — one-off "I'm dealing with something
today" signal that overrides today_workout's normal prescription and
flows into Coach Al context.

Chronic injuries live on the profile (`user_profiles.chronic_injuries`);
those are always-on rules ("this user has a bad shoulder, don't
prescribe overhead press ever"). Daily flags are episodic ("I tweaked
my back yesterday, do a recovery day today").

Public API:
    log_flag(user_id, ...)           — create a flag row
    today_flag(user_id, today_iso)   — the most recent flag for today, if any
    recent_flags(user_id, days)      — flags in the last N days
    dismiss_flag(user_id, flag_id)   — soft delete via row removal
"""

from __future__ import annotations

import logging
import os
from datetime import date as _date, timedelta
from typing import Optional


log = logging.getLogger(__name__)


_VALID_TYPES = {"injury", "discomfort", "illness", "fatigue"}


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def log_flag(
    user_id:    str,
    flag_type:  str,
    date_str:   str,
    body_area:  Optional[str] = None,
    severity:   Optional[int] = None,
    notes:      Optional[str] = None,
) -> dict:
    if not user_id:
        raise ValueError("user_id required")
    if flag_type not in _VALID_TYPES:
        raise ValueError(f"flag_type must be one of {sorted(_VALID_TYPES)}")
    if severity is not None:
        try:
            severity = max(1, min(3, int(severity)))
        except (TypeError, ValueError):
            severity = None
    sb = _sb()
    if not sb:
        raise RuntimeError("Supabase unavailable")
    row = {
        "user_id":   user_id,
        "date":      date_str,
        "flag_type": flag_type,
        "body_area": (body_area or "").strip() or None,
        "severity":  severity,
        "notes":     (notes or "").strip() or None,
    }
    res = sb.table("training_flags").insert(row).execute()
    return (res.data or [row])[0]


def today_flag(user_id: str, today_iso: str) -> Optional[dict]:
    if not (user_id and today_iso):
        return None
    sb = _sb()
    if not sb:
        return None
    try:
        res = (sb.table("training_flags")
                 .select("*")
                 .eq("user_id", user_id)
                 .eq("date", today_iso)
                 .order("created_at", desc=True)
                 .limit(1).execute())
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def recent_flags(user_id: str, days: int = 14) -> list[dict]:
    if not user_id:
        return []
    sb = _sb()
    if not sb:
        return []
    try:
        cutoff = (_date.today() - timedelta(days=days)).isoformat()
        res = (sb.table("training_flags")
                 .select("*")
                 .eq("user_id", user_id)
                 .gte("date", cutoff)
                 .order("date", desc=True)
                 .limit(50).execute())
        return res.data or []
    except Exception:
        return []


def dismiss_flag(user_id: str, flag_id: str) -> bool:
    if not (user_id and flag_id):
        return False
    sb = _sb()
    if not sb:
        return False
    try:
        res = (sb.table("training_flags")
                 .delete()
                 .eq("user_id", user_id)
                 .eq("id", flag_id)
                 .execute())
        return bool(res.data)
    except Exception:
        return False


def context_block_for_coach(flag: Optional[dict]) -> str:
    """Preformatted context block for the shared AI context. Empty
    when no flag. Coach Al must acknowledge the flag by name and pivot
    the day's prescription accordingly — the today_workout prompt
    already has the injury directive."""
    if not flag:
        return ""
    ftype = (flag.get("flag_type") or "").upper()
    area  = flag.get("body_area") or ""
    sev   = flag.get("severity")
    notes = flag.get("notes") or ""
    lines = ["\n=== TRAINING FLAG FOR TODAY ==="]
    line  = f"User flagged: {ftype}"
    if area:  line += f" ({area})"
    if sev:   line += f", severity {sev}/3"
    lines.append(line)
    if notes:
        lines.append(f"Note: {notes}")
    lines.append(
        "Coach responses today MUST acknowledge this flag and avoid "
        "movements that load the affected area. If severity ≥ 2 or the "
        "flag type is injury/illness, override any workout suggestion "
        "with a recovery/mobility session and say so plainly."
    )
    return "\n".join(lines) + "\n"


__all__ = [
    "log_flag", "today_flag", "recent_flags", "dismiss_flag",
    "context_block_for_coach",
]
