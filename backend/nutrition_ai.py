"""
AI meal parsing for BackNine — turns a text description or a photo of a meal
into structured food items (name + calories + macros) the user confirms.

Uses the same Claude Haiku model (multimodal) the rest of the app uses. Output
is always a draft the user reviews before logging, so approximate estimates
stay honest.
"""

import json
import os
import re

MODEL = "claude-haiku-4-5-20251001"

_SYSTEM = (
    "You are a precise nutrition estimator. Given a text description OR a photo of a meal, "
    "identify the distinct food/drink items and estimate calories and macros for the portion "
    "shown or described. Respond with ONLY a JSON array — no prose, no code fences — where each "
    'element is {"name": string, "calories": number, "protein": number, "carbs": number, "fat": number}. '
    "Use grams for macros and kcal for calories. Estimate realistically; if a portion is ambiguous, "
    "assume a typical single serving. Combine obvious sub-parts (e.g. 'chicken salad') sensibly but "
    "keep clearly separate items separate. Return [] if you truly can't identify any food."
)


def _client():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    import anthropic
    return anthropic.Anthropic(api_key=api_key)


def _parse_items(text: str) -> list[dict]:
    if not text:
        return []
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t).strip()
    data = None
    try:
        data = json.loads(t)
    except Exception:
        m = re.search(r"\[.*\]", t, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
            except Exception:
                data = None
    if not isinstance(data, list):
        return []
    out = []
    for it in data[:20]:
        if not isinstance(it, dict):
            continue
        try:
            out.append({
                "name":     str(it.get("name", "item")).strip()[:80] or "item",
                "calories": max(0, round(float(it.get("calories") or 0))),
                "protein":  max(0, round(float(it.get("protein") or 0), 1)),
                "carbs":    max(0, round(float(it.get("carbs") or 0), 1)),
                "fat":      max(0, round(float(it.get("fat") or 0), 1)),
            })
        except (TypeError, ValueError):
            continue
    return out


def parse_text(text: str) -> list[dict]:
    client = _client()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=800,
        system=_SYSTEM,
        messages=[{"role": "user", "content": f"Meal: {text}\n\nReturn the JSON array."}],
    )
    return _parse_items(resp.content[0].text)


def parse_photo(image_b64: str, media_type: str = "image/jpeg") -> list[dict]:
    if media_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        media_type = "image/jpeg"
    client = _client()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=800,
        system=_SYSTEM,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": "Identify the foods in this meal photo and estimate calories + macros for the portions shown. Return ONLY the JSON array."},
            ],
        }],
    )
    return _parse_items(resp.content[0].text)
