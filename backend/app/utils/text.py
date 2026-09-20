"""Text helpers shared by the pipeline and the eval harness."""

import unicodedata

from backend.app.types import Paragraph

_MATCH_TABLE: dict[int, str | None] = {
    **{ord(c): "'" for c in "‘’‚‛"},
    **{ord(c): '"' for c in "“”„‟"},
    **{ord(c): "-" for c in "‐‑‒–—―−"},
    **{ord(c): None for c in "​‌‍⁠﻿­"},  # invisible
}


def normalize_with_map(text: str) -> tuple[str, list[int]]:
    """Normalize `text` for matching and map every output character back to its index in `text`.

    NFKC, curly quotes to straight, dashes to a hyphen, invisible characters dropped, and runs
    of whitespace (non-breaking spaces included) collapsed to one space. Each character is
    normalized on its own, which is what makes the index map possible.
    """
    out: list[str] = []
    index: list[int] = []
    for i, ch in enumerate(text):
        for c in unicodedata.normalize("NFKC", ch).translate(_MATCH_TABLE):
            if c.isspace():
                if out and out[-1] != " ":
                    out.append(" ")
                    index.append(i)
            else:
                out.append(c)
                index.append(i)
    if out and out[-1] == " ":
        out.pop()
        index.pop()
    return "".join(out), index


def normalize_for_match(text: str) -> str:
    return normalize_with_map(text)[0]


def batch_paragraphs(paragraphs: list[Paragraph], size: int = 5) -> list[list[Paragraph]]:
    """Split into consecutive batches of `size`; the last one may be shorter."""
    if size < 1:
        raise ValueError("size must be at least 1")
    return [paragraphs[i : i + size] for i in range(0, len(paragraphs), size)]


def sample_for_classification(
    paragraphs: list[Paragraph], count: int = 3, max_chars: int = 600
) -> list[Paragraph]:
    """The opening paragraphs, truncated: enough to tell news from opinion without the article."""
    return [p.model_copy(update={"text": p.text[:max_chars]}) for p in paragraphs[:count]]
