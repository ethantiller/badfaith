# Bad Faith Extension

Chrome Manifest V3 extension for auditing news articles using Vite, React, TypeScript, and Tailwind CSS.

## Quick Start

```bash
make install    # Install dependencies
make dev        # Start development server
make build      # Build for production
make help       # See all available commands
```

## Setup

Using Make:
```bash
make install
```

Or with pnpm directly:
```bash
pnpm install
```

## Development

Start the watch build (rebuilds on file changes):

```bash
make dev
```

This runs `vite build --watch`, which rebuilds `dist/` whenever you change files. Then:

1. Load `dist/` unpacked in Chrome (see "Load Unpacked" below)
2. After each build, reload the extension in Chrome (press the reload icon or press `Ctrl+R` on the Extensions page)

## Build

Create an optimized production build:

```bash
make build
```

Output appears in `dist/`.

## Type Checking

Verify TypeScript types:

```bash
make typecheck
```

## Load Unpacked

To load the extension in Chrome:

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` directory

For development, reload the extension via the Extensions page after rebuilding.

## Structure

```
src/                    # Source code
├── main.tsx           # React app entry point
├── popup.tsx          # Popup UI with inline Tailwind classes
├── styles.css         # Tailwind directives and base styles
└── types.ts           # API contract types

public/               # Static assets
├── popup.html        # Popup HTML template
├── manifest.json     # Chrome manifest
└── icon.jpeg         # Extension icon

Makefile              # Common development tasks
tailwind.config.js    # Tailwind configuration
postcss.config.js     # PostCSS configuration
```

## Styling

Styles use **Tailwind CSS** with inline utility classes in components. No separate CSS files for components. Base styles and Tailwind directives are in `src/styles.css`. Customize the theme in `tailwind.config.js`.

## API Contract Types

See `src/types.ts` for TypeScript interfaces that mirror the Python backend schemas.

## Available Make Commands

- `make install` — Install dependencies
- `make dev` — Start dev server
- `make build` — Production build
- `make typecheck` — Type checking
- `make clean` — Remove dist/ and node_modules/
- `make clean-dist` — Remove only dist/
- `make preview` — Preview built extension
- `make ci` — Full CI build (clean → install → build)