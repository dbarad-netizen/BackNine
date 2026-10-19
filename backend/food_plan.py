"""
food_plan.py — an eating protocol the app can CHECK, not just display.

David 2026-10-18: "Is there a way to add this into my account on BackNine
to help me track and manage this eating protocol?" — his nutritionist's
2021 plan, reset: three meals in a 10-hour window, kitchen closed 3 h
before bed, protein first (30-40 / 40-50 / 40-50 g), carbs under 25 g a
meal, two fists of veg at lunch and dinner, no snacks, no alcohol for a
two-week restart, then 2-3 drinks a week.

What makes this BackNine rather than a diet app: most rules are checked
against things we already measure.

  rule                         source
  ─────────────────────────    ────────────────────────────────────────
  kitchen closed 3 h pre-bed   last meal logged_at vs OURA bedtime_start
  10-hour window               first/last meal logged_at
  protein floor per meal       nutrition_meals.protein (photo/text parse)
  carb cap per meal + day      nutrition_meals.carbs
  no snacks                    meals logged per day
  alcohol                      nutrition_vices (vice_type alcohol)
  veg at lunch + dinner        a tap (food_plan_days) — cameras don't count fists
  weight                       apple_health_daily.weight_kg (scale)
  fiber                        NOT tracked — meals don't carry fiber. We say so.

Nothing here touches the Health Span score or the League: a plan you
log is not a sensor. Doctrine since 2026-08-25.

Restart: for the first 14 days the card shows the six restart rules as a
daily checklist, mostly auto-filled; on day 15 it switches to the full
targets. Sunday check-in: days-of-7 per habit, auto-tallied.
"""

from __future__ import annotations

import logging
import os
from datetime import date as _date, datetime, timedelta, timezone
from typing import Optional

log = logging.getLogger(__name__)


def _sb():
    from supabase import create_client
    url = os.getenv("SUPABASE_URL"); key = os.getenv("SUPABASE_SERVICE_KEY")
    if not (url and key):
        return None
    try:
        return create_client(url, key)
    except Exception:
        return None


# ── Default plan (David's reset, Oct 18 2026) ───────────────────────────

DEFAULT_PLAN = {
    "name": "Food Plan Reset",
    "started": None,                 # ISO date; restart = first 14 days
    "restart_days": 14,
    "window_hours": 10,
    "kitchen_close_hours_before_bed": 3,
    "meals_per_day": 3,
    "protein_floor_g": {"breakfast": 30, "lunch": 40, "dinner": 40},
    "protein_day_g": [110, 140],
    "carb_cap_meal_g": 25,
    "carb_cap_day_g": 75,
    "fiber_day_g": 30,               # displayed only — not tracked
    "veg_portions": {"lunch": 2, "dinner": 2},
    "alcohol_restart": 0,            # drinks/week during restart
    "alcohol_week_max": 3,           # after restart
    "water_liters": [2, 3],
    "restart_rules": [
        "Kitchen closes 3 hours before bed. Every night.",
        "Protein first at every meal — palm-sized or bigger.",
        "Half the plate is non-starchy vegetables at lunch and dinner.",
        "No bread, pasta, rice, chips or sweets. Berries are the only fruit.",
        "No snacks between meals. Hungry? The last meal needed more protein or fat.",
        "No alcohol for the two weeks.",
    ],
    "eating_out": {
        "default": "Order the protein, double the vegetables, skip the bread basket.",
        "steakhouse": "Steak or fish, two vegetable sides, salad. Skip potatoes.",
        "italian": "Grilled fish or chicken piccata, salad, roasted vegetables. Swap pasta for a side.",
        "mexican": "Fajitas without tortillas, or a burrito bowl with no rice and a small scoop of beans.",
        "japanese": "Sashimi, edamame, seaweed salad, miso. One roll is 40-60 g of carbs.",
        "burger": "Lettuce wrap or bunless, side salad.",
        "drinks": "After the restart, 2-3 a week: dry wine, tequila or vodka with soda. Count it as the meal's carbs.",
        "slip": "Go straight back at the next meal. No 'starting Monday'.",
    },
    "sunday_prep": "Hard-boil 8-10 eggs, grill 2 lb of chicken, wash salad greens, roast a sheet pan of vegetables.",
}


def get_plan(profile: Optional[dict]) -> Optional[dict]:
    p = (profile or {}).get("food_plan")
    if not p or not isinstance(p, dict):
        return None
    merged = dict(DEFAULT_PLAN)
    merged.update(p)
    return merged


def phase(plan: dict, today_iso: str) -> dict:
    """{'phase': 'restart'|'targets'|'not_started', 'day': n, 'restart_days': 14}"""
    started = plan.get("started")
    if not started:
        return {"phase": "not_started", "day": 0, "restart_days": plan.get("restart_days", 14)}
    try:
        d0 = _date.fromisoformat(str(started)[:10])
        today = _date.fromisoformat(today_iso[:10])
    except Exception:
        return {"phase": "not_started", "day": 0, "restart_days": plan.get("restart_days", 14)}
    day = (today - d0).days + 1
    rd = int(plan.get("restart_days", 14))
    if day < 1:
        return {"phase": "not_started", "day": 0, "restart_days": rd}
    return {"phase": "restart" if day <= rd else "targets", "day": day, "restart_days": rd}


# ── Data ────────────────────────────────────────────────────────────────

def _meals(sb, user_id: str, d0: str, d1: str) -> list[dict]:
    try:
        res = (sb.table("nutrition_meals").select("date, name, protein, carbs, meal_type, logged_at")
                 .eq("user_id", user_id).gte("date", d0).lte("date", d1).execute())
        return res.data or []
    except Exception:
        return []


def _alcohol(sb, user_id: str, d0: str, d1: str) -> dict[str, int]:
    """date -> drinks (count rows; amount parsed when numeric)."""
    out: dict[str, int] = {}
    try:
        res = (sb.table("nutrition_vices").select("date, vice_type, amount")
                 .eq("user_id", user_id).gte("date", d0).lte("date", d1).execute())
        for r in (res.data or []):
            if (r.get("vice_type") or "").lower() not in ("alcohol", "drink", "drinks", "wine", "beer", "liquor"):
                continue
            n = 1
            try:
                n = max(1, int(float(str(r.get("amount") or "1").split()[0])))
            except Exception:
                pass
            out[str(r["date"])[:10]] = out.get(str(r["date"])[:10], 0) + n
    except Exception:
        pass
    return out


def _bedtimes(user_id: str, d0: str, d1: str) -> dict[str, str]:
    """date (wake day) -> bedtime_start ISO (the night before)."""
    try:
        import oura_cache as oc
        _rm, _slm, _am, smm = oc.get_days(user_id, days=40)
        out = {}
        for d, s in (smm or {}).items():
            if d0 <= d <= d1 and isinstance(s, dict) and s.get("bedtime_start"):
                out[d] = s["bedtime_start"]
        return out
    except Exception:
        return {}


def _taps(sb, user_id: str, d0: str, d1: str) -> dict[str, dict]:
    try:
        res = (sb.table("food_plan_days").select("date, veg_lunch, veg_dinner, note")
                 .eq("user_id", user_id).gte("date", d0).lte("date", d1).execute())
        return {str(r["date"])[:10]: r for r in (res.data or [])}
    except Exception:
        return {}


def _weight_kg(user_id: str, as_of: str) -> Optional[float]:
    try:
        import apple_health as ah
        for r in ah.get_data(user_id, days=14, end_date=as_of):
            if r.get("weight_kg") is not None:
                return float(r["weight_kg"])
    except Exception:
        pass
    return None


def _local_dt(iso: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except Exception:
        return None


def _display_tz(bedtime_iso: Optional[str]):
    """Meal timestamps are stored in UTC; show them in the user's zone.
    Oura's bedtime_start carries the user's real offset — borrow it.
    Fallback: Pacific (the foursome's home zone) until profiles carry tz."""
    bt = _local_dt(bedtime_iso) if bedtime_iso else None
    if bt and bt.tzinfo:
        return bt.tzinfo
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/Los_Angeles")
    except Exception:
        return timezone.utc


# ── Daily status ────────────────────────────────────────────────────────

def _day_status(plan: dict, d: str, meals: list[dict], bedtime_next: Optional[str],
                drinks: int, tap: Optional[dict], ph: dict) -> dict:
    """One day's rule-by-rule read. Each rule: {ok: bool|None, detail: str}.
    None = can't tell (nothing logged) — shown grey, never guessed."""
    meals = sorted([m for m in meals if m.get("logged_at")], key=lambda m: m["logged_at"])
    n_meals = len(meals)
    rules: dict[str, dict] = {}

    # Window + kitchen close
    tz = _display_tz(bedtime_next)
    first = _local_dt(meals[0]["logged_at"]).astimezone(tz) if meals and _local_dt(meals[0]["logged_at"]) else None
    last  = _local_dt(meals[-1]["logged_at"]).astimezone(tz) if meals and _local_dt(meals[-1]["logged_at"]) else None
    if first and last:
        hrs = (last - first).total_seconds() / 3600
        rules["window"] = {"ok": hrs <= plan["window_hours"] + 0.25,
                           "detail": f"{hrs:.1f} h ({first.strftime('%-I:%M%p').lower()}–{last.strftime('%-I:%M%p').lower()})"}
    else:
        rules["window"] = {"ok": None, "detail": "log meals to measure"}

    bt = _local_dt(bedtime_next).astimezone(tz) if bedtime_next and _local_dt(bedtime_next) else None
    if last and bt:
        gap = (bt - last).total_seconds() / 3600
        rules["kitchen_closed"] = {"ok": gap >= plan["kitchen_close_hours_before_bed"] - 0.1,
                                   "detail": f"last bite {gap:.1f} h before bed ({bt.strftime('%-I:%M%p').lower()})"}
    elif last:
        rules["kitchen_closed"] = {"ok": None, "detail": "waiting on bedtime from your ring"}
    else:
        rules["kitchen_closed"] = {"ok": None, "detail": "log dinner to measure"}

    # Meals / snacks
    if n_meals:
        rules["no_snacks"] = {"ok": n_meals <= plan["meals_per_day"], "detail": f"{n_meals} eating occasion{'s' if n_meals != 1 else ''} logged"}
    else:
        rules["no_snacks"] = {"ok": None, "detail": "nothing logged yet"}

    # Protein per meal + carbs per meal
    floors = plan["protein_floor_g"]
    per_meal = []
    protein_ok = True; carb_ok = True; any_macro = False
    for m in meals:
        mt = (m.get("meal_type") or "").lower()
        slot = "breakfast" if "break" in mt else "lunch" if "lunch" in mt else "dinner" if "dinner" in mt else None
        p = m.get("protein"); c = m.get("carbs")
        if p is None and c is None:
            continue
        any_macro = True
        floor = floors.get(slot or "lunch", 40)
        p_ok = (p is not None and float(p) >= floor * 0.9)
        c_ok = (c is None) or float(c) <= plan["carb_cap_meal_g"] + 3
        protein_ok &= p_ok; carb_ok &= c_ok
        per_meal.append({"slot": slot or mt or "meal", "name": m.get("name"), "protein": p, "carbs": c,
                         "protein_floor": floor, "carb_cap": plan["carb_cap_meal_g"], "protein_ok": p_ok, "carb_ok": c_ok})
    if any_macro:
        tot_p = sum(float(m.get("protein") or 0) for m in meals)
        tot_c = sum(float(m.get("carbs") or 0) for m in meals)
        rules["protein_first"] = {"ok": protein_ok and n_meals >= 1, "detail": f"{tot_p:.0f} g today · floors {floors['breakfast']}/{floors['lunch']}/{floors['dinner']}"}
        rules["carbs_capped"]  = {"ok": carb_ok and tot_c <= plan["carb_cap_day_g"] + 5, "detail": f"{tot_c:.0f} g today · cap {plan['carb_cap_meal_g']}/meal, {plan['carb_cap_day_g']}/day"}
    else:
        rules["protein_first"] = {"ok": None, "detail": "log meals to measure"}
        rules["carbs_capped"]  = {"ok": None, "detail": "log meals to measure"}

    # Veg (tap)
    vl = (tap or {}).get("veg_lunch"); vd = (tap or {}).get("veg_dinner")
    if vl is None and vd is None:
        rules["veg"] = {"ok": None, "detail": "tap when you've had your two fists"}
    else:
        rules["veg"] = {"ok": bool(vl) and bool(vd), "detail": f"lunch {'✓' if vl else '—'} · dinner {'✓' if vd else '—'}"}

    # Alcohol
    if ph["phase"] == "restart":
        rules["alcohol"] = {"ok": drinks == 0, "detail": "none during the restart" if drinks == 0 else f"{drinks} logged — restart says none"}
    else:
        rules["alcohol"] = {"ok": True if drinks == 0 else None, "detail": f"{drinks} today" if drinks else "none today"}

    kept = sum(1 for r in rules.values() if r["ok"] is True)
    measured = sum(1 for r in rules.values() if r["ok"] is not None)
    return {"date": d, "rules": rules, "meals": per_meal, "kept": kept, "measured": measured, "drinks": drinks}


def today(user_id: str, profile: dict, today_iso: str) -> Optional[dict]:
    plan = get_plan(profile)
    if not plan:
        return None
    sb = _sb()
    if not sb:
        return None
    ph = phase(plan, today_iso)
    d_today = _date.fromisoformat(today_iso[:10])
    d0 = (d_today - timedelta(days=7)).isoformat()
    d1 = (d_today + timedelta(days=1)).isoformat()  # bedtime for tonight lands on tomorrow's row
    meals = _meals(sb, user_id, d0, today_iso)
    drinks = _alcohol(sb, user_id, d0, today_iso)
    beds = _bedtimes(user_id, d0, d1)
    taps = _taps(sb, user_id, d0, today_iso)

    by_day: dict[str, list[dict]] = {}
    for m in meals:
        by_day.setdefault(str(m["date"])[:10], []).append(m)

    def _bed_after(d: str) -> Optional[str]:
        nxt = (_date.fromisoformat(d) + timedelta(days=1)).isoformat()
        return beds.get(nxt)

    today_status = _day_status(plan, today_iso, by_day.get(today_iso, []), _bed_after(today_iso),
                               drinks.get(today_iso, 0), taps.get(today_iso), ph)

    # 7-day tally (Sunday check-in, auto)
    week: dict[str, dict] = {"window": {"kept": 0, "of": 0}, "kitchen_closed": {"kept": 0, "of": 0},
                             "protein_first": {"kept": 0, "of": 0}, "veg": {"kept": 0, "of": 0},
                             "no_snacks": {"kept": 0, "of": 0}}
    drinks_week = 0
    for i in range(1, 8):
        d = (d_today - timedelta(days=i)).isoformat()
        st = _day_status(plan, d, by_day.get(d, []), _bed_after(d), drinks.get(d, 0), taps.get(d), ph)
        drinks_week += drinks.get(d, 0)
        for k in week:
            r = st["rules"].get(k) or {}
            if r.get("ok") is not None:
                week[k]["of"] += 1
                if r["ok"]:
                    week[k]["kept"] += 1

    weight = _weight_kg(user_id, today_iso)
    return {
        "plan": {k: plan[k] for k in ("name", "started", "restart_days", "window_hours",
                                      "kitchen_close_hours_before_bed", "meals_per_day", "protein_floor_g",
                                      "protein_day_g", "carb_cap_meal_g", "carb_cap_day_g", "fiber_day_g",
                                      "veg_portions", "alcohol_week_max", "water_liters", "restart_rules",
                                      "eating_out", "sunday_prep")},
        "phase": ph,
        "today": today_status,
        "week": week,
        "drinks_week": drinks_week,
        "weight_lb": round(weight * 2.20462, 1) if weight else None,
        "not_tracked": ["fiber"],
    }


def set_tap(user_id: str, date_iso: str, veg_lunch: Optional[bool], veg_dinner: Optional[bool], note: Optional[str]) -> bool:
    sb = _sb()
    if not sb:
        return False
    row = {"user_id": user_id, "date": date_iso[:10], "updated_at": datetime.now(timezone.utc).isoformat()}
    if veg_lunch is not None: row["veg_lunch"] = veg_lunch
    if veg_dinner is not None: row["veg_dinner"] = veg_dinner
    if note is not None: row["note"] = note
    try:
        sb.table("food_plan_days").upsert(row, on_conflict="user_id,date").execute()
        return True
    except Exception:
        log.exception("food_plan tap failed")
        return False


# ── Coach Al context ────────────────────────────────────────────────────

def context_block(user_id: str, profile: dict, today_iso: str) -> str:
    try:
        t = today(user_id, profile, today_iso)
    except Exception:
        return ""
    if not t:
        return ""
    ph = t["phase"]; p = t["plan"]; ts = t["today"]
    lines = [f"\n=== FOOD PLAN — {p['name']} ==="]
    if ph["phase"] == "restart":
        lines.append(f"Two-week restart, day {ph['day']} of {ph['restart_days']}. Six rules, no counting yet: " +
                     " ".join(f"({i+1}) {r}" for i, r in enumerate(p["restart_rules"])))
    elif ph["phase"] == "targets":
        lines.append(f"Day {ph['day']}, full targets: protein {p['protein_floor_g']['breakfast']}/{p['protein_floor_g']['lunch']}/{p['protein_floor_g']['dinner']} g per meal "
                     f"({p['protein_day_g'][0]}–{p['protein_day_g'][1]} g/day), carbs under {p['carb_cap_meal_g']} g/meal and {p['carb_cap_day_g']}/day, "
                     f"{p['window_hours']}-hour window, kitchen closed {p['kitchen_close_hours_before_bed']} h before bed, 2 fists of veg at lunch and dinner, "
                     f"≤{p['alcohol_week_max']} drinks/week.")
    else:
        lines.append("Plan set but not started yet.")
    measured = [(k, r) for k, r in ts["rules"].items() if r["ok"] is not None]
    if measured:
        lines.append("Today so far: " + "; ".join(f"{k.replace('_', ' ')} {'kept' if r['ok'] else 'missed'} ({r['detail']})" for k, r in measured))
    else:
        lines.append("Today: no meals logged yet — do not assume anything about what he ate.")
    wk = t["week"]
    lines.append("Last 7 days: " + ", ".join(f"{k.replace('_', ' ')} {v['kept']}/{v['of']}" for k, v in wk.items() if v["of"]) +
                 (f"; drinks {t['drinks_week']}" if t.get("drinks_week") else ""))
    lines.append("Rules for you: the plan is the user's own (from his nutritionist); support it, don't re-litigate it. "
                 "Cite only the measured facts above — never invent a meal. Kitchen-closed is checked against his real Oura bedtime; "
                 "that is the one rule no other app can see. Fiber is not tracked — if asked, say so and point to flax and vegetables. "
                 "If he asks what to order out, use the eating-out playbook: " + p["eating_out"]["default"])
    return "\n".join(lines)
