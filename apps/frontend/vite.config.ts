import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import type { Plugin } from 'vite'

/**
 * Slim shiki bundles: ~20 languages (from 232), 2 themes (from 64),
 * no Oniguruma WASM engine. Unrecognised languages/themes fall back gracefully.
 */
function shikiSlim(): Plugin {
  const slim: Record<string, string> = {
    langs: path.resolve(__dirname, 'src/lib/shiki-langs.mjs'),
    themes: path.resolve(__dirname, 'src/lib/shiki-themes.mjs'),
    stub: path.resolve(__dirname, 'src/lib/shiki-oniguruma-stub.mjs'),
  }
  return {
    name: 'shiki-slim',
    enforce: 'pre',
    resolveId(source, importer) {
      const fromShiki = importer?.includes('/shiki/') ?? false

      // Redirect full language/theme bundles → slim subsets
      if (fromShiki) {
        if (
          source === './langs.mjs' ||
          source.includes('langs-bundle-full') ||
          source.endsWith('/shiki/dist/langs.mjs')
        ) {
          return slim.langs
        }
        if (source === './themes.mjs' || source.endsWith('/shiki/dist/themes.mjs'))
          return slim.themes
      }
      // Stub out the Oniguruma WASM engine (unused — JS engine is used)
      if (
        source === '@shikijs/engine-oniguruma' ||
        source === '@shikijs/engine-oniguruma/wasm-inlined' ||
        source === 'shiki/wasm'
      ) {
        return slim.stub
      }
    },
  }
}

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname)
  const devPort = Number(env.VITE_DEV_PORT) || 3000
  const devHost = env.VITE_DEV_HOST || '0.0.0.0'

  return {
    plugins: [
      shikiSlim(),
      tsconfigPaths({ projects: ['./tsconfig.json'] }),
      tailwindcss(),
      viteReact(),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            const m = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
            if (!m) return undefined
            const pkg = m[1]
            if (pkg === 'react' || pkg === 'scheduler') return 'vendor-react'
            if (pkg === 'react-dom') return 'vendor-react-dom'
            if (pkg === 'react-router' || pkg === 'react-router-dom') return 'vendor-router'
            if (pkg === '@tanstack/react-query') return 'vendor-query'
            if (pkg.startsWith('@dnd-kit/')) return 'vendor-dnd'
            if (pkg.startsWith('@base-ui/') || pkg === 'lucide-react') return 'vendor-ui'
            if (pkg === '@pierre/diffs') return 'vendor-diff'
            if (pkg === 'shiki' || pkg.startsWith('@shikijs/')) return 'vendor-shiki'
            if (pkg === 'i18next' || pkg === 'react-i18next') return 'vendor-i18n'
            if (pkg === 'tailwind-merge' || pkg === 'clsx' || pkg === 'class-variance-authority')
              return 'vendor-style'
            if (pkg === 'zustand') return 'vendor-state'
            if (pkg.startsWith('@xterm/')) return 'vendor-xterm'
          },
        },
      },
    },
    server: {
      port: devPort,
      host: devHost,
      // Dev only: allow all hosts (nsl proxy fronts the dev server)
      allowedHosts: true,
    },
  }
})

export default config
