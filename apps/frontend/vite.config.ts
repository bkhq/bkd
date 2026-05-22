import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
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
  // Dev env is consolidated in the monorepo root .env (loaded by the root `dev`
  // script via --env-file). Read it here so the Vite dev server picks up the
  // same file whether launched via the root `dev` or `dev:frontend` standalone.
  const env = loadEnv(mode, path.resolve(import.meta.dirname, '../..'))
  const devPort = Number(env.VITE_DEV_PORT) || 3000
  const devHost = env.VITE_DEV_HOST || '0.0.0.0'

  return {
    plugins: [
      shikiSlim(),
      tailwindcss(),
      viteReact(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    build: {
      rolldownOptions: {
        output: {
          advancedChunks: {
            groups: [
              { name: 'vendor-react-dom', test: /[\\/]node_modules[\\/]react-dom[\\/]/ },
              { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|scheduler)[\\/]/ },
              { name: 'vendor-router', test: /[\\/]node_modules[\\/]react-router(-dom)?[\\/]/ },
              { name: 'vendor-query', test: /[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/ },
              { name: 'vendor-dnd', test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/ },
              { name: 'vendor-ui', test: /[\\/]node_modules[\\/](@base-ui[\\/]|lucide-react[\\/])/ },
              { name: 'vendor-diff', test: /[\\/]node_modules[\\/]@pierre[\\/]diffs[\\/]/ },
              { name: 'vendor-shiki', test: /[\\/]node_modules[\\/](shiki|@shikijs)[\\/]/ },
              { name: 'vendor-i18n', test: /[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/ },
              { name: 'vendor-style', test: /[\\/]node_modules[\\/](tailwind-merge|clsx|class-variance-authority)[\\/]/ },
              { name: 'vendor-state', test: /[\\/]node_modules[\\/]zustand[\\/]/ },
              { name: 'vendor-xterm', test: /[\\/]node_modules[\\/]@xterm[\\/]/ },
            ],
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
