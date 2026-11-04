import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** The web app you browse and cast from, served by the KMovies server. */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
  },
});
