import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const DEFAULT_MAX_FILES = 10

/**
 * Shared file-attachment state + handlers used by ChatInput (follow-up) and
 * CreateIssueDialog. Keeps the picker/drag/paste/preview behaviour aligned.
 *
 * Limits mirror server-side `uploads.ts` constants. Errors auto-clear after 5s.
 */
export function useFileAttachments(opts: { maxFileSize?: number, maxFiles?: number } = {}) {
  const { t } = useTranslation()
  const maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES

  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(
    (incoming: File[]) => {
      setAttachedFiles((prev) => {
        const combined = [...prev]
        for (const file of incoming) {
          if (file.size > maxFileSize) {
            setAttachError(
              t('chat.fileTooBig', { name: file.name, limit: maxFileSize / 1024 / 1024 }),
            )
            setTimeout(setAttachError, 5000, null)
            continue
          }
          if (combined.length >= maxFiles) {
            setAttachError(t('chat.tooManyFiles', { max: maxFiles }))
            setTimeout(setAttachError, 5000, null)
            break
          }
          if (!combined.some(f => f.name === file.name && f.size === file.size)) {
            combined.push(file)
          }
        }
        return combined
      })
    },
    [t, maxFileSize, maxFiles],
  )

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const removed = prev[index]
      setPreviewFile(current =>
        current && removed && current.name === removed.name && current.size === removed.size
          ? null
          : current,
      )
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const reset = useCallback(() => {
    setAttachedFiles([])
    setAttachError(null)
    setPreviewFile(null)
  }, [])

  const openPicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      const files: File[] = []
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = [...e.dataTransfer.files]
      if (files.length > 0) addFiles(files)
    },
    [addFiles],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = [...e.target.files ?? []]
      if (files.length > 0) addFiles(files)
      // Reset so the same file can be re-selected later
      e.target.value = ''
    },
    [addFiles],
  )

  return {
    attachedFiles,
    setAttachedFiles,
    attachError,
    setAttachError,
    isDragOver,
    previewFile,
    setPreviewFile,
    fileInputRef,
    addFiles,
    removeFile,
    reset,
    openPicker,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
  }
}
