import { Loader2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'

/** Footer of a settings edit dialog: an optional delete on the left, cancel and save on the right. */
export function EditDialogFooter({
  deleteLabel,
  onDelete,
  onClose,
  onSave,
  canSave,
  saving,
}: {
  /** Shown with `onDelete` when the edited entry already exists. */
  deleteLabel?: string
  onDelete?: () => void
  onClose: () => void
  onSave: () => void
  canSave: boolean
  saving: boolean
}) {
  const { t } = useTranslation()
  return (
    <DialogFooter className="sm:justify-between">
      <div>
        {onDelete
          ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={onDelete}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3" />
                {deleteLabel}
              </Button>
            )
          : null}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="button" size="sm" disabled={!canSave} onClick={onSave}>
          {saving ? <Loader2 className="size-3 animate-spin" /> : null}
          {t('common.save')}
        </Button>
      </div>
    </DialogFooter>
  )
}
