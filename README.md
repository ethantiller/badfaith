# Bad Faith 2026

## SteelHacks XIII Hackathon 2026

Project Members:
- Maxwell Blevins
- Jason Sun
- Ethan Tiller

# Project structure and contracts

Bad Faith is a monorepo for a news article auditing product. The backend is a Python
3.12 FastAPI server, the frontend is a Chrome extension, and the eval harness is a
standalone Python CLI.

Use `badfaith` as the package/product slug unless a more specific deploy-time identifier
is intentionally chosen. The slug can affect the Python package name, extension ID, and
Firestore collection prefix, so keep it consistent across the stack.

```
badfaith/
├── extension/
├── backend/
├── eval/
├── docs/
├── .github/workflows/
└── README.md
```

---

## 1. Shared contract

Defined once, mirrored in two languages. Python is the source of truth
(`backend/app/types.py`); the TypeScript version is hand-mirrored in
`extension/src/types.ts`. Do not generate one from the other — codegen setup costs more
than the 80 lines you'd save.

### `POST /analyze` request

```json
{
  "url": "https://example.com/politics/article",
  "title": "Senate passes funding bill",
  "section_hint": "opinion | news | null",
  "paragraphs": [
    { "id": 0, "text": "The Senate voted Tuesday..." },
    { "id": 1, "text": "Critics called the reckless scheme..." }
  ]
}
```

`section_hint` is what the content script scraped from URL path, `<meta>` section tags, or
schema.org `articleSection`. `null` means nothing found — backend falls back to a model
call.

Size caps sit on the Pydantic model, so an oversized payload is a 422 before any handler
runs: 400 paragraphs, 5,000 characters per paragraph, a 2,048-character URL, a
512-character title.

### `POST /analyze` response

```json
{
  "doc_type": "news | news_with_slight_bias | news_with_heavy_bias | opinion | other",
  "doc_type_source": "metadata | model",
  "flags": [
    {
      "paragraph_id": 1,
      "quote": "reckless scheme",
      "technique": "loaded_language",
      "severity": "low | medium | high",
      "confidence": 0.82,
      "explanation": "One sentence, no hedging."
    }
  ],
  "claims": [
    {
      "id": "c0",
      "paragraph_id": 3,
      "quote": "unemployment fell to 3.8 percent",
      "claim_type": "statistic | attributed_quote | date_or_count",
      "entities": ["unemployment", "August 2026"]
    }
  ],
  "citations": [
    {
      "id": "s0",
      "paragraph_id": 4,
      "quote": "we will not raise taxes",
      "speaker": "Jane Doe, Health Secretary",
      "speaker_role": "government_official | elected_politician | journalist | academic_expert | industry_corporate | funder_donor | advocacy_activist | think_tank | legal_court | private_individual | anonymous | unknown"
    }
  ],
  "meta": {
    "cached": false,
    "doc_hash": "sha256:...",
    "model_route": "small | large",
    "latency_ms": 2140,
    "flags_dropped": 2
  }
}
```

`citations` are quoted words with the speaker the paragraph names. They come from a second model
call over quoted paragraphs, run in parallel with labeling. Each distinct named speaker is then
searched on the web (DDGS) and given a `speaker_role` from the snippets; no evidence means
`unknown`, an unnamed source is `anonymous`. The bias note shown for a role is a fixed client-side
map, never model text. The role list is locked in `app/types.py::SpeakerRole`.

`claims` carry no verification status here. Verification is `/coverage`, which is
user-triggered. `flags_dropped` is the grounding gate's reject count — surface it in the
panel, it's a credibility signal. `model_route` is the tier that labeled the article,
`small` or `large`.

### `POST /coverage` request

```json
{
  "doc_hash": "sha256:...",
  "claim_id": "c0",
  "quote": "unemployment fell to 3.8 percent",
  "entities": ["unemployment", "August 2026"],
  "title": "Senate passes funding bill"
}
```

### `POST /coverage` response

```json
{
  "claim_id": "c0",
  "status": "supported | contradicted | unverified",
  "related": [
    { "outlet": "Reuters", "url": "...", "headline": "...", "snippet": "...", "seendate": "2026-09-17T14:00:00Z" }
  ],
  "omissions": [
    { "summary": "Other outlets note the figure excludes seasonal workers.", "corroborating_urls": ["..."] }
  ],
  "meta": { "sources_queried": 47, "latency_ms": 3200 }
}
```

### Technique enum

Lock this list. Free-text technique names will produce forty variants of the same label
and break your eval mapping.

```
loaded_language
name_calling
repetition
exaggeration_minimization
doubt
appeal_to_fear
flag_waving
causal_oversimplification
slogans
appeal_to_authority
false_dilemma
thought_terminating_cliche
whataboutism
straw_man
red_herring
bandwagon
```

Sixteen values covering all fourteen SemEval-2020 Task 11 classes (PTC-SemEval20), in the
order of the task paper's Table 1. `whataboutism`, `straw_man` and `red_herring` are one
merged SemEval class, `false_dilemma` is its Black-and-White Fallacy, and `bandwagon`
covers Bandwagon / Reductio ad hitlerum. The eval runner renames and collapses on the way
in, so scoring stays many-to-one.

Mapping used when scoring against SemEval (spellings as listed on the dataset card; confirm
against the data files when the runner is built):

| SemEval class | Our value(s) |
|---|---|
| Loaded Language | `loaded_language` |
| Name Calling/Labeling | `name_calling` |
| Repetition | `repetition` |
| Exaggeration/Minimisation | `exaggeration_minimization` |
| Doubt | `doubt` |
| Appeal to fear-prejudice | `appeal_to_fear` |
| Flag-Waving | `flag_waving` |
| Causal Oversimplification | `causal_oversimplification` |
| Slogans | `slogans` |
| Appeal to Authority | `appeal_to_authority` |
| Black-and-White Fallacy | `false_dilemma` |
| Thought-terminating Clichés | `thought_terminating_cliche` |
| Whataboutism/Straw Men/Red Herring | `whataboutism`, `straw_man`, `red_herring` |
| Bandwagon/Reductio ad hitlerum | `bandwagon` |

---

## 2. Backend

```
backend/
├── Dockerfile
├── pyproject.toml
├── app/
│   ├── main.py
│   ├── config.py
│   ├── deps.py
│   ├── routes/
│   │   ├── analyze.py
│   │   ├── coverage.py
│   │   ├── health.py
│   │   └── evals.py
│   ├── schemas/
│   │   ├── requests.py
│   │   ├── responses.py
│   │   └── models.py
│   ├── pipeline/
│   │   ├── orchestrate.py
│   │   ├── classify.py
│   │   ├── label.py
│   │   ├── speakers.py
│   │   ├── ground.py
│   │   └── verify.py
│   ├── clients/
│   │   ├── nemotron.py
│   │   ├── gdelt.py
│   │   └── store.py
│   ├── prompts/
│   │   ├── classify.txt
│   │   ├── label.txt
│   │   ├── speakers.txt
│   │   ├── speaker_roles.txt
│   │   └── verify.txt
│   └── utils/
│       ├── hashing.py
│       └── text.py
└── tests/
    ├── test_ground.py
    ├── test_hashing.py
    ├── test_schemas.py
    └── test_xxe.py
```

### `app/main.py`
FastAPI app construction only. Mounts routers, CORS middleware allowlisting the extension
origin, lifespan handler that creates one shared `httpx.AsyncClient` and one Firestore
client and puts them on `app.state`. No business logic. Under 60 lines.

### `app/config.py`
```python
class Settings(BaseSettings):
    nvidia_api_key: str            # from mounted secret file
    nemotron_base_url: str
    model_small: str
    model_large: str
    firebase_project_id: str
    firestore_prefix: str = "prod"
    cache_ttl_hours: int = 24
    rate_limit_per_hour: int = 60
    global_limit_per_hour: int = 2000
    max_paragraphs: int = 300
    max_chars_per_paragraph: int = 4000
    allowed_origin: str
```
`pydantic-settings`, single `get_settings()` with `lru_cache`. Nothing reads `os.environ`
anywhere else in the codebase.

### `app/deps.py`
Two FastAPI dependencies.
- `current_uid(authorization: str = Header(...)) -> str` — verifies the Firebase ID token
  via Admin SDK, returns the uid, raises 401.
- `enforce_rate_limit(uid: str = Depends(current_uid)) -> None` — Firestore transactional
  counter increment against `rate_limits/{uid}/{hour_bucket}`, plus the global bucket.
  Raises 429.

### `app/api/analyze.py`
```python
@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(payload: AnalyzeRequest, request: Request,
                  session: AsyncSession = Depends(get_db_session),
                  user_id: UUID = Depends(get_current_user))
```
Rate-limit check, then `run_analysis` with the `PipelineContext` from `app.state.pipeline`,
then the rate-limit increment (successful analyses only, as in `/coverage`). Answers 429
when limited, 502 when no batch produced a usable result, and 503 when the server has no
NVIDIA key (it still boots, and `/coverage` keeps working). Caching is not wired yet: it
needs a frozen `doc_hash` (see the TODO in the route).

### `app/routes/coverage.py`
```python
@router.post("/coverage", response_model=CoverageResponse)
async def coverage(req: CoverageRequest, uid: str = Depends(current_uid),
                   _: None = Depends(enforce_rate_limit)) -> CoverageResponse
```
Caches per `(doc_hash, claim_id)` so repeat clicks on the same claim are free.

### `app/routes/health.py`
`GET /health` → `{"status": "ok"}`. No dependencies, no auth — Cloud Run needs it to
answer even when Firestore is down.

### `app/routes/evals.py`
`GET /eval/results` → the latest rolled-up eval JSON. Reads a static file baked into the
image or a Firestore doc. No auth; the numbers aren't secret and judges may hit it
directly.

### `app/schemas/requests.py`
`Paragraph`, `AnalyzeRequest`, `CoverageRequest`. All size limits expressed as
`Field(max_length=...)` and validators, so an oversized payload is rejected by FastAPI
before a single line of your code runs.

### `app/schemas/responses.py`
`Flag`, `Claim`, `AnalyzeMeta`, `AnalyzeResponse`, `RelatedArticle`, `Omission`,
`CoverageResponse`. `Technique` and `Severity` as `StrEnum`.

### `app/schemas/models.py`
The shapes Nemotron is asked to return, separate from what you return to the client.
`RawLabelBatch`, `RawClassification`, `RawVerification`. Keeping these separate means a
model output change doesn't ripple into your public contract.

### `app/pipeline/orchestrate.py`
```python
@dataclass
class PipelineContext:
    nemotron: NemotronClient
    model_small: str
    model_large: str
    label_route: Literal["small", "large"] = "large"
    batch_size: int = 5
    max_concurrency: int = 8
    budget_s: float = 60.0

async def run_analysis(req: AnalyzeRequest, ctx: PipelineContext) -> AnalyzeResponse
```
The only function routes call. Sequence: resolve doc type → batch paragraphs → label the
batches concurrently (at most `max_concurrency` model calls in flight; each batch also runs
the citation extraction alongside `label_batch`) → ground flags, claims and citations → drop
flags below `MIN_FLAG_CONFIDENCE` (0.85) → look up each distinct speaker's role → number
claims `c0..cN` and citations `s0..sN` in article order → assemble. The
`news_with_slight_bias` / `news_with_heavy_bias` tier is counted from the surviving flags
only, never from claims or citations. `label_route` picks which model labels and is
what `meta.model_route` reports; the routing eval flips it.

**Partial failure.** A batch that raises, or is still running when `budget_s` runs out, is
cancelled and logged; its paragraphs come back unlabeled and the request still succeeds. If
*every* batch fails, `AnalysisError` is raised (the route answers 502) rather than returning
a clean article that was never actually read. The failed-batch count is only logged for now:
`meta` has no field for it yet.

### `app/pipeline/classify.py`
```python
async def resolve_doc_type(section_hint: str | None, title: str,
                           sample: list[Paragraph], ctx) -> tuple[DocType, DocTypeSource]
```
A non-null `section_hint` short-circuits with no model call. Otherwise one small-model call;
a failed call or an unknown answer falls back to `other`, whose severity policy changes
nothing.

`SEVERITY_POLICY` is the explicit doc type → technique → severity table. Its starting values
mark the wording that is expected in opinion writing (loaded language, name calling,
exaggeration/minimization, repetition, slogans, flag waving) `high` in news and `low` in
opinion; every other technique keeps the model's severity. These values are a placeholder
for editorial review.

### `app/pipeline/label.py`
```python
async def label_batch(paragraphs: list[Paragraph], doc_type: DocType,
                      model: str, ctx) -> tuple[list[Flag], list[Claim]]
```
One call per batch returning both flags and claims — the merged design. Batch size around
5 paragraphs, tune on latency. The client makes one reprompt on a JSON parse failure; if
that also fails, `NemotronError` propagates and the orchestrator decides what a failed batch
means. Items with an unknown technique or claim type are skipped. An unknown severity falls
back to `medium`, because a grounded flag is never dropped over a secondary field.

Each paragraph goes into the prompt as one `[id] text` line, so article text can't forge a
paragraph line, and the prompt tells the model the paragraphs are untrusted data.

**Quote the minimal span.** `label.txt` tells the model to quote only the words that carry
the technique, not the whole sentence. SemEval's gold spans are short phrases, so
sentence-length quotes would score near zero on exact match, and short quotes also make
better highlights.

**Confidence floor.** `label_batch` records confidence and filters nothing.
`SEVERITY_POLICY` may change a flag's `severity`. `run_analysis` then drops any grounded flag
below `MIN_FLAG_CONFIDENCE = 0.85`, and the extension applies the same 0.85 in
`api/analyze.ts` as a second guard. The eval harness does not go through `run_analysis`, so
it still sees every grounded flag.

### `app/pipeline/ground.py`
```python
def verify_quotes(flags: list[Flag], claims: list[Claim],
                  paragraphs: dict[int, str]) -> GroundingResult
```
Pure function, no I/O, no model. Normalizes whitespace and smart quotes, then requires the
quote to be a literal substring of its paragraph. Returns kept items plus a drop count and
reasons. **The most heavily tested file in the repo** — `test_ground.py` covers curly
apostrophes, non-breaking spaces, em dashes, wrong `paragraph_id`, and fabricated text.

**One quote, one place.** If a quote occurs more than once in its paragraph, it refers to
the first occurrence. `highlight.ts` and the SemEval runner use the same rule, so what the
panel highlights and what the eval scores agree.

**Kept quotes are the paragraph's own text.** Matching ignores typography, so a kept item's
quote is rewritten to the exact characters from the paragraph (curly quotes, dash style and
all). `highlight.ts` and the SemEval runner can then locate it with a plain substring search.
Drop reasons: `empty_quote`, `unknown_paragraph`, `wrong_paragraph` (the quote exists, in a
different paragraph) and `not_found` (fabricated, paraphrased, or spanning paragraphs).

### `app/pipeline/verify.py`
```python
async def verify_claim(claim: Claim, title: str, ctx) -> CoverageResponse
```
Builds the GDELT query from claim entities, fetches, then one Nemotron call comparing the
claim against the returned snippets.

### `app/clients/nemotron.py`
```python
class NemotronClient:
    async def complete_json(self, prompt: str, model: str,
                            schema: type[BaseModel], *, retries: int = 2) -> BaseModel
```
The single choke point for model calls. Owns retries with jittered backoff, per-call
timeout, JSON extraction, Pydantic parsing, the reprompt, and structured logging of token
counts and latency. Nothing else in the codebase calls the model API directly.

### `app/clients/gdelt.py`
```python
async def search(keywords: list[str], *, hours: int = 72,
                 max_records: int = 50) -> list[RelatedArticle]
```
DOC API, `mode=ArtList&format=json`. Dedupes by domain so one outlet's syndication
network doesn't fill all fifty slots.

### `app/clients/store.py`
```python
async def get_analysis(doc_hash: str) -> AnalyzeResponse | None
async def put_analysis(doc_hash: str, resp: AnalyzeResponse, ttl_hours: int) -> None
async def get_coverage(doc_hash: str, claim_id: str) -> CoverageResponse | None
async def put_coverage(doc_hash: str, claim_id: str, resp: CoverageResponse) -> None
async def bump_rate_limit(uid: str, limit: int) -> bool
```
Firestore access lives only here. Collections:
```
{prefix}_analyses/{doc_hash}
{prefix}_coverage/{doc_hash}_{claim_id}
{prefix}_rate_limits/{uid}
```

### `app/prompts/*.txt`
Plain text with `{placeholders}`, loaded at import. Prompts in files, not string literals
in Python — three people editing prompts inside functions will produce merge conflicts all
night.

### `app/utils/hashing.py`
```python
def doc_hash(url: str, paragraphs: list[Paragraph]) -> str
```
`sha256` of normalized URL (strip query params, fragments, trailing slash) plus the joined
normalized paragraph text. This is the cache key — changing it invalidates every cached
demo article, so freeze it early.

### `app/utils/text.py`
`normalize_for_match()`, `batch_paragraphs()`, `sample_for_classification()`. Shared by the
pipeline and the eval harness.

---

## 3. Extension

Vite + React + TypeScript, Manifest V3, loaded unpacked. The full tree, the three-pass
build and the per-file notes live in **`docs/project-structure.md` §3**; that is the one
copy, so this section stays short rather than drifting away from it.

The shape in one paragraph: the **side panel** (Chrome's native `chrome.sidePanel`, opened
from the toolbar icon) holds sign-in, the Analyze button and the report; the **background
service worker** is the only context with a token or a `fetch` call; the **content script**
renders nothing until the side panel asks, then injects highlights and a hover summary into
the article inside a closed shadow root, while the report itself renders in the panel
beside the page rather than on top of it. The paragraph ID to live-element map stays in the
content script and never crosses a message boundary. Requests are checked against the
`AnalyzeRequest` schema before they are sent, so a bad payload fails with a message that
names the problem instead of an opaque 422.

Build and load it with `cd extension && make build`, then load `extension/dist/` unpacked.
See `extension/README.md` for the environment variables and the Supabase redirect URL that
password reset needs.

## 4. Eval harness

```
eval/
├── cli.py
├── report.py
├── datasets/
│   ├── semeval/
│   ├── symmetry/
│   │   ├── pairs.jsonl
│   │   └── build_pairs.py
│   └── adversarial/
├── runners/
│   ├── base.py
│   ├── semeval_spans.py
│   ├── symmetry.py
│   ├── grounding.py
│   └── routing.py
└── results/
```

### `runners/base.py`
Every runner returns the same envelope, so `report.py` and the eval page never special-case:
```python
@dataclass
class EvalResult:
    name: str
    headline_metric: str      # "Span F1", "Mean score delta"
    headline_value: float
    detail: dict[str, Any]
    n: int
    run_at: datetime
    notes: str                # caveats, disclosed splits
```

### `runners/semeval_spans.py`
Scores the pipeline against SemEval-2020 Task 11 (PTC-SemEval20): English news articles
with human-labeled propaganda spans. It is the only eval scored against independent
ground truth, which is why it belongs in the pitch. It is an eval only — nothing at
runtime and no training depends on it.

**Data.** `datasets-v2.tgz` from the task's Zenodo record
(https://zenodo.org/records/3952415, CC BY 4.0 — cite the task overview paper), fetched
on demand into `eval/datasets/semeval/`. Test-set gold labels are hidden, so score on
train and dev only and say so in `notes`. Use a fixed-seed subset of about 50 articles:
the free API tier is rate limited, and the seed keeps runs comparable. Record `n`.

**How a run works.**
1. Load each article's plain text and its gold spans, `(technique, start, end)` character
   offsets.
2. Split the article into paragraphs, keeping each paragraph's start offset.
3. Call `run_analysis` directly. No HTTP, no server.
4. Convert each flag to article offsets: the paragraph's start plus the quote's position
   in it. The grounding gate returns every kept quote as the paragraph's exact text, so a
   plain `str.find` (first occurrence) gives the position.
5. Collapse our 16 labels onto SemEval's 14 classes using the table in the technique enum
   section.
6. Score per technique — exact match and overlap — as precision, recall and F1.

**Open item.** Decide what counts as overlap (any overlap, or a minimum fraction of the
gold span) when building the runner, and record the choice in `notes`.

**Caveats to disclose in `notes`.** The corpus is dense — about 17 labeled spans per
article — so recall will be limited for a pipeline that flags conservatively. The articles
date from mid-2017 to early 2019 and come from 13 propaganda and 36 non-propaganda outlets.
Nothing here is tuned on the data. Only train/dev were scored, on a subset of `n` articles.

### `runners/symmetry.py`
Loads `pairs.jsonl` (article, party-swapped article), runs both, reports mean absolute
delta in flag count and severity, plus label flip rate. Near-zero proves evenhandedness.
A gap is a measured finding. Both are presentable results.

### `runners/grounding.py`
Runs the pipeline with the gate instrumented, reports fabrication rate — flags dropped
divided by flags returned. Target is a number you can state out loud.

### `runners/routing.py`
Same inputs through small and large models. Reports agreement rate, latency delta, and
cost per article. This is the file that justifies calling your architecture a routed
pipeline rather than one big prompt.

### `cli.py`
```
python -m eval.cli run --suite tier1
python -m eval.cli run --only symmetry
python -m eval.cli report
```
Imports `backend.app.pipeline` directly. No HTTP, no running server.

### `report.py`
Rolls the newest result per runner into `results/latest.json`, which `GET /eval/results`
serves and `EvalPage.tsx` renders.

---

## 5. Root files

**`.github/workflows/deploy.yml`** — on push to `main`: build the backend image, push to
Artifact Registry, deploy to Cloud Run.

**`.github/workflows/test.yml`** — `pytest` on the backend, `tsc --noEmit` on the
extension. Fast, runs on every PR.

**`README.md`** — what it is, how to load the extension unpacked, how to run the backend
locally, and the eval numbers. Judges read this.

**`docs/`** — `architecture.md`, this file, and the eval writeup.