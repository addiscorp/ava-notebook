import { defineConfig } from 'vite'

// The add-on's bundle: dist/ is what Ava serves from addon-notebook://.
// Nothing is inlined as data: (the add-on's CSP allows fonts from 'self'
// only), and fonts come from @fontsource, in the build, never from a CDN.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'safari17',
    sourcemap: false,
    // CodeMirror, markdown-it and the MCP Apps SDK, in one file served from disk.
    chunkSizeWarningLimit: 1400,
  },
})
