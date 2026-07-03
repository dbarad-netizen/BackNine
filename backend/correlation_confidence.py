"""
Shared confidence helper for BackNine's three correlation engines
(symptoms.py, oura_tags.py, journal.py).

Motivation (Fable feedback, IMPROVE #4):
    "'Your last 3 alcohol nights all had sleep efficiency below 75%'
     is compelling — and n=3. A skeptical 55-year-old engineer will
     catch one spurious correlation and stop trusting all of them.
     Enforce minimum sample sizes, show them, and suppress weak
     correlations entirely. Trust is the product; spurious precision
     is the failure mode."

Rules enforced uniformly across all engines:
  1. Do NOT surface a correlation unless the "positive" side (symptom
     days / tag days / journal-tag days) has ≥ MIN_SAMPLE_SIZE and the
     "negative" side has ≥ MIN_NEG_SAMPLE_SIZE.
  2. Every surfaced correlation carries a `confidence` level so the
     frontend and Coach Al can use hedged language for low-n signals.
  3. Very small deltas are suppressed regardless of sample size —
     spurious precision is worse than silence.
"""

from __future__ import annotations

from typing import Literal, Optional

# ── thresholds ─────────────────────────────────────────────────────────

# Below this positive-side count, do not surface AT ALL. The engines
# used to allow n=3, which is exactly where a skeptical user starts
# calling us out for pattern-matching noise.
MIN_SAMPLE_SIZE            = 5

# The negative side (baseline) is usually large (30+ days), but if it's
# tiny we can't compute a meaningful delta. Guard it too.
MIN_NEG_SAMPLE_SIZE        = 5

# Confidence tiers based on the POSITIVE-side count (the limiting
# factor in practice — negative sides are almost always huge).
HIGH_CONFIDENCE_THRESHOLD  = 10
MEDIUM_CONFIDENCE_THRESHOLD = 7

# Minimum absolute delta size (as a percent of baseline) worth surfacing.
# Below this, the effect is too small to matter even if the sample size
# is high.
MIN_ABS_DELTA_PCT          = 3.0


Confidence = Literal["low", "medium", "high"]


def confidence_level(positive_n: int, negative_n: int) -> Optional[Confidence]:
    """Return the confidence tier for a correlation with these sample
    sizes, or None if the correlation should be suppressed entirely.

    Suppression happens when either side is below its minimum count."""
    if positive_n < MIN_SAMPLE_SIZE or negative_n < MIN_NEG_SAMPLE_SIZE:
        return None
    if positive_n >= HIGH_CONFIDENCE_THRESHOLD:
        return "high"
    if positive_n >= MEDIUM_CONFIDENCE_THRESHOLD:
        return "medium"
    return "low"


def should_surface(positive_n: int, negative_n: int, abs_pct: float) -> bool:
    """Combined gate: sample sizes AND absolute delta must both be
    meaningful. Use this at the very end of each correlation loop."""
    return (
        confidence_level(positive_n, negative_n) is not None
        and abs_pct >= MIN_ABS_DELTA_PCT
    )


def confidence_label(level: Optional[Confidence], positive_n: int) -> str:
    """Human-readable confidence blurb for the UI and for Coach Al's
    system prompt. Shows the sample size prominently so a skeptical
    reader can judge for themselves."""
    if level is None:
        return f"insufficient data (only {positive_n} matching days)"
    if level == "high":
        return f"based on {positive_n} days · high confidence"
    if level == "medium":
        return f"based on {positive_n} days · moderate confidence"
    return f"based on {positive_n} days · early signal"


def coach_hedge_language(level: Optional[Confidence]) -> str:
    """Suggested language modifier for Coach Al when he references a
    correlation at each confidence tier."""
    if level == "high":
        return "consistently associated with"
    if level == "medium":
        return "associated with (moderate confidence)"
    if level == "low":
        return "a possible early signal — worth watching"
    return "no pattern yet"
