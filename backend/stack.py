"""
Stack efficacy tracking — Phase 4 of the Insight pillar.

The longevity-experimenter persona constantly adds and removes
supplements, peptides, and medications. The question they actually want
answered: *did this thing do anything for me?*

We answer it by:
  1) Recording every add / remove / dose-change to the user's stack as a
     row in `stack_events` (auto-detected by diffing user_profiles on save).
  2) For each item with at least 14 days of post-start data, comparing
     before-vs-after averages across sleep / HRV / RHR / breath / BP /
     readiness. Surfaces the largest deltas in the Stack Efficacy card.

Correlation only — explicit "associated with, not caused by" framing in
the UI. The point isn't to make health claims, it's to give the user a
data-grounded read on whether their experiments are doing anything.
"""

from __future__ import annotations

import logging
import os
from datetime import date as _date, datetime, timedelta
from typing import Optional

import oura_cache as oc
import apple_health as ah

from supabase import create_client, Client


log = logging.getLogger(__name__)


CLASSES = ("supplement", "peptide", "medication")


def _sb() -> Optional[Client]:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    return create_client(url, key)


def _normalize_name(name: str) -> str:
    return (name or "").strip().lower()


def _index(items: list[dict]) -> dict[str, dict]:
    """Index a stack list by normalized name → {dose, timing, notes, display}."""
    out: dict[str, dict] = {}
    for it in items or []:
        if not isinstance(it, dict):
            continue
        nm = _normalize_name(it.get("name") or "")
        if not nm:
            continue
        out[nm] = {
            "display": (it.get("name") or "").strip(),
            "dose":    (it.get("dose")   or "").strip() or None,
            "timing":  (it.get("timing") or "").strip() or None,
            "notes":   (it.get("notes")  or "").strip() or None,
        }
    return out


def _write_events(user_id: str, events: list[dict]) -> None:
    if not events:
        return
    sb = _sb()
    if not sb:
        return
    try:
        sb.table("stack_events").insert(events).execute()
    except Exception as exc:
        log.warning("stack: write_events failed: %s", exc)


def record_diff(user_id: str, old_profile: dict, new_profile: dict,
                when_iso: Optional[str] = None) -> int:
    """Compare two profile snapshots and write any add / remove / dose-change
    events to stack_events. Called from /api/profile save endpoint after a
    successful upsert. Returns the number of events written."""
    when = when_iso or _date.today().isoformat()
    events: list[dict] = []
    for cls in CLASSES:
        field = {"supplement": "supplements", "peptide": "peptides", "medication": "medications"}[cls]
        old_items = _index((old_profile or {}).get(field) or [])
        new_items = _index((new_profile or {}).get(field) or [])

        # Added
        for nm, meta in new_items.items():
            if nm in old_items:
                continue
            events.append({
                "user_id":      user_id,
                "class":        cls,
                "item_name":    nm,
                "display_name": meta["display"],
                "event_type":   "started",
                "dose":         meta["dose"],
                "timing":       meta["timing"],
                "notes":        meta["notes"],
                "event_date":   when,
            })
        # Removed
        for nm, meta in old_items.items():
            if nm in new_items:
                continue
            events.append({
                "user_id":      user_id,
                "class":        cls,
                "item_name":    nm,
                "display_name": meta["display"],
                "event_type":   "stopped",
                "dose":         meta["dose"],
                "timing":       meta["timing"],
                "notes":        None,
                "event_date":   when,
            })
        # Dose changed (same name, different dose)
        for nm, meta in new_items.items():
            if nm not in old_items:
                continue
            if (meta["dose"] or "") != (old_items[nm]["dose"] or ""):
                events.append({
                    "user_id":      user_id,
                    "class":        cls,
                    "item_name":    nm,
                    "display_name": meta["display"],
                    "event_type":   "dose_changed",
                    "dose":         meta["dose"],
                    "timing":       meta["timing"],
                    "notes":        f"prev dose: {old_items[nm]['dose'] or '—'}",
                    "event_date":   when,
                })
    _write_events(user_id, events)
    return len(events)


def backfill_from_current_stack(user_id: str, profile: dict) -> int:
    """First-time backfill: when a user has never had any stack_events but
    DOES have items in their current profile, record them all as
    'started' on today. Without this, the first comparison can't run
    until they make their next edit."""
    sb = _sb()
    if not sb:
        return 0
    # Skip if we already have any events for the user.
    try:
        res = (sb.table("stack_events")
                 .select("id")
                 .eq("user_id", user_id)
                 .limit(1)
                 .execute())
        if res.data:
            return 0
    except Exception:
        return 0

    today = _date.today().isoformat()
    events: list[dict] = []
    for cls in CLASSES:
        field = {"supplement": "supplements", "peptide": "peptides", "medication": "medications"}[cls]
        for nm, meta in _index((profile or {}).get(field) or []).items():
            events.append({
                "user_id":      user_id,
                "class":        cls,
                "item_name":    nm,
                "display_name": meta["display"],
                "event_type":   "started",
                "dose":         meta["dose"],
                "timing":       meta["timing"],
                "notes":        "(backfilled from existing stack — start date approximated)",
                "event_date":   today,
            })
    _write_events(user_id, events)
    return len(events)


# ── Efficacy compute ────────────────────────────────────────────────────

# How many days BEFORE and AFTER the start date the analysis needs.
WINDOW_BEFORE = 14
WINDOW_AFTER  = 14

# Metrics we compare. "direction" used to color deltas in the UI.
METRIC_SPECS: list[dict] = [
    {"key": "sleep_hours", "label": "Sleep duration",   "unit": "hrs",     "direction": "higher_better"},
    {"key": "sleep_eff",   "label": "Sleep efficiency", "unit": "%",       "direction": "higher_better"},
    {"key": "waso_min",    "label": "Awake (WASO)",     "unit": "min",     "direction": "lower_better"},
    {"key": "hrv",         "label": "HRV",              "unit": "ms",      "direction": "higher_better"},
    {"key": "rhr",         "label": "Resting HR",       "unit": "bpm",     "direction": "lower_better"},
    {"key": "breath",      "label": "Breathing rate",   "unit": "br/min",  "direction": "lower_better"},
    {"key": "spo2",        "label": "O₂ saturation",    "unit": "%",       "direction": "higher_better"},
    {"key": "readiness",   "label": "Readiness",        "unit": "",        "direction": "higher_better"},
]


def _build_metrics_window(user_id: str, start_iso: str, end_iso: str) -> dict[str, dict]:
    """Per-day metric values across the start..end window. Same shape
    used by the symptom correlation engine."""
    try:
        rm, slm, am, smm = oc.get_days(user_id, days=180)
    except Exception:
        rm, slm, am, smm = {}, {}, {}, {}

    out: dict[str, dict] = {}
    try:
        sd = datetime.strptime(start_iso, "%Y-%m-%d").date()
        ed = datetime.strptime(end_iso,   "%Y-%m-%d").date()
    except Exception:
        return out
    n_days = (ed - sd).days + 1
    if n_days <= 0:
        return out

    for offset in range(n_days):
        d = (sd + timedelta(days=offset)).isoformat()
        row = {}
        sm = smm.get(d) or {}
        if sm.get("total"):       row["sleep_hours"] = round(sm["total"] / 3600, 2)
        if sm.get("hrv")        is not None: row["hrv"] = sm["hrv"]
        if sm.get("rhr")        is not None: row["rhr"] = sm["rhr"]
        if sm.get("breath")     is not None: row["breath"] = sm["breath"]
        if sm.get("efficiency") is not None: row["sleep_eff"] = sm["efficiency"]
        if sm.get("awake")      is not None: row["waso_min"] = round(sm["awake"] / 60, 1)
        if sm.get("spo2")       is not None: row["spo2"] = sm["spo2"]
        rd = rm.get(d) or {}
        if rd.get("score") is not None:      row["readiness"] = rd["score"]
        if row:
            out[d] = row
    return out


def _avg(values: list[float]) -> Optional[float]:
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 2)


def compute_efficacy(user_id: str) -> dict:
    """For each currently-active stack item (started, not yet stopped) with
    enough before/after data, compute per-metric deltas.

    Returns: {
      items: [{
        item_name, display_name, class, dose, timing,
        started_on, days_since_start,
        before_window: {start, end}, after_window: {start, end},
        deltas: [{metric, label, unit, direction, before_avg, after_avg,
                  delta, abs_delta_pct, helpful}],
        notes,
      }, ...]
    }
    """
    sb = _sb()
    if not sb:
        return {"items": []}

    today = _date.today()
    try:
        res = (sb.table("stack_events")
                 .select("*")
                 .eq("user_id", user_id)
                 .order("event_date", desc=False)
                 .execute())
        all_events = res.data or []
    except Exception:
        return {"items": []}

    # Group by (class, item_name) and find each item's most recent 'started'
    # event that isn't followed by a 'stopped' event.
    items: dict[tuple[str, str], dict] = {}
    for ev in all_events:
        key = (ev["class"], ev["item_name"])
        items.setdefault(key, {"events": []})["events"].append(ev)

    out_items: list[dict] = []
    for (cls, name), bundle in items.items():
        events = bundle["events"]
        # Walk events; track current "active" start.
        active_started = None
        for ev in events:
            t = ev["event_type"]
            if t in ("started", "dose_changed"):
                active_started = ev
            elif t == "stopped":
                active_started = None
        if not active_started:
            continue

        start_d_str = active_started["event_date"]
        try:
            start_d = datetime.strptime(start_d_str, "%Y-%m-%d").date()
        except Exception:
            continue

        days_since = (today - start_d).days
        if days_since < WINDOW_AFTER:
            # Not enough post-start data yet — surface the item with a
            # "wait N more days" hint instead of skipping silently.
            out_items.append({
                "item_name":    name,
                "display_name": active_started.get("display_name") or name,
                "class":        cls,
                "dose":         active_started.get("dose"),
                "timing":       active_started.get("timing"),
                "started_on":   start_d_str,
                "days_since_start": days_since,
                "before_window": None,
                "after_window":  None,
                "deltas":        [],
                "note":          f"Add {WINDOW_AFTER - days_since} more days of data to compute a comparison.",
            })
            continue

        before_start = (start_d - timedelta(days=WINDOW_BEFORE)).isoformat()
        before_end   = (start_d - timedelta(days=1)).isoformat()
        after_start  = start_d.isoformat()
        after_end    = (start_d + timedelta(days=WINDOW_AFTER - 1)).isoformat()

        before_metrics = _build_metrics_window(user_id, before_start, before_end)
        after_metrics  = _build_metrics_window(user_id, after_start,  after_end)

        deltas: list[dict] = []
        for spec in METRIC_SPECS:
            k = spec["key"]
            before_vals = [m[k] for m in before_metrics.values() if k in m]
            after_vals  = [m[k] for m in after_metrics.values()  if k in m]
            if len(before_vals) < 4 or len(after_vals) < 4:
                continue
            ba = _avg(before_vals)
            aa = _avg(after_vals)
            if ba is None or aa is None:
                continue
            delta = round(aa - ba, 2)
            denom = max(abs(ba), 0.001)
            abs_pct = round(abs(delta) / denom * 100, 1)
            if spec["direction"] == "higher_better":
                helpful = delta > 0
            elif spec["direction"] == "lower_better":
                helpful = delta < 0
            else:
                helpful = None
            deltas.append({
                "metric":         k,
                "label":          spec["label"],
                "unit":           spec["unit"],
                "direction":      spec["direction"],
                "before_avg":     ba,
                "after_avg":      aa,
                "delta":          delta,
                "abs_delta_pct":  abs_pct,
                "helpful":        helpful,
            })
        deltas.sort(key=lambda r: r["abs_delta_pct"], reverse=True)

        out_items.append({
            "item_name":        name,
            "display_name":     active_started.get("display_name") or name,
            "class":            cls,
            "dose":             active_started.get("dose"),
            "timing":           active_started.get("timing"),
            "started_on":       start_d_str,
            "days_since_start": days_since,
            "before_window":    {"start": before_start, "end": before_end},
            "after_window":     {"start": after_start,  "end": after_end},
            "deltas":           deltas,
            "note":             None,
        })

    # Surface most recently-started items first
    out_items.sort(key=lambda r: r["started_on"], reverse=True)
    return {"items": out_items}
