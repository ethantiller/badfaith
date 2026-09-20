import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// One config, three passes. `pages` (the default) builds the React surfaces as ES
// modules; `content` and `background` each build one self-contained IIFE, because a
// content script is a classic script and must not emit import statements.
const target = process.env.BUILD_TARGET ?? 'pages';

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

export default defineConfig(() => {
  if (target === 'content') return iifeBundle('src/content/index.ts', 'content');
  if (target === 'background') return iifeBundle('src/background.ts', 'background');
  // Dev-only design harness; writes next to dev/index.html, never into dist/.
  if (target === 'preview') {
    const config = iifeBundle('dev/preview.ts', 'preview');
    config.build!.outDir = 'dev';
    return config;
  }

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/pages/popup/main.tsx'),
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
