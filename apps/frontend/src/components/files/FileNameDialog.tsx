import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/** A plain entry name: no separators, not `.` or `..`. */
export function isValidEntryName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !name.includes('/')
}

/**
 * Asks for one entry name (new file, new folder, rename). The parent keys it
 * per request, so each open starts from `initial`.
 */
export function FileNameDialog({
  title,
  confirmLabel,
  initial = '',
  error,
  pending,
  onSubmit,
  onClose,
}: {
  title: string
  confirmLabel: string
  initial?: string
  /** Server-side refusal, e.g. the name is taken. */
  error?: string | null
  pending?: boolean
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial)
  const [touched, setTouched] = useState(false)
  const trimmed = name.trim()
  const invalid = touched && !isValidEntryName(trimmed)

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (isValidEntryName(trimmed) && trimmed !== initial) onSubmit(trimmed)
          }}
        >
          <Input
            autoFocus
            aria-label={t('fileBrowser.nameLabel')}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setTouched(true)
            }}
            // Select the stem so typing replaces the name and keeps the extension
            onFocus={(e) => {
              const dot = initial.lastIndexOf('.')
              e.target.setSelectionRange(0, dot > 0 ? dot : initial.length)
            }}
            aria-invalid={invalid || !!error}
          />
          {(invalid || error) && (
            <p role="alert" className="text-xs text-destructive">
              {invalid ? t('fileBrowser.invalidName') : error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('fileBrowser.cancel')}</Button>
            <Button type="submit" disabled={pending}>{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
