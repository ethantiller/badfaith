# AGENTS.md

Guidance for AI agents working in this repository. This file summarizes the durable project rules from `README.md` and `docs/`; when details conflict, prefer the more specific document in `docs/` and update this file if the rule is still current.

## Project Shape

This is a monorepo for Bad Faith 2026, a SteelHacks XIII news article auditing browser extension.

- `backend/`: Python 3.12 FastAPI API hosted on Cloud Run.
- `extension/`: Chrome extension using WXT, React, TypeScript, and Manifest V3.
- `eval/`: standalone Python evaluation harness.
- `docs/`: architecture, contracts, build checklist, and project structure notes.

The documentation currently uses `litmus` as a placeholder package/product slug. Do not bake that name into permanent identifiers unless the project name has been explicitly locked.

## Source Documents

Read these before making architectural or contract changes:

- `docs/project-structure.md`: canonical project structure and shared API contracts.
- `docs/architecture.md`: system architecture, extension/backend responsibilities, security posture, and pipeline design.
- `docs/build-checklist.md`: implementation sequence, ownership, blocking tasks, and integration gates.
- `README.md`: top-level summary and duplicated contract notes.

## Core Architecture Rules

- Server-side code is Python. Browser-side code is TypeScript. Do not introduce Java or an extra runtime unless the architecture docs are intentionally revised.
- The Python backend schemas are the source of truth for the shared API contract. Mirror the TypeScript types by hand in `extension/lib/types.ts`; do not add schema code generation unless the docs are changed first.
- Every model-facing result that reaches the extension must be grounded to a paragraph ID and a verbatim quote.
- Keep the content script, background service worker, and side panel responsibilities separate. Content scripts render and extract; the background worker owns auth and network calls; the side panel owns the rich report UI.
- The backend never re-fetches article URLs. Article extraction stays client-side because the browser has the rendered page and user-visible content.

## API Contract Rules

The shared public endpoints are:

- `POST /analyze`: analyze article paragraphs, returning `doc_type`, grounded flags, extracted claims, and analysis metadata.
- `POST /coverage`: user-triggered claim verification and related coverage lookup.
- `GET /health`: unauthenticated liveness endpoint returning `{"status":"ok"}`.
- `GET /eval/results`: unauthenticated latest eval results.

Keep the technique enum locked to these values unless the eval mapping and docs are updated together:

```text
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

Claims in `/analyze` do not carry verification status. Verification belongs to `/coverage` and is user-triggered.

## Backend Guidelines

- `app/main.py` should only construct the FastAPI app, mount routers, configure CORS, and create shared clients in lifespan. Keep business logic out of it.
- `app/config.py` owns settings via `pydantic-settings` and a cached `get_settings()`. Do not read `os.environ` directly elsewhere.
- Mount the Nemotron API key as a Cloud Run secret file, not as an environment variable.
- `app/deps.py` owns Firebase ID token verification and Firestore-backed rate limiting.
- Route handlers should handle auth, cache lookup/write, and delegation. Pipeline work belongs under `app/pipeline/`.
- `orchestrate.run_analysis(...)` is the route-facing analysis entry point. It owns doc type resolution, batching, async fan-out, grounding, assembly, timeout budget, and partial-failure policy.
- Use `httpx` async for network calls and keep retries, backoff, timeouts, structured JSON parsing, and model reprompting in the Nemotron client layer.
- Use `defusedxml` or `feedparser` for any XML/feed parsing.

## Extension Guidelines

- Use WXT with React and TypeScript for the Chrome Manifest V3 extension.
- Keep host permissions narrow to the tested news domains. The manifest should omit `externally_connectable`.
- Content scripts must never see auth tokens. They request work from the background worker and render returned results.
- The background service worker owns Firebase auth, all `fetch` calls, and message handling. Reject messages whose `sender.id` is not this extension's ID.
- Do not rely on module-level mutable state in the background worker; Chrome can evict idle workers. Persist needed state to `chrome.storage`.
- Import Firebase auth from `firebase/auth/web-extension`, not `firebase/auth`.
- Store tokens in `chrome.storage`, never page `localStorage`.
- Extract articles with Mozilla Readability against `document.cloneNode(true)`, not the live document.
- Highlight with `Range` and `TreeWalker`; do not replace page content with `innerHTML`.
- Use Shadow DOM for in-page tooltip/card UI so host page CSS does not bleed in or out.

## Pipeline And Evaluation Rules

- Document classification uses a small model unless metadata already provides `section_hint`.
- Span labeling and claim extraction should return structured JSON with verbatim quotes and the locked technique enum.
- The grounding gate is deterministic Python string matching. It drops fabricated or misplaced quotes and reports drop counts/reasons.
- Normalize quotes, whitespace, dashes, and Unicode before quote matching.
- Coverage search should build GDELT queries from claim entities, not full raw quote sentences.
- The eval harness is a standalone Python CLI that imports pipeline modules and writes JSON. Do not turn it into the primary API path.
- Build the cheapest grounding eval early.
- The SemEval eval (SemEval-2020 Task 11 / PTC-SemEval20, Zenodo record 3952415) scores on train/dev only because test labels are hidden, on a fixed-seed subset. Our 16 techniques map many-to-one onto SemEval's 14 classes; the table and run steps are in `docs/project-structure.md`.
- Flag quotes are the minimal words that carry the technique, not whole sentences.
- Never filter flags by severity or confidence in the pipeline. Only the grounding gate removes a flag; the severity policy may change `severity` only, and display thresholds belong to the extension and the eval.
- When a quote appears more than once in its paragraph, it refers to the first occurrence — in the grounding gate, `highlight.ts`, and the SemEval runner alike.

## Security And Reliability

- CORS must allow only the extension origin and must include the `authorization` header.
- Enforce request size caps at the Pydantic schema layer.
- Rate limit by Firebase `uid` and maintain a global hourly ceiling to protect model credits.
- Cache analyses by a stable article hash derived from normalized URL and paragraph text. Freeze hash behavior before pre-caching demos.
- Cache coverage by `(doc_hash, claim_id)`.
- `/health` must have no auth or external dependency requirements.
- A failed model batch should degrade that paragraph, not fail the whole `/analyze` request.

## Testing And Validation

- Add focused tests for shared contracts, hashing stability, grounding behavior, auth failures, and XML/XXE rejection as those modules are implemented.
- For backend changes, prefer narrow `pytest` runs for touched modules.
- For extension changes, prefer `pnpm` checks such as TypeScript compilation once the extension project is scaffolded.
- For contract changes, update Python schemas, TypeScript mirrors, docs, and tests in the same change.

## Documentation Expectations

- Keep docs and implementation synchronized when changing endpoints, schemas, technique labels, auth flow, deployment assumptions, or extension permissions.
- Treat `docs/build-checklist.md` as the implementation priority guide. Items marked `[BLOCKING]` unblock other work and should be handled early.
- Capture notable failures and tradeoffs as they happen; the project documentation explicitly calls for one documented failure for the track narrative.