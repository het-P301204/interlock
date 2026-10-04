import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * index.html carries the production Content-Security-Policy. The dev server
 * injects an inline React Refresh preamble that a strict `script-src 'self'`
 * would block, so the meta tag is removed while serving and kept in builds.
 */
function devOnlyStripCsp(): Plugin {
  return {
    name: 'interlock:dev-strip-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/i, '')
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/interlock/' : '/',
  plugins: [react(), devOnlyStripCsp()],
  server: {
    fs: { allow: [repoRoot] },
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    // Inlined data: fonts or scripts would violate font-src/script-src 'self'.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
}))
