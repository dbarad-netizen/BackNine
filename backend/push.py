"""
push.py — APNs push notifications (David 2026-09-24).

Everything since the Sunday text says Coach Al works when he COMES TO
the user. This is the app-side version: the morning teaser and the
Sunday scoreboard as lock-screen notifications, so the value arrives
without an open.

Token-based APNs auth (no certificates): a .p8 key from the Apple
Developer portal, signed into a short-lived ES256 JWT per request.

Env (Render):
  APNS_KEY_ID      — 10-char key id from Certificates, Identifiers & Profiles → Keys
  APNS_TEAM_ID     — Apple Developer Team ID
  APNS_KEY_P8      — the .p8 file contents (paste the whole thing, newlines OK)
  APNS_BUNDLE_ID   — com.backnine.app (or whatever Xcode shows)
  APNS_ENV         — "sandbox" for TestFlight/dev builds, "production" for App Store

Table: push_tokens(user_id text, token text, platform text, updated_at timestamptz)
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

log = logging.getLogger(__name__)

_jwt_cache: dict = {"token": None, "issued": 0.0}


def _sb():
    from main import get_supabase  # lazy: main imports us
    return get_supabase()


def configured() -> bool:
    return all(os.getenv(k) for k in ("APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY_P8", "APNS_BUNDLE_ID"))


def _provider_jwt() -> str:
    """ES256 provider token, cached ~50 min (Apple allows up to 60)."""
    now = time.time()
    if _jwt_cache["token"] and now - _jwt_cache["issued"] < 50 * 60:
        return _jwt_cache["token"]
    from jose import jwt
    key = os.getenv("APNS_KEY_P8", "").replace("\\n", "\n")
    tok = jwt.encode(
        {"iss": os.getenv("APNS_TEAM_ID"), "iat": int(now)},
        key, algorithm="ES256",
        headers={"kid": os.getenv("APNS_KEY_ID")},
    )
    _jwt_cache.update(token=tok, issued=now)
    return tok


def _host() -> str:
    return ("https://api.push.apple.com" if os.getenv("APNS_ENV", "sandbox") == "production"
            else "https://api.sandbox.push.apple.com")


# ── Token registry ─────────────────────────────────────────────────────

def register_token(user_id: str, token: str, platform: str = "ios") -> None:
    sb = _sb()
    if not (sb and user_id and token):
        return
    sb.table("push_tokens").upsert({
        "user_id":    user_id,
        "token":      token,
        "platform":   platform,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="token").execute()


def tokens_for(user_id: str) -> list[str]:
    sb = _sb()
    if not sb:
        return []
    try:
        res = sb.table("push_tokens").select("token").eq("user_id", user_id).execute()
        return [r["token"] for r in (res.data or []) if r.get("token")]
    except Exception:
        return []


def all_user_ids() -> list[str]:
    sb = _sb()
    if not sb:
        return []
    try:
        res = sb.table("push_tokens").select("user_id").execute()
        return sorted({r["user_id"] for r in (res.data or []) if r.get("user_id")})
    except Exception:
        return []


def _drop_token(token: str) -> None:
    try:
        _sb().table("push_tokens").delete().eq("token", token).execute()
    except Exception:
        pass


# ── Send ───────────────────────────────────────────────────────────────

async def send_to_user(user_id: str, title: str, body: str,
                       data: Optional[dict] = None, collapse_id: Optional[str] = None) -> dict:
    """Push to every device registered for user_id. Returns
    {sent, failed, dry_run}. Unregistered/expired tokens (410) are
    pruned automatically."""
    toks = tokens_for(user_id)
    if not configured():
        return {"sent": 0, "failed": 0, "dry_run": True, "tokens": len(toks)}
    if not toks:
        return {"sent": 0, "failed": 0, "dry_run": False, "tokens": 0}

    payload = {"aps": {"alert": {"title": title, "body": body}, "sound": "default"}}
    if data:
        payload.update(data)
    headers = {
        "authorization":   f"bearer {_provider_jwt()}",
        "apns-topic":      os.getenv("APNS_BUNDLE_ID", ""),
        "apns-push-type":  "alert",
        "apns-priority":   "10",
    }
    if collapse_id:
        headers["apns-collapse-id"] = collapse_id[:64]

    sent = failed = 0
    async with httpx.AsyncClient(http2=True, timeout=15.0) as client:
        for tok in toks:
            try:
                r = await client.post(f"{_host()}/3/device/{tok}", json=payload, headers=headers)
                if r.status_code == 200:
                    sent += 1
                else:
                    failed += 1
                    if r.status_code == 410 or "BadDeviceToken" in r.text or "Unregistered" in r.text:
                        _drop_token(tok)
                    log.warning("APNs %s for %s…: %s", r.status_code, tok[:8], r.text[:120])
            except Exception as e:
                failed += 1
                log.warning("APNs send error for %s…: %s", tok[:8], e)
    return {"sent": sent, "failed": failed, "dry_run": False, "tokens": len(toks)}
