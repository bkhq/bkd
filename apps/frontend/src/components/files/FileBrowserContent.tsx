import {
  ChevronsDownUp,
  Code,
  Copy,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  ListTree,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  WrapText,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { DragEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from 'cn'
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import { queryKeys, useDeleteFile, useProject, useProjectFiles, useSaveFile, useUploadFiles } from '@/hooks/use-kanban'
import { eventBus } from '@/lib/event-bus'
import { ApiError, kanbanApi } from '@/lib/kanban-api'
import { joinRootPath } from '@/lib/path-tree'
import { selectDraft, useFileBrowserStore } from '@/stores/file-browser-store'
import { FileBreadcrumb } from './FileBreadcrumb'
import { FileEditor } from './FileEditor'
import { FileList } from './FileList'
import { FileTree } from './FileTree'
import { TreePane } from './TreePane'

const UPLOAD_ERROR_TTL_MS = 5000
/** Server prefix on a 409 upload response; the remainder lists the clashing names. */
const CONFLICT_PREFIX = /^Already exists:\s*/

function parentDir(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
}

/** Only OS file drags upload; text dragged inside the editor stays the editor's. */
function isFileDrag(e: DragEvent): boolean {
  return [...e.dataTransfer.types].includes('Files')
}

function isMarkdown(path: string): boolean {
  return /\.mdx?$/i.test(path)
}

/** Small square icon button used in the headers. */
function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: typeof Copy
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

/**
 * Workspace file browser: a directory tree (open by default) beside the
 * opened file, which is directly editable. Without the tree, a directory shows
 * as a listing.
 */
export function FileBrowserContent({
  headerActions,
  enabled = true,
}: {
  headerActions?: ReactNode
  enabled?: boolean
}) {
  const { t } = useTranslation()
  const fileBrowser = useFileBrowserStore()
  const {
    projectId,
    rootPath,
    currentPath,
    hideIgnored,
    navigateTo,
    toggleHideIgnored,
    showTree,
    toggleTree,
    wrap,
    toggleWrap,
  } = fileBrowser

  // Entry awaiting delete confirmation (from either menu)
  const [deleteTarget, setDeleteTarget] = useState<{ path: string, type: 'file' | 'directory' } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [conflict, setConflict] = useState<{ files: File[], names: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // A navigation waiting on "discard?"; drafts themselves live in the store
  const [saveConflict, setSaveConflict] = useState(false)
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [collapseVersion, setCollapseVersion] = useState(0)
  // On a phone the tree and the content take turns at full width; this local
  // flag drives it, so the desktop `showTree` preference stays untouched
  const isMobile = useIsMobile()
  const [mobileTreeOpen, setMobileTreeOpen] = useState(true)
  const treeVisible = isMobile ? mobileTreeOpen : showTree
  const handleToggleTree = isMobile ? () => setMobileTreeOpen(v => !v) : toggleTree
  const queryClient = useQueryClient()

  // Agents edit the workspace too: refresh listings when a run reports changes
  useEffect(() => eventBus.onChangesSummary(() => {
    void queryClient.invalidateQueries({ queryKey: ['files'] })
  }), [queryClient])

  const { data: project } = useProject(projectId ?? '')
  const effectiveRoot = rootPath ?? project?.directory ?? null

  const deleteFileMutation = useDeleteFile()
  const saveFileMutation = useSaveFile()
  const uploadMutation = useUploadFiles()

  const {
    data: listing,
    isLoading,
    isError,
    error,
    refetch,
  } = useProjectFiles(effectiveRoot, currentPath, !!effectiveRoot && enabled)

  const file = listing?.type === 'file' ? listing : null
  // Unsaved edits of the opened file, scoped to this workspace root
  const draft = useFileBrowserStore(s => (effectiveRoot ? selectDraft(s, effectiveRoot, currentPath) : null))
  const setStoreDraft = useFileBrowserStore(s => s.setDraft)
  const clearDraft = useCallback((path: string) => {
    if (effectiveRoot) setStoreDraft(effectiveRoot, path, null)
  }, [effectiveRoot, setStoreDraft])
  const draftContent = draft?.content ?? null
  const editorValue = draftContent ?? file?.content ?? ''
  const isDirty = !!file && draftContent !== null && draftContent !== file.content
  // The file changed on disk under unsaved edits (typically an agent wrote it)
  const changedOnDisk = isDirty && draft?.baseModifiedAt !== file?.modifiedAt
  const preview = !!file && previewPath === file.path

  /** Run `go` now, or after the user agrees to drop unsaved edits. */
  const guardDirty = useCallback((go: () => void) => {
    if (isDirty) setPendingNav(() => go)
    else go()
  }, [isDirty])

  const openPath = useCallback((path: string) => {
    if (path === currentPath) return
    guardDirty(() => {
      clearDraft(currentPath)
      navigateTo(path)
    })
  }, [currentPath, guardDirty, clearDraft, navigateTo])

  /** Save the draft; `overwrite` skips the changed-on-disk check. */
  const handleSave = useCallback((overwrite = false) => {
    if (!effectiveRoot || !file || !isDirty) return
    setSaveConflict(false)
    saveFileMutation.mutate(
      {
        root: effectiveRoot,
        path: file.path,
        content: editorValue,
        expectedModifiedAt: overwrite ? undefined : draft?.baseModifiedAt,
      },
      {
        onSuccess: (saved) => {
          // Show the saved text right away; dropping the draft first would
          // flash the pre-save cache until the refetch lands
          queryClient.setQueryData(
            queryKeys.projectFiles(effectiveRoot, file.path, hideIgnored),
            { ...file, content: editorValue, size: saved.size, modifiedAt: saved.modifiedAt },
          )
          clearDraft(file.path)
        },
        onError: (err) => {
          if (err instanceof ApiError && err.statusCode === 409) setSaveConflict(true)
          else toast.error(err.message)
        },
      },
    )
  }, [effectiveRoot, file, isDirty, editorValue, draft, saveFileMutation, queryClient, hideIgnored, clearDraft])

  const handleEditorChange = useCallback((content: string) => {
    if (!file || !effectiveRoot) return
    // Typing back to the on-disk text drops the draft, so a later refresh
    // shows the new disk content instead of a stale "edit"
    setStoreDraft(
      effectiveRoot,
      file.path,
      content === file.content ? null : { content, baseModifiedAt: draft?.baseModifiedAt ?? file.modifiedAt },
    )
  }, [file, effectiveRoot, draft, setStoreDraft])

  const handleDiscard = useCallback(() => {
    clearDraft(currentPath)
    void refetch()
  }, [clearDraft, currentPath, refetch])

  const copyText = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(t('fileBrowser.copied')))
  }, [t])

  /** Contents as the editor would show them: draft first, then disk. */
  const copyContent = useCallback(async (path: string) => {
    if (!effectiveRoot) return
    if (path === file?.path) return copyText(editorValue)
    const pending = selectDraft(useFileBrowserStore.getState(), effectiveRoot, path)
    if (pending) return copyText(pending.content)
    const listed = await queryClient.fetchQuery({
      queryKey: queryKeys.projectFiles(effectiveRoot, path, hideIgnored),
      queryFn: () => kanbanApi.listFiles(effectiveRoot, path, hideIgnored),
    })
    if (listed.type !== 'file' || listed.isBinary) toast.error(t('fileBrowser.binaryFile'))
    else copyText(listed.content)
  }, [effectiveRoot, file, editorValue, copyText, queryClient, hideIgnored, t])

  const download = useCallback((path: string) => {
    if (!effectiveRoot) return
    const a = document.createElement('a')
    a.href = kanbanApi.rawFileUrl(effectiveRoot, path)
    a.download = ''
    a.click()
  }, [effectiveRoot])

  const discardPath = useCallback((path: string) => {
    clearDraft(path)
    if (path === currentPath) void refetch()
  }, [clearDraft, currentPath, refetch])

  /** Every delete (menus or list view) goes here, so drafts are always cleared. */
  const deletePath = useCallback((path: string) => {
    if (!effectiveRoot) return
    deleteFileMutation.mutate(
      { root: effectiveRoot, path },
      {
        onSuccess: () => {
          useFileBrowserStore.getState().clearDraftsUnder(effectiveRoot, path)
          // Leave the deleted file, or anything inside the deleted directory
          if (currentPath === path || currentPath.startsWith(`${path}/`)) navigateTo(parentDir(path))
        },
      },
    )
  }, [effectiveRoot, deleteFileMutation, currentPath, navigateTo])

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) deletePath(deleteTarget.path)
    setDeleteTarget(null)
  }, [deleteTarget, deletePath])

  /**
   * The file actions, shared by the header "..." menu and the tree's
   * right-click menu so both stay in sync. Directories only copy or delete.
   */
  const renderFileActions = (path: string, type: 'file' | 'directory') => {
    const isOpenFile = path === file?.path
    const hasDraft = !!effectiveRoot && !!selectDraft(fileBrowser, effectiveRoot, path)
    const item = 'whitespace-nowrap text-xs'
    return (
      <>
        <DropdownMenuItem className={item} onClick={() => copyText(joinRootPath(effectiveRoot, path))}>
          <Copy className="h-3.5 w-3.5" />
          {t('fileBrowser.copyPath')}
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onClick={() => copyText(path)}>
          <Copy className="h-3.5 w-3.5" />
          {t('fileBrowser.copyRelativePath')}
        </DropdownMenuItem>
        {type === 'file' && !(isOpenFile && file?.isBinary) && (
          <DropdownMenuItem className={item} onClick={() => void copyContent(path)}>
            <Copy className="h-3.5 w-3.5" />
            {t('fileBrowser.copyContent')}
          </DropdownMenuItem>
        )}
        {type === 'file' && (
          <DropdownMenuItem className={item} onClick={() => download(path)}>
            <Download className="h-3.5 w-3.5" />
            {t('fileBrowser.download')}
          </DropdownMenuItem>
        )}
        {type === 'file' && (isOpenFile || hasDraft) && (
          <DropdownMenuItem variant="destructive" className={item} onClick={() => discardPath(path)}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t('fileBrowser.discardAndReload')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" className={item} onClick={() => setDeleteTarget({ path, type })}>
          <Trash2 className="h-3.5 w-3.5" />
          {t('fileBrowser.delete')}
        </DropdownMenuItem>
      </>
    )
  }

  const handleEntryClick = useCallback((name: string) => {
    openPath(currentPath === '.' ? name : `${currentPath}/${name}`)
  }, [currentPath, openPath])

  // FileList confirms on its own
  const handleDeleteEntry = useCallback((name: string) => {
    deletePath(currentPath === '.' ? name : `${currentPath}/${name}`)
  }, [currentPath, deletePath])

  // Uploads land in the shown directory, or beside the opened file
  const uploadDir = file ? parentDir(file.path) : currentPath
  const canUpload = !!effectiveRoot && !!listing

  const uploadFiles = useCallback((files: File[], overwrite = false) => {
    if (!effectiveRoot || files.length === 0) return
    setConflict(null)
    uploadMutation.mutate(
      { root: effectiveRoot, path: uploadDir, files, overwrite },
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
  }, [effectiveRoot, uploadDir, uploadMutation])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!canUpload || !isFileDrag(e)) return
    e.preventDefault()
    setIsDragOver(true)
  }, [canUpload])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Moving between children of the drop zone also fires dragleave
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!canUpload || !isFileDrag(e)) return
    e.preventDefault()
    setIsDragOver(false)
    uploadFiles([...e.dataTransfer.files])
  }, [canUpload, uploadFiles])

  const workspaceTools = (
    <>
      {canUpload && (
        <IconButton
          icon={Upload}
          label={uploadMutation.isPending ? t('fileBrowser.uploading') : t('fileBrowser.upload')}
          onClick={() => fileInputRef.current?.click()}
        />
      )}
      <IconButton
        icon={hideIgnored ? EyeOff : Eye}
        label={hideIgnored ? t('fileBrowser.showIgnored') : t('fileBrowser.hideIgnored')}
        onClick={toggleHideIgnored}
        active={hideIgnored}
      />
    </>
  )

  const currentFileName = currentPath.split('/').pop() ?? currentPath

  return (
    <div
      className="relative flex flex-1 min-h-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-background/80 text-sm text-primary">
          {t('fileBrowser.dropToUpload')}
        </div>
      )}

      {treeVisible && effectiveRoot && (
        <TreePane fill={isMobile}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1.5 min-h-[37px]">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={effectiveRoot}>
                {project?.name ?? effectiveRoot}
              </span>
              {workspaceTools}
              <IconButton
                icon={RefreshCw}
                label={t('fileBrowser.refresh')}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['files'] })}
              />
              <IconButton icon={ChevronsDownUp} label={t('fileBrowser.collapseAll')} onClick={() => setCollapseVersion(v => v + 1)} />
              {/* The content header (and its toggle) is hidden behind the tree on a phone */}
              {isMobile && (
                <>
                  <IconButton icon={ListTree} label={t('fileBrowser.fileTree')} onClick={handleToggleTree} active />
                  {headerActions}
                </>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <FileTree
                root={effectiveRoot}
                currentPath={currentPath}
                renderMenu={renderFileActions}
                onOpenFile={(path) => {
                  openPath(path)
                  if (isMobile) setMobileTreeOpen(false)
                }}
                collapseVersion={collapseVersion}
              />
            </div>
          </div>
        </TreePane>
      )}

      <div className={cn('flex flex-1 min-w-0 flex-col', isMobile && treeVisible && effectiveRoot && 'hidden')}>
        {/* Header: path, unsaved state + save, file menu, tree toggle */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5 min-h-[37px]">
          <div className="min-w-0 flex-1">
            <FileBreadcrumb path={currentPath} onNavigate={openPath} projectName={project?.name} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isDirty && (
              <>
                {changedOnDisk
                  ? <span className="text-xs text-amber-600 dark:text-amber-400">{t('fileBrowser.changedOnDisk')}</span>
                  : <span className="text-xs text-muted-foreground">{t('fileBrowser.modified')}</span>}
                <button
                  type="button"
                  onClick={() => handleSave()}
                  disabled={saveFileMutation.isPending}
                  className="flex h-6 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-medium text-white transition-colors hover:bg-emerald-600/90 disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saveFileMutation.isPending ? t('fileBrowser.saving') : t('fileBrowser.saveFile')}
                </button>
              </>
            )}
            {file && isMarkdown(file.path) && (
              <IconButton
                icon={preview ? Code : FileText}
                label={preview ? t('fileBrowser.viewSource') : t('fileBrowser.viewRendered')}
                onClick={() => setPreviewPath(preview ? null : file.path)}
              />
            )}
            {!treeVisible && workspaceTools}
            {file && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={t('fileBrowser.fileActions')}
                  title={t('fileBrowser.fileActions')}
                >
                  <Ellipsis className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-0">
                  {renderFileActions(file.path, 'file')}
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={toggleWrap} className="whitespace-nowrap text-xs">
                    <WrapText className="h-3.5 w-3.5" />
                    {t('fileBrowser.wordWrap')}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <IconButton icon={ListTree} label={t('fileBrowser.fileTree')} onClick={handleToggleTree} active={treeVisible} />
            {headerActions}
          </div>
        </div>

        {uploadError && (
          <div role="alert" className="px-3 py-1.5 text-xs text-destructive border-b border-border/60 shrink-0">
            {uploadError}
          </div>
        )}

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
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
                : file
                  ? (
                      <FileEditor
                        file={file}
                        root={effectiveRoot}
                        value={editorValue}
                        onChange={handleEditorChange}
                        onSave={() => handleSave()}
                        wrap={wrap}
                        preview={preview}
                      />
                    )
                  : listing?.type === 'directory'
                    ? (treeVisible
                        ? (
                            <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                              {t('fileBrowser.selectFile')}
                            </div>
                          )
                        : (
                            <FileList
                              entries={listing.entries}
                              onNavigate={handleEntryClick}
                              onDelete={handleDeleteEntry}
                              isDeleting={deleteFileMutation.isPending}
                            />
                          ))
                    : null}
        </div>
      </div>

      {/* Save refused: the file changed on disk since it was opened */}
      <AlertDialog open={saveConflict} onOpenChange={setSaveConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileBrowser.saveConflictTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('fileBrowser.saveConflictDesc', { name: currentFileName })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('fileBrowser.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => {
                setSaveConflict(false)
                handleDiscard()
              }}
            >
              {t('fileBrowser.reloadFromDisk')}
            </AlertDialogAction>
            <AlertDialogAction variant="destructive" onClick={() => handleSave(true)}>
              {t('fileBrowser.overwrite')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Navigating away from unsaved edits */}
      <AlertDialog open={!!pendingNav} onOpenChange={open => !open && setPendingNav(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileBrowser.unsavedTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('fileBrowser.unsavedDesc', { name: currentFileName })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('fileBrowser.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                pendingNav?.()
                setPendingNav(null)
              }}
            >
              {t('fileBrowser.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation, from either file actions menu */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileBrowser.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(deleteTarget?.type === 'directory' ? 'fileBrowser.deleteConfirmDirDesc' : 'fileBrowser.deleteConfirmDesc', {
                name: deleteTarget?.path.split('/').pop(),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('fileBrowser.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteFileMutation.isPending}
              onClick={handleConfirmDelete}
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
    </div>
  )
}
