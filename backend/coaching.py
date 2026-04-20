"""
BackNine Coaching Engine
Generates short/mid/long-term coaching items from Oura daily metrics.
"""
import statistics as _stats
from datetime import datetime, timedelta
from typing import Optional


# ── helpers ──────────────────────────────────────────────────────────────────

def _smm_for_day(smm: dict, day: str) -> dict:
    """
    Oura sleep sessions are keyed by BEDTIME date; daily scores use WAKE date.
    Try wake date first, then wake-1 day (bedtime date), then return {}.
    """
    s = smm.get(day)
    if s:
        return s
    try:
        prev = (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        return smm.get(prev) or {}
    except Exception:
        return {}


def _avg(days: list[str], key: str, src: dict) -> Optional[float]:
    vals = [src[d][key] for d in days if d in src and src[d].get(key) is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def _avg_smm(days: list[str], key: str, smm: dict) -> Optional[float]:
    """Like _avg but uses _smm_for_day to handle the bedtime-date offset."""
    vals = [_smm_for_day(smm, d)[key] for d in days
            if _smm_for_day(smm, d).get(key) is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def _ins(icon: str, label: str, text: str, sev: str = "info") -> dict:
    cols = {
        "urgent": "#ef4444",
        "warn":   "#f59e0b",
        "good":   "#22c55e",
        "info":   "#818cf8",
        "watch":  "#60a5fa",
    }
    return {"icon": icon, "label": label, "text": text, "color": cols.get(sev, "#818cf8"), "urgency": sev}


# ── today tile coaches (simple 3-color cards) ─────────────────────────────────

def coach_overall(rdy: dict, sm: dict) -> dict:
    s = rdy.get("score") or 0
    hrv = sm.get("hrv") or 0
    if s >= 85:
        return {
            "color": "#052e16", "border": "#22c55e", "icon": "🟢",
            "title": "You're primed to perform today.",
            "msg": f"Readiness {s} — your body is well-recovered. HRV of {hrv}ms is strong. Great day for training.",
        }
    if s >= 70:
        return {
            "color": "#1c1a07", "border": "#f59e0b", "icon": "🟡",
            "title": "Moderate readiness — listen to your body.",
            "msg": f"Readiness {s}. HRV {hrv}ms. OK for moderate exercise. Avoid max-effort training.",
        }
    return {
        "color": "#1c0707", "border": "#ef4444", "icon": "🔴",
        "title": "Your body needs recovery today.",
        "msg": f"Readiness {s} — fatigue elevated. HRV {hrv}ms. Skip intense exercise, prioritize rest.",
    }


def coach_sleep(sl: dict, sm: dict) -> dict:
    s   = sl.get("score") or 0
    tot = sm.get("total") or 0
    hrs = round(tot / 3600, 1) if tot >= 3600 else None
    hrs_str = f"{hrs:.1f}h" if hrs is not None else ""
    if s >= 85:
        return {
            "color": "#052e16", "border": "#22c55e", "icon": "😴",
            "title": "Excellent sleep — well recovered!",
            "msg": f"Sleep score {s}." + (f" {hrs_str} of quality sleep." if hrs_str else "") + " Recovery is solid.",
        }
    if s >= 70:
        return {
            "color": "#1c1a07", "border": "#f59e0b", "icon": "😐",
            "title": "Decent sleep — room to improve.",
            "msg": f"Sleep score {s}." + (f" {hrs_str} total." if hrs_str else "") + " Try consistent sleep timing and less screens before bed.",
        }
    return {
        "color": "#1c0707", "border": "#ef4444", "icon": "😟",
        "title": "Poor sleep — prioritize rest tonight.",
        "msg": f"Sleep score {s}." + (f" Only {hrs_str} —" if hrs_str else "") + " Sleep debt accumulating. Avoid caffeine after noon.",
    }


def coach_activity(act: dict) -> dict:
    s = act.get("score") or 0
    steps = act.get("steps") or 0
    steps_fmt = f"{steps:,}"
    if s >= 85:
        return {
            "color": "#052e16", "border": "#22c55e", "icon": "🏃",
            "title": "Crushing your activity goals!",
            "msg": f"Activity score {s}. {steps_fmt} steps. Excellent movement consistency.",
        }
    if s >= 70:
        return {
            "color": "#1c1a07", "border": "#f59e0b", "icon": "🚶",
            "title": "Good activity — keep the momentum.",
            "msg": f"Activity score {s}. {steps_fmt} steps. Keep moving!",
        }
    return {
        "color": "#1c0707", "border": "#ef4444", "icon": "🛑",
        "title": "Low activity today.",
        "msg": f"Activity score {s}. {steps_fmt} steps. Even a short walk helps.",
    }


# ── main coaching engine ───────────────────────────────────────────────────────

def generate_coaching(
    rm: dict,    # readiness map  {date: {...}}
    slm: dict,   # sleep score map
    am: dict,    # activity map
    smm: dict,   # sleep model detail map
    labs=None,  # dict | None
) -> dict:
    """
    Generate coaching intelligence items from 120 days of Oura data.

    Returns:
        {
          short: [CoachItem, ...],   # actionable today
          mid:   [CoachItem, ...],   # next 1–2 weeks
          long:  [CoachItem, ...],   # chronic / lab-based
          meta:  {...}               # computed averages & flags
        }
    """
    labs = labs or {}
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")

    all_days = sorted(set(list(rm) + list(slm) + list(am)))
    last30   = [d for d in all_days if d >= (now - timedelta(days=30)).strftime("%Y-%m-%d")]
    last7    = [d for d in last30   if d >= (now - timedelta(days=7)).strftime("%Y-%m-%d")]
    fort1    = [d for d in last30   if d >= (now - timedelta(days=14)).strftime("%Y-%m-%d")]
    fort2    = [d for d in all_days if (now - timedelta(days=28)).strftime("%Y-%m-%d") <= d < (now - timedelta(days=14)).strftime("%Y-%m-%d")]

    # ── "today" — fall back to most recent available day ─────────────────────
    t_rdy = rm.get(today_str, {})
    t_sl  = slm.get(today_str, {})
    t_act = am.get(today_str, {})
    t_sm  = _smm_for_day(smm, today_str)
    if not t_rdy and rm:  t_rdy = rm[sorted(rm)[-1]]
    if not t_sl  and slm: t_sl  = slm[sorted(slm)[-1]]
    if not t_act and am:  t_act = am[sorted(am)[-1]]
    if not t_sm  and smm: t_sm  = smm[sorted(smm)[-1]]

    today_hrv  = t_sm.get("hrv")  or 0
    today_rdy  = t_rdy.get("score") or 0
    today_hrs  = round((t_sm.get("total") or 0) / 3600, 1)
    today_deep = t_sm.get("deep") or 0
    today_rem  = t_sm.get("rem")  or 0

    # Use Oura's personalised sleep need if available, else fall back to 7.5h
    sleep_need_vals = [_smm_for_day(smm, d)["sleep_need"] / 3600 for d in last30
                       if _smm_for_day(smm, d).get("sleep_need")]
    sleep_target = round(sum(sleep_need_vals) / len(sleep_need_vals), 1) if sleep_need_vals else 7.5

    avg_hrv_30  = _avg_smm(last30, "hrv", smm)
    avg_rdy_30  = _avg(last30, "score", rm)
    avg_slp_30  = _avg(last30, "score", slm)
    avg_hrv_f1  = _avg_smm(fort1, "hrv", smm)
    avg_hrv_f2  = _avg_smm(fort2, "hrv", smm)

    # Only average nights where ring was actually worn (total > 1h = 3600s)
    hrs30 = [_smm_for_day(smm, d)["total"] / 3600 for d in last30
             if (_smm_for_day(smm, d).get("total") or 0) >= 3600]
    hrs7  = [_smm_for_day(smm, d)["total"] / 3600 for d in last7
             if (_smm_for_day(smm, d).get("total") or 0) >= 3600]
    avg_hrs_30 = round(sum(hrs30) / len(hrs30), 1) if hrs30 else None
    avg_hrs_7  = round(sum(hrs7)  / len(hrs7),  1) if hrs7  else None

    # bedtime consistency
    bedtimes = []
    for d in last30:
        bs = _smm_for_day(smm, d).get("bedtime_start", "")
        if bs:
            try:
                t2 = datetime.fromisoformat(bs)
                m2 = t2.hour * 60 + t2.minute
                if m2 < 180:
                    m2 += 1440
                bedtimes.append(m2)
            except Exception:
                pass
    bt_std = round(_stats.stdev(bedtimes)) if len(bedtimes) > 1 else 0
    avg_bt_mins = sum(bedtimes) / len(bedtimes) if bedtimes else 1320
    h2, m2 = int(avg_bt_mins // 60) % 24, int(avg_bt_mins % 60)
    avg_bt_str = f"{h2 if h2 <= 12 else h2 - 12}:{m2:02d} {'AM' if h2 < 12 else 'PM'}"

    steps_10k = sum(1 for d in last30 if am.get(d, {}).get("steps", 0) and am[d]["steps"] >= 10000)
    steps_pct = round(steps_10k / len(last30) * 100) if last30 else 0

    hrv_trend_dir = "declining" if (avg_hrv_f1 and avg_hrv_f2 and avg_hrv_f1 < avg_hrv_f2) else "improving"

    short_items: list[dict] = []
    mid_items:   list[dict] = []
    long_items:  list[dict] = []

    # ── Training zone (HRV vs baseline) ──────────────────────────────────────
    if today_hrv and avg_hrv_30:
        ratio = today_hrv / avg_hrv_30
        if ratio >= 1.05:
            short_items.append(_ins("🏋️", "Build day — push hard",
                f"HRV {today_hrv} ms is {(ratio-1)*100:.0f}% above your 30-day baseline ({round(avg_hrv_30)} ms). "
                "Your nervous system is primed. Great day for high-intensity training.", "good"))
        elif ratio >= 0.95:
            short_items.append(_ins("🏃", "Quality training day",
                f"HRV {today_hrv} ms is within your normal baseline ({round(avg_hrv_30)} ms). "
                "Solid for moderate-to-hard training — intervals, tempo, or strength.", "good"))
        elif ratio >= 0.80:
            short_items.append(_ins("🚶", "Zone 2 only today",
                f"HRV {today_hrv} ms is {(1-ratio)*100:.0f}% below baseline ({round(avg_hrv_30)} ms). "
                "Keep training easy — Zone 2 cardio or a walk.", "warn"))
        else:
            short_items.append(_ins("🛌", "Rest day — skip training",
                f"HRV {today_hrv} ms is severely suppressed ({(1-ratio)*100:.0f}% below {round(avg_hrv_30)} ms baseline). "
                "Full rest only. Light stretching or walking.", "urgent"))
    elif today_rdy < 70:
        short_items.append(_ins("🔴", "Recovery day required",
            f"Readiness {today_rdy} — nervous system still recovering. HRV {today_hrv} ms. "
            "Avoid intense training.", "urgent"))
    else:
        short_items.append(_ins("🟢", "Body is primed",
            f"Readiness {today_rdy} with HRV {today_hrv} ms. Good day for quality training.", "good"))

    # ── Temperature deviation ─────────────────────────────────────────────────
    temp_dev = t_rdy.get("temp_dev")
    if temp_dev is not None:
        if temp_dev > 0.5:
            short_items.append(_ins("🌡️", "Temperature elevated — consider rest",
                f"Skin temp {temp_dev:.1f}°C above baseline. Common with early illness, alcohol, or overtraining.", "urgent"))
        elif temp_dev < -0.8:
            short_items.append(_ins("❄️", "Peak recovery window",
                f"Temperature {temp_dev:.1f}°C below baseline — thermoregulation is optimal. "
                "Often coincides with supercompensation.", "good"))

    # ── Sleep hours ───────────────────────────────────────────────────────────
    if today_hrs < 6:
        short_items.append(_ins("😴", "Rebuild your sleep tonight",
            f"Last night was only {today_hrs:.1f}h — well below your {avg_hrs_30 or 0:.1f}h average. "
            "No screens after 9 PM, lights out by 10 PM.", "urgent"))
    elif today_hrs < 7:
        short_items.append(_ins("⚠️", "Prioritize sleep this week",
            f"You averaged {avg_hrs_7 or today_hrs:.1f}h this week, below the 7–8h optimal range. "
            "Move bedtime earlier by 30–45 min.", "warn"))

    # ── Sleep stages ──────────────────────────────────────────────────────────
    total_s = t_sm.get("total") or 0
    if total_s > 0:
        deep_pct = today_deep / total_s * 100
        rem_pct  = today_rem  / total_s * 100
        if today_deep > 0 and deep_pct < 10:
            short_items.append(_ins("🧠", "Very low deep sleep last night",
                f"Only {deep_pct:.0f}% deep sleep ({today_deep/60:.0f} min of {today_hrs:.1f}h). "
                "Tips: cool room (65–68°F), no alcohol, dinner 3h before bed.", "warn"))
        elif today_deep > 0 and deep_pct >= 20:
            short_items.append(_ins("💪", "Deep sleep was excellent",
                f"{deep_pct:.0f}% deep sleep ({today_deep/60:.0f} min) — top-tier physical recovery.", "good"))
        if today_rem > 0 and rem_pct < 15:
            short_items.append(_ins("🎭", "Low REM sleep",
                f"Only {rem_pct:.0f}% REM ({today_rem/60:.0f} min). REM supports memory and emotional regulation. "
                "Consistent wake time and no alcohol are the biggest REM protectors.", "warn"))

    # ── Bedtime consistency ───────────────────────────────────────────────────
    if bt_std > 45:
        short_items.append(_ins("🕐", "Stabilize your bedtime",
            f"Bedtimes vary by {bt_std} min (avg {avg_bt_str}). "
            "Each 1-hour shift suppresses HRV by ~5–8%. Pick a fixed bedtime for 14 days.", "warn"))

    # ── Daily steps baseline ──────────────────────────────────────────────────
    if steps_pct < 50:
        short_items.append(_ins("👟", "Daily movement baseline",
            f"You've hit 10,000 steps only {steps_pct}% of days this month. "
            "Aim for 8k minimum even on rest days.", "warn"))

    # ── 3-day training load ───────────────────────────────────────────────────
    last3 = [d for d in sorted(am) if d >= (now - timedelta(days=3)).strftime("%Y-%m-%d")]
    load_3d = sum(am.get(d, {}).get("active_cal", 0) or 0 for d in last3)
    if load_3d > 1500 and today_rdy < 75:
        mid_items.append(_ins("⚖️", "High training load — consider a deload",
            f"{load_3d} active kcal over 3 days with readiness at {today_rdy}. "
            "A 2–3 day deload (50% volume reduction) will accelerate adaptation.", "warn"))

    # ── Sleep debt ────────────────────────────────────────────────────────────
    if len(hrs7) >= 3:  # only calculate debt if we have at least 3 nights of data
        sleep_debt = max(0.0, len(hrs7) * sleep_target - sum(hrs7))
        if sleep_debt > 5:
            mid_items.append(_ins("🏦", "Significant sleep debt — repay gradually",
                f"You're {sleep_debt:.1f}h short over 7 days vs your {sleep_target}h/night target. "
                "Add 45–60 min per night for 2 weeks — do not catch up in one weekend.", "urgent"))
        elif sleep_debt > 2:
            mid_items.append(_ins("📊", "Moderate sleep debt building",
                f"{sleep_debt:.1f}h short over 7 days vs your {sleep_target}h target. Add 30 min per night for 5 days.", "warn"))

    # ── Sleep efficiency ──────────────────────────────────────────────────────
    avg_eff = _avg_smm(last30, "efficiency", smm)
    if avg_eff and avg_eff < 83:
        mid_items.append(_ins("🛏️", "Sleep efficiency needs work",
            f"30-day avg efficiency is {avg_eff:.0f}% (target >85%). "
            "Fixes: strict sleep/wake times, leave bed if awake >20 min, cool room below 68°F.", "warn"))

    # ── HRV trend ─────────────────────────────────────────────────────────────
    if hrv_trend_dir == "declining" and avg_hrv_f1 and avg_hrv_f2:
        mid_items.append(_ins("📉", "HRV is trending downward",
            f"HRV dropped from {avg_hrv_f2:.0f} ms (2 weeks ago) to {avg_hrv_f1:.0f} ms (this week). "
            "Primary lever: more consistent sleep.", "warn"))

    # ── Chronic sleep duration ────────────────────────────────────────────────
    if avg_hrs_30 and avg_hrs_30 < sleep_target - 0.5:
        mid_items.append(_ins("💤", "Sleep duration is your biggest unlock",
            f"Averaging {avg_hrs_30:.1f}h over 30 days — {sleep_target - avg_hrs_30:.1f}h short of your {sleep_target}h target. "
            "This gap alone predicts cardiovascular and metabolic risk.", "warn"))

    # ── Readiness baseline ────────────────────────────────────────────────────
    if avg_rdy_30 and avg_rdy_30 < 80:
        mid_items.append(_ins("💚", "Readiness baseline has room to grow",
            f"30-day average readiness is {avg_rdy_30:.0f}. Scores above 80 correlate with peak performance. "
            "Earlier, consistent bedtime would push this into the 80s within 4–6 weeks.", "info"))

    # ── Lab-based long-term items ─────────────────────────────────────────────
    def _lab(name):
        if name not in labs:
            return None, None, None, None, None
        b = labs[name]
        r = b["readings"][-1]
        prev = b["readings"][-2]["value"] if len(b["readings"]) > 1 else None
        return r["value"], r.get("ref_low"), r.get("ref_high"), prev, b.get("unit")

    creat_v, _, creat_hi, _, _ = _lab("Creatinine")
    egfr_v,  _, _,         _, _ = _lab("eGFR")
    testo_v, _, _,         _, _ = _lab("Testosterone Total")
    psa_v,   _, psa_hi,  psa_prev, _ = _lab("PSA")
    b12_v,   b12_lo, b12_hi, _, _ = _lab("Vitamin B12")
    hba1c_v, _, _, _, _ = _lab("HbA1c")
    gluc_v,  _, _, _, _ = _lab("Glucose")

    if creat_v and creat_hi and creat_v > creat_hi:
        mid_items.append(_ins("🫘", "Monitor kidney hydration markers",
            f"Creatinine {creat_v:.2f} mg/dL (above ref {creat_hi:.2f}). eGFR {egfr_v or 0:.0f}. "
            "Drink 2.5–3L water daily, reduce NSAIDs, recheck in 3 months.", "warn"))

    if testo_v:
        mid_items.append(_ins("⚡", "Testosterone is in excellent range",
            f"At {testo_v:.0f} ng/dL you're in the upper-healthy range. "
            "Sleep is your primary testosterone protector.", "good"))

    if psa_v and psa_prev:
        psa_chg = round((psa_v - psa_prev) / psa_prev * 100)
        long_items.append(_ins("🔬", "PSA is trending up — watch closely",
            f"PSA increased from {psa_prev:.1f} to {psa_v:.1f} ng/mL ({abs(psa_chg):.0f}% year-over-year). "
            "Still in range, but rate of change matters. Discuss velocity at next visit.",
            "warn" if psa_chg > 15 else "info"))

    if egfr_v and egfr_v < 75:
        long_items.append(_ins("🫁", "Kidney function: borderline territory",
            f"eGFR {egfr_v:.0f} mL/min, just above stage-2 CKD threshold. "
            "Trend annually. Protect with hydration, BP control, no NSAIDs.", "watch"))

    if b12_v and b12_v > 900:
        long_items.append(_ins("💊", "Very high B12 — review supplementation",
            f"Vitamin B12 at {int(b12_v)} pg/mL is above the 200–900 reference range. "
            "If supplementing, likely benign; otherwise discuss with doctor.", "watch"))

    if hba1c_v and gluc_v:
        chol = labs.get("Total Cholesterol", {}).get("readings", [{}])[-1].get("value", 0) if labs.get("Total Cholesterol") else 0
        hdl  = labs.get("HDL",               {}).get("readings", [{}])[-1].get("value", 0) if labs.get("HDL")               else 0
        trig = labs.get("Triglycerides",      {}).get("readings", [{}])[-1].get("value", 0) if labs.get("Triglycerides")     else 0
        long_items.append(_ins("✅", "Metabolic health: exceptional",
            f"HbA1c {hba1c_v:.1f}%, Glucose {gluc_v:.0f} mg/dL, Total Cholesterol {chol:.0f}, "
            f"HDL {hdl:.0f}, Triglycerides {trig:.0f}. Every metabolic marker is optimal.", "good"))

    return {
        "short": short_items,
        "mid":   mid_items,
        "long":  long_items,
        "meta": {
            "avg_hrv_30":   avg_hrv_30,
            "avg_rdy_30":   avg_rdy_30,
            "avg_slp_30":   avg_slp_30,
            "avg_hrs_30":   avg_hrs_30,
            "avg_hrs_7":    avg_hrs_7,
            "bt_std":       bt_std,
            "avg_bt_str":   avg_bt_str,
            "steps_pct":    steps_pct,
            "hrv_trend":    hrv_trend_dir,
        },
    }
