# Project structure and contracts

Monorepo. Python 3.12 backend, TypeScript extension, Python eval harness.

`litmus` is used below as the package/product slug. Swap it once the name is locked —
it appears in the Python package name, the extension ID, and the Firestore collection
prefix, so decide before hour one.

```
litmus/
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
(`backend/app/schemas/`); the TypeScript version is hand-mirrored in
`extension/lib/types.ts`. Do not generate one from the other — codegen setup costs more
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

### `POST /analyze` response

```json
{
  "doc_type": "news | opinion | other",
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
  "meta": {
    "cached": false,
    "doc_hash": "sha256:...",
    "model_route": "small | large",
    "latency_ms": 2140,
    "flags_dropped": 2
  }
}
```

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
├── pyproject.toml
├── app/
│   ├── main.py                (FastAPI app, lifespan, router mounting)
│   ├── config.py              (pydantic-settings, get_settings())
│   ├── deps.py                (Dependencies: user extraction, DB session)
│   ├── types.py               (Pydantic models: shared contracts)
│   ├── api/                   (HTTP route handlers)
│   │   ├── __init__.py
│   │   ├── coverage.py        (POST /coverage endpoint)
│   │   ├── analyze.py         (POST /analyze: auth, rate limit, delegates to the pipeline)
│   │   ├── health.py          (TODO: GET /health)
│   │   └── evals.py           (TODO: GET /eval/results)
│   ├── db/                    (Database, connection pooling, ORM)
│   │   ├── __init__.py
│   │   ├── connection.py      (Database class, AsyncSession factory)
│   │   └── models.py          (SQLAlchemy ORM: CachedAnalysis, RateLimit, etc.)
│   ├── middleware/            (Cross-cutting concerns)
│   │   ├── __init__.py
│   │   └── rate_limit.py      (Rate limit checking, bucket math, increments)
│   ├── ext/                   (External service integrations)
│   │   ├── __init__.py
│   │   ├── nemotron.py        (NemotronClient, the only caller of the model API)
│   │   └── search.py          (DuckDuckGo web search wrapper)
│   ├── pipeline/              (Analysis pipeline)
│   │   ├── __init__.py
│   │   ├── orchestrate.py     (PipelineContext, run_analysis)
│   │   ├── classify.py        (doc type, severity policy)
│   │   ├── label.py           (flags and claims per batch)
│   │   └── ground.py          (grounding gate)
│   ├── prompts/               (classify.txt, label.txt)
│   ├── schemas/
│   │   └── models.py          (lenient Raw* shapes the model returns)
│   ├── utils/
│   │   ├── __init__.py
│   │   └── text.py            (normalization, batching, sampling)
│   └── [future: clients/ (gdelt, store), verify pipeline]
└── tests/
    ├── conftest.py            (dummy settings so the pipeline imports without a database)
    ├── unit/
    │   ├── __init__.py
    │   ├── test_analyze_request.py
    │   ├── test_analyze_route.py
    │   ├── test_coverage.py
    │   ├── test_ground.py
    │   └── test_pipeline.py
    └── integration/
        └── __init__.py
```

### `app/main.py`
FastAPI app construction only. Mounts routers, configures CORS, initializes the Database
and other clients in lifespan. No business logic. Under 60 lines.

### `app/config.py`
```python
class Settings(BaseSettings):
    DATABASE_INSTANCE_STRING: str              # Supabase async PostgreSQL URL
    supabase_url: str
    supabase_anon_key: str
    nvidia_api_key: str            # from mounted secret file (when implemented)
    cache_ttl_hours: int = 24
```
`pydantic-settings` with `get_settings()` and `lru_cache`. Nothing reads `os.environ`
directly elsewhere.

### `app/deps.py`
- `set_db(database: Database)` — initialize the global DB reference in lifespan.
- `get_db_session() -> AsyncSession` — FastAPI dependency providing an async database session.
- `extract_user_id(token: str) -> UUID` — currently hash-based; TODO: replace with Supabase JWT.
- `get_current_user(authorization: Header) -> UUID` — extracts Bearer token and returns user ID.

### `app/types.py`
Pydantic models for all request/response contracts. Currently:
- `Article`, `CoverageRequest`, `CoverageResponse`, `RelatedSource`, `CoverageMeta`, `Omission`
Later: `AnalyzeRequest`, `AnalyzeResponse`, `Flag`, `Claim`, etc.

### `app/api/coverage.py`
```python
@router.post("/coverage", response_model=CoverageResponse)
async def get_coverage(request: CoverageRequest,
                       session: AsyncSession = Depends(get_db_session),
                       user_id: UUID = Depends(get_current_user)) -> CoverageResponse
```
Checks rate limit, calls web search, transforms results, returns. Delegates to middleware
for rate limiting.

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

### `app/db/connection.py`
```python
class Database:
    async def init()            # Create async engine and session factory
    async def get_session()     # AsyncGenerator[AsyncSession, None] for dependency injection
    async def close()           # Cleanup on shutdown
    async def create_all()      # Create tables from ORM metadata
```

### `app/db/models.py`
SQLAlchemy ORM models:
- `CachedAnalysis` — cache `/analyze` results by `doc_hash`
- `CachedCoverage` — cache `/coverage` results by `(doc_hash, claim_id)`
- `RateLimit` — per-user request counts by hour bucket
- `GlobalRateLimit` — global request count by hour bucket

### `app/middleware/rate_limit.py`
```python
async def check_rate_limit(session: AsyncSession, user_id: UUID) -> tuple[bool, dict]
async def increment_rate_limit(session: AsyncSession, user_id: UUID) -> None
```
Implements fixed-window rate limiting with per-user and global hourly ceilings (100 and
10,000 respectively). Can be replaced with sliding window later.

### `app/ext/search.py`
```python
async def search(title: str, entities: list[str], *, max_records: int, timelimit: str) -> list[Article]
```
Searches DuckDuckGo news for coverage of a claim. Social and reference domains are
dropped and only one result per domain is kept. The blocking `ddgs` call runs in a worker
thread so it doesn't stall the event loop.

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
    budget_s: float = 25.0

async def run_analysis(req: AnalyzeRequest, ctx: PipelineContext) -> AnalyzeResponse
```
The only function routes call. Sequence: resolve doc type → batch paragraphs → label the
batches concurrently (at most `max_concurrency` model calls in flight) → ground → number
claims `c0..cN` in article order → assemble. `label_route` picks which model labels and is
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

**Never hide flags in the pipeline.** Severity and confidence are recorded, not used to
filter. `SEVERITY_POLICY` may change a flag's `severity`; the only thing that removes a flag
is the grounding gate. Any display threshold is applied at render time in the extension,
and the SemEval runner applies its own, so the eval always sees every grounded flag.

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

### `app/ext/nemotron.py`
```python
class NemotronClient:
    async def complete_json(self, prompt: str, model: str, schema: type[T], *,
                            retries: int = 2, thinking: bool = False) -> T
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
night. `classify.txt` and `label.txt` exist. Literal JSON braces in a template are doubled
(`{{ }}`) because the templates are filled with `str.format`.

### `app/utils/hashing.py`
```python
def doc_hash(url: str, paragraphs: list[Paragraph]) -> str
```
`sha256` of normalized URL (strip query params, fragments, trailing slash) plus the joined
normalized paragraph text. This is the cache key — changing it invalidates every cached
demo article, so freeze it early.

### `app/utils/text.py`
`normalize_for_match()`, `batch_paragraphs()`, `sample_for_classification()`. Shared by the
pipeline and the eval harness. `normalize_with_map()` also returns each normalized
character's index in the original text; the grounding gate uses it to hand back the
paragraph's exact text.

---

## 3. Extension

```
extension/
├── wxt.config.ts
├── package.json
├── tsconfig.json
├── entrypoints/
│   ├── background.ts
│   ├── content.ts
│   └── sidepanel/
│       ├── index.html
│       ├── main.tsx
│       └── App.tsx
├── components/
│   ├── FlagList.tsx
│   ├── FlagCard.tsx
│   ├── ClaimList.tsx
│   ├── CoveragePanel.tsx
│   ├── DocTypeBadge.tsx
│   └── EvalPage.tsx
├── lib/
│   ├── types.ts
│   ├── messaging.ts
│   ├── api.ts
│   ├── auth.ts
│   ├── extract.ts
│   ├── paragraphs.ts
│   ├── highlight.ts
│   └── metadata.ts
└── assets/
```

### `wxt.config.ts`
Manifest config. `permissions: ["storage", "sidePanel", "activeTab"]`,
`host_permissions` listing **only your five tested news domains**, no
`externally_connectable`. Content script `matches` mirrors the host list.

### `lib/types.ts`
Hand-mirror of the Python schemas, plus the message envelope:
```ts
type Msg =
  | { kind: "ANALYZE_REQUEST" }
  | { kind: "ANALYZE_RESULT"; payload: AnalyzeResponse }
  | { kind: "ANALYZE_ERROR"; error: string }
  | { kind: "COVERAGE_REQUEST"; claimId: string }
  | { kind: "COVERAGE_RESULT"; payload: CoverageResponse }
  | { kind: "FOCUS_FLAG"; paragraphId: number; quote: string };
```
`FOCUS_FLAG` is the side panel telling the content script to scroll to and pulse a
highlight. Cheap to build, disproportionately good in a demo.

### `entrypoints/background.ts`
The trusted core. Registers `chrome.runtime.onMessage`, rejects any message where
`sender.id !== chrome.runtime.id`. Holds no module-level mutable state — Chrome evicts
idle workers, so anything durable goes to `chrome.storage.session`. Opens the side panel
on action click. All network calls originate here.

### `entrypoints/content.ts`
Runs in the page. No token ever reaches this file. On `ANALYZE_REQUEST`: extract, number,
scrape metadata, send to background, await result, inject highlights. Keeps the
`Map<number, HTMLElement>` of paragraph ID to live DOM node in memory — it never crosses
a message boundary.

### `lib/extract.ts`
```ts
export function extractArticle(doc: Document): { title: string; root: HTMLElement } | null
```
Readability against a `doc.cloneNode(true)` — Readability mutates the document it's given,
and mutating the live page breaks your highlight targets.

### `lib/paragraphs.ts`
```ts
export function toParagraphs(root: HTMLElement): {
  paragraphs: Paragraph[];
  nodeMap: Map<number, HTMLElement>;
}
```
**The riskiest file in the project.** Every site nests article text differently. Skip
elements under 40 characters, skip figure captions and pull quotes, and log the resulting
paragraph count per domain during testing. If this produces different structures across
your five sites, every downstream `paragraph_id` is wrong.

### `lib/metadata.ts`
```ts
export function detectSection(doc: Document, url: string): "opinion" | "news" | null
```
Checks URL path segments (`/opinion/`, `/commentary/`, `/editorial/`),
`<meta property="article:section">`, and schema.org `articleSection`. Returns `null`
freely — a wrong hint is worse than no hint.

### `lib/highlight.ts`
```ts
export function applyFlags(flags: Flag[], nodeMap: Map<number, HTMLElement>): void
export function clearHighlights(): void
export function focusFlag(paragraphId: number, quote: string): void
```
Uses `Range` and `TreeWalker` to wrap the quote inside one known element. Never
`innerHTML` replacement — that destroys event listeners the news site depends on and can
blank the page. Tooltip content in a Shadow DOM. If the quote appears more than once
in the paragraph, wrap the first occurrence — the same rule the grounding gate and the
SemEval runner use.

### `lib/api.ts`
```ts
export async function postAnalyze(body: AnalyzeRequest): Promise<AnalyzeResponse>
export async function postCoverage(body: CoverageRequest): Promise<CoverageResponse>
```
Background-only. Reads base URL from `import.meta.env.API_BASE`.

### `lib/auth.ts`
```ts
export async function getIdToken(): Promise<string>
```
Imports from `firebase/auth/web-extension`. Anonymous sign-in on first call, SDK handles
refresh. Background-only.

---

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
