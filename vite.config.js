import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import webosCompat from './scripts/vite-plugin-webos-compat.js';

/**
 * webOS loads apps from the local file system (file://), and TV browsers run
 * older Chromium builds. That's why this config:
 *  - uses relative asset paths (base: './')
 *  - emits a single classic (non-module) script (see webosCompat)
 *  - compiles down to ES2015 (webOS 4.0+ / 2018+ TVs)
 *  - copies the webOS manifest + icons from /webos into the build output
 */
export default defineConfig({
  base: './',
  publicDir: 'webos',
  plugins: [react(), webosCompat()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2015',
    cssTarget: 'chrome53',
    modulePreload: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
