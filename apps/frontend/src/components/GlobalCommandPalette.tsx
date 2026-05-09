import { useCallback, useEffect, useState } from 'react'
import { CommandDialog } from '@/components/ui/command'
import { SearchContent } from '@/components/search/SearchContent'

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const handleSelect = useCallback(() => {
    setOpen(false)
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command Palette">
      <SearchContent onSelect={handleSelect} autoFocus />
    </CommandDialog>
  )
}
