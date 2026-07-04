"""
Data-freshness contract for BackNine.

Fable IMPROVE #2, applied ruthlessly:

    "AI surfaces and UI widgets compute their own versions of the truth.
     Every surface reads the same numbers with the same data-age stamp,
     and every AI generation receives that stamp with a hard rule: if
     data is older than ~48 hours, say so and adapt."

Concretely — this module gives every metric an as_of date and an age in
hours. It's the piece the briefing was missing when it said "should show
up in an hour or two" 9 days after the last Oura sync. AI surfaces now
receive an explicit staleness advisory in their system prompt; if data
is > STALE_THRESHOLD_HOURS old, they MUST acknowledge and adapt rather
than invent recency.

Two entry points:

  1. stamp(value, as_of_iso)
        Wrap any single value in a MetricFreshness record.

  2. oura_data_age_hours(user_id)  /  apple_health_data_age_hours(user_id)
        Return the age in hours since the most recent row from that
        source. Callers use this to decide whether to trust the value
        they're about to render, and to inject an explicit staleness
        line into any AI prompt.

  3. build_freshness_advisory(user_id) → str | None
        Preformatted human-readable line for AI system prompts. Empty
        when nothing is stale.
"""

from __future__ import annotations

import os
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional

from supabase import create_client, Client


# ── tunables ────────────────────────────────────────────────────────────

# Above this age, an AI surface MUST acknowledge staleness. 48h buys us
# through a normal 2-day travel weekend without the coach getting weird
# while still catching the "hasn't synced in a week" case that inspired
# the whole fix.
STALE_THRESHOLD_HOURS = 48

# Below this age, treat the data as "fresh" — no acknowledgment needed.
# Between fresh and stale is a "yellow zone" where the AI can hedge.
FRESH_THRESHOLD_HOURS = 12


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


# ── core stamp helper ───────────────────────────────────────────────────

def _iso_to_utc_dt(iso: str) -> Optional[datetime]:
    """Parse an ISO date or ISO datetime into a UTC datetime. Returns
    None for empty / unparseable input."""
    if not iso:
        return None
    try:
        s = iso.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        # Bare date (YYYY-MM-DD) — anchor to noon UTC of that day so we
        # don't get 24h of jitter around midnight boundaries.
        try:
            d = datetime.strptime(iso[:10], "%Y-%m-%d")
            dt = d.replace(hour=12, tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _age_hours(as_of_iso: Optional[str]) -> Optional[float]:
    """Hours between as_of_iso and now (UTC). None if input is unparseable."""
    dt = _iso_to_utc_dt(as_of_iso or "")
    if not dt:
        return None
    delta = datetime.now(timezone.utc) - dt
    return round(delta.total_seconds() / 3600, 1)


def stamp(value, as_of_iso: Optional[str], source: str = "unknown") -> dict:
    """Wrap a single value in a MetricFreshness record.

    The shape is intentionally flat + JSON-safe so it can be shipped
    over the API and read from any frontend without a client library.
    """
    age = _age_hours(as_of_iso)
    if age is None:
        return {
            "value":       value,
            "as_of":       as_of_iso,
            "age_hours":   None,
            "source":      source,
            "freshness":   "unknown",
            "is_stale":    False,
        }
    if age <= FRESH_THRESHOLD_HOURS:
        label = "fresh"
    elif age <= STALE_THRESHOLD_HOURS:
        label = "yellow"
    else:
        label = "stale"
    return {
        "value":       value,
        "as_of":       as_of_iso,
        "age_hours":   age,
        "source":      source,
        "freshness":   label,
        "is_stale":    age > STALE_THRESHOLD_HOURS,
    }


# ── source-age lookups ──────────────────────────────────────────────────

# A source counts as "active" only if it has 3+ rows in the last N days.
# Below that we treat it as "inactive/not in use" — no stale banner. This
# is the whole point of the July-3 false-positive fix: David had a lone
# Apple Health row from May 5 (~9 weeks earlier). Under the old rule the
# banner screamed "9 weeks ago" every time he loaded the dashboard even
# though he never uses AH and the Oura data he does use was fresh.
_ACTIVITY_WINDOW_DAYS = 30
_MIN_ACTIVE_ROWS      = 3


def _source_is_active(sb: Client, table: str, user_id: str,
                      extra_where: Optional[dict] = None) -> bool:
    """Does this user have ≥ _MIN_ACTIVE_ROWS rows for this source in the
    last _ACTIVITY_WINDOW_DAYS days? If not, the source is 'inactive' —
    stale banners for it are user-hostile."""
    try:
        cutoff = (_date.today() - timedelta(days=_ACTIVITY_WINDOW_DAYS)).isoformat()
        q = (sb.table(table)
               .select("date", count="exact")
               .eq("user_id", user_id)
               .gte("date", cutoff)
               .limit(_MIN_ACTIVE_ROWS))
        for k, v in (extra_where or {}).items():
            q = q.eq(k, v)
        res = q.execute()
        return len(res.data or []) >= _MIN_ACTIVE_ROWS
    except Exception:
        return False


def oura_data_age_hours(user_id: str) -> Optional[float]:
    """Hours since the most recent Oura data row cached for this user.
    Returns None when:
      • nothing is cached (user never connected the ring), OR
      • the source is 'inactive' (no recent activity → no meaningful
        recency to report, don't fire a stale banner).
    """
    sb = _sb()
    if not sb or not user_id:
        return None
    if not _source_is_active(sb, "oura_daily_cache", user_id):
        return None
    try:
        res = (
            sb.table("oura_daily_cache")
              .select("date")
              .eq("user_id", user_id)
              .order("date", desc=True)
              .limit(1)
              .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return _age_hours(str(rows[0].get("date")))
    except Exception:
        return None


def oura_last_sync_iso(user_id: str) -> Optional[str]:
    """When did we last WRITE to the Oura cache for this user? Different
    from data_age — the cache may be recent even when the *data* it
    holds is old (e.g. we hit Oura's API but it returned nothing new)."""
    sb = _sb()
    if not sb or not user_id:
        return None
    try:
        res = (
            sb.table("oura_daily_cache")
              .select("fetched_at")
              .eq("user_id", user_id)
              .order("fetched_at", desc=True)
              .limit(1)
              .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return rows[0].get("fetched_at")
    except Exception:
        return None


def apple_health_data_age_hours(user_id: str) -> Optional[float]:
    """Hours since the most recent Apple Health row for this user.

    Returns None when the source is inactive (< 3 rows in the last 30 days).
    A single stray row from months ago should not fire a "9 weeks ago"
    banner — the user has clearly moved on to another source."""
    sb = _sb()
    if not sb or not user_id:
        return None
    if not _source_is_active(sb, "apple_health_daily", user_id):
        return None
    try:
        res = (
            sb.table("apple_health_daily")
              .select("date")
              .eq("user_id", user_id)
              .order("date", desc=True)
              .limit(1)
              .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return _age_hours(str(rows[0].get("date")))
    except Exception:
        return None


# ── AI advisory ─────────────────────────────────────────────────────────

def build_freshness_advisory(user_id: str) -> Optional[str]:
    """Return a preformatted human-readable staleness advisory for use
    in an AI system prompt, or None when everything is fresh.

    The advisory is written in the imperative because it goes to the
    model, not the user. The user-facing rendering happens on the
    frontend using the raw age numbers.
    """
    oura_age = oura_data_age_hours(user_id)
    ah_age   = apple_health_data_age_hours(user_id)

    lines: list[str] = []
    stale = False
    if oura_age is not None:
        if oura_age > STALE_THRESHOLD_HOURS:
            lines.append(f"  • Oura data is {round(oura_age)}h old (STALE). Last synced ~{round(oura_age/24, 1)} days ago.")
            stale = True
        elif oura_age > FRESH_THRESHOLD_HOURS:
            lines.append(f"  • Oura data is {round(oura_age)}h old (yellow — older than 12h but under 48h).")
        else:
            lines.append(f"  • Oura data is {round(oura_age)}h old (fresh).")
    else:
        lines.append("  • Oura: inactive or not connected — do NOT reference Oura numbers unless the payload explicitly contains them.")

    if ah_age is not None:
        if ah_age > STALE_THRESHOLD_HOURS:
            lines.append(f"  • Apple Health data is {round(ah_age)}h old (STALE).")
            stale = True
        elif ah_age > FRESH_THRESHOLD_HOURS:
            lines.append(f"  • Apple Health data is {round(ah_age)}h old (yellow).")
        else:
            lines.append(f"  • Apple Health data is {round(ah_age)}h old (fresh).")
    else:
        lines.append("  • Apple Health: inactive or not connected — do NOT invoke it.")

    header = (
        "\n=== DATA FRESHNESS — READ AND RESPECT ===\n"
        "The user's data may be stale. Follow these rules WITHOUT exception:\n"
        "  1. If ANY source is marked STALE (> 48h old), you MUST acknowledge\n"
        "     the staleness explicitly at the start of your response.\n"
        "  2. NEVER invent a recency the data does not support. Do NOT say\n"
        "     'your latest sync' or 'this morning' or 'today' unless the\n"
        "     underlying source is fresh (< 12h old).\n"
        "  3. If data is stale, offer to help the user reconnect their\n"
        "     device or manually log in the meantime — do not proceed as\n"
        "     if the numbers on screen are today's numbers.\n"
        "  4. Yellow-zone data (12-48h old) is OK to use, but hedge:\n"
        "     'as of yesterday morning' rather than 'right now'.\n"
    )
    body = "Current freshness state:\n" + "\n".join(lines)
    # Always return the advisory so the model sees the freshness state,
    # even if everything is fresh — that way the model can proactively
    # confirm freshness in its answer if the user asks.
    return header + body if lines else None


__all__ = [
    "STALE_THRESHOLD_HOURS",
    "FRESH_THRESHOLD_HOURS",
    "stamp",
    "oura_data_age_hours",
    "oura_last_sync_iso",
    "apple_health_data_age_hours",
    "build_freshness_advisory",
]
