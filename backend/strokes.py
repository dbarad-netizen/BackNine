"""
strokes.py — the League, scored as strokes gained against your own usual.

David 2026-11-20: "It feels like the competition just comes down to sleep
timing." It did. The Health Span score has ceilings (7–9 h, 7,500 steps,
5 active days) because more is not healthier — and over four weeks David
sat at the ceiling on three of four bands 29 days out of 29, so his whole
net was bedtime. A health score should saturate; a game score must not.

So the League no longer nets the Health Span total against a par. It
scores four things, each against the player's OWN usual, with no ceiling
on movement:

  steps      daily steps vs your usual day            1 stroke per  5 %
  activity   daily active calories vs your usual      1 stroke per  5 %
  sleep      how far each night sits outside 7–9 h    1 stroke per 15 min closer
  bedtime    how much bedtime wanders (std dev)       1 stroke per 10 min tighter

"Usual" = the 56 days (eight weeks) before the week's Monday: the median
day for steps and activity; mean distance-from-range for sleep; the mean
of the prior weeks' own wander for bedtime, so a 7-night spread is
compared with 7-night spreads. Eight weeks, not four: backtested on
Oct–Nov 2026, a four-week usual let one bad month (Josh, mid-October)
pay out +13, +16, +13 in the weeks after it — the same regression the
old par rule guarded against. Each band is capped at ±6 for a full week and scaled
by days played ÷ 7, so strokes accumulate through the week like holes —
Tuesday's card is small, Sunday's is the whole round. A band with no
data, or no usual yet, plays even. Net = the sum, rounded.

Positive is good (strokes gained), matching the app's existing "+4".

The core (`score_week`) is pure — dicts in, dict out — so it can be
backtested and unit-checked without a database.
"""

from __future__ import annotations

import logging
import statistics
from datetime import date, timedelta
from typing import Optional

log = logging.getLogger(__name__)

USUAL_DAYS = 56                # eight weeks: one bad month must not hand out strokes the next
BAND_CAP = 6.0                 # max strokes per band over a full week
STEPS_PCT_PER_STROKE = 5.0
ACTIVITY_PCT_PER_STROKE = 5.0
SLEEP_MIN_PER_STROKE = 15.0
BEDTIME_MIN_PER_STROKE = 10.0
SLEEP_LO, SLEEP_HI = 7.0, 9.0
MIN_USUAL_DAYS = 7             # below this a band plays even (provisional)
MIN_BEDTIME_NIGHTS = 3

BAND_ORDER = ("steps", "activity", "sleep", "bedtime")
BAND_LABELS = {"steps": "Steps", "activity": "Activity", "sleep": "Sleep hours", "bedtime": "Bedtime"}


def _clamp(v: float, cap: float) -> float:
    return max(-cap, min(cap, v))


def _sleep_miss_min(hours: float) -> float:
    """Minutes a night sits outside the 7–9 h range (0 inside it)."""
    if hours < SLEEP_LO:
        return (SLEEP_LO - hours) * 60
    if hours > SLEEP_HI:
        return (hours - SLEEP_HI) * 60
    return 0.0


def _std(vals: list[float]) -> Optional[float]:
    return statistics.pstdev(vals) if len(vals) >= MIN_BEDTIME_NIGHTS else None


def score_week(daily: dict, monday: date, as_of: date, live: bool = True) -> dict:
    """Score one player's week.

    daily: {"YYYY-MM-DD": {"steps", "active_cal", "sleep_h", "bed_min"}} —
           any key may be missing/None. `bed_min` is minutes after noon of
           the evening the night began (22:30 → 630, 00:15 → 735), keyed
           like sleep on the WAKE date.
    monday: the week's Monday. as_of: the day being scored (≤ Sunday).
    live:   True when as_of is still being played — its steps/activity
            are partial and are left out. Sleep keeps as_of (last night
            is finished once scored).
    """
    sunday = monday + timedelta(days=6)
    as_of = min(as_of, sunday)
    week = [(monday + timedelta(days=i)) for i in range(7)]
    move_days = [d for d in week if (d < as_of if live else d <= as_of)]
    night_days = [d for d in week if d <= as_of]
    prior = [(monday - timedelta(days=i)) for i in range(1, USUAL_DAYS + 1)]

    def g(d: date, k: str):
        v = (daily.get(d.isoformat()) or {}).get(k)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    bands: dict = {}

    # ── steps / activity: relative to the usual day ─────────────────────
    for key, field, pct_per in (("steps", "steps", STEPS_PCT_PER_STROKE),
                                ("activity", "active_cal", ACTIVITY_PCT_PER_STROKE)):
        usual_vals = [v for v in (g(d, field) for d in prior) if v is not None and v > 0]
        wk_vals = [v for v in (g(d, field) for d in move_days) if v is not None]
        b = {"label": BAND_LABELS[key], "days": len(wk_vals), "strokes": 0.0,
             "week": None, "usual": None, "status": "even"}
        if len(usual_vals) >= MIN_USUAL_DAYS:
            usual = statistics.median(usual_vals)
            b["usual"] = round(usual)
            if wk_vals and usual > 0:
                avg = sum(wk_vals) / len(wk_vals)
                b["week"] = round(avg)
                raw = _clamp(((avg - usual) / usual * 100) / pct_per, BAND_CAP)
                b["strokes"] = round(raw * len(wk_vals) / 7, 1)
                b["status"] = "scored"
            else:
                b["status"] = "no days yet"
        else:
            b["status"] = "no usual yet"
            if wk_vals:
                b["week"] = round(sum(wk_vals) / len(wk_vals))
        bands[key] = b

    # ── sleep hours: minutes outside 7–9 h, lower is better ─────────────
    usual_miss = [_sleep_miss_min(v) for v in (g(d, "sleep_h") for d in prior) if v is not None and v > 0]
    wk_h = [v for v in (g(d, "sleep_h") for d in night_days) if v is not None and v > 0]
    b = {"label": BAND_LABELS["sleep"], "days": len(wk_h), "strokes": 0.0,
         "week": None, "usual": None, "status": "even"}
    if wk_h:
        b["week"] = round(sum(wk_h) / len(wk_h), 1)                       # avg hours, for display
        b["week_miss_min"] = round(sum(_sleep_miss_min(h) for h in wk_h) / len(wk_h))
    if len(usual_miss) >= MIN_USUAL_DAYS:
        u = sum(usual_miss) / len(usual_miss)
        b["usual_miss_min"] = round(u)
        uh = [v for v in (g(d, "sleep_h") for d in prior) if v is not None and v > 0]
        b["usual"] = round(sum(uh) / len(uh), 1)
        if wk_h:
            raw = _clamp((u - b["week_miss_min"]) / SLEEP_MIN_PER_STROKE, BAND_CAP)
            b["strokes"] = round(raw * len(wk_h) / 7, 1)
            b["status"] = "scored"
        else:
            b["status"] = "no nights yet"
    else:
        b["status"] = "no usual yet"
    bands["sleep"] = b

    # ── bedtime: how much it wanders; compare week-sized spreads ────────
    wk_bed = [v for v in (g(d, "bed_min") for d in night_days) if v is not None]
    prior_spreads = []
    for w in range(1, USUAL_DAYS // 7 + 1):
        wk_start = monday - timedelta(days=7 * w)
        vals = [v for v in (g(wk_start + timedelta(days=i), "bed_min") for i in range(7)) if v is not None]
        if len(vals) >= 4:
            prior_spreads.append(statistics.pstdev(vals))
    b = {"label": BAND_LABELS["bedtime"], "days": len(wk_bed), "strokes": 0.0,
         "week": None, "usual": None, "status": "even"}
    wk_spread = _std(wk_bed)
    if wk_spread is not None:
        b["week"] = round(wk_spread)
    if prior_spreads:
        usual = sum(prior_spreads) / len(prior_spreads)
        b["usual"] = round(usual)
        if wk_spread is not None:
            raw = _clamp((usual - wk_spread) / BEDTIME_MIN_PER_STROKE, BAND_CAP)
            b["strokes"] = round(raw * len(wk_bed) / 7, 1)
            b["status"] = "scored"
        else:
            b["status"] = f"needs {MIN_BEDTIME_NIGHTS} nights"
    else:
        b["status"] = "no usual yet"
    bands["bedtime"] = b

    scored = [k for k in BAND_ORDER if bands[k]["status"] == "scored"]
    total = sum(bands[k]["strokes"] for k in BAND_ORDER)
    return {
        "net": int(round(total)) if scored else None,
        "net_exact": round(total, 1) if scored else None,
        "bands": bands,
        "scored_bands": scored,
        "provisional": len(scored) < 3,
        "days_played": len(move_days),
        "nights_played": len(night_days),
    }


def series(daily: dict, monday: date, as_of: date, live: bool = True) -> list[dict]:
    """Cumulative net for each day of the week so far — the pace line."""
    out = []
    for i in range(7):
        d = monday + timedelta(days=i)
        if d > as_of:
            out.append({"date": d.isoformat(), "net": None})
            continue
        r = score_week(daily, monday, d, live=(live and d == as_of))
        out.append({"date": d.isoformat(), "net": r["net_exact"]})
    return out


# ── Loaders ─────────────────────────────────────────────────────────────

def _bed_min(ts) -> Optional[float]:
    """ISO local timestamp → minutes after noon (so 22:30 = 630, 00:15 = 735)."""
    try:
        s = str(ts)
        hh, mm = int(s[11:13]), int(s[14:16])
        m = hh * 60 + mm
        return float(m - 720 if m >= 720 else m + 720)
    except Exception:
        return None


def load_daily(user_id: str, monday: date, as_of: date) -> dict:
    """Daily facts for the 28 days before `monday` through `as_of`.
    Oura wins for Oura users (doctrine); Apple Health otherwise."""
    start = monday - timedelta(days=USUAL_DAYS)
    out: dict = {}
    am, smm = {}, {}
    try:
        import oura_cache as oc
        span = (date.today() - start).days + 2
        _rm, _slm, am, smm = oc.get_days(user_id, days=max(span, 30))
    except Exception as exc:
        log.warning("strokes: oura load failed for %s: %r", user_id[:8], exc)
    if am or smm:
        for d, a in (am or {}).items():
            out.setdefault(d, {}).update({"steps": (a or {}).get("steps"), "active_cal": (a or {}).get("active_cal")})
        for d, sm in (smm or {}).items():
            tot = (sm or {}).get("total")
            out.setdefault(d, {}).update({
                "sleep_h": (tot / 3600) if tot else None,
                "bed_min": _bed_min((sm or {}).get("bedtime_start")) if (sm or {}).get("bedtime_start") else None,
            })
    else:
        try:
            import apple_health as ah
            rows = ah.get_data(user_id, days=(as_of - start).days + 1, end_date=as_of.isoformat()) or []
            for r in rows:
                d = str(r.get("date"))[:10]
                out[d] = {
                    "steps": r.get("steps"), "active_cal": r.get("active_calories"),
                    "sleep_h": float(r["sleep_hours"]) if r.get("sleep_hours") else None,
                    "bed_min": _bed_min(r.get("sleep_start")) if r.get("sleep_start") else None,
                }
        except Exception as exc:
            log.warning("strokes: apple health load failed for %s: %r", user_id[:8], exc)
    lo, hi = start.isoformat(), as_of.isoformat()
    return {d: v for d, v in out.items() if lo <= d <= hi}


def for_users(user_ids: list[str], monday: date, as_of: date, live: bool = True) -> dict[str, dict]:
    """{uid: score_week(...)} — members scored in parallel (each is a couple
    of memoised reads)."""
    from concurrent.futures import ThreadPoolExecutor

    def _one(uid: str):
        try:
            return uid, score_week(load_daily(uid, monday, as_of), monday, as_of, live=live)
        except Exception as exc:
            log.warning("strokes: scoring failed for %s: %r", uid[:8], exc)
            return uid, {"net": None, "net_exact": None, "bands": {}, "scored_bands": [], "provisional": True}

    if not user_ids:
        return {}
    with ThreadPoolExecutor(max_workers=min(8, len(user_ids))) as ex:
        return dict(ex.map(_one, user_ids))


RULE_TEXT = (
    "Strokes gained against your own usual (the eight weeks before Monday): steps and activity earn a stroke "
    "for every 5% above your usual day, sleep a stroke for every 15 minutes closer to the 7–9 hour range, "
    "bedtime a stroke for every 10 minutes steadier. Each is capped at ±6 for a full week and builds up "
    "day by day. Net is the sum."
)
