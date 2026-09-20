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

Size caps are expressed on the Pydantic model (`backend/app/types.py::AnalyzeRequest`), so
an oversized payload is a 422 before any handler runs:

| Cap | Value |
|---|---|
| `MAX_PARAGRAPHS` | 400 |
| `MAX_PARAGRAPH_CHARS` | 5,000 |
| `MAX_URL_CHARS` | 2,048 |
| `MAX_TITLE_CHARS` | 512 |

`backend/tests/unit/test_analyze_request.py` covers each one, plus a rejected
`section_hint`. The TypeScript mirror re-exports the same numbers from
`extension/src/types.ts`.

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
│   │   └── search.py          (DuckDuckGo news search and speaker text search)
│   ├── pipeline/              (Analysis pipeline)
│   │   ├── __init__.py
│   │   ├── orchestrate.py     (PipelineContext, run_analysis)
│   │   ├── classify.py        (doc type, severity policy)
│   │   ├── label.py           (flags and claims per batch)
│   │   ├── speakers.py        (citation extraction, speaker role lookup)
│   │   └── ground.py          (grounding gate)
│   ├── prompts/               (classify.txt, label.txt, speakers.txt, speaker_roles.txt)
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

```python
async def search_speaker(name: str, context: str = "", *, max_results: int = 5) -> list[str]
```
A general (not news-only) DuckDuckGo text search for a quoted speaker, returning short
`"title: body"` snippets. Reference sites are allowed. Any `DDGSException` gives an empty
list, which the caller treats as no evidence.

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
claims `c0..cN` and citations `s0..sN` in article order → assemble.

**Bias tier.** For a `news` document, `news_with_slight_bias` (1 to 10 flags) or
`news_with_heavy_bias` (more than 10) is decided from the flags that survive the confidence
floor. Claims and citations never count. `label_route` picks which model labels and is
what `meta.model_route` reports; the routing eval flips it.

**Partial failure.** A batch that raises, or is still running when `budget_s` runs out, is
cancelled and logged; its paragraphs come back unlabeled and the request still succeeds. If
*every* batch fails, `AnalysisError` is raised (the route answers 502) rather than returning
a clean article that was never actually read. A failed citation call or speaker lookup does
not count as a failed batch: it only leaves that batch without citations, or a speaker
`unknown`. The failed-batch count is only logged for now:
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

### `app/pipeline/speakers.py`
```python
async def extract_citations(paragraphs: list[Paragraph], model: str, ctx) -> list[Citation]
async def resolve_roles(speakers: list[str], title: str, ctx) -> dict[str, SpeakerRole]
```
`extract_citations` keeps only paragraphs containing a quotation mark (straight, curly,
low-9 or guillemet) and makes one model call over them, returning `(paragraph_id, quote,
speaker)`; a blank speaker becomes `anonymous`. It raises on failure and the orchestrator
degrades. `resolve_roles` never raises: it searches each distinct named speaker (at most 15)
with `search_speaker`, then makes one small-model call that classifies them from the
snippets only. No snippets, a failed call, or an unrecognised role all leave `unknown`, and
`anonymous` speakers are never searched. Citations are grounded like flags and claims; the
`"citations"` key is checked by `deps.ensure_quote_in_text`.

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

Vite + React + TypeScript, Manifest V3, loaded unpacked. (WXT was the original plan; the
scaffold that got built is plain Vite, and the three-pass build below is what that costs.)

```
extension/
├── vite.config.ts        (one config, branching on BUILD_TARGET)
├── public/               (manifest.json, sidepanel.html, reset.html)
└── src/
    ├── background.ts     (entry: service worker, the only token holder and fetch caller)
    ├── types.ts          (hand-mirror of app/types.py, plus the message envelopes)
    ├── api/              (everything that speaks HTTP to the backend)
    │   ├── client.ts     (ApiError, headers, 401 retry, postJson, getErrorMessage)
    │   ├── contract.ts   (AnalyzeRequest validation; nothing is sent without it)
    │   ├── analyze.ts    (POST /api/v1/analyze)
    │   └── coverage.ts   (POST /api/v1/coverage)
    ├── auth/             (the one Supabase client; background-only)
    ├── article/          (reading and marking up the page)
    │   ├── paragraph_parser.ts   (paragraphs + Map<number, HTMLElement>)
    │   ├── detect_opinion_piece.ts
    │   ├── doc_hash.ts           (paragraph hash, for staleness)
    │   └── highlight.ts          (Range/TreeWalker wrap, unwrap, scroll-and-pulse)
    ├── messaging/        (sendToBackground, sendToTab, sendToActiveTab, broadcast, isOwnMessage)
    ├── content/          (the content script)
    │   ├── index.ts      (entry: state machine and the analysis flow)
    │   ├── surface.ts    (shadow host and tooltip, created on demand)
    │   ├── hover.ts      (delegated hover and keyboard focus on a highlight)
    │   └── watcher.ts    (debounced MutationObserver for staleness)
    ├── ui/               (injected UI: plain DOM, mostly in a closed shadow root)
    │   ├── dom.ts        (el/button helpers)
    │   ├── host.ts  tooltip.ts  labels.ts
    │   └── tokens.css  injected.css  highlight.css  page.css  sidepanel.css  report.css
    └── pages/            (the extension's own React screens)
        ├── mount.tsx     (shared bootstrap: inject styles, render into #root)
        ├── Brand.tsx     (shared heading and spinner)
        ├── sidepanel/    (sign in/up/out, reset, the Analyze button, and the report)
        └── reset/        (full tab for the password-recovery link)
```

Four top-level concerns, each a directory: `api/` owns the wire, `auth/` owns the
session, `article/` owns the page's text, and `ui/` owns pixels. `content/` and `pages/`
are the two places those get assembled; `messaging/` is the seam between them.

### `vite.config.ts`
Three build passes, because the entry points have different rules. The pages pass builds
`sidepanel` and `reset` as ES modules sharing a React chunk. `BUILD_TARGET=content` and
`BUILD_TARGET=background` each produce one self-contained IIFE, because **a content script
is a classic script**: a shared chunk or a surviving `import` statement breaks it at load.

There must be no `vite.config.js` in the directory — Vite resolves it *before* the
TypeScript config, so edits to the `.ts` file would be silently ignored.

### `public/manifest.json`
`permissions: ["storage", "sidePanel"]`, host permissions for the sites the content script
runs on, no `externally_connectable`. `side_panel.default_path` points at `sidepanel.html`,
and `background.ts` calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true
})` so the toolbar icon opens the panel instead of a popup. A `web_accessible_resources`
entry exposes `reset.html` to `https://*.supabase.co/*` only, which is the origin that
navigates to the password-recovery page. `chrome.tabs` needs no permission here because the
side panel only reads tab ids and load state, never a tab's URL or title.

### `src/types.ts`
Hand-mirror of the Python schemas, plus two message envelopes.

Side panel and content script to the **background worker**:
```ts
type BgRequest =
  | { kind: "ANALYZE_REQUEST"; payload: AnalyzeRequest }
  | { kind: "AUTH_STATUS" }
  | { kind: "AUTH_SIGN_IN" | "AUTH_SIGN_UP" | "AUTH_SIGN_OUT" | "AUTH_RESET" | "AUTH_RECOVER"; ... };

type BgResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "unauthenticated" | "rate_limited" | "network" | "server"
                      | "invalid_request"; message: string };
```

Side panel to a **specific tab**, which needs no token and so does not go through the
background:
```ts
type TabRequest =
  | { kind: "PAGE_STATUS" }
  | { kind: "RUN_ANALYZE" }
  | { kind: "FOCUS_FLAG"; id: string }
  | { kind: "FOCUS_CLAIM"; id: string }
  | { kind: "FOCUS_CITATION"; id: string }
  | { kind: "SET_HOT_FLAG"; id: string | null }
  | { kind: "TOGGLE_HIGHLIGHTS"; visible: boolean }
  | { kind: "CLEAR" };
interface PageStatus { isArticle; paragraphs; state; flags; docType; message; result; highlightsVisible }
```

Content script to the **side panel**, with no particular tab in mind — the panel filters by
`sender.tab.id` itself:
```ts
type HoverBroadcast = { kind: "HOVER_FLAG"; id: string | null };
```

The side panel is long-lived, unlike the popup it replaced: it does not cache a report per
tab, it just re-asks the newly active tab's content script for `PAGE_STATUS` — including
the stored `result` — every time `chrome.tabs.onActivated` fires. The content script's own
module state is the source of truth for its tab for as long as that page is not reloaded.

There is no `AUTH_STATE` broadcast. It existed so an already-open page could update its
Analyze button after a sign-in; the button now lives in the side panel, which reads auth
state fresh every time it opens.

### `src/background.ts`
The trusted core. Registers `chrome.runtime.onMessage`, rejects any message where
`sender.id !== chrome.runtime.id`. Holds no module-level mutable state — Chrome evicts idle
workers. All network calls originate here; the content script never fetches the backend
itself (its requests carry the page's origin, which CORS rejects, and it must not hold a
token). It owns the only Supabase client in the extension, so nothing races on the refresh
token. Errors are classified for the UI: a `ContractError` becomes `invalid_request`, 401
and 403 become `unauthenticated`, 429 becomes `rate_limited`, any other server answer
becomes `server`, and only a `fetch` that never reached a server becomes `network`. A 4xx
body is logged to the worker console, because FastAPI's 422 detail names the field.

### `src/content/`
`index.ts` runs in the page and renders nothing until asked. On load it registers one
message listener. `PAGE_STATUS` parses locally and reports whether this looks like an article,
plus the stored result if one exists; `RUN_ANALYZE` parses, detects the section hint, sends
one `ANALYZE_REQUEST`, then mounts the shadow host and applies highlights. `FOCUS_FLAG`,
`FOCUS_CLAIM`, `FOCUS_CITATION`, `SET_HOT_FLAG`, `TOGGLE_HIGHLIGHTS` and `CLEAR` come from the side panel and drive the same
functions the old in-page card used to call directly. No token ever reaches this file.
It keeps the `Map<number, HTMLElement>` of paragraph ID to live DOM node in memory — that
map never crosses a message boundary. A debounced `MutationObserver`, started only once an
analysis has run, marks a changed article stale and re-applies wrappers the site dropped;
it is disconnected while we wrap, so our own edits are never mistaken for the site's.
The pieces are split by job: `surface.ts` creates and destroys the shadow host and tooltip,
`hover.ts` delegates the highlight interactions from the document, shows the flag or
citation tooltip, and for flags broadcasts a `HOVER_FLAG` message so the side panel can light
the matching row, and `watcher.ts` owns
the observer and its `silently()` guard.

### `src/article/paragraph_parser.ts`
```ts
export function parseParagraphs(document: Document): {
  paragraphs: Paragraph[];
  nodeMap: Map<number, HTMLElement>;
  foundArticleContainer: boolean;
  roots: Element[];
}
```
**The riskiest file in the project.** Every site nests article text differently. It tries
`<article>`, then a list of body-content selectors, and validates each candidate on
paragraph count and total length. `foundArticleContainer` is false when it falls back to
`document.body`, and that flag is what stops the side panel offering Analyze on a non-article
page. Text is `textContent` with whitespace runs collapsed to one space, then trimmed —
`highlight.ts` reproduces that collapse exactly, so the two cannot drift.

### `src/api/contract.ts`
```ts
export function buildAnalyzeRequest(input: AnalyzeRequest): AnalyzeRequest  // or throws ContractError
```
Hand-mirror of `AnalyzeRequest`'s validation, and the only path into
`sendAnalyzeRequest`. Clamps the size caps, drops blank paragraph bodies, and throws on
anything structurally wrong. Keep it in step with `backend/app/types.py`; the caps
themselves are re-exported from `src/types.ts` so there is one set of numbers.

### `src/article/highlight.ts`
```ts
export function applyFlags(flags: Flag[], nodeMap: Map<number, HTMLElement>): { applied; skipped }
export function clearHighlights(): void
export function focusFlag(id: string): void
```
`applyClaims`/`focusClaim` and `applyCitations`/`focusCitation` reuse the same matching and
wrapping; claims get a dashed underline and quoted sources a dotted one.
Rebuilds the parser's normalized string for one paragraph while recording, per character,
which text node and offset it came from; matches the quote in that string; then wraps each
text-node segment with `Range.surroundContents`. Segments are wrapped last-first, because
splitting a text node at a later offset leaves every earlier offset in it valid. Never
`innerHTML` replacement — that destroys listeners the news site depends on and can blank
the page. Only 1:1 character substitutions are applied before matching (curly quotes, en
and em dashes, non-breaking spaces); anything length-changing, such as NFKC, would
invalidate the offset map. A quote that is absent, or that overlaps an earlier highlight,
is skipped and counted, never thrown. If a quote appears more than once in its paragraph
the first occurrence wins — the same rule the grounding gate and the SemEval runner use.

### `src/ui/`
Plain DOM, no React, inside a **closed** shadow root: the content bundle stays around
27 KB, no second React runtime lands on the page, and a page script cannot reach the
controls. `tokens.css` holds colour, radius, shadow and motion for both the injected UI and
the extension's own pages. `highlight.css` is the only stylesheet that lives in the page's
light DOM, because the wrappers must sit inside the article's own text.

### `src/pages/sidepanel/`
Sign in, sign up (13+ confirmation, required), forgot password, sign out, the Analyze
button, and a three-tab report: Summary (technique tally, flagged phrases in reading
order), Claims (two views: checkable claims and citations, each leading with who said it and
their role; clicking either scrolls the article to its mark) and Coverage (a user-triggered
`POST /coverage`, cached per `doc_hash` so tab switches do not refire it). It
constructs no Supabase client; every auth action is a message to the background worker. It
tracks whichever tab it is currently reporting on, since unlike a popup it stays open
across tab switches, and re-fetches that tab's `PAGE_STATUS` on every switch instead of
caching a report per tab itself.

### `src/pages/reset/`
A full tab, reached by the password-recovery email link. A popup closes as soon as it
loses focus, so the flow cannot complete there. It reads the recovery tokens from the URL
fragment, clears them from the address bar, and hands them to the background worker.

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
