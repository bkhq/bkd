import type { ComponentProps } from 'react'
import { ShikiCodeBlock } from '@/components/files/ShikiCodeBlock'

const LANG_RE = /language-(\S+)/

type CodeProps = ComponentProps<'code'> & { node?: unknown }

/** Fenced code: streamdown routes only block-level `code` here when `inlineCode` is set. */
function BlockCode({ className, children }: CodeProps) {
  const lang = LANG_RE.exec(className ?? '')?.[1] ?? 'text'
  return <ShikiCodeBlock code={String(children ?? '').replace(/\n$/, '')} lang={lang} />
}

function InlineCode({ children }: CodeProps) {
  return <code className="rounded bg-muted/70 px-1 py-0.5 text-[0.9em] font-mono">{children}</code>
}

/** streamdown `components` shared by the chat and the file-browser renderers. */
export const markdownCodeComponents = { code: BlockCode, inlineCode: InlineCode }
