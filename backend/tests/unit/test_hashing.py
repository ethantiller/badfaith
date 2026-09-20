from backend.app.types import Paragraph
from backend.app.utils.hashing import doc_hash

PARAS = [Paragraph(id=0, text="Hello  world."), Paragraph(id=1, text="Second one.")]


def test_hash_ignores_query_fragment_and_trailing_slash():
    base = doc_hash("https://Example.com/story", PARAS)
    assert base.startswith("sha256:")
    assert doc_hash("https://example.com/story/?utm=1#top", PARAS) == base


def test_hash_changes_with_text_or_path():
    base = doc_hash("https://example.com/story", PARAS)
    assert doc_hash("https://example.com/other", PARAS) != base
    assert doc_hash("https://example.com/story", PARAS[:1]) != base
