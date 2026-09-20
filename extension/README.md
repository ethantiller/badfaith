# Bad Faith Extension

Chrome Manifest V3 extension built with Vite, React and TypeScript.

The popup holds sign-in and the Analyze button. Everything else — highlights, hover
summaries and the report card — is injected into the article by the content script, and
only after the user has asked for it. On an ordinary page the extension renders nothing.

## Setup

```bash
make install        # npm install
cp .env.example .env
```

Fill in `.env`. Vite only exposes `VITE_`-prefixed variables, and the Supabase URL and
anon key are project identifiers rather than secrets, so they ship inside the bundle by
design. `VITE_API_BASE` must include the scheme and point at a backend serving
`POST /api/v1/analyze`. There is no mock any more, so a route that is not up yet shows
as a 404 in the badge.

## Build

```bash
make build          # typecheck, then three Vite passes into dist/
make dev            # the same three passes in watch mode
make typecheck
```

Three passes, because the three entry points have different rules:

| Pass | Output | Format | Why |
|---|---|---|---|
| `vite build` | `popup.js`, `reset.js`, `chunks/` | ES modules | Extension pages load as modules and can share a React chunk. |
| `BUILD_TARGET=content vite build` | `content.js` | IIFE | A content script is a classic script. It must be one self-contained file with no `import` statements. |
| `BUILD_TARGET=background vite build` | `background.js` | IIFE | The service worker, with the Supabase client bundled in. |

`vite.config.ts` branches on `BUILD_TARGET`. There is no `vite.config.js` — if one
reappears, Vite resolves it *before* the TypeScript config and your changes will be
silently ignored.

## Load unpacked

1. `chrome://extensions/`, enable **Developer mode**
2. **Load unpacked**, select `dist/`
3. For password reset to work, add `chrome-extension://<your-extension-id>/reset.html`
   to Supabase → Authentication → URL Configuration → Redirect URLs. An unpacked
   extension's ID is derived from the folder path, so it is stable on one machine and
   different on another.

Reload the extension from the Extensions page after each build.

## Design harness

`dev/index.html` renders a fake article and drives the real injected UI from a fixed
fixture, without loading the extension or calling the backend, so the visual work can be
reviewed in a normal tab:

```bash
BUILD_TARGET=preview npx vite build
open dev/index.html          # ?state=signedOut|loading|done|stale|error
```

It is dev-only and never ends up in `dist/`.

## Structure

```
src/
├── background.ts        Service worker: the only holder of a token or a fetch call
├── types.ts             Hand-mirror of backend/app/types.py, plus the message envelopes
├── api/                 Everything that speaks HTTP to the backend
│   ├── client.ts        ApiError, headers, the 401 retry, postJson, getErrorMessage
│   ├── contract.ts      Validates AnalyzeRequest; nothing is sent without it
│   ├── analyze.ts       POST /api/v1/analyze
│   └── coverage.ts      POST /api/v1/coverage
├── auth/                The one Supabase client in the extension. Background-only
├── article/             Reading and marking up the page
│   ├── paragraph_parser.ts   Paragraphs plus the live-element map
│   ├── detect_opinion_piece.ts   section_hint
│   ├── doc_hash.ts      Paragraph hash, for staleness
│   └── highlight.ts     Range/TreeWalker wrapping, unwrapping, scroll-and-pulse
├── messaging/           sendToBackground, sendToActiveTab, isOwnMessage
├── content/             The content script
│   ├── index.ts         State machine and the analysis flow
│   ├── surface.ts       Shadow host, badge, card and tooltip, created on demand
│   ├── hover.ts         Delegated hover and keyboard focus on a highlight
│   └── watcher.ts       Debounced MutationObserver for staleness
├── ui/                  Injected UI: plain DOM in a closed shadow root
│   ├── dom.ts           el/button helpers
│   ├── host.ts  badge.ts  card.ts  tooltip.ts  labels.ts
│   └── tokens.css  injected.css  highlight.css  page.css
└── pages/               The extension's own React screens
    ├── mount.tsx        Shared bootstrap: inject styles, render into #root
    ├── Brand.tsx        Shared heading and spinner
    ├── popup/           Sign in, sign up, forgot password, sign out, Analyze
    └── reset/           Full tab for the password-recovery link
```

Four top-level concerns, each a directory: `api/` owns the wire, `auth/` owns the
session, `article/` owns the page's text, `ui/` owns pixels. `content/` and `pages/` are
where those get assembled, and `messaging/` is the seam between them.

## Styling

Hand-authored CSS with the design tokens in `src/ui/tokens.css`. There is no Tailwind:
the injected UI needs its stylesheet as a string inside a shadow root, and one styling
system beats two. The shadow-root and page stylesheets are imported with Vite's
`?inline` and injected as `<style>` elements.

## API contract types

`src/types.ts` is a hand-mirror of `backend/app/types.py`. Python is the source of truth
and there is no codegen; when the contract changes, both files, the docs and the tests
change together.
