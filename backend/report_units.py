"""
Report units policy — enforce a single unit system across every report.

Fable IMPROVE #1 flagged inconsistencies inside a single Doctor Report:
weight in kg in the narrative + lbs in the table, decimal step counts
(10485.2), duplicate weigh-ins with contradictory body fat values. This
module is where the policy lives — every report reads through it before
rendering.

Policy:
  • Weight in POUNDS (lbs). Rounded to 1 decimal.
  • Height in FEET AND INCHES. Never cm.
  • Steps as whole INTEGERS. Never decimals.
  • Blood pressure in mmHg. Whole integers.
  • Body fat as percentage. One decimal.
  • VO₂ max in ml/kg/min. One decimal.

If a source hands us kg, we convert. If it hands us decimal steps, we
round. Any leaked kg or decimal step to a user-visible surface is a
consistency bug — this module is the choke point.
"""

from __future__ import annotations

from typing import Optional


# ── weight ────────────────────────────────────────────────────────────

def kg_to_lbs(kg: Optional[float]) -> Optional[float]:
    if kg is None:
        return None
    try:
        return round(float(kg) * 2.20462, 1)
    except (TypeError, ValueError):
        return None


def normalize_weight_lbs(row: dict) -> Optional[float]:
    """Take a weigh-in row that might have weight in either weight_lbs
    OR weight_kg (rare Apple Health imports) and return lbs. If both
    fields are present the lbs field wins."""
    if not isinstance(row, dict):
        return None
    lbs = row.get("weight_lbs")
    if lbs is not None:
        try:
            return round(float(lbs), 1)
        except (TypeError, ValueError):
            pass
    return kg_to_lbs(row.get("weight_kg"))


# ── height ────────────────────────────────────────────────────────────

def height_cm_to_ft_in(cm: Optional[float]) -> Optional[str]:
    """5'11" style string from centimeters. Returns None for empty input."""
    if not cm:
        return None
    try:
        total_in = float(cm) / 2.54
    except (TypeError, ValueError):
        return None
    feet = int(total_in // 12)
    inches = int(round(total_in - feet * 12))
    if inches == 12:
        feet += 1
        inches = 0
    return f"{feet}'{inches}\""


# ── steps ─────────────────────────────────────────────────────────────

def normalize_steps(v) -> Optional[int]:
    """Round to whole integer. A step count with a decimal never makes
    sense as a display value — it comes from averaging code that
    forgot the last integer round."""
    if v is None:
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


# ── dedupe ────────────────────────────────────────────────────────────

def dedupe_weight_entries(entries: list[dict]) -> list[dict]:
    """When multiple weigh-ins share the same date, keep only the most
    recently *created* row. Fable found two entries on the same date
    with different body_fat_pct values (18% and 15%) showing up in the
    Doctor Report side by side — that's the bug this closes.

    Entries are expected to have at minimum a `date` field. Preserves
    the input row's other fields on the winner."""
    if not entries:
        return []
    by_date: dict[str, dict] = {}
    for e in entries:
        if not isinstance(e, dict):
            continue
        d = e.get("date")
        if not d:
            continue
        # Keep the winner with the latest created_at. If created_at is
        # missing on both, first-seen wins.
        prev = by_date.get(d)
        if not prev:
            by_date[d] = e
            continue
        prev_ts = str(prev.get("created_at") or "")
        new_ts  = str(e.get("created_at") or "")
        if new_ts > prev_ts:
            by_date[d] = e
    # Sort newest first for display
    return sorted(by_date.values(), key=lambda r: r.get("date") or "", reverse=True)
