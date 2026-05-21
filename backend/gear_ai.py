"""
Coach Al gear finder for BackNine — the user describes what they're trying to
do ("something to help me sleep when I travel", "recover faster after leg day")
and Coach Al recommends matching items from the BackNine catalog AND, when the
catalog doesn't have a great fit, honest "here's what to look for" guidance so
the answer is always useful even though the catalog is still small.

Input:  query + a compact catalog [{id, name, brand, category, price, description}]
Output: {
  "intro":       short friendly sentence,
  "picks":       [{"id": <catalog id>, "reason": "why this fits you"}],
  "suggestions": [{"title": "...", "detail": "...", "search": "amazon search terms"}]
}

Uses the same Claude Haiku model the rest of the app uses.
"""

import json
import os
import re

MODEL = "claude-haiku-4-5-20251001"

_SYSTEM = (
    "You are Coach Al, the friendly, no-hype health coach inside the BackNine app. "
    "The user tells you what they're trying to accomplish and you help them find gear. "
    "You are given the BackNine store catalog as a list of items "
    "(id | name | brand | category | price | description). "
    "Respond with ONLY a JSON object (no prose, no code fences) of the form: "
    '{"intro":string,"picks":[{"id":string,"reason":string}],'
    '"suggestions":[{"title":string,"detail":string,"search":string}]}. Rules: '
    "1) PICKS: choose items from the catalog that genuinely fit the request. Use the EXACT "
    "id from the catalog. Give a short, specific reason (one sentence) tying the item to "
    "what they asked for. Order best-fit first. Pick 0-4 items — quality over quantity, and "
    "do NOT force a weak match. "
    "2) SUGGESTIONS: this is how you help when the catalog is missing something they need. "
    "For anything they're looking for that the catalog does NOT cover well, add a short "
    "'what to look for' entry: title is the product type (e.g. 'A zero-drop walking shoe'), "
    "detail is one sentence on the key features / rough price range to look for, and search "
    "is a concise phrase they could search to find it (e.g. 'zero drop walking shoes'). "
    "Give 0-3 suggestions. If the catalog already covers the request well, suggestions can be empty. "
    "3) INTRO: one warm, plain sentence summarizing your take. If you have nothing in the "
    "catalog, be honest in the intro and lean on suggestions. "
    "Never invent catalog ids. Never recommend anything unsafe or extreme. Keep it concise."
)


def _client():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    import anthropic
    return anthropic.Anthropic(api_key=api_key)


def _catalog_lines(catalog: list) -> str:
    lines = []
    for it in catalog[:120]:
        if not isinstance(it, dict):
            continue
        iid = str(it.get("id", "")).strip()
        if not iid:
            continue
        name = str(it.get("name", "")).strip()
        brand = str(it.get("brand", "")).strip()
        cat = str(it.get("category", "")).strip()
        price = str(it.get("price", "")).strip()
        desc = str(it.get("description", "")).strip()[:160]
        lines.append(f"{iid} | {name} | {brand} | {cat} | {price} | {desc}")
    return "\n".join(lines)


def _coerce(data: dict, valid_ids: set) -> dict:
    empty = {"intro": "", "picks": [], "suggestions": []}
    if not isinstance(data, dict):
        return empty

    picks = []
    seen = set()
    for p in (data.get("picks") or [])[:8]:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id", "")).strip()
        if not pid or pid not in valid_ids or pid in seen:
            continue  # never surface an id that isn't really in the catalog
        seen.add(pid)
        picks.append({"id": pid, "reason": str(p.get("reason") or "").strip()[:240]})

    suggestions = []
    for s in (data.get("suggestions") or [])[:5]:
        if not isinstance(s, dict):
            continue
        title = str(s.get("title") or "").strip()[:80]
        if not title:
            continue
        suggestions.append({
            "title":  title,
            "detail": str(s.get("detail") or "").strip()[:240],
            "search": str(s.get("search") or "").strip()[:120],
        })

    return {
        "intro":       str(data.get("intro") or "").strip()[:400],
        "picks":       picks[:4],
        "suggestions": suggestions[:3],
    }


def _parse(text: str, valid_ids: set) -> dict:
    if not text:
        return {"intro": "", "picks": [], "suggestions": []}
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t).strip()
    data = None
    try:
        data = json.loads(t)
    except Exception:
        m = re.search(r"\{.*\}", t, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
            except Exception:
                data = None
    return _coerce(data, valid_ids)


def find_gear(query: str, catalog: list, context: str = "") -> dict:
    valid_ids = {
        str(it.get("id", "")).strip()
        for it in (catalog or [])
        if isinstance(it, dict) and str(it.get("id", "")).strip()
    }
    user_block = f"What I'm trying to do: {query}\n\n"
    if context:
        user_block += f"About me: {context}\n\n"
    user_block += "BackNine catalog (id | name | brand | category | price | description):\n"
    user_block += _catalog_lines(catalog or [])
    user_block += "\n\nReturn the JSON object."

    client = _client()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=1100,
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_block}],
    )
    return _parse(resp.content[0].text, valid_ids)
