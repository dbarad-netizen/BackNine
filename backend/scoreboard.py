"""
scoreboard.py — the Sunday text (David 2026-09-22).

The one experiment that has never been run: does a weekly scoreboard
between friends change behavior? Coach Al goes to where the guys
already are — a text thread — instead of asking them to open an app.
This module builds that text from the same numbers the Weekly
Leaderboard uses, one true line per person, and sends it by SMS.

Prototype scope: recipients are a hard-coded env whitelist (David +
Chris first, so they can see it before anyone else is included).
No DB phone numbers, no opt-in UI yet — that comes only if the
experiment says it should.

Env:
  SCOREBOARD_RECIPIENTS  "user_id:+15551234567,user_id:+15557654321"
  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM  (omit → dry run)
"""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from typing import Optional

import httpx

import healthspan as hspan
import leagues as lg
import oura_cache as oc

log = logging.getLogger(__name__)


# ── Recipients ─────────────────────────────────────────────────────────

def recipients() -> list[tuple[str, str]]:
    """[(user_id, e164_phone), ...] from SCOREBOARD_RECIPIENTS."""
    raw = os.getenv("SCOREBOARD_RECIPIENTS", "")
    out: list[tuple[str, str]] = []
    for part in raw.split(","):
        part = part.strip()
        if ":" not in part:
            continue
        uid, phone = part.rsplit(":", 1)
        uid, phone = uid.strip(), phone.strip()
        if uid and phone.startswith("+"):
            out.append((uid, phone))
    return out


# ── Per-person line ────────────────────────────────────────────────────

def _one_true_line(name: str, comps: dict) -> str:
    """One sentence per person: the band carrying them and the band
    that's the lever. Same 'earn the open' rule as the briefing — a
    specific number beats praise."""
    if not comps:
        return f"{name}: no data this week."
    ranked = sorted(comps.values(), key=lambda c: (c["points"] / c["max"]) if c["max"] else 0, reverse=True)
    best, worst = ranked[0], ranked[-1]
    best_pct = best["points"] / best["max"] if best["max"] else 0
    worst_pct = worst["points"] / worst["max"] if worst["max"] else 0
    b = f"{best['label'].split(' (')[0].lower()} {best['value']}"
    w = f"{worst['label'].split(' (')[0].lower()} {worst['value']}"
    if len(ranked) == 1:
        return f"{name}: {b}."
    if best_pct >= 0.8 and worst_pct < 0.5:
        return f"{name}: {b} carried it — {w} is the lever."
    if best_pct >= 0.8:
        return f"{name}: {b}, solid across the board."
    if worst_pct < 0.5:
        return f"{name}: {w} is where the week went."
    return f"{name}: {b}; {w}."


# ── Build ──────────────────────────────────────────────────────────────

def build(today: Optional[date] = None) -> dict:
    """Compute standings + lines for every recipient. Returns
    {"week_label", "text", "rows": [...]}.

    Standings recompute Health Span live (not the cached snapshot) so
    the Sunday text reflects the full week even if someone hasn't
    opened the app — which is the whole point."""
    today = today or date.today()
    monday = today - timedelta(days=today.weekday())
    week_label = f"Week of {monday.strftime('%b')} {monday.day}"
    today_iso = today.isoformat()

    sb = lg._sb()
    recips = recipients()
    ids = [uid for uid, _ in recips]
    names = lg._names_for(sb, ids) if sb else {}

    rows = []
    for uid in ids:
        name = (names.get(uid) or "Friend").split(" ")[0]
        try:
            _rm, _slm, am, smm = oc.get_days(uid, days=8)
        except Exception:
            am, smm = {}, {}
        try:
            snap = hspan.compute(uid, today_iso, am or {}, smm or {}, {})
        except Exception:
            log.exception("scoreboard: healthspan failed for %s", uid)
            snap = {"score": None, "components": {}}
        rows.append({
            "user_id": uid,
            "name":    name,
            "score":   snap.get("score"),
            "line":    _one_true_line(name, snap.get("components") or {}),
        })

    rows.sort(key=lambda r: -(r["score"] if r["score"] is not None else -1))

    standings = " · ".join(
        f"{r['name']} {r['score'] if r['score'] is not None else '—'}" for r in rows
    )
    lines = "\n".join(r["line"] for r in rows)
    scored = [r for r in rows if r["score"] is not None]
    closer = ""
    if len(scored) >= 2:
        closer = f"\nLowest score buys coffee. That's {scored[-1]['name']}."
    elif scored:
        closer = f"\n{scored[0]['name']} is the only one on the board — everyone else, connect your watch."

    text = f"BackNine — {week_label}\n{standings}\n\n{lines}{closer}"
    return {"week_label": week_label, "text": text, "rows": rows}


# ── Send ───────────────────────────────────────────────────────────────

def _twilio_creds() -> Optional[tuple[str, str, str]]:
    sid, tok, frm = (os.getenv("TWILIO_ACCOUNT_SID", ""), os.getenv("TWILIO_AUTH_TOKEN", ""),
                     os.getenv("TWILIO_FROM", ""))
    return (sid, tok, frm) if (sid and tok and frm) else None


async def send(text: str) -> dict:
    """SMS the text to every recipient. Without Twilio creds this is a
    dry run that just returns what WOULD be sent."""
    creds = _twilio_creds()
    recips = recipients()
    if not creds:
        return {"sent": 0, "dry_run": True, "to": [p for _, p in recips], "text": text}
    sid, tok, frm = creds
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    results = []
    async with httpx.AsyncClient(timeout=20.0, auth=(sid, tok)) as client:
        for _uid, phone in recips:
            try:
                r = await client.post(url, data={"From": frm, "To": phone, "Body": text})
                ok = r.status_code in (200, 201)
                results.append({"to": phone, "ok": ok, "status": r.status_code,
                                "detail": None if ok else r.text[:200]})
            except Exception as e:
                results.append({"to": phone, "ok": False, "status": None, "detail": str(e)[:200]})
    return {"sent": sum(1 for x in results if x["ok"]), "dry_run": False, "results": results, "text": text}
