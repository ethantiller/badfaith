import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest-and-html',
      writeBundle() {
        copyFileSync(
          resolve(__dirname, 'public/manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        );
        copyFileSync(
          resolve(__dirname, 'public/popup.html'),
          resolve(__dirname, 'dist/popup.html')
        );
        copyFileSync(
          resolve(__dirname, 'public/icon.png'),
          resolve(__dirname, 'dist/icon.png')
        );
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: './src/main.tsx',
      output: {
        entryFileNames: 'popup.js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
