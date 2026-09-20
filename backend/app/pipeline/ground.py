"""The grounding gate: keeps only flags and claims whose quote really is in its paragraph.

Pure functions, no I/O, no model. Nothing that fails here reaches the user.
"""

from dataclasses import dataclass, field
from typing import TypeVar

from backend.app.types import Claim, Flag
from backend.app.utils.text import normalize_with_map

EMPTY_QUOTE = "empty_quote"
UNKNOWN_PARAGRAPH = "unknown_paragraph"  # paragraph_id is not in the article
WRONG_PARAGRAPH = "wrong_paragraph"  # quote exists, but in a different paragraph
NOT_FOUND = "not_found"  # quote exists nowhere: fabricated, paraphrased, or spans paragraphs

Item = TypeVar("Item", Flag, Claim)


@dataclass
class GroundingResult:
    flags: list[Flag]
    claims: list[Claim]
    flags_dropped: int = 0
    claims_dropped: int = 0
    reasons: dict[str, int] = field(default_factory=dict)  # flags and claims combined


def verify_quotes(
    flags: list[Flag], claims: list[Claim], paragraphs: dict[int, str]
) -> GroundingResult:
    """Keep items whose quote is a literal substring of the paragraph they name.

    Matching ignores curly quotes, dash styles, non-breaking spaces and whitespace runs. A kept
    item's quote is rewritten to the exact text of the paragraph, so callers can find it with a
    plain substring search. If the quote occurs more than once, the first occurrence is used.
    """
    normalized: dict[int, tuple[str, list[int]]] = {}

    def norm(pid: int) -> tuple[str, list[int]]:
        if pid not in normalized:
            normalized[pid] = normalize_with_map(paragraphs[pid])
        return normalized[pid]

    def ground(item: Item) -> tuple[Item | None, str]:
        needle, _ = normalize_with_map(item.quote)
        if not needle:
            return None, EMPTY_QUOTE
        if item.paragraph_id not in paragraphs:
            return None, UNKNOWN_PARAGRAPH
        haystack, index = norm(item.paragraph_id)
        start = haystack.find(needle)
        if start == -1:
            elsewhere = any(norm(pid)[0].find(needle) != -1 for pid in paragraphs)
            return None, WRONG_PARAGRAPH if elsewhere else NOT_FOUND
        first, last = index[start], index[start + len(needle) - 1] + 1
        return item.model_copy(update={"quote": paragraphs[item.paragraph_id][first:last]}), ""

    result = GroundingResult(flags=[], claims=[])
    for item in flags:
        kept, reason = ground(item)
        if kept is None:
            result.flags_dropped += 1
            result.reasons[reason] = result.reasons.get(reason, 0) + 1
        else:
            result.flags.append(kept)
    for item in claims:
        kept, reason = ground(item)
        if kept is None:
            result.claims_dropped += 1
            result.reasons[reason] = result.reasons.get(reason, 0) + 1
        else:
            result.claims.append(kept)
    return result
