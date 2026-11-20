"""
Week pace — the week as a running card.

2026-10-30: built as "where does this week land vs par" after Oura's
weekly Cardio Effort card. 2026-11-20: the League moved from Health Span
net-of-par to strokes gained against your own usual (strokes.py), so
this view now shows the same thing the standings rank on: the running
net day by day, each band's strokes with this week against your usual,
and where the week lands at the same pace.

Everything the reader sees is computed here. The copy never does math.
"""

from __future__ import annotations

from datetime import date, timedelta

import strokes as sg

DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _fmt_net(v) -> str:
    if v is None:
        return "—"
    r = int(round(v))
    return "even" if r == 0 else f"{'+' if r > 0 else '−'}{abs(r)}"


def _band_line(key: str, b: dict) -> dict:
    """Display strings for one band: this week, your usual."""
    wk, us = b.get("week"), b.get("usual")
    if key in ("steps",):
        f = lambda v: f"{int(v):,}" if v is not None else "—"
        unit = "a day"
    elif key == "activity":
        f = lambda v: f"{int(v)} cal" if v is not None else "—"
        unit = "a day"
    elif key == "sleep":
        f = lambda v: f"{v:.1f} h" if v is not None else "—"
        unit = "a night"
    else:
        f = lambda v: ("same time nightly" if v is not None and v < 15 else
                       f"within {int(round(v / 5.0) * 5)} min" if v is not None else "—")
        unit = ""
    return {
        "key": key, "label": b.get("label"), "strokes": b.get("strokes", 0.0),
        "status": b.get("status"), "days": b.get("days", 0),
        "week_label": f(wk), "usual_label": f(us), "unit": unit,
    }


def compute(user_id: str, today_iso: str) -> dict:
    today = date.fromisoformat(today_iso)
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)

    daily = sg.load_daily(user_id, monday, today)
    res = sg.score_week(daily, monday, today, live=True)
    ser = sg.series(daily, monday, today, live=True)
    days = [{"date": s["date"], "dow": DOW[i], "net": s["net"], "played": s["date"] <= today_iso}
            for i, s in enumerate(ser)]

    bands = [_band_line(k, res["bands"][k]) for k in sg.BAND_ORDER]

    # Same-pace projection: each scored band's strokes scaled to a full week.
    projected = None
    if res["net_exact"] is not None:
        tot = 0.0
        for k in sg.BAND_ORDER:
            b = res["bands"][k]
            if b.get("status") == "scored" and b.get("days"):
                tot += max(-sg.BAND_CAP, min(sg.BAND_CAP, b["strokes"] * 7 / b["days"]))
        projected = round(tot, 1)

    days_left = (sunday - today).days + 1            # today is still being played
    scored = [b for b in bands if b["status"] == "scored"]
    if not scored:
        sentence = "Fresh card. Strokes start counting once the first full day is in."
    else:
        played = res.get("days_played", 0)
        day_word = "day" if played == 1 else "days"
        sentence = f"{_fmt_net(res['net_exact']).capitalize()} through {played} full {day_word}"
        if projected is not None and days_left > 1 and int(round(projected)) != int(round(res["net_exact"])):
            sentence += f", on pace for about {_fmt_net(projected)}"
        sentence += "."
        best = max(scored, key=lambda b: b["strokes"])
        worst = min(scored, key=lambda b: b["strokes"])
        if best["strokes"] >= 0.5:
            sentence += f" Biggest gain: {best['label'].lower()} ({best['week_label']} against your usual {best['usual_label']})."
        if worst["strokes"] <= -0.5 and worst is not best:
            sentence += f" Giving strokes back on {worst['label'].lower()}."

    return {
        "week_start": monday.isoformat(), "week_end": sunday.isoformat(), "today": today_iso,
        "days": days,
        "net": res["net"], "net_exact": res["net_exact"],
        "projected": projected, "days_left": days_left,
        "sentence": sentence,
        "bands": bands,
        "provisional": res.get("provisional", True),
        "rule": sg.RULE_TEXT,
    }
