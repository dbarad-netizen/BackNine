"""
Lab report OCR — Claude Vision path for extracting structured lab values
from a PDF or image.

Why this exists on top of labs.parse_pdf:
  • parse_pdf() uses pdfplumber + regex. It works on text-native PDFs from
    Quest/LabCorp portals but silently returns nothing on:
      – scanned image PDFs (paper reports the user photographed),
      – portal exports where text is fragmented across overlapping layers,
      – hospital printouts with two-column layouts,
      – iPhone photos of a lab printout.
  • Users don't know which of those buckets their file lands in. The old
    UX was "upload → we found 0 markers, sorry." That's a dead end.

  Claude Vision handles all four buckets without special cases. The
  trade-off is a per-request LLM cost, so we keep parse_pdf as the
  no-cost fallback: try the free text path first, and only escalate to
  vision when it returns fewer than a threshold of markers.

Public API:
  extract_from_bytes(file_bytes, filename)
      → {"date": str|None, "extracted": {key: {value, unit,
         reference_range, confidence, raw_line}}, "count": int,
         "method": "text"|"vision"}

The extracted dict keys are canonical marker keys from
labs.REFERENCE_RANGES. Values not in REFERENCE_RANGES are dropped so
downstream code (Doctor Handoff, Annual Physical) always sees known
markers. The `confidence` field is Claude's own low/medium/high tag —
the frontend uses it to steer the user's eye at review time.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Optional

import labs as _labs


log = logging.getLogger(__name__)


# How many markers the text-only parser must find before we skip vision.
# Set high enough that partial extractions still trigger the LLM (a Quest
# CMP with only Na/K/Cl parsed means the layout confused the regex, not
# that the panel only ran three tests).
_TEXT_PATH_MIN_MARKERS = 6


_SYSTEM_PROMPT = """You are an OCR + extraction assistant for a personal
health app. The user uploads a lab report — typically Quest, LabCorp, a
hospital portal export, or a photo of a paper printout. Your job:

1. Read every lab value on the report.
2. Return them as a strict JSON object matching the schema below.
3. Only include markers that appear in the KNOWN_MARKERS list. Anything
   else, skip silently — do not invent, do not include narrative text.
4. Do NOT interpret. Do NOT flag high/low. Do NOT recommend anything.
   You are a transcriber. The app's downstream logic handles ranges.
5. If a value is ambiguous (smudge, overlapping text, torn photo),
   include it with confidence "low" — the user reviews before saving.
6. Never guess a value that isn't visible. If you can't read a number,
   omit it.

Date rule:
  • If the report shows a "Collected" or "Specimen Collection" date,
    use that. If only a report/print date exists, use that instead.
  • Format as YYYY-MM-DD. If unclear, return null.

Output schema (JSON only, no code fence, no prose):
{
  "collection_date": "YYYY-MM-DD" | null,
  "markers": [
    {
      "key":             "<canonical key from KNOWN_MARKERS>",
      "value":           <number>,
      "unit":            "<unit string as shown, e.g. 'mg/dL'>",
      "reference_range": "<range string as shown, e.g. '70-99'>",
      "confidence":      "low" | "medium" | "high",
      "raw_line":        "<the exact line from the report, verbatim>"
    }
  ]
}
"""


def _known_markers_hint() -> str:
    """Compact hint listing the canonical marker keys + display labels so
    Claude maps 'LDL Cholesterol Calc' → 'ldl' correctly."""
    lines = []
    for key, ref in _labs.REFERENCE_RANGES.items():
        lines.append(f"  {key} — {ref.get('label', key)} ({ref.get('unit', '')})")
    return "KNOWN_MARKERS (canonical key — human label — unit):\n" + "\n".join(lines)


def _looks_like_pdf(file_bytes: bytes, filename: str) -> bool:
    if filename.lower().endswith(".pdf"):
        return True
    return file_bytes[:4] == b"%PDF"


def _looks_like_image(file_bytes: bytes, filename: str) -> bool:
    lname = filename.lower()
    if any(lname.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".heic")):
        return True
    # Magic bytes
    if file_bytes[:3] == b"\xff\xd8\xff":                       # JPEG
        return True
    if file_bytes[:8] == b"\x89PNG\r\n\x1a\n":                  # PNG
        return True
    if file_bytes[:4] == b"RIFF" and file_bytes[8:12] == b"WEBP":
        return True
    return False


def _guess_media_type(file_bytes: bytes, filename: str) -> str:
    if _looks_like_pdf(file_bytes, filename):
        return "application/pdf"
    lname = filename.lower()
    if lname.endswith(".png") or file_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if lname.endswith(".webp") or (file_bytes[:4] == b"RIFF" and file_bytes[8:12] == b"WEBP"):
        return "image/webp"
    # Default to JPEG — Claude Vision accepts jpg/png/gif/webp.
    return "image/jpeg"


def _parse_claude_json(raw: str) -> Optional[dict]:
    """Extract the first {...} block. Claude usually complies with 'JSON
    only' but occasionally wraps in ```json fences; tolerate both."""
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.strip("`").strip()
        if s.startswith("json"):
            s = s[4:].strip()
    try:
        return json.loads(s)
    except Exception:
        try:
            i = s.find("{")
            j = s.rfind("}")
            if i != -1 and j > i:
                return json.loads(s[i : j + 1])
        except Exception:
            return None
    return None


def _normalize_marker(row: dict) -> Optional[dict]:
    """Coerce Claude's marker into a normalized preview row. Drop rows
    with keys we don't recognize or values we can't parse — the whole
    point of the canonical schema is to keep the downstream simple."""
    if not isinstance(row, dict):
        return None
    key = str(row.get("key") or "").strip().lower()
    if not key or key not in _labs.REFERENCE_RANGES:
        return None
    try:
        value = float(row.get("value"))
    except (TypeError, ValueError):
        return None
    conf = (row.get("confidence") or "medium").strip().lower()
    if conf not in ("low", "medium", "high"):
        conf = "medium"
    return {
        "key":             key,
        "value":           round(value, 3),
        "unit":            str(row.get("unit") or "").strip(),
        "reference_range": str(row.get("reference_range") or "").strip(),
        "confidence":      conf,
        "raw_line":        str(row.get("raw_line") or "").strip()[:200],
    }


def _vision_extract(file_bytes: bytes, filename: str) -> Optional[dict]:
    """Send the file to Claude Vision and return the parsed extraction."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        log.warning("labs_ocr: ANTHROPIC_API_KEY not set")
        return None
    try:
        import anthropic
    except ImportError:
        log.warning("labs_ocr: anthropic package missing")
        return None

    media_type = _guess_media_type(file_bytes, filename)
    b64        = base64.b64encode(file_bytes).decode("ascii")

    # Documents (application/pdf) go through the document source; images
    # go through the image source. Same API surface, different `type`.
    if media_type == "application/pdf":
        content_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    else:
        content_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        }

    system = _SYSTEM_PROMPT + "\n\n" + _known_markers_hint()

    try:
        client   = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            # Vision + document understanding requires a Sonnet-tier
            # model. Haiku doesn't accept documents in the current API.
            model="claude-sonnet-4-6",
            max_tokens=4000,
            system=system,
            messages=[{
                "role": "user",
                "content": [
                    content_block,
                    {"type": "text", "text": (
                        "Extract every lab value on this report. Follow the "
                        "schema exactly. JSON only."
                    )},
                ],
            }],
        )
    except Exception as exc:
        log.warning("labs_ocr: vision call failed: %s", exc)
        return None

    raw    = response.content[0].text if response.content else ""
    parsed = _parse_claude_json(raw)
    if not parsed:
        log.warning("labs_ocr: couldn't parse Claude output: %s", raw[:400])
        return None

    markers_in  = parsed.get("markers") or []
    markers_out = []
    for m in markers_in:
        norm = _normalize_marker(m)
        if norm:
            markers_out.append(norm)
    # Preserve the collection date if it's valid ISO-like
    date_str = parsed.get("collection_date")
    if date_str and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(date_str)):
        date_str = None

    return {
        "date":    date_str,
        "markers": markers_out,
        "method":  "vision",
    }


def extract_from_bytes(file_bytes: bytes, filename: str) -> dict:
    """Public entry point. Try the free text-only regex parser first; if
    it finds enough markers, return that. Otherwise fall through to
    Claude Vision. Never raises — always returns a well-formed dict."""
    # 1) Fast text path (PDFs only — pdfplumber can't read images).
    text_result: Optional[dict] = None
    if _looks_like_pdf(file_bytes, filename):
        try:
            date_str, extracted = _labs.parse_pdf(file_bytes)
        except Exception as exc:
            log.info("labs_ocr: text parse_pdf raised: %s", exc)
            date_str, extracted = None, {}
        markers = []
        for k, v in (extracted or {}).items():
            if k in _labs.REFERENCE_RANGES:
                markers.append({
                    "key":             k,
                    "value":           round(float(v), 3),
                    "unit":            _labs.REFERENCE_RANGES[k].get("unit", ""),
                    "reference_range": "",
                    "confidence":      "high",
                    "raw_line":        "",
                })
        text_result = {"date": date_str, "markers": markers, "method": "text"}
        if len(markers) >= _TEXT_PATH_MIN_MARKERS:
            text_result["count"] = len(markers)
            return text_result

    # 2) Vision path — handles images + PDF cases the text path misses.
    if not (_looks_like_pdf(file_bytes, filename) or
            _looks_like_image(file_bytes, filename)):
        # Unrecognized format — fail gracefully.
        return {"date": None, "markers": [], "method": "unsupported", "count": 0}

    vision_result = _vision_extract(file_bytes, filename)
    if vision_result and vision_result.get("markers"):
        vision_result["count"] = len(vision_result["markers"])
        return vision_result

    # 3) If vision failed but text found *something*, still return it.
    if text_result and text_result.get("markers"):
        text_result["count"] = len(text_result["markers"])
        return text_result

    return {"date": None, "markers": [], "method": "empty", "count": 0}


__all__ = ["extract_from_bytes"]
