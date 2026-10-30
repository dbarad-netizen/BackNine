"""
Week pace — "where does this week land if I keep going like this?"

David 2026-10-30, after Oura's weekly Cardio Effort card: a week should
read like a bank account, not seven pass/fail days. A bad Tuesday is a
withdrawal you can cover by Saturday. BackNine already plays a Mon–Sun
week against par (leagues.py); this module adds the path and the pacing.

The Sunday Health Span score is a rolling 7-day score, so on Sunday it is
exactly this week's seven days. That makes the projection honest:

  * sleep hours   — avg of the nights played so far; the rest of the week
                    at the same avg leaves it unchanged
  * steps         — avg of the COMPLETE days so far (today is partial)
  * active days   — count so far + the same rate over the days left
  * sleep timing  — a two-week std dev; held at its current band

Projected score = the same band functions healthspan.py uses, on the
projected values, over the same bands the user is scored on today.
Everything the reader sees — the projection, the net, the one sentence,
the "what it takes" numbers — is computed here. The copy never does math.

Par is the only target. Oura draws a separate "maintenance range"; ours
is par — your own best recent month — so there is one line, not two.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import healthspan as hs
import leagues as lg

DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _oura_daily(user_id: str) -> tuple[dict, dict, bool]:
    """{date: {steps, active_cal}}, {date: sleep_hours}, has_oura."""
    try:
        import oura_cache as oc
        _rm, _slm, am, smm = oc.get_days(user_id, days=14)
    except Exception:
        return {}, {}, False
    act = {d: {"steps": (v or {}).get("steps"), "active_cal": (v or {}).get("active_cal")}
           for d, v in (am or {}).items()}
    slp = {d: (v or {}).get("total", 0) / 3600 for d, v in (smm or {}).items() if (v or {}).get("total")}
    return act, slp, bool(am or smm)


def _ah_daily(user_id: str, end_iso: str) -> tuple[dict, dict]:
    try:
        import apple_health as ah
        rows = ah.get_data(user_id, days=14, end_date=end_iso) or []
    except Exception:
        return {}, {}
    act, slp = {}, {}
    for r in rows:
        d = str(r.get("date"))[:10]
        act[d] = {"steps": r.get("steps"), "active_cal": r.get("active_calories")}
        if r.get("sleep_hours"):
            slp[d] = float(r["sleep_hours"])
    return act, slp


def _workout_days(user_id: str, lo: str, hi: str) -> set:
    sb = hs._sb()
    if not sb:
        return set()
    try:
        res = (sb.table("training_workouts").select("date, source, duration_min")
                 .eq("user_id", user_id).gte("date", lo).lte("date", hi).execute())
        # Same rule as healthspan._load_active_days: device-detected rows need 30+ min.
        return {str(r.get("date"))[:10] for r in (res.data or [])
                if not (r.get("source") in ("oura", "apple_health") and (r.get("duration_min") or 0) < 30)}
    except Exception:
        return set()


def _snapshots(user_id: str, lo: str, hi: str) -> dict[str, dict]:
    sb = hs._sb()
    if not sb:
        return {}
    try:
        res = (sb.table("weekly_healthspan_history")
                 .select("date, score, components")
                 .eq("user_id", user_id).gte("date", lo).lte("date", hi).execute())
        return {str(r["date"])[:10]: r for r in (res.data or [])}
    except Exception:
        return {}


def _fmt_h(h: float) -> str:
    return f"{h:.1f} h"


def compute(user_id: str, today_iso: str) -> dict:
    today = date.fromisoformat(today_iso)
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    week = [(monday + timedelta(days=i)).isoformat() for i in range(7)]

    # ── Par (same function the League uses) ─────────────────────────────
    sb = lg._sb()
    par_info = (lg.compute_par(sb, [user_id], monday.isoformat()) or {}).get(user_id) or {}
    par = par_info.get("par")

    # ── Daily snapshots this week → the path ────────────────────────────
    snaps = _snapshots(user_id, monday.isoformat(), today_iso)
    days = []
    for i, d in enumerate(week):
        s = snaps.get(d)
        days.append({
            "date": d, "dow": DOW[i],
            "score": int(s["score"]) if s and s.get("score") is not None else None,
            "played": d <= today_iso,
        })
    latest = next((x["score"] for x in reversed(days) if x["score"] is not None), None)
    latest_comp = (snaps.get(max(snaps)) or {}).get("components") if snaps else None
    latest_comp = latest_comp or {}

    # ── Raw days this week (Oura first, Apple Health fallback) ──────────
    o_act, o_slp, has_oura = _oura_daily(user_id)
    a_act, a_slp = _ah_daily(user_id, today_iso)
    act_src = o_act if has_oura and any(d in o_act for d in week) else a_act
    slp_src = o_slp if has_oura and any(d in o_slp for d in week) else a_slp

    complete_days = [d for d in week if d < today_iso]          # steps/active: full days only
    nights = [d for d in week if d <= today_iso]                # sleep: last night is done
    steps_days_left = 7 - len(complete_days)                    # today..Sunday
    nights_left = 7 - len(nights)                               # tonight..Saturday night

    steps_vals = [float(act_src[d]["steps"]) for d in complete_days
                  if act_src.get(d) and act_src[d].get("steps") is not None]
    sleep_vals = [float(slp_src[d]) for d in nights if slp_src.get(d)]

    workouts = _workout_days(user_id, monday.isoformat(), today_iso)
    have_cal = any(act_src.get(d, {}).get("active_cal") is not None for d in complete_days)
    active_so_far = 0
    for d in complete_days:
        cal = (act_src.get(d) or {}).get("active_cal")
        st = (act_src.get(d) or {}).get("steps")
        if (cal is not None and float(cal) >= hs.ACTIVE_DAY_KCAL) or d in workouts \
           or (not have_cal and st is not None and int(st) >= hs.ACTIVE_DAY_STEPS_PHONE_ONLY):
            active_so_far += 1

    # ── Projection: same pace the rest of the way ───────────────────────
    sleep_avg = round(sum(sleep_vals) / len(sleep_vals), 2) if sleep_vals else None
    steps_avg = round(sum(steps_vals) / len(steps_vals)) if steps_vals else None
    n_cd = len(complete_days)
    active_proj = None
    if n_cd > 0:
        active_proj = min(7, int(round(active_so_far + steps_days_left * (active_so_far / n_cd))))

    # Sleep timing: two-week std dev, held at its current band.
    timing_pts = (latest_comp.get("sleep_consistency") or {}).get("points")

    bands = {}
    pts, mx = 0, 0
    c = hs._score_sleep_hours(sleep_avg) if sleep_avg is not None else None
    if c and ("sleep_hours" in latest_comp or not latest_comp):
        bands["sleep_hours"] = c; pts += c["points"]; mx += c["max"]
    if timing_pts is not None:
        pts += timing_pts; mx += 10
        bands["sleep_consistency"] = {"points": timing_pts, "max": 10}
    c = hs._score_steps(steps_avg) if steps_avg is not None else None
    if c and ("steps" in latest_comp or not latest_comp):
        bands["steps"] = c; pts += c["points"]; mx += c["max"]
    c = hs._score_active_days(active_proj) if active_proj is not None else None
    if c and ("active_days" in latest_comp or not latest_comp):
        bands["active_days"] = c; pts += c["points"]; mx += c["max"]
    projected = int(round(100 * pts / mx)) if mx > 0 else None
    projected_net = (projected - par) if (projected is not None and par is not None) else None

    # ── What it takes: per band, the number for the days left ───────────
    levers: list[dict] = []
    if sleep_avg is not None and nights_left > 0 and "sleep_hours" in bands:
        need = (7.0 * 7 - sum(sleep_vals)) / nights_left if len(sleep_vals) == len(nights) else None
        gain = 15 - bands["sleep_hours"]["points"]
        if need is not None and gain > 0 and need <= 9.5:
            levers.append({"key": "sleep_hours", "gain": gain,
                           "text": f"{_fmt_h(need)} a night the rest of the way gets sleep to 7 h"})
    if steps_avg is not None and steps_days_left > 0 and "steps" in bands:
        need = (7500 * 7 - sum(steps_vals)) / steps_days_left if len(steps_vals) == n_cd else None
        gain = 10 - bands["steps"]["points"]
        if need is not None and gain > 0 and need <= 15000:
            levers.append({"key": "steps", "gain": gain,
                           "text": f"{int(round(need, -2)):,} steps a day the rest of the way gets you to a 7,500 average"})
    if active_proj is not None and steps_days_left > 0 and "active_days" in bands:
        for target, points in ((5, 15), (4, 12), (3, 9)):
            more = target - active_so_far
            if 0 < more <= steps_days_left and points > bands["active_days"]["points"]:
                word = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five"}.get(more, str(more))
                levers.append({"key": "active_days", "gain": points - bands["active_days"]["points"],
                               "text": f"{word} more active day{'s' if more > 1 else ''} by Sunday is worth {points - bands['active_days']['points']} more points"})
                break
    levers.sort(key=lambda l: -l["gain"])
    lever = levers[0]["text"] if levers else None

    # ── The sentence (coffee-shop words, numbers precomputed) ───────────
    dl = steps_days_left
    day_word = "day" if dl == 1 else "days"
    if n_cd == 0 and not sleep_vals:
        sentence = "Fresh card. The first full day lands tomorrow."
    elif par is None:
        sentence = (f"On pace for about {projected}. No par yet — a few more days of history and you'll play net."
                    if projected is not None else "Not enough of this week scored yet.")
    elif projected is None:
        sentence = "Not enough of this week scored yet."
    elif projected_net >= 2:
        sentence = f"On pace for about {projected}, {projected_net} over par with {dl} {day_word} left."
    elif projected_net >= -1:
        sentence = f"On pace for about {projected}, right at par. {dl} {day_word} to pick up a stroke."
    else:
        sentence = f"On pace for about {projected}, {abs(projected_net)} under par with {dl} {day_word} left."
    if lever and (projected_net is None or projected_net < 2):
        sentence += f" {lever}."

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "today": today_iso,
        "days": days,
        "latest": latest,
        "par": par,
        "par_provisional": bool(par_info.get("provisional", True)) if par is not None else None,
        "projected": projected,
        "projected_net": projected_net,
        "days_left": dl,
        "sentence": sentence,
        "lever": lever,
        "so_far": {
            "sleep_hours":  {"value": sleep_avg, "nights": len(sleep_vals), "label": _fmt_h(sleep_avg) if sleep_avg is not None else "—", "target": "7–9 h"},
            "steps":        {"value": steps_avg, "days": len(steps_vals), "label": f"{steps_avg:,}" if steps_avg is not None else "—", "target": "7,500"},
            "active_days":  {"value": active_so_far if n_cd else None, "days": n_cd, "label": f"{active_so_far} of {n_cd}" if n_cd else "—", "target": "5 of 7"},
        },
        "bands": {k: {"points": v["points"], "max": v["max"]} for k, v in bands.items()},
    }
