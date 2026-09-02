import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Trash2,
  Upload,
} from 'lucide-react'
import type { DragEvent, ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useDeleteFile, useProject, useProjectFiles, useSaveFile, useUploadFiles } from '@/hooks/use-kanban'
import { ApiError, kanbanApi } from '@/lib/kanban-api'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { SidePanelButton } from '@/components/ui/side-panel'
import { FileBreadcrumb } from './FileBreadcrumb'
import { FileList } from './FileList'
import { FileViewer } from './FileViewer'

const UPLOAD_ERROR_TTL_MS = 5000
/** Server prefix on a 409 upload response; the remainder lists the clashing names. */
const CONFLICT_PREFIX = /^Already exists:\s*/

export function FileBrowserContent({
  headerActions,
  enabled = true,
}: {
  headerActions?: ReactNode
  enabled?: boolean
}) {
  const { t } = useTranslation()
  const {
    projectId,
    rootPath,
    currentPath,
    hideIgnored,
    navigateTo,
    toggleHideIgnored,
  } = useFileBrowserStore()

  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [deleteFileConfirm, setDeleteFileConfirm] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [conflict, setConflict] = useState<{ files: File[], names: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: project } = useProject(projectId ?? '')
  const effectiveRoot = rootPath ?? project?.directory ?? null

  const deleteFileMutation = useDeleteFile()
  const saveFileMutation = useSaveFile()
  const uploadMutation = useUploadFiles()

  const handleCopyPath = useCallback(() => {
    const fullPath = currentPath === '.' ? (effectiveRoot ?? '/') : (effectiveRoot ? `${effectiveRoot}/${currentPath}` : currentPath)
    navigator.clipboard.writeText(fullPath)
    setCopied(true)
    setTimeout(setCopied, 1500, false)
  }, [currentPath, effectiveRoot])

  const handleDownload = useCallback(() => {
    if (!effectiveRoot || currentPath === '.') return
    const url = kanbanApi.rawFileUrl(effectiveRoot, currentPath)
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.click()
  }, [effectiveRoot, currentPath])

  const {
    data: listing,
    isLoading,
    isError,
    error,
  } = useProjectFiles(effectiveRoot, currentPath, !!effectiveRoot && enabled)

  const handleEntryClick = useCallback(
    (name: string, _type: 'file' | 'directory') => {
      setIsEditing(false)
      const newPath = currentPath === '.' ? name : `${currentPath}/${name}`
      navigateTo(newPath)
    },
    [currentPath, navigateTo],
  )

  const handleFileBack = useCallback(() => {
    setIsEditing(false)
    const parentPath = currentPath.includes('/')
      ? currentPath.slice(0, currentPath.lastIndexOf('/'))
      : '.'
    navigateTo(parentPath)
  }, [currentPath, navigateTo])

  const handleDeleteEntry = useCallback((name: string, _type: 'file' | 'directory') => {
    if (!effectiveRoot) return
    const targetPath = currentPath === '.' ? name : `${currentPath}/${name}`
    deleteFileMutation.mutate({ root: effectiveRoot, path: targetPath })
  }, [effectiveRoot, currentPath, deleteFileMutation])

  const handleDeleteCurrentFile = useCallback(() => {
    if (!effectiveRoot || currentPath === '.') return
    deleteFileMutation.mutate(
      { root: effectiveRoot, path: currentPath },
      { onSuccess: () => handleFileBack() },
    )
    setDeleteFileConfirm(false)
  }, [effectiveRoot, currentPath, deleteFileMutation, handleFileBack])

  const handleSave = useCallback((content: string) => {
    if (!effectiveRoot || currentPath === '.') return
    saveFileMutation.mutate(
      { root: effectiveRoot, path: currentPath, content },
      { onSuccess: () => setIsEditing(false) },
    )
  }, [effectiveRoot, currentPath, saveFileMutation])

  const canUpload = !!effectiveRoot && listing?.type === 'directory'

  const uploadFiles = useCallback((files: File[], overwrite = false) => {
    if (!effectiveRoot || files.length === 0) return
    setConflict(null)
    uploadMutation.mutate(
      { root: effectiveRoot, path: currentPath, files, overwrite },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.statusCode === 409) {
            setConflict({ files, names: err.message.replace(CONFLICT_PREFIX, '') })
            return
          }
          setUploadError(err.message)
          setTimeout(setUploadError, UPLOAD_ERROR_TTL_MS, null)
        },
      },
    )
  }, [effectiveRoot, currentPath, uploadMutation])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!canUpload) return
    e.preventDefault()
    setIsDragOver(true)
  }, [canUpload])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Moving between children of the drop zone also fires dragleave
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!canUpload) return
    e.preventDefault()
    setIsDragOver(false)
    uploadFiles([...e.dataTransfer.files])
  }, [canUpload, uploadFiles])

  const currentFileName = currentPath.split('/').pop() ?? currentPath

  return (
    <>
      {/* Header + Breadcrumb */}
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <span className="text-xs font-medium text-muted-foreground truncate font-mono" title={effectiveRoot ?? undefined}>
            {effectiveRoot ?? t('fileBrowser.title')}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <SidePanelButton
            icon={copied ? Check : Copy}
            label={t('fileBrowser.copyPath')}
            onClick={handleCopyPath}
          />
          {canUpload && (
            <>
              <SidePanelButton
                icon={Upload}
                label={uploadMutation.isPending ? t('fileBrowser.uploading') : t('fileBrowser.upload')}
                onClick={() => fileInputRef.current?.click()}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  uploadFiles([...(e.target.files ?? [])])
                  e.target.value = ''
                }}
              />
            </>
          )}
          {listing?.type === 'file' && (
            <>
              <SidePanelButton
                icon={Download}
                label={t('fileBrowser.download')}
                onClick={handleDownload}
              />
              <SidePanelButton
                icon={Trash2}
                label={t('fileBrowser.delete')}
                onClick={() => setDeleteFileConfirm(true)}
                destructive
              />
            </>
          )}
          <button
            type="button"
            onClick={toggleHideIgnored}
            className={`p-1 rounded transition-colors ${
              hideIgnored
                ? 'text-foreground bg-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            aria-label={t('fileBrowser.hideIgnored')}
            title={hideIgnored ? t('fileBrowser.showIgnored') : t('fileBrowser.hideIgnored')}
          >
            {hideIgnored ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          {headerActions}
        </div>
      </div>

      {uploadError && (
        <div role="alert" className="px-3 py-1.5 text-xs text-destructive border-b border-border/60 shrink-0">
          {uploadError}
        </div>
      )}

      {/* Content (drop zone while a directory is shown) */}
      <div
        className="relative flex-1 min-h-0 flex flex-col"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary bg-background/80 text-sm text-primary">
            {t('fileBrowser.dropToUpload')}
          </div>
        )}
        <div className="flex-1 overflow-auto min-h-0 flex flex-col">
          {!effectiveRoot
            ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <FolderOpen className="h-12 w-12" />
                  <p className="text-sm">{t('fileBrowser.noDirectory')}</p>
                </div>
              )
            : isLoading
              ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                )
              : isError
                ? (
                    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                      {(error as Error)?.message || t('fileBrowser.loadError')}
                    </div>
                  )
                : listing?.type === 'file'
                  ? (
                      <FileViewer
                        file={listing}
                        breadcrumb={<FileBreadcrumb path={currentPath} onNavigate={navigateTo} projectName={project?.name} />}
                        isEditing={isEditing}
                        onStartEdit={() => setIsEditing(true)}
                        onCancelEdit={() => setIsEditing(false)}
                        onSave={handleSave}
                        isSaving={saveFileMutation.isPending}
                      />
                    )
                  : listing?.type === 'directory'
                    ? (
                        <FileList
                          entries={listing.entries}
                          onNavigate={handleEntryClick}
                          onDelete={handleDeleteEntry}
                          isDeleting={deleteFileMutation.isPending}
                          breadcrumb={<FileBreadcrumb path={currentPath} onNavigate={navigateTo} projectName={project?.name} />}
                        />
                      )
                    : null}
        </div>
      </div>

      {/* Delete confirmation for current file */}
      <AlertDialog open={deleteFileConfirm} onOpenChange={setDeleteFileConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileBrowser.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('fileBrowser.deleteConfirmDesc', { name: currentFileName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('fileBrowser.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteFileMutation.isPending}
              onClick={handleDeleteCurrentFile}
            >
              {deleteFileMutation.isPending ? t('fileBrowser.deleting') : t('fileBrowser.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replace confirmation when an upload clashes with existing files */}
      <AlertDialog open={!!conflict} onOpenChange={open => !open && setConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileBrowser.uploadConflictTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('fileBrowser.uploadConflictDesc', { names: conflict?.names })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('fileBrowser.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={uploadMutation.isPending}
              onClick={() => conflict && uploadFiles(conflict.files, true)}
            >
              {t('fileBrowser.replace')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
