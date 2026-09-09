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

/**
 * Rehype plugin: point images referenced relative to the previewed file at
 * the raw-file API. Runs after rehype-raw (so inline HTML images are
 * elements) and before sanitize/harden (which would resolve relative URLs
 * against the app origin).
 */
function rehypeRelativeImages(root: string, filePath: string) {
  const dir = filePath.split('/').slice(0, -1).join('/')
  const walk = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'img' && node.properties) {
      const src = node.properties.src
      if (typeof src === 'string' && src && !ABSOLUTE_RE.test(src)) {
        const resolved = new URL(src, `file:///${dir}/`).pathname.replace(/^\/+/, '')
        node.properties.src = kanbanApi.rawFileUrl(root, resolved)
      }
    }
    node.children?.forEach(walk)
  }
  return () => walk
}

const { raw, sanitize, harden } = defaultRehypePlugins

export function MarkdownRenderer({ content, root, path }: MarkdownRendererProps) {
  const rehypePlugins = useMemo(
    () => (root && path ? [raw, rehypeRelativeImages(root, path), sanitize, harden] : undefined),
    [root, path],
  )

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
