import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { codeToHtml } from '@/lib/shiki'

interface ShikiCodeBlockProps {
  code: string
  lang: string
}

export function ShikiCodeBlock({ code, lang }: ShikiCodeBlockProps) {
  const { t } = useTranslation()
  const [html, setHtml] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setHtml('')
    let cancelled = false
    void codeToHtml(code, lang).then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(setCopied, 2000, false)
    }).catch(() => {})
  }, [code])

  if (!html) {
    return (
      <div className="relative group/code">
        <pre className="overflow-x-auto rounded-md bg-popover p-3 text-xs font-mono leading-snug">
          <code>{code}</code>
        </pre>
        <CopyButton copied={copied} onCopy={handleCopy} t={t} />
      </div>
    )
  }

  return (
    <div className="relative group/code my-2">
      <div className="absolute right-1.5 top-1.5 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity">
        <CopyButton copied={copied} onCopy={handleCopy} t={t} />
      </div>
      <div
        className="rounded-md bg-popover overflow-hidden [&_.shiki]:!bg-transparent [&_.shiki]:p-3 [&_.shiki]:text-xs [&_.shiki]:overflow-x-auto [&_code]:leading-snug"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

function CopyButton({
  copied,
  onCopy,
  t,
}: {
  copied: boolean
  onCopy: () => void
  t: (key: string) => string
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="flex items-center gap-1 rounded bg-background/90 backdrop-blur-sm border border-border/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-background transition-all shadow-sm"
      title={t('common.copy')}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-500" />
          <span className="text-emerald-500">{t('common.copied')}</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>{t('common.copy')}</span>
        </>
      )}
    </button>
  )
}
