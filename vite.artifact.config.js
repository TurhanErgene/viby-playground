import { defineConfig } from 'vite';

/**
 * Builds the whole game into ONE self-contained IIFE bundle so it can be
 * dropped inline into a single HTML page with no module loading, no CDN and
 * no separate asset requests.
 */
export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'dist-artifact',
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.js',
      output: {
        format: 'iife',
        entryFileNames: 'game.js',
        assetFileNames: 'game.[ext]',
        inlineDynamicImports: true
      }
    }
  }
});
