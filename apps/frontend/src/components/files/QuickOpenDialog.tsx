import { File } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useFileSearch } from '@/hooks/use-kanban'

/** Open a file by (fuzzy) name: the server ranks the workspace's files. */
export function QuickOpenDialog({
  root,
  open,
  onOpenChange,
  onPick,
}: {
  root: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (path: string) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(setDebounced, 150, query)
    return () => clearTimeout(timer)
  }, [query])
  const { data, isFetching } = useFileSearch(open ? root : null, debounced)
  const paths = debounced ? (data?.paths ?? []) : []

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery('')
      }}
      title={t('fileBrowser.quickOpen')}
      description={t('fileBrowser.quickOpenPlaceholder')}
    >
      {/* The server already ranked the paths */}
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder={t('fileBrowser.quickOpenPlaceholder')} />
        <CommandList>
          {debounced && !isFetching && <CommandEmpty>{t('fileBrowser.quickOpenEmpty')}</CommandEmpty>}
          {paths.map((path) => {
            const slash = path.lastIndexOf('/')
            return (
              <CommandItem
                key={path}
                value={path}
                onSelect={() => {
                  onPick(path)
                  onOpenChange(false)
                  setQuery('')
                }}
              >
                <File className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{path.slice(slash + 1)}</span>
                {slash > 0 && <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{path.slice(0, slash)}</span>}
              </CommandItem>
            )
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
