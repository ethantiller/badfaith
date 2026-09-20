import pytest

from eval.load import Article, build_paragraphs, load_train

N_ARTICLES = 371
N_SPANS = 6129
N_ARTICLES_WITHOUT_SPANS = 14


@pytest.fixture(scope="module")
def articles() -> list[Article]:
    return load_train()


def make_article(text: str) -> Article:
    return Article(id="0", title=text.split("\n", 1)[0], text=text, spans=[])


def test_load_train_counts(articles):
    assert len(articles) == N_ARTICLES
    assert sum(len(a.spans) for a in articles) == N_SPANS
    assert sum(not a.spans for a in articles) == N_ARTICLES_WITHOUT_SPANS


def test_load_train_sorted_by_id(articles):
    ids = [a.id for a in articles]
    assert ids == sorted(ids)
    assert len(set(ids)) == len(ids)


def test_title_is_first_line_and_spans_fit_text(articles):
    for a in articles:
        assert a.text.startswith(a.title + "\n")
        for s in a.spans:
            assert 0 <= s.start < s.end <= len(a.text)


@pytest.mark.parametrize("lines_per_para", [1, 3, 5])
def test_paragraphs_are_contiguous_slices_of_the_text(articles, lines_per_para):
    for a in articles:
        paras = build_paragraphs(a, lines_per_para)
        assert paras
        for p in paras:
            assert a.text[p.start : p.start + len(p.text)] == p.text, (a.id, p.id)


def test_paragraph_ids_are_consecutive_and_title_is_first(articles):
    for a in articles:
        paras = build_paragraphs(a)
        assert [p.id for p in paras] == list(range(len(paras)))
        assert paras[0].start == 0
        assert paras[0].text == a.title
        assert not any(not p.text.strip() for p in paras)


def test_build_paragraphs_groups_and_offsets():
    a = make_article("Title\n\nl1\nl2\nl3\nl4\nl5\n")
    paras = build_paragraphs(a, lines_per_para=3)
    assert [(p.id, p.start, p.text) for p in paras] == [
        (0, 0, "Title"),
        (1, 7, "l1\nl2\nl3"),
        (2, 16, "l4\nl5"),
    ]


def test_build_paragraphs_skips_whitespace_groups_and_renumbers():
    a = make_article("Title\n\nl1\n\n \nl4\n\n\n\nl8\n")
    paras = build_paragraphs(a, lines_per_para=2)
    # lines: l1,"" | " ",l4 | "","" | "",l8  -> the "","" group is dropped
    assert [p.text for p in paras] == ["Title", "l1\n", " \nl4", "\nl8"]
    assert [p.id for p in paras] == [0, 1, 2, 3]
    for p in paras:
        assert a.text[p.start : p.start + len(p.text)] == p.text


def test_non_blank_line_two_is_kept_as_body():
    a = make_article("Title\nSubtitle\nbody1\nbody2\n")
    paras = build_paragraphs(a, lines_per_para=1)
    assert [p.text for p in paras] == ["Title", "Subtitle", "body1", "body2"]


def test_lines_per_para_must_be_positive():
    with pytest.raises(ValueError):
        build_paragraphs(make_article("Title\n\nbody\n"), lines_per_para=0)


def test_missing_directory_points_at_the_download(tmp_path):
    with pytest.raises(FileNotFoundError, match="Zenodo"):
        load_train(tmp_path)
