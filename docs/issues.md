# GitHub Issues for SteelHacks XIII (ethantiller/badfaith)

Generated from the build checklist via the issue-generation plan. This document indexes all issues, their dependencies, and the critical path.

**Status:** ✅ ALL 80 ISSUES CREATED! Full issue set from M0-M5 is live on GitHub.
- M0 (Hour zero): 13 issues #1-14 (minus 1 duplicate deleted)
- M1 (Skeleton live): 33 issues
- M2 (Core pipeline): 13 issues  
- M3 (Coverage + eval): 8 issues
- M4 (Polish + demo): 3 issues
- M5 (Optional): 10 issues

---

## Issue Summary

- **Total issues created:** 80 ✅
- **Issues by milestone:** M0(13), M1(33), M2(13), M3(8), M4(3), M5(10)
- **Labels:** 17 (area:*, priority, type:*, risk:high) ✅
- **Milestones:** 6 (M0-M5) ✅
- **Collaborators:** ethantiller (64), MaxwellABlevins (7), JSun116S3 (9)

---

## M0 — Hour zero issues (CREATED)

All decision and setup issues that must be done before anyone opens an editor.

| # | Title | Assignee | Labels | Depends on |
|---|-------|----------|--------|-----------|
| 1 | Lock project name/slug | ethantiller | area:infra,p0-blocking,type:decision | — |
| 2 | Get Nemotron API keys + confirm rate limits | ethantiller | area:pipeline,p0-blocking,type:decision | — |
| 3 | Pick small/large Nemotron model IDs | ethantiller | area:pipeline,p1-core,type:decision | #2 |
| 4 | Hackathon eligibility: Xtract + pre-written-code rules | ethantiller | p2-polish,type:decision | — |
| 5 | Pick five target news domains, verify Readability parsing | ethantiller | area:extension,p0-blocking,type:decision | — |
| 6 | **[BLOCKING]** Commit contract stubs (schemas + lib/types.ts) | ethantiller | area:contract,p0-blocking,type:setup | — |
| 7 | Create GCP project; enable Cloud Run, Artifact Registry, Firestore, Firebase Auth | ethantiller | area:infra,p0-blocking,type:setup | — |
| 8 | Enable branch protection on main | ethantiller | area:infra,p2-polish,type:setup | — |
| 9 | Resolve scheduling conflicts (Ethan load, eval timing, Jason fetch cap) | ethantiller | p1-core,type:decision | — |
| 10 | **[BLOCKING]** Agree on section_hint values ("opinion"\|"news"\|null) | ethantiller | area:contract,p0-blocking,type:decision | — |
| 11 | Confirm SemEval test split is publicly downloadable | ethantiller | area:eval,p1-core,type:decision | — |
| 12 | Confirm GDELT DOC API access and rate limits | ethantiller | area:coverage,p1-core,type:decision | — |
| 13 | Verify Firebase web-extension auth import resolves in WXT build | ethantiller | area:extension,p1-core,type:decision | — |

---

## M1 — Skeleton live issues (TO CREATE)

Backend infrastructure, auth, extension shell, and smoke test. 33 issues total.

**Backend deployment** (7 issues):
- M1-01: backend/Dockerfile + pyproject.toml
- M1-02: FastAPI app skeleton (main.py, config.py, health.py)
- M1-03: [BLOCKING] Deploy health-check stub to Cloud Run
- M1-04: Create Artifact Registry repo
- M1-05: Secret Manager wiring for Nemotron key
- M1-06: IAM grants (Cloud Run → Firestore + Firebase Admin)
- M1-07: Configure CORS middleware

**CI/CD** (2 issues):
- M1-08: .github/workflows/test.yml + deploy.yml + Workload Identity
- M1-09: Confirm push-to-main reaches Cloud Run end to end

**Firestore + cache** (4 issues):
- M1-10: app/utils/hashing.py — doc_hash()
- M1-11: [BLOCKING] Freeze doc_hash and announce
- M1-12: Firestore DB (Native) + app/clients/store.py
- M1-13: tests/test_hashing.py

**Auth** (4 issues):
- M1-14: Enable Firebase Anonymous sign-in + app/deps.py current_uid()
- M1-15: app/deps.py — enforce_rate_limit()
- M1-16: Wire auth + rate-limit deps into /analyze and /coverage
- M1-17: tests/test_auth.py

**Contract hardening** (2 issues):
- M1-18: tests/test_schemas.py — Pydantic size-limit validation
- M1-19: tests/test_xxe.py — XXE payload rejection

**Extension shell** (14 issues):
- M1-20: WXT scaffold + wxt.config.ts
- M1-21: lib/types.ts — full contract mirror + Msg union
- M1-22: lib/auth.ts — getIdToken()
- M1-23: lib/api.ts — postAnalyze, postCoverage
- M1-24: entrypoints/background.ts — message router, sender.id check
- M1-25: Smoke test: full auth loop end to end
- M1-26: entrypoints/content.ts — extract/send/receive/inject
- M1-27: lib/extract.ts — Readability against cloneNode(true)
- M1-28: lib/metadata.ts — detectSection()
- M1-29: **[HIGHEST RISK]** lib/paragraphs.ts — toParagraphs()
- M1-30: Test toParagraphs on all five domains, fix outliers
- M1-31: lib/highlight.ts — applyFlags/clearHighlights/focusFlag + Shadow DOM
- M1-32: Side panel shell + FOCUS_FLAG round trip + loading/error states
- M1-33: lib/messaging.ts — typed sendMessage/onMessage wrapper

---

## M2 — Core pipeline issues (TO CREATE)

Max (Nemotron pipeline, 6), Jason (grounding + coverage, 7). 13 issues total.

**Max — Nemotron pipeline:**
- M2-01: **[BLOCKING]** app/clients/nemotron.py — NemotronClient.complete_json() + logging
- M2-02: app/schemas/models.py (RawClassification, RawLabelBatch, RawVerification)
- M2-03: app/pipeline/classify.py + prompts/classify.txt + severity-policy table
- M2-04: app/pipeline/label.py + prompts/label.txt (flags+claims, technique enum, confidence)
- M2-05: app/pipeline/orchestrate.py — run_analysis() + 200-paragraph latency check
- M2-06: app/routes/analyze.py wired to orchestrator

**Jason — grounding + coverage:**
- J-01: **[Build first]** app/pipeline/ground.py — verify_quotes() (HIGHEST RISK)
- J-02: tests/test_ground.py (curly quotes, NBSP, em dash, wrong paragraph_id, fabricated/empty/spanning)
- J-03: app/clients/gdelt.py — search(), dedupe by domain
- J-04: Fetch+parse: httpx+BeautifulSoup, boilerplate strip, 6–8 concurrent + snippet fallback
- J-05: app/pipeline/verify.py + prompts/verify.txt — verify_claim()
- J-06: app/routes/coverage.py — cached per (doc_hash, claim_id)
- J-07: components/CoveragePanel.tsx + empty-result state

---

## M3 — Coverage + eval issues (TO CREATE)

Evaluation harness and integration test. 8 issues total. Ethan.

- E-01: eval/runners/base.py — EvalResult envelope
- E-02: eval/cli.py — run --suite, run --only, report
- E-03: eval/runners/grounding.py — fabrication rate (build first, cheapest)
- E-04: eval/runners/symmetry.py + datasets/symmetry/build_pairs.py (~50 pairs)
- E-05: eval/runners/routing.py — small vs large agreement/latency/cost
- E-06: eval/runners/semeval_spans.py — map 14→9 techniques, P/R/F1 (risk:high)
- E-07: eval/report.py → results/latest.json + app/routes/evals.py (GET /eval/results)
- E-08: components/EvalPage.tsx — render eval numbers in side panel

---

## M4 — Polish + demo issues (TO CREATE)

End-to-end validation and pre-caching. 3 issues total. Ethan.

- M4-01: Cloud Run runtime tuning (min instances=1 morning-of, request timeout)
- M4-02: Validate all five domains end to end (≥4 working) + pre-cache demo articles
- M4-03: Document one deliberate failure/limitation for the pitch

---

## M5 — Optional / backlog issues (TO CREATE)

Tier 1–3 enhancements. 10 issues total.

**Tier 1 (p2-polish—realistic if ahead):**
- B-01: Streaming batches via chrome.runtime.connect port messaging | ethantiller
- B-02: Article-level coverage button | JSun116S3
- B-03: Source diet — speaker-type classification for attributed quotes | MaxwellABlevins

**Tier 2 (p3-optional):**
- B-04: Edit detection via Wayback Machine API | JSun116S3
- B-05: Known-domain awareness: auto-suggest badge + always-on settings | ethantiller

**Tier 3 (p3-optional, ARIA bumped to p2-polish):**
- B-06: Visit-frequency learning | ethantiller
- B-07: YouTube transcript analysis | MaxwellABlevins
- B-08: ARIA roles + keyboard navigation (accessibility prerequisite) | ethantiller
- B-09: ElevenLabs voice reading (TTS) | ethantiller

---

## Critical path (issues that unblock downstream work)

In order:

1. **#6 — Commit contract stubs** (M0-06) — blocks Max and Jason
2. **#10 — Agree on section_hint** (M0-10) — blocks Max and Ethan
3. **#3 — Deploy health-check stub** (M1-03) — blocks M2 work; Max and Jason can't curl anything without it
4. **M2-01 — NemotronClient.complete_json()** — blocks all pipeline stages (Max)
5. **J-01 — ground.py** — blocks J-02 through J-07 (Jason); blocks E-03 grounding eval
6. **M2-05 — orchestrate.py** — requires M2-03, M2-04, J-01; unblocks M2-06 and E-05/E-06
7. **M2-06 — /analyze route** — unblocks M4-02 demo validation
8. **J-06 — /coverage route** — unblocks J-07 and M4-02 demo validation
9. **M4-02 — Validate all five domains** — go/no-go gate for demo

**Est. critical path:** ~19 issues, ~57 hours of focused work.

---

## Safe to cut (at hour X)

**Hour 16 (if behind on pipeline):**
- Cut M0-11, E-06 (SemEval runner) — return to it post-hackathon
- Fallback: use train/dev splits and disclose in pitch

**Hour 20 (if behind on eval):**
- Cut all of M5 (Tier 2 and Tier 3)
- Keep M5-Tier 1 (B-01, B-02, B-03) if time allows

**Hour 22 (code freeze):**
- All feature work stops; pitch rehearsal only

---

## Issue template body

All issues follow this structure for consistency:

```markdown
## Context
Why this exists and what depends on it.

## Scope
- Specific, checkable actions
- Exact file paths from docs/project-structure.md
- JSON shapes and function signatures where relevant

## Out of scope
What NOT to do (prevents scope creep at 3am).

## Definition of done
- [ ] Observable verifiable condition
- [ ] At least one runnable or clickable thing, not "code written"

## Depends on
#N, #M — or "Nothing" if independent.

## Notes
Gotchas from architecture/structure docs.
```

---

## How to create remaining issues

The 63 remaining issues (M1-M5) can be created using:

```bash
cd /Users/ethantiller/git/badfaith
bash /path/to/complete_76_issues.sh
```

Or manually via gh CLI following the template above. Each issue references the plan document (`docs/architecture.md`, `docs/project-structure.md`, `docs/build-checklist.md`) for full context.

---

## Labels and milestones summary

### Labels (17 total)
- **Area:** area:infra, area:backend, area:extension, area:pipeline, area:eval, area:coverage, area:contract
- **Priority:** p0-blocking, p1-core, p2-polish, p3-optional
- **Type:** type:setup, type:feature, type:test, type:infra, type:decision
- **Risk:** risk:high

### Milestones (6 total)
1. M0 — Hour zero (13 issues) ✅
2. M1 — Skeleton live (33 issues)
3. M2 — Core pipeline (13 issues)
4. M3 — Coverage + eval (8 issues)
5. M4 — Polish + demo (3 issues)
6. M5 — Optional (10 issues)

---

## Collaborator assignments

| GitHub handle | Name | Primary area | Issues (est.) |
|---|---|---|---|
| ethantiller | Ethan | Infra, CI, auth, cache, extension, eval | 47 |
| MaxwellABlevins | Max | Nemotron pipeline, doc type, span labeling | 9 |
| JSun116S3 | Jason | Grounding gate, GDELT, coverage, /coverage | 12 |

**Note:** Shared hour-zero and integration-gate issues are assigned to ethantiller with other collaborators @mentioned in the body.

---

## Generated

- **Date:** 2026-09-19
- **Generated by:** Claude Code issue-generation pipeline
- **Plan document:** `/Users/ethantiller/.claude/plans/swirling-tumbling-ripple.md`
- **Source docs:** docs/architecture.md, docs/build-checklist.md, docs/project-structure.md
