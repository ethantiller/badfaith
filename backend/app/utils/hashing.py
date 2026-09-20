import hashlib
from urllib.parse import urlsplit

from backend.app.types import Paragraph
from backend.app.utils.text import normalize_for_match


def _normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    path = parts.path.rstrip("/")
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}{path}"


def doc_hash(url: str, paragraphs: list[Paragraph]) -> str:
    """Stable cache key: sha256 of the normalized URL (no query, fragment or trailing slash)
    plus the normalized paragraph text. Changing this invalidates every cached article."""
    text = "\n".join(normalize_for_match(p.text) for p in paragraphs)
    digest = hashlib.sha256(f"{_normalize_url(url)}\n{text}".encode()).hexdigest()
    return f"sha256:{digest}"
