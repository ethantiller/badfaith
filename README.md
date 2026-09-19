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
│   │   ├── ground.py
│   │   └── verify.py
│   ├── clients/
│   │   ├── nemotron.py
│   │   ├── gdelt.py
│   │   └── store.py
│   ├── prompts/
│   │   ├── classify.txt
│   │   ├── label.txt
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
    nemotron_api_key: str          # from mounted secret file
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

### `app/routes/analyze.py`
```python
@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest, uid: str = Depends(current_uid),
                  _: None = Depends(enforce_rate_limit)) -> AnalyzeResponse
```
Computes `doc_hash`, checks cache, on miss calls `orchestrate.run_analysis(...)`, writes
cache, returns. Route does no pipeline work itself — it's cache logic and delegation.

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
async def run_analysis(req: AnalyzeRequest, ctx: PipelineContext) -> AnalyzeResponse
```
The only function routes call. Sequence: resolve doc type → batch paragraphs → fan out
labeling with `asyncio.gather` → ground → assemble. Owns the timeout budget and the
partial-failure policy (a failed batch degrades that paragraph, it does not fail the
request).

### `app/pipeline/classify.py`
```python
async def resolve_doc_type(section_hint: str | None, title: str,
                           sample: list[Paragraph], ctx) -> tuple[DocType, str]
```
Returns the type and its source. Short-circuits on `section_hint` without a model call.

### `app/pipeline/label.py`
```python
async def label_batch(paragraphs: list[Paragraph], doc_type: DocType,
                      ctx) -> tuple[list[Flag], list[Claim]]
```
One call per batch returning both flags and claims — the merged design. Batch size around
5 paragraphs, tune on latency. One reprompt on JSON parse failure, then give up on that
batch and log it.

### `app/pipeline/ground.py`
```python
def verify_quotes(flags: list[Flag], claims: list[Claim],
                  paragraphs: dict[int, str]) -> GroundingResult
```
Pure function, no I/O, no model. Normalizes whitespace and smart quotes, then requires the
quote to be a literal substring of its paragraph. Returns kept items plus a drop count and
reasons. **The most heavily tested file in the repo** — `test_ground.py` covers curly
apostrophes, non-breaking spaces, em dashes, wrong `paragraph_id`, and fabricated text.

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
│   ├── types.ts (API + auth types)
│   ├── auth.ts (Supabase email auth)
│   ├── api_helpers.ts (token refresh, error handling)
│   ├── analyze.ts (POST /analyze)
│   ├── coverage.ts (POST /coverage)
│   ├── extract.ts (Readability)
│   ├── paragraphs.ts (article → paragraphs)
│   ├── highlight.ts (apply flags to DOM)
│   ├── metadata.ts (detect section)
│   └── messaging.ts (message types)
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

### `lib/api_helpers.ts`
Shared HTTP utilities for all API calls. Exports: `ApiError`, `makeAuthenticatedRequest<T>()` (handles 401 refresh+retry), `buildHeaders()`, `generateRequestId()`, `getErrorMessage()`. Reads base URL from `import.meta.env.API_BASE`.

### `lib/analyze.ts` and `lib/coverage.ts`
Background-only API clients. Exports: `sendAnalyzeRequest(request)` and `sendCoverageRequest(request)`. Both automatically get the token from Supabase and handle 401 errors with token refresh and retry.

### `lib/auth.ts`
Supabase email auth with `chrome.storage.local` persistence. Exports: `signUp()`, `signIn()`, `signOut()`, `resetPassword()`, `updatePassword()`, `getIdToken()`, `getSession()`, `refreshSession()`, `initAuth()`. Tokens persist across browser restarts and auto-refresh in the background. Background-only.

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