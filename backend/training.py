"""
Training module for BackNine Health.
Covers:
  - Exercise & stretch database
  - Workout / stretch session CRUD
  - Oura-aware daily training recommendation
  - Post-workout stretch routine generator
  - Weekly training plan generator (general fitness / athlete split)

Data persisted to ~/.backnine/training.json
"""

import json
import uuid
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

DATA_DIR   = Path.home() / ".backnine"
TRAIN_FILE = DATA_DIR / "training.json"


# ── Exercise database ─────────────────────────────────────────────────────────
# name → { primary, secondary, equipment, category }
# category: compound | isolation | hinge | push | pull | squat | carry | core

EXERCISES: Dict[str, dict] = {
    # ── Barbell compounds ──
    "barbell back squat":     {"primary": ["quads","glutes"],          "secondary": ["hamstrings","lower_back","core"],  "equipment": "barbell", "category": "squat"},
    "barbell front squat":    {"primary": ["quads","core"],            "secondary": ["glutes","upper_back"],              "equipment": "barbell", "category": "squat"},
    "barbell deadlift":       {"primary": ["hamstrings","glutes","lower_back"], "secondary": ["traps","lats","core"],    "equipment": "barbell", "category": "hinge"},
    "romanian deadlift":      {"primary": ["hamstrings","glutes"],     "secondary": ["lower_back","calves"],              "equipment": "barbell", "category": "hinge"},
    "sumo deadlift":          {"primary": ["quads","glutes","adductors"],"secondary": ["hamstrings","lower_back"],        "equipment": "barbell", "category": "hinge"},
    "barbell bench press":    {"primary": ["chest"],                   "secondary": ["triceps","front_delts"],            "equipment": "barbell", "category": "push"},
    "incline barbell press":  {"primary": ["upper_chest"],             "secondary": ["triceps","front_delts"],            "equipment": "barbell", "category": "push"},
    "barbell overhead press": {"primary": ["front_delts","side_delts"],"secondary": ["triceps","upper_chest","traps"],   "equipment": "barbell", "category": "push"},
    "barbell row":            {"primary": ["lats","rhomboids"],        "secondary": ["biceps","rear_delts","traps"],      "equipment": "barbell", "category": "pull"},
    "barbell curl":           {"primary": ["biceps"],                  "secondary": ["brachialis"],                       "equipment": "barbell", "category": "isolation"},
    "barbell hip thrust":     {"primary": ["glutes"],                  "secondary": ["hamstrings","core"],                "equipment": "barbell", "category": "hinge"},
    "barbell lunge":          {"primary": ["quads","glutes"],          "secondary": ["hamstrings","core"],                "equipment": "barbell", "category": "squat"},
    "good morning":           {"primary": ["hamstrings","lower_back"], "secondary": ["glutes","core"],                    "equipment": "barbell", "category": "hinge"},
    "barbell shrug":          {"primary": ["traps"],                   "secondary": ["upper_back"],                       "equipment": "barbell", "category": "isolation"},

    # ── Dumbbell compounds & isolations ──
    "dumbbell bench press":   {"primary": ["chest"],                   "secondary": ["triceps","front_delts"],            "equipment": "dumbbell", "category": "push"},
    "incline dumbbell press": {"primary": ["upper_chest"],             "secondary": ["triceps","front_delts"],            "equipment": "dumbbell", "category": "push"},
    "dumbbell shoulder press":{"primary": ["front_delts","side_delts"],"secondary": ["triceps","upper_chest"],           "equipment": "dumbbell", "category": "push"},
    "dumbbell row":           {"primary": ["lats"],                    "secondary": ["biceps","rear_delts"],              "equipment": "dumbbell", "category": "pull"},
    "dumbbell curl":          {"primary": ["biceps"],                  "secondary": ["brachialis"],                       "equipment": "dumbbell", "category": "isolation"},
    "hammer curl":            {"primary": ["brachialis","biceps"],     "secondary": ["forearms"],                         "equipment": "dumbbell", "category": "isolation"},
    "lateral raise":          {"primary": ["side_delts"],              "secondary": ["traps"],                            "equipment": "dumbbell", "category": "isolation"},
    "rear delt fly":          {"primary": ["rear_delts"],              "secondary": ["rhomboids","traps"],                "equipment": "dumbbell", "category": "isolation"},
    "dumbbell romanian deadlift":{"primary":["hamstrings","glutes"],   "secondary": ["lower_back"],                       "equipment": "dumbbell", "category": "hinge"},
    "goblet squat":           {"primary": ["quads","glutes"],          "secondary": ["core","adductors"],                 "equipment": "dumbbell", "category": "squat"},
    "dumbbell lunge":         {"primary": ["quads","glutes"],          "secondary": ["hamstrings","core"],                "equipment": "dumbbell", "category": "squat"},
    "dumbbell step up":       {"primary": ["quads","glutes"],          "secondary": ["hamstrings"],                       "equipment": "dumbbell", "category": "squat"},
    "farmers carry":          {"primary": ["traps","forearms","core"], "secondary": ["glutes","hamstrings"],              "equipment": "dumbbell", "category": "carry"},
    "tricep kickback":        {"primary": ["triceps"],                 "secondary": [],                                   "equipment": "dumbbell", "category": "isolation"},

    # ── Bodyweight ──
    "pull up":                {"primary": ["lats"],                    "secondary": ["biceps","rear_delts","core"],       "equipment": "bodyweight", "category": "pull"},
    "chin up":                {"primary": ["lats","biceps"],           "secondary": ["core","rear_delts"],                "equipment": "bodyweight", "category": "pull"},
    "push up":                {"primary": ["chest"],                   "secondary": ["triceps","front_delts","core"],     "equipment": "bodyweight", "category": "push"},
    "dip":                    {"primary": ["triceps","chest"],         "secondary": ["front_delts"],                      "equipment": "bodyweight", "category": "push"},
    "bodyweight squat":       {"primary": ["quads","glutes"],          "secondary": ["hamstrings","core"],                "equipment": "bodyweight", "category": "squat"},
    "bulgarian split squat":  {"primary": ["quads","glutes"],          "secondary": ["hamstrings","core"],                "equipment": "bodyweight", "category": "squat"},
    "glute bridge":           {"primary": ["glutes"],                  "secondary": ["hamstrings","core"],                "equipment": "bodyweight", "category": "hinge"},
    "plank":                  {"primary": ["core"],                    "secondary": ["shoulders","glutes"],               "equipment": "bodyweight", "category": "core"},
    "ab wheel rollout":       {"primary": ["core"],                    "secondary": ["lats","shoulders"],                 "equipment": "bodyweight", "category": "core"},
    "leg raise":              {"primary": ["core","hip_flexors"],      "secondary": [],                                   "equipment": "bodyweight", "category": "core"},
    "face pull":              {"primary": ["rear_delts","external_rotators"],"secondary": ["traps","rhomboids"],         "equipment": "cable",     "category": "pull"},
    "cable row":              {"primary": ["lats","rhomboids"],        "secondary": ["biceps","rear_delts"],              "equipment": "cable",     "category": "pull"},
    "lat pulldown":           {"primary": ["lats"],                    "secondary": ["biceps","rear_delts"],              "equipment": "cable",     "category": "pull"},
    "cable fly":              {"primary": ["chest"],                   "secondary": ["front_delts"],                      "equipment": "cable",     "category": "push"},
    "tricep pushdown":        {"primary": ["triceps"],                 "secondary": [],                                   "equipment": "cable",     "category": "isolation"},
    "cable curl":             {"primary": ["biceps"],                  "secondary": [],                                   "equipment": "cable",     "category": "isolation"},
    "leg press":              {"primary": ["quads","glutes"],          "secondary": ["hamstrings"],                       "equipment": "machine",   "category": "squat"},
    "leg curl":               {"primary": ["hamstrings"],              "secondary": ["calves"],                           "equipment": "machine",   "category": "isolation"},
    "leg extension":          {"primary": ["quads"],                   "secondary": [],                                   "equipment": "machine",   "category": "isolation"},
    "calf raise":             {"primary": ["calves"],                  "secondary": [],                                   "equipment": "machine",   "category": "isolation"},
    "chest supported row":    {"primary": ["lats","rhomboids"],        "secondary": ["biceps","rear_delts"],              "equipment": "machine",   "category": "pull"},
    "chest fly machine":      {"primary": ["chest"],                   "secondary": ["front_delts"],                      "equipment": "machine",   "category": "push"},
    "hip abduction":          {"primary": ["glutes","abductors"],      "secondary": [],                                   "equipment": "machine",   "category": "isolation"},
    "kettlebell swing":       {"primary": ["glutes","hamstrings"],     "secondary": ["core","lower_back","shoulders"],    "equipment": "kettlebell","category": "hinge"},
    "turkish get up":         {"primary": ["core","shoulders","glutes"],"secondary": ["hips","triceps"],                  "equipment": "kettlebell","category": "compound"},
}

# Canonical muscle group display names
MUSCLE_DISPLAY: Dict[str, str] = {
    "quads": "Quads", "hamstrings": "Hamstrings", "glutes": "Glutes",
    "chest": "Chest", "upper_chest": "Upper Chest", "lats": "Lats",
    "traps": "Traps", "rhomboids": "Rhomboids", "upper_back": "Upper Back",
    "lower_back": "Lower Back", "front_delts": "Front Delts",
    "side_delts": "Side Delts", "rear_delts": "Rear Delts",
    "biceps": "Biceps", "triceps": "Triceps", "brachialis": "Brachialis",
    "core": "Core", "calves": "Calves", "forearms": "Forearms",
    "adductors": "Adductors", "abductors": "Abductors",
    "hip_flexors": "Hip Flexors", "external_rotators": "External Rotators",
    "shoulders": "Shoulders",
}


# ── Stretch database ──────────────────────────────────────────────────────────
# muscle_group → list of { name, duration_sec, cue }

STRETCHES: Dict[str, List[dict]] = {
    "quads": [
        {"name": "Standing quad stretch",        "duration_sec": 30, "cue": "Pull heel to glute, keep knees together, stand tall"},
        {"name": "Couch stretch (hip flexor/quad)","duration_sec": 45, "cue": "Back knee on ground, lunge forward, drive hips down"},
        {"name": "Prone quad stretch",            "duration_sec": 30, "cue": "Lie face down, pull heel to glute, keep hips flat"},
    ],
    "hamstrings": [
        {"name": "Standing forward fold",         "duration_sec": 45, "cue": "Soft knees, hinge at hips, let head hang heavy"},
        {"name": "Seated hamstring stretch",       "duration_sec": 40, "cue": "Legs straight, hinge forward, reach for feet"},
        {"name": "Supine single-leg stretch",      "duration_sec": 30, "cue": "Lie on back, pull straight leg toward you with strap or hands"},
        {"name": "PNF hamstring stretch",          "duration_sec": 30, "cue": "Push into resistance for 6s, then deepen the stretch"},
    ],
    "glutes": [
        {"name": "Figure-4 stretch (lying)",       "duration_sec": 40, "cue": "On back, cross ankle over knee, pull thigh toward chest"},
        {"name": "Pigeon pose",                    "duration_sec": 60, "cue": "Front shin parallel to mat, fold forward over front leg"},
        {"name": "Seated glute stretch",           "duration_sec": 35, "cue": "Cross ankle over knee, lean forward from hips"},
        {"name": "90/90 hip stretch",              "duration_sec": 45, "cue": "Both hips at 90°, sit tall, lean over front leg"},
    ],
    "chest": [
        {"name": "Doorway chest stretch",          "duration_sec": 30, "cue": "Elbow at 90°, press forearm on frame, step forward, feel stretch across pec"},
        {"name": "Pec minor stretch on ball/foam", "duration_sec": 30, "cue": "Lie on foam roller along spine, arms out at 45°, let gravity open chest"},
        {"name": "Behind-back clasped hands",      "duration_sec": 30, "cue": "Clasp hands behind back, squeeze scapulae, lift arms slightly"},
    ],
    "lats": [
        {"name": "Overhead lat stretch",           "duration_sec": 35, "cue": "Grab rig or bar overhead, lean away and drop hips to one side"},
        {"name": "Child's pose lat reach",          "duration_sec": 45, "cue": "Walk hands far to one side, sink hips back, breathe into that side"},
        {"name": "Thread the needle",              "duration_sec": 30, "cue": "On all fours, slide one arm under body, rotate, rest shoulder on ground"},
    ],
    "upper_back": [
        {"name": "Cat-cow",                        "duration_sec": 30, "cue": "Slow breath cycle: arch on exhale, round on inhale — 10 reps"},
        {"name": "Thoracic extension on foam roller","duration_sec": 45,"cue": "Place roller across mid-back, arms crossed, arch over it one vertebra at a time"},
        {"name": "Seated T-spine rotation",        "duration_sec": 30, "cue": "Sit cross-legged, hand behind head, rotate fully, hold at end range"},
    ],
    "lower_back": [
        {"name": "Supine knee-to-chest",           "duration_sec": 40, "cue": "Pull both knees to chest, rock gently side to side"},
        {"name": "Child's pose",                   "duration_sec": 45, "cue": "Hips to heels, arms long, breathe into lower back"},
        {"name": "Supine twist",                   "duration_sec": 35, "cue": "Knee crosses body, opposite shoulder stays flat, look away"},
    ],
    "shoulders": [
        {"name": "Cross-body shoulder stretch",    "duration_sec": 30, "cue": "Pull arm across chest with opposite hand, keep elbow below shoulder"},
        {"name": "Sleeper stretch",                "duration_sec": 30, "cue": "Lie on side, upper arm forward, use other hand to press wrist down"},
        {"name": "Wall shoulder flexion stretch",  "duration_sec": 30, "cue": "Arms on wall at shoulder height, walk feet forward, let chest drop"},
    ],
    "front_delts": [
        {"name": "Behind-back wrist clasp",        "duration_sec": 30, "cue": "Clasp wrists behind back, straighten elbows, lift arms gently"},
    ],
    "rear_delts": [
        {"name": "Cross-body rear delt pull",      "duration_sec": 30, "cue": "Arm across chest, use other elbow as leverage, point shoulder down"},
    ],
    "triceps": [
        {"name": "Overhead tricep stretch",        "duration_sec": 30, "cue": "Raise arm, bend elbow, use other hand to gently push elbow behind head"},
    ],
    "biceps": [
        {"name": "Bicep wall stretch",             "duration_sec": 30, "cue": "Arm on wall with thumb down, rotate body away slowly"},
    ],
    "calves": [
        {"name": "Standing calf stretch",          "duration_sec": 40, "cue": "Heel on ground, toes up on wall, lean shin forward"},
        {"name": "Soleus stretch",                 "duration_sec": 35, "cue": "Bent-knee version of calf stretch — targets deeper soleus"},
    ],
    "hip_flexors": [
        {"name": "Kneeling lunge hip flexor",      "duration_sec": 45, "cue": "Rear knee down, drive hips forward until you feel the stretch up the front of hip"},
        {"name": "Standing hip flexor stretch",    "duration_sec": 35, "cue": "Step forward, squeeze rear glute, tuck pelvis, feel front hip open"},
    ],
    "core": [
        {"name": "Cobra pose",                     "duration_sec": 30, "cue": "Hands under shoulders, press up, keep hips on ground, look forward"},
        {"name": "Side stretch",                   "duration_sec": 25, "cue": "Arm overhead, lean to opposite side, breathe into the stretch"},
    ],
    "adductors": [
        {"name": "Seated butterfly stretch",       "duration_sec": 45, "cue": "Soles of feet together, press knees gently toward floor"},
        {"name": "Wide-leg forward fold",          "duration_sec": 40, "cue": "Legs wide, hinge forward from hips, walk hands out"},
        {"name": "Cossack squat",                  "duration_sec": 30, "cue": "Shift weight side to side in wide stance, opposite leg straight"},
    ],
    "traps": [
        {"name": "Neck side tilt",                 "duration_sec": 30, "cue": "Ear to shoulder, apply gentle pressure with hand, breathe into neck"},
        {"name": "Upper trap stretch",             "duration_sec": 30, "cue": "Head tilted, rotate chin slightly down, feel stretch up side of neck"},
    ],
}


# ── Weekly plan templates (general fitness / athlete) ─────────────────────────
# A 4-day / 5-day rotation. Each session has a name, focus muscles, and
# a list of exercises with set/rep targets.

WEEKLY_TEMPLATES = {
    4: [
        {
            "name": "Upper A — Push Focus",
            "focus": ["chest", "shoulders", "triceps"],
            "exercises": [
                {"name": "barbell bench press",     "sets": 4, "reps": "6-8",  "note": "Primary strength work"},
                {"name": "incline dumbbell press",  "sets": 3, "reps": "10-12","note": ""},
                {"name": "barbell overhead press",  "sets": 3, "reps": "8-10", "note": ""},
                {"name": "lateral raise",           "sets": 3, "reps": "12-15","note": ""},
                {"name": "tricep pushdown",         "sets": 3, "reps": "12-15","note": ""},
                {"name": "face pull",               "sets": 3, "reps": "15-20","note": "Shoulder health — don't skip"},
            ],
        },
        {
            "name": "Lower A — Squat Focus",
            "focus": ["quads", "glutes", "core"],
            "exercises": [
                {"name": "barbell back squat",      "sets": 4, "reps": "5-7",  "note": "Primary strength work"},
                {"name": "bulgarian split squat",   "sets": 3, "reps": "10-12","note": "Each leg"},
                {"name": "leg press",               "sets": 3, "reps": "12-15","note": ""},
                {"name": "leg curl",                "sets": 3, "reps": "12-15","note": ""},
                {"name": "calf raise",              "sets": 4, "reps": "15-20","note": ""},
                {"name": "plank",                   "sets": 3, "reps": "30-60s","note": ""},
            ],
        },
        {
            "name": "Upper B — Pull Focus",
            "focus": ["lats", "upper_back", "biceps", "rear_delts"],
            "exercises": [
                {"name": "barbell row",             "sets": 4, "reps": "6-8",  "note": "Primary strength work"},
                {"name": "pull up",                 "sets": 4, "reps": "max",  "note": "Add weight when 3×8+ is easy"},
                {"name": "lat pulldown",            "sets": 3, "reps": "10-12","note": ""},
                {"name": "dumbbell row",            "sets": 3, "reps": "10-12","note": "Each arm"},
                {"name": "rear delt fly",           "sets": 3, "reps": "15-20","note": ""},
                {"name": "hammer curl",             "sets": 3, "reps": "12-15","note": ""},
            ],
        },
        {
            "name": "Lower B — Hinge Focus",
            "focus": ["hamstrings", "glutes", "lower_back"],
            "exercises": [
                {"name": "barbell deadlift",        "sets": 4, "reps": "4-6",  "note": "Primary strength work"},
                {"name": "romanian deadlift",       "sets": 3, "reps": "10-12","note": "Control the descent"},
                {"name": "barbell hip thrust",      "sets": 3, "reps": "12-15","note": "Squeeze hard at top"},
                {"name": "leg curl",                "sets": 3, "reps": "12-15","note": ""},
                {"name": "dumbbell step up",        "sets": 3, "reps": "10-12","note": "Each leg"},
                {"name": "ab wheel rollout",        "sets": 3, "reps": "8-12", "note": ""},
            ],
        },
    ],
    5: [
        {
            "name": "Push A — Chest Focus",
            "focus": ["chest", "front_delts", "triceps"],
            "exercises": [
                {"name": "barbell bench press",     "sets": 4, "reps": "5-7",  "note": "Primary strength"},
                {"name": "incline barbell press",   "sets": 3, "reps": "8-10", "note": ""},
                {"name": "cable fly",               "sets": 3, "reps": "12-15","note": ""},
                {"name": "dumbbell shoulder press", "sets": 3, "reps": "10-12","note": ""},
                {"name": "lateral raise",           "sets": 4, "reps": "15-20","note": ""},
                {"name": "tricep pushdown",         "sets": 3, "reps": "12-15","note": ""},
            ],
        },
        {
            "name": "Pull A — Back Width",
            "focus": ["lats", "biceps"],
            "exercises": [
                {"name": "pull up",                 "sets": 4, "reps": "max",  "note": "Weighted when 8+ reps"},
                {"name": "lat pulldown",            "sets": 3, "reps": "10-12","note": ""},
                {"name": "cable row",               "sets": 4, "reps": "10-12","note": ""},
                {"name": "dumbbell curl",           "sets": 3, "reps": "12-15","note": ""},
                {"name": "hammer curl",             "sets": 3, "reps": "12-15","note": ""},
                {"name": "face pull",               "sets": 3, "reps": "15-20","note": "Shoulder health"},
            ],
        },
        {
            "name": "Legs — Squat + Hinge",
            "focus": ["quads", "hamstrings", "glutes"],
            "exercises": [
                {"name": "barbell back squat",      "sets": 4, "reps": "5-7",  "note": "Primary strength"},
                {"name": "romanian deadlift",       "sets": 3, "reps": "10-12","note": ""},
                {"name": "leg press",               "sets": 3, "reps": "12-15","note": ""},
                {"name": "leg curl",                "sets": 3, "reps": "12-15","note": ""},
                {"name": "calf raise",              "sets": 4, "reps": "15-20","note": ""},
            ],
        },
        {
            "name": "Push B — Shoulders + Triceps",
            "focus": ["side_delts", "front_delts", "triceps"],
            "exercises": [
                {"name": "barbell overhead press",  "sets": 4, "reps": "5-7",  "note": "Primary strength"},
                {"name": "dumbbell bench press",    "sets": 3, "reps": "10-12","note": ""},
                {"name": "lateral raise",           "sets": 4, "reps": "15-20","note": ""},
                {"name": "rear delt fly",           "sets": 3, "reps": "15-20","note": ""},
                {"name": "dip",                     "sets": 3, "reps": "max",  "note": ""},
                {"name": "tricep kickback",         "sets": 3, "reps": "12-15","note": ""},
            ],
        },
        {
            "name": "Pull B — Back Thickness + Arms",
            "focus": ["upper_back", "rhomboids", "biceps", "rear_delts"],
            "exercises": [
                {"name": "barbell row",             "sets": 4, "reps": "6-8",  "note": "Primary strength"},
                {"name": "chest supported row",     "sets": 3, "reps": "10-12","note": ""},
                {"name": "barbell deadlift",        "sets": 3, "reps": "5",    "note": "Technique / moderate intensity"},
                {"name": "dumbbell curl",           "sets": 4, "reps": "10-12","note": ""},
                {"name": "face pull",               "sets": 3, "reps": "15-20","note": ""},
            ],
        },
    ],
}

# Recovery / mobility day template
MOBILITY_SESSION = {
    "name": "Active Recovery & Mobility",
    "focus": ["core", "hip_flexors", "lower_back", "adductors"],
    "exercises": [
        {"name": "cat-cow",                    "sets": 3, "reps": "10 reps",  "note": "Slow and controlled"},
        {"name": "90/90 hip stretch",          "sets": 2, "reps": "60s each", "note": ""},
        {"name": "couch stretch (hip flexor/quad)", "sets": 2, "reps": "45s each", "note": ""},
        {"name": "thoracic extension on foam roller","sets": 3,"reps": "10 reps", "note": ""},
        {"name": "child's pose",               "sets": 3, "reps": "45s",      "note": ""},
        {"name": "pigeon pose",                "sets": 2, "reps": "60s each", "note": ""},
        {"name": "seated butterfly stretch",   "sets": 3, "reps": "45s",      "note": ""},
    ],
}


# ── Storage helpers ───────────────────────────────────────────────────────────

def _load() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if TRAIN_FILE.exists():
        try:
            return json.loads(TRAIN_FILE.read_text())
        except Exception:
            pass
    return {"workouts": [], "settings": {}}


def _save(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TRAIN_FILE.write_text(json.dumps(data, indent=2, default=str))


# ── Exercise search ───────────────────────────────────────────────────────────

def search_exercises(query: str, limit: int = 10) -> List[dict]:
    q = query.lower().strip()
    if not q:
        return []
    results = []
    for name, info in EXERCISES.items():
        if q in name or any(q in m for m in info["primary"] + info["secondary"]):
            results.append({"name": name, **info})
    results.sort(key=lambda x: (
        0 if x["name"] == q else
        1 if x["name"].startswith(q) else
        2 if q in x["name"] else 3
    ))
    return results[:limit]


# ── Workout CRUD ──────────────────────────────────────────────────────────────

def get_workouts(days: int = 30) -> List[dict]:
    data  = _load()
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    return [w for w in data.get("workouts", []) if w["date"] >= cutoff]


def add_workout(
    date_str: str,
    workout_type: str,          # "lifting" | "stretching" | "mobility"
    exercises: List[dict],      # see schema below
    duration_min: Optional[int] = None,
    notes: str = "",
) -> dict:
    """
    Exercise schema (lifting):
      { name, sets: [{weight_lbs, reps, rpe?}] }
    Exercise schema (stretching):
      { name, duration_sec }
    """
    data = _load()

    # Compute totals for lifting sessions
    total_volume = 0
    muscle_groups: List[str] = []
    for ex in exercises:
        info = EXERCISES.get(ex["name"], {})
        for mg in info.get("primary", []):
            if mg not in muscle_groups:
                muscle_groups.append(mg)
        if workout_type == "lifting":
            for s in ex.get("sets", []):
                w = s.get("weight_lbs", 0) or 0
                r = s.get("reps", 0) or 0
                total_volume += w * r

    entry: dict = {
        "id":            str(uuid.uuid4())[:8],
        "date":          date_str,
        "type":          workout_type,
        "exercises":     exercises,
        "muscle_groups": muscle_groups,
        "duration_min":  duration_min,
        "notes":         notes,
        "logged_at":     datetime.now().isoformat(),
    }
    if workout_type == "lifting":
        entry["total_volume_lbs"] = round(total_volume)

    data["workouts"].append(entry)
    _save(data)
    return entry


def delete_workout(workout_id: str) -> bool:
    data = _load()
    orig = data.get("workouts", [])
    data["workouts"] = [w for w in orig if w["id"] != workout_id]
    if len(data["workouts"]) == len(orig):
        return False
    _save(data)
    return True


# ── Settings ──────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "goal":          "general_fitness",   # strength | hypertrophy | general_fitness
    "days_per_week": 4,
    "split_type":    "push_pull_legs",
    "equipment":     ["barbell", "dumbbell", "cable", "machine", "bodyweight", "kettlebell"],
    "units":         "lbs",
}


def get_settings() -> dict:
    data = _load()
    return {**DEFAULT_SETTINGS, **data.get("settings", {})}


def save_settings(settings: dict) -> dict:
    data = _load()
    data["settings"] = settings
    _save(data)
    return settings


# ── Daily training recommendation ─────────────────────────────────────────────

def daily_recommendation(
    readiness: int,
    hrv: Optional[float],
    recent_workouts: List[dict],
) -> dict:
    """
    Combines Oura readiness score with recent training history to recommend
    today's training intensity and type.
    """
    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    # Was yesterday a hard day?
    yesterday_workouts = [w for w in recent_workouts if w["date"] == yesterday]
    hard_yesterday = any(
        w["type"] == "lifting" and w.get("total_volume_lbs", 0) > 5000
        for w in yesterday_workouts
    )

    # Count consecutive training days
    consecutive = 0
    for i in range(7):
        d = (date.today() - timedelta(days=i+1)).isoformat()
        if any(w["date"] == d for w in recent_workouts):
            consecutive += 1
        else:
            break

    # Determine intensity
    if readiness >= 85 and not hard_yesterday and consecutive < 4:
        level  = "full"
        label  = "Full Send 💪"
        color  = "#22c55e"
        title  = "Ready to crush it"
        detail = "HRV and readiness are strong. This is your window for heavy compound work and progressive overload. Push hard today."
    elif readiness >= 70:
        level  = "moderate"
        label  = "Moderate Load 🟡"
        color  = "#f59e0b"
        title  = "Good training day"
        detail = "Solid day for your working sets. Stay at planned weights, skip drop sets or extra intensity techniques today."
    elif readiness >= 55:
        level  = "light"
        label  = "Light Day 🔵"
        color  = "#3b82f6"
        title  = "Technique & movement focus"
        detail = "Body is under some stress. Use this for lighter work, mobility, or a deload-style session. Skip the heavy top sets."
    else:
        level  = "rest"
        label  = "Rest / Recovery 🛌"
        color  = "#6b7280"
        title  = "Active recovery recommended"
        detail = "Readiness is low. A hard session today will set you back more than it builds you up. Walk, stretch, sleep early."

    # Contextual modifiers
    modifiers = []
    if consecutive >= 4:
        modifiers.append(f"You've trained {consecutive} days in a row — consider a deload day regardless of readiness.")
    if hard_yesterday:
        modifiers.append("Yesterday was a high-volume session — prioritize technique over load today.")
    if hrv and hrv < 30:
        modifiers.append("HRV is notably suppressed — your nervous system is still recovering.")

    # What to train today (based on plan rotation and last session)
    trained_recently = set()
    for w in recent_workouts[-3:]:
        trained_recently.update(w.get("muscle_groups", []))

    if level == "rest":
        suggestion = "Active recovery: 20-30 min walk, foam rolling, or the stretching routine below."
    elif "quads" not in trained_recently and "glutes" not in trained_recently:
        suggestion = "Lower body session recommended — legs haven't been trained in the last 3 sessions."
    elif "chest" not in trained_recently and "lats" not in trained_recently:
        suggestion = "Upper body session due — push or pull focus."
    else:
        suggestion = "Full body or conditioning — all major groups trained recently."

    return {
        "level":      level,
        "label":      label,
        "color":      color,
        "title":      title,
        "detail":     detail,
        "modifiers":  modifiers,
        "suggestion": suggestion,
        "readiness":  readiness,
        "consecutive_days": consecutive,
    }


# ── Stretch routine generator ──────────────────────────────────────────────────

def generate_stretch_routine(muscle_groups: List[str], duration_target_min: int = 10) -> dict:
    """
    Build a targeted post-workout stretch protocol from muscle groups trained.
    Also includes 1-2 standard movements for antagonists / injury prevention.
    """
    # Antagonist pairs for balance
    antagonists: Dict[str, List[str]] = {
        "chest":      ["upper_back"],
        "quads":      ["hamstrings"],
        "hamstrings": ["hip_flexors", "quads"],
        "front_delts": ["rear_delts"],
        "lats":       ["shoulders"],
    }

    target_groups = list(dict.fromkeys(muscle_groups))  # preserve order, deduplicate

    # Add antagonists for key primary muscles
    for mg in list(target_groups):
        for ant in antagonists.get(mg, []):
            if ant not in target_groups and ant in STRETCHES:
                target_groups.append(ant)

    # Always include lower_back and hip_flexors as base
    for base in ["lower_back", "hip_flexors"]:
        if base not in target_groups and base in STRETCHES:
            target_groups.append(base)

    routine: List[dict] = []
    total_sec = 0
    target_sec = duration_target_min * 60

    for mg in target_groups:
        if mg not in STRETCHES:
            continue
        # Pick 1-2 stretches per muscle group
        picks = STRETCHES[mg][:2]
        for stretch in picks:
            routine.append({
                **stretch,
                "muscle_group": MUSCLE_DISPLAY.get(mg, mg.replace("_", " ").title()),
                "sides": 2 if any(kw in stretch["name"].lower() for kw in ["single", "each", "side", "leg", "arm", "lunge", "pigeon", "90/90", "neck", "cossack", "standing quad"]) else 1,
            })
            total_sec += stretch["duration_sec"] * (2 if routine[-1]["sides"] == 2 else 1)
            if total_sec >= target_sec:
                break
        if total_sec >= target_sec:
            break

    return {
        "exercises":     routine,
        "total_min":     round(total_sec / 60, 1),
        "muscle_groups": [MUSCLE_DISPLAY.get(mg, mg.replace("_"," ").title()) for mg in target_groups if mg in STRETCHES],
    }


# ── Weekly plan generator ─────────────────────────────────────────────────────

def generate_weekly_plan(settings: Optional[dict] = None) -> dict:
    """
    Generate a 7-day training plan starting from today (Monday-aligned).
    Returns scheduled day → session (or rest).
    """
    if settings is None:
        settings = get_settings()

    days_per_week = settings.get("days_per_week", 4)
    days_per_week = max(3, min(5, days_per_week))  # clamp 3-5

    template = WEEKLY_TEMPLATES.get(days_per_week, WEEKLY_TEMPLATES[4])

    # Start from today's Monday
    today    = date.today()
    mon      = today - timedelta(days=today.weekday())

    # Map template sessions to Mon/Tue/Wed/Thu/Fri by spreading across weekdays
    # e.g. 4-day: Mon, Tue, Thu, Fri  |  5-day: Mon-Fri
    day_slots_4 = [0, 1, 3, 4]  # Mon Tue Thu Fri
    day_slots_5 = [0, 1, 2, 3, 4]
    day_slots   = day_slots_4 if days_per_week == 4 else day_slots_5

    plan = []
    session_idx = 0
    for offset in range(7):
        d = (mon + timedelta(days=offset)).isoformat()
        is_today = d == today.isoformat()
        if offset in day_slots and session_idx < len(template):
            session = dict(template[session_idx])
            session["date"]     = d
            session["is_today"] = is_today
            session["rest"]     = False
            session_idx += 1
        elif offset == 6 and days_per_week >= 4:
            # Sunday: optional mobility day
            session = dict(MOBILITY_SESSION)
            session["date"]     = d
            session["is_today"] = is_today
            session["rest"]     = False
            session["optional"] = True
        else:
            session = {
                "name":     "Rest Day",
                "date":     d,
                "is_today": is_today,
                "rest":     True,
                "focus":    [],
            }
        plan.append(session)

    return {"plan": plan, "days_per_week": days_per_week}
