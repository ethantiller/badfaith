# Build checklist

GitHub-flavored. Check items off in place. Anything marked **[BLOCKING]** stops someone
else from working if it isn't done.

---

## Hour zero — before anyone opens an editor

- [ ] Lock the project name (package slug, extension ID, Firestore prefix all depend on it)
- [ ] Get Nemotron API keys from build.nvidia.com or OpenRouter and confirm rate limits
- [ ] Pick the small and large model IDs
- [ ] Decide: are we submitting to Xtract as well? Changes prompts and test articles
- [ ] Confirm SteelHacks rules on pre-written code
- [ ] Pick the five target news domains and verify each one parses with Readability
- [ ] **[BLOCKING]** Commit `schemas/requests.py`, `schemas/responses.py`, and
      `lib/types.ts` with the full contract, even as stubs. Nobody starts until this is on
      `main`
- [ ] Create the GCP project, enable Cloud Run / Artifact Registry / Firestore / Firebase Auth
- [ ] `git init`, push the directory skeleton, protect `main`

---

## Ethan — infra, extension shell, eval

### Backend deployment

- [ ] Write `backend/Dockerfile` — `python:3.12-slim`, non-root user, `uvicorn` entrypoint
- [ ] `pyproject.toml` with `fastapi`, `uvicorn`, `httpx`, `pydantic-settings`,
      `firebase-admin`, `google-cloud-firestore`, `defusedxml`, `pytest`
- [ ] `app/main.py` — app construction, router mounts, lifespan creating the shared
      `httpx.AsyncClient` and Firestore client on `app.state`
- [ ] `app/config.py` — `Settings` class, `get_settings()` with `lru_cache`
- [ ] `app/routes/health.py` returning `{"status":"ok"}` with no dependencies
- [ ] **[BLOCKING]** Deploy the stub to Cloud Run and confirm `GET /health` answers over
      HTTPS. Max and Jason need a live URL before they can curl anything
- [ ] Create the Artifact Registry repo
- [ ] Store the Nemotron key in Secret Manager, mount it **as a file** on the Cloud Run
      service, read the path in `config.py`
- [ ] Grant the Cloud Run service account Firestore read/write and Firebase Admin
- [ ] Set min instances to 1 (do this the morning of judging, not before — it bills)
- [ ] Set the request timeout above your worst-case analysis latency
- [ ] Configure CORS middleware — `allow_origins` is the extension origin only,
      `allow_headers` **must** include `authorization` or every call dies on preflight

### CI/CD

- [ ] `.github/workflows/test.yml` — `pytest` on backend, `tsc --noEmit` on extension
- [ ] `.github/workflows/deploy.yml` — build, push to Artifact Registry, deploy to Cloud Run
- [ ] Set up Workload Identity Federation or a deploy service account key in repo secrets
- [ ] Confirm a push to `main` actually reaches Cloud Run end to end

### Firestore + cache

- [ ] Create the Firestore database in Native mode
- [ ] `app/utils/hashing.py` — `doc_hash(url, paragraphs)`. Strip query params, fragments,
      trailing slash; normalize whitespace before hashing
- [ ] **[BLOCKING]** Freeze `doc_hash` and tell everyone. Changing it later invalidates
      every pre-cached demo article
- [ ] `app/clients/store.py` — `get_analysis`, `put_analysis`, `get_coverage`,
      `put_coverage`, `bump_rate_limit`
- [ ] TTL field on cached docs, checked on read (Firestore TTL policies are lazy)
- [ ] `tests/test_hashing.py` — same article with different query strings hashes equal;
      edited body text hashes different

### Auth

- [ ] `app/deps.py` — `current_uid` verifying the Supabase Bearer token (JWT), 401 on failure
- [ ] `app/deps.py` — `enforce_rate_limit`, Supabase row-level security or Firestore transactional counter per uid per hour bucket, plus the global ceiling, 429 on breach
- [ ] Wire both dependencies into `/analyze` and `/coverage`
- [ ] `tests/test_auth.py` — missing header, malformed scheme, expired token all 401

### Extension shell

- [ ] `pnpm create wxt`, React + TypeScript template
- [ ] `wxt.config.ts` — permissions `storage`, `sidePanel`, `activeTab`; host permissions
      limited to the five domains; no `externally_connectable`
- [x] `lib/types.ts` — hand-mirror of the Python schemas plus auth request/response types
- [x] `lib/auth.ts` — Email auth with `chrome.storage.local` persistence. Exports: `signUp()`, `signIn()`, `signOut()`, `resetPassword()`, `updatePassword()`, `getIdToken()`, `getSession()`, `refreshSession()`, `initAuth()`
- [x] `lib/api_helpers.ts` — `ApiError`, `makeAuthenticatedRequest<T>()`, `buildHeaders()`, `generateRequestId()`, `getErrorMessage()`
- [x] `lib/analyze.ts` — `sendAnalyzeRequest(request)` → POST `/api/v1/analyze`
- [x] `lib/coverage.ts` — `sendCoverageRequest(request)` → POST `/api/v1/coverage`
- [ ] `entrypoints/background.ts` — message router, `sender.id` check, side panel open on
      action click, no module-level mutable state
- [ ] **Smoke test the full auth loop early**: sign up/in → token → `/analyze` → 200 with a hardcoded paragraph array. Do this before any real UI exists. Auth and API helpers are done; just wire up background worker + content script
- [ ] `entrypoints/content.ts` — message handling, extract, send, receive, inject
- [ ] `lib/extract.ts` — Readability against `doc.cloneNode(true)`, never the live document
- [ ] `lib/metadata.ts` — `detectSection()` from URL path, `article:section` meta,
      schema.org `articleSection`. Returns `null` freely
- [ ] **[HIGHEST RISK]** `lib/paragraphs.ts` — `toParagraphs()` returning paragraphs plus
      the `Map<number, HTMLElement>`. Skip nodes under 40 chars, skip captions and pull
      quotes
- [ ] Test `toParagraphs` on all five domains, log the paragraph count for each, fix the
      outliers before anything downstream is built
- [ ] `lib/highlight.ts` — `applyFlags`, `clearHighlights`, `focusFlag` using `Range` and
      `TreeWalker`. Never `innerHTML` replacement. If a quote repeats in its paragraph,
      wrap the first occurrence
- [ ] Shadow DOM wrapper for the hover tooltip so the host site's CSS can't touch it
- [ ] Side panel shell — `App.tsx`, `DocTypeBadge`, `FlagList`, `FlagCard`, `ClaimList`
- [ ] `FOCUS_FLAG` round trip: click a flag in the panel, page scrolls to it and pulses
- [ ] Loading and error states — the panel must say something useful on a 429 or a timeout

### Eval (do not leave this until the end)

- [ ] `eval/runners/base.py` — the `EvalResult` envelope
- [ ] `eval/cli.py` — `run --suite`, `run --only`, `report`
- [ ] `eval/runners/grounding.py` — fabrication rate. Cheapest runner, build it first
- [ ] `eval/runners/symmetry.py` + `datasets/symmetry/build_pairs.py` — ~50 articles with
      party identities swapped, report mean delta and flip rate
- [ ] `eval/runners/routing.py` — small vs large model agreement, latency, cost per article
- [ ] Download `datasets-v2.tgz` from Zenodo (zenodo.org/records/3952415, CC BY 4.0) into
      `eval/datasets/semeval/` and confirm the train and dev gold files are in it. Test-set
      labels are hidden, so score on train/dev only
- [ ] `eval/runners/semeval_spans.py` — full spec in `docs/project-structure.md`:
  - [ ] fixed-seed subset of ~50 articles; record `n`
  - [ ] split articles into paragraphs, keeping each paragraph's start offset
  - [ ] convert each flag's quote to article offsets with a plain `find` (first occurrence;
        the gate returns the paragraph's exact text)
  - [ ] collapse our 16 techniques onto their 14 classes
  - [ ] report precision/recall/F1 per technique, exact and overlap; **decide what counts
        as overlap** and record it in `notes`
  - [ ] disclose in `notes`: train/dev only, subset size, 2017–2019 corpus, dense labels
- [ ] `eval/report.py` → `results/latest.json`
- [ ] `app/routes/evals.py` — `GET /eval/results`, no auth
- [ ] `components/EvalPage.tsx` — render the numbers live in the side panel

---

## Max — Nemotron pipeline

### Client layer

- [x] **[BLOCKING]** `app/ext/nemotron.py` — `NemotronClient.complete_json(prompt,
      model, schema)`. Retries with jittered backoff, per-call timeout, JSON extraction,
      Pydantic parse, one reprompt on parse failure. Jason needs this for `/coverage`
- [x] Structured logging of model, token counts, latency per call — this feeds the routing eval
- [x] `app/schemas/models.py` — `RawClassification`, `RawLabelBatch`, `RawVerification`.
      Model-facing shapes, kept separate from the public response schema

### Doc type

- [x] `app/pipeline/classify.py` — `resolve_doc_type(section_hint, title, sample, ctx)`
- [x] Short-circuit: if `section_hint` is non-null, return immediately with
      `doc_type_source="metadata"` and make no model call
- [x] `app/utils/text.py` — `sample_for_classification()`, headline plus the first few
      paragraphs, not the full article
- [x] `prompts/classify.txt` — a one-field JSON object: `news`, `opinion`, or `other`
- [x] Map doc type to a severity policy. Same technique scores high in news, low in
      opinion. Write this as an explicit table, not scattered conditionals. The policy
      changes `severity` only; it never removes a flag

### Span labeling + claims

- [x] `app/utils/text.py` — `batch_paragraphs()`, ~5 paragraphs per batch, tune on latency
- [x] `prompts/label.txt` — returns **both** flags and claims in one JSON response
- [x] Pin the technique enum in the prompt. List the sixteen allowed values explicitly and
      instruct the model to use no others
- [x] Require verbatim quotes in the prompt and say why — paraphrase breaks the grounding gate
- [x] Require **minimal-span** quotes in the prompt: only the words that carry the
      technique, not the whole sentence. SemEval's gold spans are short, and tight quotes
      make better highlights
- [x] No flag filtering in `label.py` or `orchestrate.py` — no severity or confidence
      cutoff. Only the grounding gate removes flags; display thresholds live in the
      extension and the eval
- [x] `app/pipeline/label.py` — `label_batch(paragraphs, doc_type, model, ctx)`
- [x] Emit `confidence` per flag (feeds the calibration story, costs nothing)
- [x] Claim extraction inside the same call: `statistic`, `attributed_quote`,
      `date_or_count`, each with `paragraph_id`, verbatim quote, and entity list for GDELT
- [x] `app/pipeline/orchestrate.py` — `run_analysis()`. Doc type → batch → `asyncio.gather`
      fan-out → grounding → assemble
- [ ] Partial failure policy: a failed batch degrades that paragraph, it does not fail the
      request. Count it in `meta` (done except the count: it is logged, and `meta` has no
      field for it yet; all batches failing raises `AnalysisError`, a 502)
- [x] Overall timeout budget enforced at the orchestrator, not per call
- [x] `app/api/analyze.py` wired to the orchestrator
- [ ] Test a 200-paragraph article and check total latency before assuming batch size is fine

---

## Jason — coverage, grounding

### Grounding gate

- [x] **Build this first.** `app/pipeline/ground.py` —
      `verify_quotes(flags, claims, paragraphs)`, pure function, no I/O
- [x] Normalize before matching: curly to straight quotes, non-breaking to regular spaces,
      em/en dashes, collapsed whitespace, Unicode NFKC
- [x] Require the quote to be a literal substring **of the paragraph it names**, not of the
      whole article
- [x] Return kept items plus drop count and drop reasons; orchestrator puts the count in
      `meta.flags_dropped`
- [x] `tests/test_ground.py` — curly apostrophes, non-breaking spaces, em dashes, wrong
      `paragraph_id`, wholly fabricated quote, empty quote, quote spanning two paragraphs,
      quote that appears twice in its paragraph (first occurrence wins)

### Coverage

- [ ] `app/clients/gdelt.py` — `search(keywords, hours, max_records)` against the DOC API,
      `mode=ArtList&format=json`
- [ ] Dedupe by domain so one syndication network doesn't fill all fifty slots
- [ ] Build the query from claim entities, not the raw quote. A full sentence returns nothing
- [ ] Decide the fetch tier: GDELT gives snippets. If fetching full articles, **cap it at
      6–8 concurrent fetches with a 3s timeout each**, and fall back to snippets on
      failure. Fifty live fetches will not finish inside a demo
- [ ] Fetch with `httpx` async, parse with BeautifulSoup — bs4 is sync but parsing is fast,
      it's the network that has to be concurrent
- [ ] Strip boilerplate from fetched pages before sending anything to the model
- [ ] `prompts/verify.txt` — given a claim and N snippets, return supported / contradicted /
      unverified, plus omissions with the URLs that back them
- [ ] `app/pipeline/verify.py` — `verify_claim(claim, title, ctx)`
- [ ] `app/routes/coverage.py`, cached per `(doc_hash, claim_id)` so repeat clicks are free
- [ ] `components/CoveragePanel.tsx` — related outlets, status badge, omissions, every item
      linking to its source URL
- [ ] Empty-result state. GDELT will return nothing for niche stories and the panel must
      handle it gracefully

---

## Integration gates

- [ ] **Hour 6** — extension sends a real article to a deployed `/analyze` with auth and
      gets a valid (possibly empty) response
- [ ] **Hour 10** — one article end to end: extract → label → ground → highlights visible
      in the page
- [ ] **Hour 14** — `/coverage` returns real GDELT results in the panel
- [ ] **Hour 14** — go/no-go on SemEval. If it's still dragging, cut it and say so in the pitch
- [ ] **Hour 16** — all five domains tested, at least four working
- [ ] **Midnight** — eval harness produces numbers, even partial ones
- [ ] **Hour 20** — pre-cache every demo article
- [ ] **Hour 22** — code freeze, pitch rehearsal only
- [ ] Capture one documented failure along the way. The track explicitly asks for it —
      assign someone to write it down rather than quietly fixing it

---

## Backlog

### Tier 1 — build if ahead of schedule

- [ ] **Confidence flag** — already in Max's list above, costs nothing, enables the
      calibration curve in the eval
- [ ] **Streaming batches** — render flags as each batch returns. No accuracy change, large
      perceived-speed change. Needs `chrome.runtime.connect` port messaging instead of
      one-shot `sendMessage`
- [ ] **Article-level coverage button** — a "what are others saying about this story"
      button at the top of the panel, separate from the per-claim one. Same `/coverage`
      code path with the article's entities instead of a claim's
- [ ] **Source diet** — classify every attributed quote by speaker type (government
      official, company spokesperson, named independent expert, anonymous, unsourced), then
      state the distribution. Mostly counting. New `sources` array on the response, no
      other contract change. Strong because it's structural rather than a score

### Tier 2 — real work, real payoff

- [ ] **Edit detection** — Wayback Machine API, diff the live article against the last
      snapshot, surface added or removed paragraphs. Coverage is spotty, so build it as a
      panel that gracefully says "no archive available". Very strong when it hits
- [ ] **Auto-suggest on known news sites** — ship a list of top news domains; when the user
      lands on one, badge the extension icon instead of doing nothing. No new backend
- [ ] **Always-on domains in settings** — a settings page where the user marks domains to
      analyze automatically on page load. `chrome.storage.sync`, a settings entrypoint, and
      content-script logic. Note this multiplies your model spend by however many articles
      they browse, so rate limits matter more

### Tier 3 — post-hackathon

- [ ] **Visit-frequency learning** — track visits per domain and offer to make a frequent
      one always-on. Needs history to be useful, so it demos as an empty state. Also a
      privacy story you'd have to defend
- [ ] **YouTube transcripts** — parse the transcript, treat segments as paragraphs, flag
      spans. The pipeline mostly transfers; highlighting into a video player does not.
      Separate content script and a different UI surface
- [ ] **ElevenLabs voice reading** — pitch as accessibility. Be careful here: a real
      accessibility feature means keyboard navigation, ARIA roles on the highlights and
      panel, and screen-reader-legible tooltips. TTS bolted onto an inaccessible UI is
      worse than not claiming it. Do the ARIA work first — that part is cheap and honest

---

## Conflicts worth resolving now

**Ethan is overloaded.** Infra, CI, auth, cache, the entire extension, and the eval harness
is roughly two people's work. The extension alone — content script, paragraph splitting,
highlighting, side panel — is the biggest single chunk in the project. Move the eval
harness to whoever finishes their backend work first, likely Jason after `/coverage` lands.

**Eval cannot go last.** It's the track-winning artifact and the reason the Nemotron judges
pick you over a team with a prettier demo. Grounding rate and symmetry are both about an
hour each and depend only on the pipeline existing. Get them running by midnight.

**`section_hint` spans two owners.** The content script produces it (Ethan,
`lib/metadata.ts`); the backend consumes it (Max, `classify.py`). Agree on the exact
string values — `"opinion" | "news" | null` — at hour zero so neither waits on the other.

**Jason's BeautifulSoup step is the latency risk.** GDELT snippets alone may be enough for
the comparison. Build against snippets first, add full-page fetching only if the model
output is visibly thin.
