"""
System-curated workout template library.

User-created templates already exist (saved routines in training_templates).
This module is the curated, BackNine-shipped library of well-known programs
the user can browse and start a session from — without designing one from
scratch.

Selection skews toward the men-50+ persona: programs that build / preserve
strength, are sustainable long-term, and don't require a Crossfit-tier
warm-up. Each program is a name + short description + a list of sessions,
where each session is an ordered list of exercise names (no sets/reps —
the user fills those in via the WorkoutLogger when they start the session).

This is static data — no DB write — so we can iterate quickly on the
catalog without migrations. If we ever want admin tooling to curate from
a database, we move this into a `system_workout_templates` table.
"""

from __future__ import annotations
from typing import Optional


SYSTEM_TEMPLATES: list[dict] = [
    {
        "id":          "full-body-3day",
        "name":        "Full Body — 3× per Week",
        "level":       "Beginner",
        "days_per_week": 3,
        "tag":         "Sustainable",
        "summary":     "Minimum effective dose for muscle and strength retention. Three full-body sessions a week with rest days between. Best place to start after 40+.",
        "why_for_50":  "Frequency-driven hypertrophy is dose-dependent; 3 full-body sessions hit every major muscle group twice a week without compounding fatigue.",
        "sessions": [
            {
                "name": "Day A",
                "exercises": [
                    "Goblet Squat",
                    "Bench Press (DB)",
                    "Bent-Over Row",
                    "Romanian Deadlift",
                    "Overhead Press",
                    "Plank (60 sec)",
                ],
            },
            {
                "name": "Day B",
                "exercises": [
                    "Trap Bar Deadlift",
                    "Incline DB Press",
                    "Lat Pulldown",
                    "Walking Lunge",
                    "Lateral Raise",
                    "Hanging Knee Raise",
                ],
            },
            {
                "name": "Day C",
                "exercises": [
                    "Front Squat (or Goblet)",
                    "Push-Up (or DB Press)",
                    "Seated Cable Row",
                    "Hip Thrust",
                    "Face Pull",
                    "Suitcase Carry",
                ],
            },
        ],
    },
    {
        "id":          "upper-lower-4day",
        "name":        "Upper / Lower — 4× per Week",
        "level":       "Intermediate",
        "days_per_week": 4,
        "tag":         "Balanced",
        "summary":     "Two upper and two lower days per week. Hits each body part twice with enough rest for older lifters to recover between sessions.",
        "why_for_50":  "Splitting upper/lower lets each session be shorter (45–60 min) while still hitting weekly volume targets. Easier on the joints than a 5-day bro-split.",
        "sessions": [
            {
                "name": "Upper A",
                "exercises": [
                    "Bench Press",
                    "Bent-Over Row",
                    "Overhead Press",
                    "Lat Pulldown",
                    "Tricep Pushdown",
                    "Bicep Curl",
                ],
            },
            {
                "name": "Lower A",
                "exercises": [
                    "Back Squat",
                    "Romanian Deadlift",
                    "Leg Press",
                    "Leg Curl",
                    "Calf Raise",
                    "Plank (60 sec)",
                ],
            },
            {
                "name": "Upper B",
                "exercises": [
                    "Incline DB Press",
                    "Cable Row",
                    "Lateral Raise",
                    "Pull-Up (or Assisted)",
                    "Skull Crusher",
                    "Hammer Curl",
                ],
            },
            {
                "name": "Lower B",
                "exercises": [
                    "Trap Bar Deadlift",
                    "Bulgarian Split Squat",
                    "Hip Thrust",
                    "Leg Extension",
                    "Standing Calf Raise",
                    "Side Plank (45 sec each)",
                ],
            },
        ],
    },
    {
        "id":          "ppl-6day",
        "name":        "Push / Pull / Legs — 6× per Week",
        "level":       "Advanced",
        "days_per_week": 6,
        "tag":         "Hypertrophy",
        "summary":     "Classic hypertrophy split: push muscles, pull muscles, then legs, repeat. High weekly volume; demands disciplined recovery.",
        "why_for_50":  "Only attempt if sleep + nutrition are dialed in. The 6-day cadence means you must recover between same-muscle sessions (~72h). Skip if you're chronically fatigued.",
        "sessions": [
            {
                "name": "Push A",
                "exercises": ["Bench Press", "Overhead Press", "Incline DB Press", "Lateral Raise", "Tricep Pushdown", "Overhead Tricep Extension"],
            },
            {
                "name": "Pull A",
                "exercises": ["Deadlift", "Pull-Up", "Bent-Over Row", "Face Pull", "Bicep Curl", "Hammer Curl"],
            },
            {
                "name": "Legs A",
                "exercises": ["Back Squat", "Romanian Deadlift", "Leg Press", "Leg Curl", "Calf Raise", "Plank (60 sec)"],
            },
            {
                "name": "Push B",
                "exercises": ["Incline Bench Press", "DB Shoulder Press", "Cable Fly", "Lateral Raise", "Dip", "Tricep Kickback"],
            },
            {
                "name": "Pull B",
                "exercises": ["Rack Pull", "Lat Pulldown", "Cable Row", "Reverse Fly", "Preacher Curl", "Cable Curl"],
            },
            {
                "name": "Legs B",
                "exercises": ["Front Squat", "Bulgarian Split Squat", "Hip Thrust", "Leg Extension", "Standing Calf Raise", "Hanging Leg Raise"],
            },
        ],
    },
    {
        "id":          "wendler-531",
        "name":        "5/3/1 Triumvirate (Wendler)",
        "level":       "Intermediate / Advanced",
        "days_per_week": 4,
        "tag":         "Strength",
        "summary":     "Jim Wendler's slow-progression strength program. Four days a week, one of the main lifts per session plus two assistance lifts. Built for longevity.",
        "why_for_50":  "Slow, sustainable PR-chasing. The 5/3/1 protocol is conservative enough that strength gains last through your 60s and beyond. Auto-regulating by AMRAP set protects against overreach.",
        "sessions": [
            {
                "name": "Press Day",
                "exercises": ["Overhead Press (5/3/1)", "Dip (5×15)", "Chin-Up (5×10)"],
            },
            {
                "name": "Deadlift Day",
                "exercises": ["Deadlift (5/3/1)", "Good Morning (5×12)", "Hanging Leg Raise (5×15)"],
            },
            {
                "name": "Bench Day",
                "exercises": ["Bench Press (5/3/1)", "DB Bench Press (5×15)", "DB Row (5×10)"],
            },
            {
                "name": "Squat Day",
                "exercises": ["Back Squat (5/3/1)", "Leg Press (5×15)", "Leg Curl (5×10)"],
            },
        ],
    },
    {
        "id":          "tactical-barbell",
        "name":        "Tactical Barbell — Operator",
        "level":       "Intermediate",
        "days_per_week": 3,
        "tag":         "Strength + Conditioning",
        "summary":     "K. Black's Operator template — 3 strength sessions a week paired with conditioning on off days. Designed for athletes and tactical personnel who need year-round capacity.",
        "why_for_50":  "Pairs heavy strength work with steady-state aerobic conditioning — the combination most associated with longevity and cardiovascular health. Three days of barbell work is recoverable.",
        "sessions": [
            {
                "name": "Cluster A",
                "exercises": ["Back Squat (3×5)", "Bench Press (3×5)", "Weighted Pull-Up (3×5)"],
            },
            {
                "name": "Cluster B",
                "exercises": ["Deadlift (3×5)", "Overhead Press (3×5)", "Weighted Dip (3×5)"],
            },
            {
                "name": "Cluster C",
                "exercises": ["Front Squat (3×5)", "Incline Bench (3×5)", "Bent-Over Row (3×5)"],
            },
        ],
    },
    {
        "id":          "stronger-by-stretching",
        "name":        "Stronger by Stretching — Hybrid",
        "level":       "All levels",
        "days_per_week": 4,
        "tag":         "Strength + Mobility",
        "summary":     "Two strength days, one mobility/stretching session, one zone-2 cardio day. Built for adults whose joints don't bounce back like they used to.",
        "why_for_50":  "Pairing strength with deliberate mobility work directly addresses the stiffness most adults over 50 cite as their biggest training limiter. The Zone 2 day reinforces cardiovascular base without recovery cost.",
        "sessions": [
            {
                "name": "Strength A — Push focus",
                "exercises": ["Bench Press", "Overhead Press", "Incline DB Press", "Tricep Pushdown", "Plank (60 sec)"],
            },
            {
                "name": "Strength B — Pull focus",
                "exercises": ["Deadlift", "Pull-Up", "Cable Row", "Face Pull", "Hammer Curl"],
            },
            {
                "name": "Mobility Day",
                "exercises": ["90/90 Hip Flow (5 min)", "World's Greatest Stretch (3×5/side)", "Cat-Cow (3×10)", "Couch Stretch (2×60 sec/side)", "Thoracic Opener (3×10)"],
            },
            {
                "name": "Zone 2 Cardio",
                "exercises": ["Zone 2 Bike or Walk (45–60 min @ HR <140)"],
            },
        ],
    },
]


def list_system_templates() -> list[dict]:
    """Return all curated system templates. Static; no DB read."""
    return SYSTEM_TEMPLATES


def get_system_template(template_id: str) -> Optional[dict]:
    """Lookup a single system template by id."""
    for t in SYSTEM_TEMPLATES:
        if t["id"] == template_id:
            return t
    return None
