import { useMemo } from 'react'
import { defaultRehypePlugins, Streamdown } from 'streamdown'
import { markdownCodeComponents } from '@/components/markdown-code'
import { kanbanApi } from '@/lib/kanban-api'

interface MarkdownRendererProps {
  content: string
  /** Workspace root of the previewed file; enables relative image resolution. */
  root?: string | null
  /** Path of the previewed file inside `root`. */
  path?: string
}

/** Minimal hast shape: enough to walk elements and touch `img` sources. */
interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const ABSOLUTE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i

interface RelativeImageOptions {
  root: string
  /** Path of the previewed file inside `root`. */
  path: string
}

/**
 * Rehype plugin: point images referenced relative to the previewed file at
 * the raw-file API. Runs after rehype-raw (so inline HTML images are
 * elements) and before sanitize/harden (which would resolve relative URLs
 * against the app origin).
 *
 * Passed as a `[plugin, options]` tuple on purpose: streamdown caches
 * processors by plugin *name* plus JSON options, so a per-file closure would
 * make every file reuse the first file's directory.
 */
function rehypeRelativeImages({ root, path }: RelativeImageOptions) {
  // Encode the directory so `new URL` normalizes `.`/`..` without choking on spaces or `%`.
  const base = `file:///${path.split('/').slice(0, -1).map(encodeURIComponent).join('/')}/`
  const walk = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'img' && node.properties) {
      const src = node.properties.src
      if (typeof src === 'string' && src && !ABSOLUTE_RE.test(src)) {
        const encoded = new URL(src, base).pathname.replace(/^\/+/, '')
        // `pathname` is percent-encoded; decode once so rawFileUrl does not double-encode.
        // A segment with a malformed escape stays literal (the name really contains that `%`).
        node.properties.src = kanbanApi.rawFileUrl(root, encoded.split('/').map(safeDecode).join('/'))
      }
    }
    node.children?.forEach(walk)
  }
  return walk
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const { raw, sanitize, harden } = defaultRehypePlugins

export function MarkdownRenderer({ content, root, path }: MarkdownRendererProps) {
  const rehypePlugins = useMemo(() => {
    if (!root || !path) return undefined
    const relative: [typeof rehypeRelativeImages, RelativeImageOptions] = [rehypeRelativeImages, { root, path }]
    return [raw, relative, sanitize, harden]
  }, [root, path])

  return (
    <Streamdown
      mode="static"
      controls={false}
      lineNumbers={false}
      linkSafety={{ enabled: false }}
      components={markdownCodeComponents}
      rehypePlugins={rehypePlugins}
      className="px-6 py-5"
    >
      {content}
    </Streamdown>
  )
}
