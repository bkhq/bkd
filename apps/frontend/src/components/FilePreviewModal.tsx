import { FileText, Image as ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatFileSize } from '@/lib/format'

/**
 * Either an in-memory File (upload-area chip) or a server-side attachment
 * already persisted and reachable by URL (chat-message chip).
 */
export type PreviewItem =
  | { kind: 'file', file: File }
  | { kind: 'remote', name: string, mimeType: string, size: number, url: string }

function describe(item: PreviewItem) {
  if (item.kind === 'file') {
    return { name: item.file.name, mimeType: item.file.type, size: item.file.size }
  }
  return { name: item.name, mimeType: item.mimeType, size: item.size }
}

export function FilePreviewModal({ item, onClose }: { item: PreviewItem, onClose: () => void }) {
  const { t } = useTranslation()
  const { name, mimeType, size } = describe(item)
  const isImage = mimeType.startsWith('image/')
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isImage) {
      setImageUrl(null)
      return
    }
    if (item.kind === 'remote') {
      setImageUrl(item.url)
      return
    }
    const url = URL.createObjectURL(item.file)
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [item, isImage])

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[600px] max-h-[80vh] overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center gap-2 px-4 py-3 border-b border-border/30 space-y-0">
          {isImage ?
              (
                <ImageIcon className="h-4 w-4 shrink-0 text-blue-500" />
              ) :
              (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
          <DialogTitle className="text-sm font-medium truncate">{name}</DialogTitle>
        </DialogHeader>

        <div className="p-4 overflow-auto max-h-[calc(80vh-56px)]">
          {imageUrl ?
              (
                <img
                  src={imageUrl}
                  alt={name}
                  className="max-w-full max-h-[60vh] rounded-lg object-contain mx-auto"
                />
              ) :
              (
                <div className="space-y-3">
                  <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-muted/60 mx-auto">
                    <FileText className="h-8 w-8 text-muted-foreground/60" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {mimeType || t('chat.unknownType')}
                      {' '}
                      &middot;
                      {formatFileSize(size)}
                    </p>
                  </div>
                </div>
              )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
