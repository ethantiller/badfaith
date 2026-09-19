# Architecture

SteelHacks XIII — news article auditing extension. Target track: Best Use of NVIDIA
Nemotron ("Beyond the Chatbot").

This document covers the stack and how the system works. Tickets, timeline and ownership
live elsewhere.

---

## 1. Stack at a glance

| Layer | Choice | Language |
|---|---|---|
| Browser extension | WXT + React, Manifest V3 | TypeScript |
| In-page extraction | Mozilla Readability | TypeScript |
| Backend API | FastAPI + Uvicorn | Python 3.12 |
| Model calls | Nemotron via build.nvidia.com or OpenRouter, over `httpx` async | Python |
| Cache + counters | Firestore (Native mode) | — |
| Auth | Firebase Anonymous Auth; Firebase Admin SDK server-side | — |
| Outside sources | GDELT DOC API | Python |
| Eval harness | Standalone Python CLI, writes JSON | Python |
| Container | Docker, distroless or slim base | — |
| Hosting | Cloud Run (backend), Firebase Hosting or the side panel itself (eval page) | — |
| CI | GitHub Actions → Artifact Registry → Cloud Run | YAML |
| Package managers | `uv` or `pip-tools` (Python), `pnpm` (extension) | — |

Everything server-side is Python. Everything browser-side is TypeScript. No Java in this
project despite Jason and Max knowing it — no component calls for it, and mixing runtimes
costs time we don't have.

---

## 2. How it works, end to end

The user opens a news article on a supported site.

1. **The content script wakes up.** WXT's `matches` pattern limits this to a handful of
   tested news domains. The script waits for the article DOM to settle, then runs
   Readability against a clone of the document to get clean article text without
   navigation, ads or comments.

2. **Text becomes numbered paragraphs.** The script splits the extracted article into
   paragraphs and assigns each an integer ID, keeping an in-memory map from ID to the
   live DOM element it came from. That map never leaves the page, and it is what makes
   highlighting tractable later.

3. **The request goes through the background worker.** The content script sends a message
   to the background service worker, which is the only part of the extension that holds
   credentials or talks to the network. It attaches a Firebase ID token and POSTs to the
   backend.

4. **The backend checks cache first.** Cache key is a hash of the URL plus a hash of the
   article text, so a re-edited article misses the cache correctly. On a hit, it returns
   the stored analysis immediately and no model call happens.

5. **On a miss, the Nemotron pipeline runs** (section 5). The backend fans out concurrent
   calls, verifies every quote the model returns, queries GDELT for other coverage, and
   assembles a single response keyed to the paragraph IDs the extension sent.

6. **The extension renders two surfaces.** The content script walks each flagged
   `paragraph_id`, finds the quote string inside that one known DOM element, and wraps it
   in a highlight with a hover tooltip. The side panel shows the full report: techniques
   found, claims with verification status, other outlets covering the story, and what
   this article omitted.

7. **The result is written to cache** with a TTL, so a demo article opened twice responds
   instantly the second time.

---

## 3. The extension

Built with **WXT**, which gives file-based entrypoints, Vite builds, hot reload, and a
dev mode that launches a browser with the extension already installed. Chosen over Plasmo
because Plasmo appears to be in maintenance mode.

Three entrypoints, with a strict division of responsibility:

**Content script** — runs inside the news page. Extracts and paragraphs the article,
injects highlights, handles hover interactions. Mostly plain DOM work; React only if we
mount an in-page card, and then inside a Shadow DOM so the host site's CSS can't bleed
in or out. **This script never sees an auth token.** It asks the background worker for
results and renders what comes back.

**Background service worker** — the extension's trusted core. Owns Firebase auth, owns
all `fetch` calls, owns the message handlers. Holds no state in module-level variables
because Chrome evicts idle workers; anything that must survive goes to `chrome.storage`.
Rejects messages whose `sender.id` isn't our own extension ID.

**Side panel** — a React app, the richest UI surface. Report view, plus the eval results
page (section 7). Being a normal web page, it can use whatever component library we want;
keep it light.

The manifest deliberately omits `externally_connectable`, so no website can message the
extension directly. Host permissions stay narrow — five reliable sites beat fifty flaky
ones, because Readability behaves differently on every domain and a demo failure is
fatal.

**Article parsing stays client-side by design.** The backend never re-fetches the URL.
The browser already has the rendered page, including content behind a paywall the user
is entitled to and text injected by the site's own JavaScript, and news sites routinely
block requests originating from cloud IP ranges.

---

## 4. The contract

One JSON schema binds the two halves of the system. Locking it first is what lets three
people work in parallel.

Request:

```json
{
  "url": "https://example.com/article",
  "title": "...",
  "paragraphs": [
    { "id": 0, "text": "..." },
    { "id": 1, "text": "..." }
  ]
}
```

Response:

```json
{
  "doc_type": "news | opinion | other",
  "flags": [
    {
      "paragraph_id": 1,
      "quote": "exact substring from that paragraph",
      "technique": "loaded_language",
      "severity": "low | medium | high",
      "explanation": "..."
    }
  ],
  "claims": [
    {
      "paragraph_id": 3,
      "quote": "...",
      "status": "supported | contradicted | unverified",
      "sources": [ { "outlet": "...", "url": "...", "snippet": "..." } ]
    }
  ],
  "coverage": {
    "related": [ { "outlet": "...", "url": "...", "headline": "..." } ],
    "omissions": [ { "summary": "...", "corroborating_urls": ["..."] } ]
  },
  "meta": { "cached": false, "model_route": "nano|super", "latency_ms": 0 }
}
```

Two properties matter. Every finding carries a `paragraph_id`, so the extension searches
one element instead of the whole page. Every finding carries a verbatim `quote`, so
grounding is a string match rather than a judgement call.

---

## 5. The Nemotron pipeline

Four stages. None is a chatbot; each produces structured JSON that the next stage or the
client consumes.

**Stage 1 — Document classifier (small model).** One call on a sample of the article:
news, opinion, or other. Routes everything downstream, since an op-ed is legitimately
allowed rhetoric that would be a red flag in straight reporting. A small model here is
deliberate and measurable — the routing eval compares it against the large model on the
same labels.

**Stage 2 — Span labeler (large model).** Fans out across paragraph batches concurrently
with `asyncio.gather`. For each batch, returns technique labels with the exact quote and
an explanation. Batching rather than per-paragraph calls keeps latency and token cost
down while preserving enough local context to judge tone.

**Stage 3 — Claim extractor (large model).** Pulls checkable assertions — statistics,
attributed quotes, dates — each anchored to a paragraph and quote. Output feeds stage 4
and the claims list in the UI.

**Stage 4 — Cross-source judge (large model).** Takes the extracted claims and the
article's core event, queries GDELT for other outlets covering the same story within a
time window, and judges consistency: which claims other coverage supports, which it
contradicts, and — the differentiating part — what other outlets reported that this
article left out.

**Grounding gate, between the model and the user.** Before anything reaches the client,
plain Python string matching confirms each returned `quote` actually occurs in the
paragraph it claims to come from. Failures are dropped and counted. This is deterministic
code, not a model call, and it is both a correctness guarantee and an eval metric.

Concurrency, retries with backoff, and a per-request timeout budget all live in a thin
Nemotron client module so stages don't each reinvent them. Structured output is enforced
by prompting for JSON only and parsing into Pydantic models, with one reprompt on a parse
failure before giving up on that batch.

---

## 6. Backend

**FastAPI on Cloud Run.** FastAPI for automatic Pydantic validation on every request,
native async for concurrent model calls, and auto-generated `/docs` that the extension
developer can hit with curl before any UI exists.

Endpoints are few:

- `POST /analyze` — the main path described above.
- `GET /health` — Cloud Run liveness.
- `GET /eval/results` — serves the latest eval JSON to the eval page.

**Firestore** handles both persistence needs: the analysis cache and per-user rate-limit
counters. Chosen over Postgres because the data is document-shaped, it needs no schema
migration, there's no instance to provision, and Firebase is already in the stack for
auth. Nothing here needs SQL.

**Security posture**, all decided:

- Nemotron API key is a Cloud Run secret, mounted as a file rather than an environment
  variable so it stays out of `/proc/self/environ`.
- CORS allowlists the extension origin only.
- Request size caps at the Pydantic level: max paragraphs, max characters per paragraph,
  max total payload.
- Rate limits per Firebase `uid`, plus a global ceiling as a backstop against burning
  Nemotron credits.
- Any XML parsing — RSS or uploaded documents, if those land — uses `defusedxml`, or
  `feedparser` for feeds. A pytest case fires an XXE payload at a local server and
  asserts rejection, so swapping libraries later can't quietly reopen the hole.

---

## 7. Auth

**Firebase Anonymous Auth.** On first use the background worker signs in anonymously and
gets a real Firebase `uid` with a signed ID token, no user interaction at all. The SDK
manages the ID token (1 hour) and refresh token itself, so we write no refresh logic and
hit none of the token-rotation race conditions a hand-rolled JWT setup would bring.

Import from `firebase/auth/web-extension`, not the standard `firebase/auth` — MV3 bans
remotely loaded code and the web-extension build strips the offending pieces.

Tokens live in `chrome.storage`, never `localStorage`, because a content script shares
the page's `localStorage` with the news site and every ad script on it. Firebase stays in
the background worker for the same reason.

Server-side, the Firebase Admin SDK verifies the token on every request and hands the
route handler a `uid`. Cloud Run's service account supplies credentials automatically
when the Firebase and GCP projects match, so there are no key files anywhere.

The Firebase web `apiKey` ships inside the extension, which is fine — unlike the Nemotron
key it is a project identifier, not a secret.

Real Google sign-in is out of scope. It needs `chrome.identity` plus
`signInWithCredential` and OAuth console configuration, and no judge scores it.

---

## 8. Eval harness

A **standalone Python CLI**, not an API route. It imports the same pipeline modules the
server uses, runs them over a dataset, and writes timestamped JSON to disk. Being
separate means it can run against a local model config, take as long as it needs, and be
re-run after every prompt change without touching the deployed service.

```
eval/
  datasets/       # SemEval subset, synthetic articles, symmetry pairs
  runners/        # one module per eval
  results/        # timestamped JSON output
  report.py       # rolls results up into the JSON the /eval page reads
```

The four Tier 1 evals — SemEval span F1, counterfactual symmetry, grounding/fabrication
rate, and small-vs-large model routing — all emit the same result envelope so the report
page renders them uniformly.

Output surfaces on an **eval page inside the side panel**, reading from
`GET /eval/results`. Judges clicking through live numbers beats a screenshot in slides.

---

## 9. Deployment and tooling

**Repo is a monorepo:**

```
/extension      # WXT + React + TypeScript
/backend        # FastAPI, Nemotron client, Firestore access
/eval           # harness, datasets, results
/docs           # this file and the rest of the plan
```

**Backend deploy:** Docker image built by GitHub Actions on push to `main`, pushed to
Artifact Registry, deployed to Cloud Run. Cloud Run configured with min instances 1
during the event so nobody eats a cold start during judging, concurrency tuned for the
async workload, and a generous request timeout since a cache-miss analysis makes several
model calls.

**Terraform is deliberately minimal** — one file for the Cloud Run service, Artifact
Registry repo and secret bindings, and nothing more. Infrastructure-as-code is good
practice but judges don't score it, and hand-clicking a Firestore database is faster than
writing the resource block for it.

**Extension distribution:** loaded unpacked via `chrome://extensions` with Developer mode
on. No Chrome Web Store submission — review takes days. Judges can load it from the repo
the same way.

**Local dev:** `pnpm dev` in `/extension` opens a browser with the extension installed and
hot reload running. `uvicorn --reload` in `/backend` with a `.env` pointing at a dev
Firestore collection prefix. The extension reads its API base URL from an env var so
switching between localhost and Cloud Run is a rebuild, not a code change.

**Configuration inventory:** Nemotron API key and endpoint, model IDs for the small and
large routes, Firebase project config (web SDK config in the extension, nothing in the
backend), Firestore collection prefix, rate limit thresholds, cache TTL, API base URL.
All of it environment-driven; none of it hardcoded.

---

## 10. Deliberately out of scope

Named here so nobody spends hours on them at 4am: Google sign-in, Chrome Web Store
publication, Firefox or Safari builds, a user account or history UI, multi-language
article support, fine-tuning any model, and self-hosting Nemotron on our own GPU.
