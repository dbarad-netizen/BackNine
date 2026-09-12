"""Shared helper for extracting text from Anthropic API responses.

David 2026-09-12: the Sonnet 5 swap broke the briefing for two days with
`'ThinkingBlock' object has no attribute 'text'` — newer models can
prepend thinking blocks to their response, so `response.content[0]` is
no longer guaranteed to be the text block. Every surface that reads a
Claude response goes through first_text() now, so a future model swap
can't reintroduce this.
"""


def first_text(response) -> str:
    """Concatenate all text blocks in a Messages API response.

    Skips thinking/tool-use/any non-text blocks. Returns "" when the
    response has no text blocks at all.
    """
    try:
        blocks = response.content or []
    except AttributeError:
        return ""
    parts = []
    for b in blocks:
        if getattr(b, "type", None) == "text" and getattr(b, "text", None):
            parts.append(b.text)
    return "".join(parts)
