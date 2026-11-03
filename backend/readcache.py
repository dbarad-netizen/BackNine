"""
readcache — a tiny process-wide TTL memo for the two hottest loaders.

2026-11-03 (David: "speed could be a killer"): one dashboard open ran the
same apple_health_daily read 325 times and the same oura_daily_cache
read dozens of times, because every band, card and background job
loads its own copy. A 60-second memo keyed on the exact arguments
collapses those into one round trip each; any write for a user clears
that user's entries so nobody reads a stale row after a sync.

Thread-safe, bounded, and deliberately dumb. Not a substitute for
fixing N+1 loops — just the cheapest 80%.
"""

from __future__ import annotations

import copy
import threading
import time
from typing import Any, Callable, Hashable

_TTL_S = 60.0
_MAX = 2000
_lock = threading.Lock()
_store: dict[tuple, tuple[float, Any]] = {}   # key -> (expires_at, value)
_hits = 0
_misses = 0


def get_or_load(user_id: str, key: Hashable, loader: Callable[[], Any], ttl: float = _TTL_S) -> Any:
    """Return the memoised value for (user_id, key), loading it if absent
    or expired. Values are deep-copied on the way out so callers can
    mutate them freely (several loaders' consumers do)."""
    global _hits, _misses
    k = (user_id, key)
    now = time.monotonic()
    with _lock:
        hit = _store.get(k)
        if hit and hit[0] > now:
            _hits += 1
            return copy.deepcopy(hit[1])
    _misses += 1
    value = loader()
    with _lock:
        if len(_store) >= _MAX:
            # Drop expired first, then oldest.
            for kk in [kk for kk, (exp, _) in _store.items() if exp <= now]:
                _store.pop(kk, None)
            while len(_store) >= _MAX:
                _store.pop(next(iter(_store)), None)
        _store[k] = (now + ttl, copy.deepcopy(value))
    return value


def invalidate(user_id: str) -> int:
    """Forget everything cached for a user. Call after any write."""
    with _lock:
        dead = [k for k in _store if k[0] == user_id]
        for k in dead:
            _store.pop(k, None)
    return len(dead)


def stats() -> dict:
    with _lock:
        return {"entries": len(_store), "hits": _hits, "misses": _misses}
