import { defineConfig, loadEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// One config, three passes. `pages` (the default) builds the React surfaces as ES
// modules; `content` and `background` each build one self-contained IIFE, because a
// content script is a classic script and must not emit import statements.
const target = process.env.BUILD_TARGET ?? 'pages';

// The repo root .env is the source of truth for shared config, but it uses the
// backend's unprefixed names and Vite only exposes VITE_-prefixed vars. So load the
// root file whole and copy across an explicit allowlist — never a blanket copy, which
// would bundle NEMOTRON_API_KEY and DATABASE_PASS into a shipped extension.
// An extension/.env is still honoured and wins, for per-developer overrides.
function clientEnv(mode: string): Record<string, string> {
  const root = loadEnv(mode, rootDir, '');
  const local = loadEnv(mode, __dirname, '');
  const pick = (...names: string[]) =>
    names.map((name) => local[name] || root[name]).find(Boolean) ?? '';

  return {
    VITE_SUPABASE_URL: pick('VITE_SUPABASE_URL', 'SUPABASE_URL'),
    VITE_SUPABASE_ANON_KEY: pick('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_KEY'),
    VITE_API_BASE: pick('VITE_API_BASE', 'API_BASE'),
  };
}

// Vite's own env loading points at the repo root too, so a VITE_-prefixed var added
// there reaches the bundle without needing an entry in the allowlist above.
function envConfig(mode: string): UserConfig {
  const env = clientEnv(mode);
  const missing = Object.keys(env).filter((key) => !env[key]);
  if (missing.length > 0) {
    console.warn(
      `[badfaith] missing env: ${missing.join(', ')} — set them in ${resolve(rootDir, '.env')}`,
    );
  }

  return {
    envDir: rootDir,
    define: Object.fromEntries(
      Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
    ),
  };
}

function iifeBundle(entry: string, name: string): UserConfig {
  return {
    // public/ is copied by the pages pass; the other passes must not repeat it.
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, entry),
        formats: ['iife'],
        name: `badfaith_${name}`,
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        output: { inlineDynamicImports: true, extend: false },
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = envConfig(mode);

  if (target === 'content') return { ...env, ...iifeBundle('src/content/index.ts', 'content') };
  if (target === 'background') return { ...env, ...iifeBundle('src/background.ts', 'background') };

  return {
    ...env,
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          sidepanel: resolve(__dirname, 'src/pages/sidepanel/main.tsx'),
          reset: resolve(__dirname, 'src/pages/reset/main.tsx'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
  };
});
