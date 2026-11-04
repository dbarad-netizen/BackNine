"""
sbpool — one Supabase client per process, not one per query.

2026-11-03: 55 modules each had a `_sb()` that called
`supabase.create_client(url, key)` on EVERY call. Each call built a new
httpx client and a new TLS connection to Supabase, so a single-row read
cost ~250 ms instead of ~40 ms, and the dashboard's few dozen reads
added up to seconds. main.py already cached its own client; the rest of
the codebase did not.

Importing this module patches `supabase.create_client` to return a
cached client per (url, key). Modules keep their `from supabase import
create_client` lines unchanged — the attribute lookup happens at call
time, after this patch. httpx.Client is thread-safe, so the shared
client is fine under asyncio.to_thread.
"""

from __future__ import annotations

import threading

import supabase as _pkg

_orig_create_client = _pkg.create_client
_clients: dict = {}
_lock = threading.Lock()


def _cached_create_client(supabase_url: str, supabase_key: str, options=None):
    if options is not None:
        # Custom options → don't share; nobody in this codebase passes any.
        return _orig_create_client(supabase_url, supabase_key, options)
    key = (supabase_url, supabase_key)
    c = _clients.get(key)
    if c is None:
        with _lock:
            c = _clients.get(key)
            if c is None:
                c = _orig_create_client(supabase_url, supabase_key)
                _clients[key] = c
    return c


_pkg.create_client = _cached_create_client
try:  # some modules import the submodule path
    import supabase._sync.client as _sc  # type: ignore
    _sc.create_client = _cached_create_client
except Exception:
    pass


def stats() -> dict:
    return {"clients": len(_clients)}


# ── Per-request DB accounting ────────────────────────────────────────────
# Counts and times every sync httpx request (that is every Supabase call)
# made while serving an API request, via a contextvar the middleware sets.
# Surfaces as `Server-Timing: db;dur=…;desc="N calls"` so "how many round
# trips did this endpoint make" is visible in any browser's Network tab.

import contextvars
import time as _time

import httpx as _httpx

_ctx: contextvars.ContextVar = contextvars.ContextVar("bn_db_acct", default=None)
_orig_send = _httpx.Client.send


def _counting_send(self, request, *args, **kwargs):
    acct = _ctx.get()
    if acct is None:
        return _orig_send(self, request, *args, **kwargs)
    t0 = _time.perf_counter()
    try:
        return _orig_send(self, request, *args, **kwargs)
    finally:
        acct["n"] += 1
        acct["ms"] += (_time.perf_counter() - t0) * 1000


_httpx.Client.send = _counting_send


def begin_request():
    """Start accounting for the current context; returns the dict."""
    acct = {"n": 0, "ms": 0.0}
    _ctx.set(acct)
    return acct
