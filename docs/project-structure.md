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
    "model_route": "nano | super",
    "latency_ms": 2140,
    "flags_dropped": 2
  }
}
```

`claims` carry no verification status here. Verification is `/coverage`, which is
user-triggered. `flags_dropped` is the grounding gate's reject count — surface it in the
panel, it's a credibility signal.

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
appeal_to_fear
appeal_to_authority
false_dilemma
unsupported_generalization
misleading_statistic
unnamed_source_as_fact
speculation_as_fact
guilt_by_association
```

Nine is enough. SemEval has fourteen; map theirs onto yours in the eval runner rather
than adopting all fourteen in the product.

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
│   │   ├── analyze.py         (TODO: POST /analyze)
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
│   │   ├── search.py          (DuckDuckGo web search wrapper)
│   │   └── [future: nemotron.py, gdelt.py]
│   └── [future: pipeline/, clients/, prompts/, utils/]
└── tests/
    ├── unit/
    │   ├── __init__.py
    │   └── test_coverage.py
    └── integration/
        └── __init__.py
```

### `app/main.py`
FastAPI app construction only. Mounts routers, configures CORS, initializes the Database
and other clients in lifespan. No business logic. Under 60 lines.

### `app/config.py`
```python
class Settings(BaseSettings):
    database_url: str              # Supabase async PostgreSQL URL
    supabase_url: str
    supabase_anon_key: str
    nemotron_api_key: str          # from mounted secret file (when implemented)
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
DuckDuckGo wrapper. Filters blocked domains, extracts date from URL, returns Article objects.
Later: GDELT client and Nemotron client go here.

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
blank the page. Tooltip content in a Shadow DOM.

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
Maps SemEval's 14 techniques onto your 9, runs the pipeline, reports exact-match and
overlap-based precision/recall/F1 per technique. If the test split isn't publicly
downloadable, use train/dev and say so in `notes`.

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
