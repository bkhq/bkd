import {
  ArrowUp,
  Eraser,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  SlashSquare,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EngineIcon } from '@/components/EngineIcons'
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
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useChangesSummary } from '@/hooks/use-changes-summary'
import { useClearIssueSession, useEngineAvailability, useEngineSettings, useFollowUpIssue, useOmitModel } from '@/hooks/use-kanban'
import { formatFileSize, formatModelName } from '@/lib/format'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { BusyAction, EngineModel, SessionStatus } from '@/types/kanban'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_FILES = 10

const MODE_OPTIONS = ['auto', 'ask'] as const
type ModeOption = (typeof MODE_OPTIONS)[number]

function normalizePrompt(input: string): string {
  return input.replace(/^(?:\\n|\s)+/g, '').replace(/(?:\\n|\s)+$/g, '')
}

function toPermissionMode(mode: ModeOption): 'auto' | 'supervised' {
  if (mode === 'ask') return 'supervised'
  return mode
}

export function ChatInput({
  projectId,
  issueId,
  diffOpen,
  onToggleDiff,
  scrollRef,
  engineType,
  model,
  sessionStatus,
  statusId,
  isThinking = false,
  onMessageSent,
  slashCommands = [],
  pluginCommands = [],
  onRefreshLogs,
  pendingEditContent,
  onPendingEditConsumed,
}: {
  projectId?: string
  issueId?: string
  diffOpen?: boolean
  onToggleDiff?: () => void
  scrollRef?: React.RefObject<HTMLDivElement | null>
  engineType?: string
  model?: string
  sessionStatus?: SessionStatus | null
  statusId?: string
  isThinking?: boolean
  onMessageSent?: (messageId: string, prompt: string, metadata?: Record<string, unknown>) => void
  slashCommands?: string[]
  pluginCommands?: Array<{ name: string, path: string }>
  onRefreshLogs?: () => void
  pendingEditContent?: string | null
  onPendingEditConsumed?: () => void
}) {
  const { t } = useTranslation()
  const draftKey = issueId ? `bkd:draft:${issueId}` : null
  // Ref tracks current issueId so async callbacks (handleSend) can compare
  // against the live value rather than the stale closure capture.
  const issueIdRef = useRef(issueId)
  issueIdRef.current = issueId
  const [input, setInput] = useState(() => {
    if (!draftKey) return ''
    try {
      return localStorage.getItem(draftKey) ?? ''
    } catch {
      return ''
    }
  })
  // Track previous draftKey so the persist effect can detect a key change
  // and skip one cycle. Without this, switching issues would write stale
  // input (from the previous issue) into the new key — setInput from the
  // restore effect only takes effect on the *next* render.
  //
  // Only the persist effect updates the ref. The restore effect deliberately
  // does NOT touch it, so the persist effect can reliably detect the change.
  // This pattern is StrictMode-safe (no shared boolean flag to consume).
  const prevDraftKeyRef = useRef(draftKey)
  // Restore draft when switching issues
  useEffect(() => {
    if (!draftKey) {
      setInput('')
      return
    }
    try {
      setInput(localStorage.getItem(draftKey) ?? '')
    } catch {
      setInput('')
    }
  }, [draftKey])
  // Persist draft to localStorage on input change.
  // When draftKey changes, skip one cycle to avoid persisting stale input.
  useEffect(() => {
    if (prevDraftKeyRef.current !== draftKey) {
      prevDraftKeyRef.current = draftKey
      return
    }
    if (!draftKey) return
    try {
      if (input) {
        localStorage.setItem(draftKey, input)
      } else {
        localStorage.removeItem(draftKey)
      }
    } catch {
      /* quota exceeded — ignore */
    }
  }, [draftKey, input])
  // Fill input from pending message edit (recall)
  useEffect(() => {
    if (pendingEditContent) {
      setInput(pendingEditContent)
      textareaRef.current?.focus()
      onPendingEditConsumed?.()
    }
  }, [pendingEditContent, onPendingEditConsumed])

  const [sendError, setSendError] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isSendingRef = useRef(false)

  const followUp = useFollowUpIssue(projectId ?? '')
  const clearSession = useClearIssueSession(projectId ?? '')
  const [clearSessionOpen, setClearSessionOpen] = useState(false)
  const changesSummary = useChangesSummary(projectId, issueId ?? undefined)
  const changedCount = changesSummary?.fileCount ?? 0
  const additions = changesSummary?.additions ?? 0
  const deletions = changesSummary?.deletions ?? 0
  const changesRoot = (changesSummary as { root?: string } | null)?.root
  const openFileBrowser = useFileBrowserStore(s => s.openForIssue)

  // Fetch models for current engine, filtering out hidden ones
  const { data: discovery } = useEngineAvailability(!!engineType)
  const { data: engineSettings } = useEngineSettings(!!engineType)
  const models = useMemo(() => {
    if (!engineType) return []
    const all = discovery?.models[engineType] ?? []
    const hidden = new Set(engineSettings?.engines[engineType]?.hiddenModels ?? [])
    return hidden.size > 0 ? all.filter(m => !hidden.has(m.id)) : all
  }, [engineType, discovery, engineSettings])
  const [selectedModel, setSelectedModel] = useState(model || '')
  // Sync selectedModel when issue changes (model prop changes)
  useEffect(() => {
    setSelectedModel(model || '')
  }, [model])

  // Lock model picker when omit-model flag is on for Claude engines
  const { data: omitModelData } = useOmitModel(true)
  const isClaudeEngine = engineType === 'claude-code' || engineType === 'claude-code-sdk'
  const modelLocked = isClaudeEngine && (omitModelData?.enabled ?? false)
  const [mode, setMode] = useState<ModeOption>('auto')
  const [busyAction, setBusyAction] = useState<BusyAction>('queue')
  const activeModel = selectedModel || model || ''
  const isSessionActive = sessionStatus === 'running' || sessionStatus === 'pending'
  const effectiveBusyAction: BusyAction | undefined = isSessionActive ?
    isThinking ?
      'queue' :
      busyAction :
    undefined

  // Normalized slash commands only (for CommandPicker button + command detection)
  const normalizedSlashCommands = useMemo(
    () => slashCommands.map(cmd => (cmd.startsWith('/') ? cmd : `/${cmd}`)),
    [slashCommands],
  )

  // Build tagged command list with category labels (for inline menu)
  interface TaggedCommand {
    value: string
    category: 'command' | 'plugin'
  }
  const allCommands: TaggedCommand[] = useMemo(() => {
    const norm = (cmd: string) => (cmd.startsWith('/') ? cmd : `/${cmd}`)
    const items: TaggedCommand[] = []
    for (const cmd of slashCommands) items.push({ value: norm(cmd), category: 'command' })
    for (const p of pluginCommands) items.push({ value: norm(p.name), category: 'plugin' })
    return items
  }, [slashCommands, pluginCommands])

  // All command values for command detection in handleSend
  const normalizedCommands = useMemo(() => allCommands.map(c => c.value), [allCommands])

  // Inline command menu: show when input starts with "/" and has no spaces yet
  const commandQuery = useMemo(() => {
    const trimmed = input.trimStart()
    if (!trimmed.startsWith('/')) return null
    if (trimmed.includes(' ')) return null
    return trimmed.slice(1).toLowerCase()
  }, [input])

  const filteredCommands = useMemo(() => {
    if (commandQuery === null || allCommands.length === 0) return [] as TaggedCommand[]
    if (commandQuery === '') return allCommands
    return allCommands.filter((item) => {
      const target = item.value.toLowerCase()
      let ti = 0
      for (let qi = 0; qi < commandQuery.length; qi++) {
        ti = target.indexOf(commandQuery[qi], ti)
        if (ti === -1) return false
        ti++
      }
      return true
    })
  }, [commandQuery, allCommands])

  const showCommandMenu = filteredCommands.length > 0
  const [commandIndex, setCommandIndex] = useState(0)
  // Reset selection when filtered list changes
  const prevFilteredRef = useRef(filteredCommands)
  if (prevFilteredRef.current !== filteredCommands) {
    prevFilteredRef.current = filteredCommands
    if (commandIndex !== 0) setCommandIndex(0)
  }

  const normalizedPrompt = normalizePrompt(input)
  const canSend =
    (normalizedPrompt.length > 0 || attachedFiles.length > 0) && !!issueId && !!projectId

  const addFiles = useCallback(
    (incoming: File[]) => {
      setAttachedFiles((prev) => {
        const combined = [...prev]
        for (const file of incoming) {
          if (file.size > MAX_FILE_SIZE) {
            setSendError(
              t('chat.fileTooBig', {
                name: file.name,
                limit: MAX_FILE_SIZE / 1024 / 1024,
              }),
            )
            setTimeout(setSendError, 5000, null)
            continue
          }
          if (combined.length >= MAX_FILES) {
            setSendError(t('chat.tooManyFiles', { max: MAX_FILES }))
            setTimeout(setSendError, 5000, null)
            break
          }
          // Deduplicate by name+size
          if (!combined.some(f => f.name === file.name && f.size === file.size)) {
            combined.push(file)
          }
        }
        return combined
      })
    },
    [t],
  )

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const removed = prev[index]
      // Clear preview if the removed file is currently being previewed
      setPreviewFile(current =>
        current && current.name === removed.name && current.size === removed.size ? null : current,
      )
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleClearSession = async () => {
    if (!issueId) return
    try {
      await clearSession.mutateAsync(issueId)
      setClearSessionOpen(false)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
      setTimeout(setSendError, 5000, null)
    }
  }

  const handleSend = async () => {
    if (!canSend || !issueId || isSendingRef.current) return
    isSendingRef.current = true
    const prompt = normalizedPrompt
    const filesToSend = [...attachedFiles]
    setInput('')
    // Reset manual drag-resize so the next message starts auto-growing
    // from the empty state instead of inheriting the previous turn's
    // pinned height.
    setManualHeight(null)
    // Clear persisted draft
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey)
      } catch {
        /* ignore */
      }
    }
    setAttachedFiles([])
    setSendError(null)
    try {
      const isTodo = statusId === 'todo'
      const isDone = statusId === 'done'
      const isWorking = statusId === 'working'
      const result = await followUp.mutateAsync({
        issueId,
        prompt,
        model: activeModel || undefined,
        permissionMode: toPermissionMode(mode),
        busyAction: effectiveBusyAction,
        files: filesToSend.length > 0 ? filesToSend : undefined,
      })
      // Append message with server-assigned messageId
      if (result.messageId) {
        const filesMeta =
          filesToSend.length > 0 ?
              filesToSend.map(f => ({
                id: '',
                name: f.name,
                mimeType: f.type,
                size: f.size,
              })) :
            undefined
        const firstWord = prompt.split(/\s/)[0] ?? ''
        const isCommand =
          firstWord.startsWith('/') &&
          (normalizedCommands.length === 0 || normalizedCommands.includes(firstWord))
        const isQueued = result.queued === true
        const metadata: Record<string, unknown> | undefined = isTodo || (isWorking && isQueued) ?
            {
              type: 'pending',
              ...(filesMeta ? { attachments: filesMeta } : {}),
            } :
          isDone ?
              { type: 'done', ...(filesMeta ? { attachments: filesMeta } : {}) } :
            isCommand ?
                { type: 'command' } :
              filesMeta ?
                  { attachments: filesMeta } :
                undefined
        onMessageSent?.(result.messageId, prompt, metadata)
      }
      // Auto-scroll to bottom after sending
      setTimeout(() => {
        scrollRef?.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth',
        })
      }, 100)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSendError(msg)
      // Restore input and files on failure — only if still on the same issue.
      // Compare against the ref (live value) rather than the closure-captured
      // issueId, which is always the same value as draftKey's source.
      if (issueIdRef.current === issueId) {
        setInput(prompt)
        setAttachedFiles(filesToSend)
      }
      setTimeout(setSendError, 5000, null)
    } finally {
      isSendingRef.current = false
    }
  }

  const selectSlashCommand = useCallback((cmd: string) => {
    setInput(cmd)
    textareaRef.current?.focus()
  }, [])

  /** Resolve the text to insert for a tagged command item. */
  const resolveCommandInput = useCallback((item: TaggedCommand): string => {
    return `${item.value} `
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCommandIndex(i => (i < filteredCommands.length - 1 ? i + 1 : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCommandIndex(i => (i > 0 ? i - 1 : filteredCommands.length - 1))
        return
      }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
        e.preventDefault()
        const item = filteredCommands[commandIndex]
        if (item) {
          setInput(resolveCommandInput(item))
          textareaRef.current?.focus()
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // Add a space to dismiss the menu while keeping the text
        setInput(prev => `${prev} `)
        return
      }
    }
    // Enter sends, Shift+Enter inserts newline. Cmd/Ctrl+Enter kept for muscle
    // memory. Skip while IME is composing so Chinese/Japanese input commits
    // its candidate first.
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
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
      // Reset input so same file can be re-selected
      e.target.value = ''
    },
    [addFiles],
  )

  // Manual height override (desktop drag-resize). When set, takes priority
  // over the auto-grow effect. Cleared on send so the next message starts
  // with auto-grow again.
  const [manualHeight, setManualHeight] = useState<number | null>(null)
  const dragRef = useRef({ active: false, startY: 0, startH: 0 })

  // Auto-grow textarea: shrink to content, expand up to ~8 lines, then scroll.
  // useLayoutEffect runs before paint so the resize never flashes a stale
  // height. Skipped while a manual override is active.
  useLayoutEffect(() => {
    if (manualHeight !== null) return
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = '0px'
    const next = Math.min(ta.scrollHeight, 200)
    ta.style.height = `${Math.max(next, 32)}px`
  }, [input, manualHeight])

  // Apply manual height when user drags the resize handle.
  useLayoutEffect(() => {
    if (manualHeight === null) return
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = `${manualHeight}px`
  }, [manualHeight])

  // Drag-to-resize handler (desktop only — the handle is `max-md:hidden`).
  // Sets manualHeight so the auto-grow effect bows out for this turn.
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const ta = textareaRef.current
      const startH = ta?.offsetHeight ?? 32
      dragRef.current = { active: true, startY: e.clientY, startH }
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current.active) return
        const delta = dragRef.current.startY - ev.clientY
        const next = Math.max(32, Math.min(640, dragRef.current.startH + delta))
        setManualHeight(next)
      }
      const cleanup = () => {
        dragRef.current.active = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', cleanup)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', cleanup)
    },
    [],
  )

  const hasChanges = changedCount > 0

  return (
    <div className="shrink-0 w-full min-w-0 px-2 pb-2 relative z-30">
      <div
        className={`rounded-2xl border bg-card/80 backdrop-blur-sm shadow-sm transition-all duration-200 focus-within:border-border/80 focus-within:shadow-md ${
          isDragOver ?
            'border-primary/50 bg-primary/[0.03] ring-2 ring-primary/20' :
            'border-border/50'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag-to-resize handle — desktop only. Lets power users pin a
            larger textarea height for long compositions; auto-grow takes
            over again after send (manualHeight resets in handleSend).
            Hidden on mobile because the 2px target is unreachable on
            touch and auto-grow is the better default there. */}
        <div
          onMouseDown={handleResizeStart}
          className="hidden md:flex items-center justify-center h-2 cursor-ns-resize group/resize"
        >
          <div className="w-8 h-0.5 rounded-full bg-border/30 group-hover/resize:bg-border/60 transition-colors" />
        </div>

        {/* Drag overlay hint */}
        {isDragOver ?
            (
              <div className="flex items-center justify-center py-4 text-xs text-primary font-medium">
                {t('chat.attachDragHint')}
              </div>
            ) :
          null}

        {/* Status bar — desktop only. Mobile collapses files-changed badge,
            Mode/Model selectors, etc. behind the ⋯ button in the bottom toolbar.
            Rendered without an internal divider so the whole input feels like
            one card; selectors live here on the right while file changes (when
            present) appear on the left as subtle chips. */}
        <div className="flex items-center gap-1.5 px-2 pt-2 max-md:hidden">
          <button
            type="button"
            onClick={() => projectId && issueId && openFileBrowser(projectId, issueId, changesRoot)}
            className="inline-flex items-center justify-center rounded-md h-6 w-6 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t('diff.openFiles')}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          {hasChanges ?
              (
                <button
                  type="button"
                  onClick={onToggleDiff}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 h-6 text-[11px] transition-colors ${
                    diffOpen ?
                      'bg-primary/10 ring-1 ring-primary/20 text-foreground' :
                      'text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  <span>{t('chat.filesChanged', { count: changedCount })}</span>
                  <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    +
                    {additions}
                  </span>
                  <span className="font-mono tabular-nums text-red-600 dark:text-red-400">
                    -
                    {deletions}
                  </span>
                </button>
              ) :
            null}
          <div className="ml-auto flex items-center gap-1">
            {/* Desktop: inline toolbar */}
            <div className="hidden md:flex items-center gap-1">
              {isSessionActive && !isThinking ?
                  (
                    <BusyActionSelect value={busyAction} onChange={setBusyAction} />
                  ) :
                null}
              <ModeSelect value={mode} onChange={setMode} />
              {models.length > 0 ?
                  (
                    <ModelSelect
                      models={models}
                      value={activeModel}
                      onChange={setSelectedModel}
                      disabled={isSessionActive || modelLocked}
                      locked={modelLocked}
                    />
                  ) :
                null}
            </div>
            {/* Mobile: collapse all selectors behind a single ⋯ trigger so the
                input toolbar stays one-line and doesn't fight the soft keyboard. */}
            <div className="md:hidden">
              <Popover>
                <PopoverTrigger
                  render={(
                    <button
                      type="button"
                      className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      aria-label="More options"
                    />
                  )}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </PopoverTrigger>
                <PopoverContent align="end" side="top" className="w-auto p-2">
                  <div className="flex flex-col items-stretch gap-2 min-w-[180px]">
                    {isSessionActive && !isThinking ?
                        (
                          <BusyActionSelect value={busyAction} onChange={setBusyAction} />
                        ) :
                      null}
                    <ModeSelect value={mode} onChange={setMode} />
                    {models.length > 0 ?
                        (
                          <ModelSelect
                            models={models}
                            value={activeModel}
                            onChange={setSelectedModel}
                            disabled={isSessionActive || modelLocked}
                            locked={modelLocked}
                          />
                        ) :
                      null}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Error banner */}
        {sendError ?
            (
              <div className="mx-2 mt-2 rounded-lg bg-destructive/10 border border-destructive/20 px-2 py-2 text-xs text-destructive">
                {sendError}
              </div>
            ) :
          null}

        {/* Inline command menu */}
        {showCommandMenu ?
            (
              <div className="mx-2 mt-1 rounded-lg border border-border/40 bg-popover shadow-md overflow-hidden">
                <div className="max-h-[200px] overflow-y-auto py-1">
                  {filteredCommands.map((item, i) => (
                    <button
                      key={`${item.category}:${item.value}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setInput(resolveCommandInput(item))
                        textareaRef.current?.focus()
                      }}
                      className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors ${
                        i === commandIndex ?
                          'bg-primary/10 text-primary' :
                          'text-foreground/80 hover:bg-muted/50'
                      }`}
                    >
                      <code className="font-mono">{item.value}</code>
                      {item.category === 'plugin' ?
                          (
                            <span className="ml-auto text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                              {t('chat.plugins')}
                            </span>
                          ) :
                        null}
                    </button>
                  ))}
                </div>
              </div>
            ) :
          null}

        {/* File preview bar — above the textarea row when files are attached */}
        {attachedFiles.length > 0 ?
            (
              <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
                {attachedFiles.map((file, idx) => (
                  <div
                    key={`${file.name}-${file.size}`}
                    className="group/file flex items-center gap-1.5 rounded-lg bg-muted/50 border border-border/40 px-2 py-1 text-xs cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => setPreviewFile(file)}
                  >
                    {file.type.startsWith('image/') ?
                        (
                          <ImageIcon className="h-3 w-3 shrink-0 text-blue-500" />
                        ) :
                        (
                          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                    <span className="truncate max-w-[120px]">{file.name}</span>
                    <span className="text-muted-foreground/60">{formatFileSize(file.size)}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(idx)
                      }}
                      className="ml-0.5 rounded p-0.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title={t('chat.removeFile')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) :
          null}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Combined input row: textarea grows in the middle, action icons sit
            on either side and stay aligned to the bottom of the textarea
            even when it auto-grows (`items-end`). When the textarea is a
            single line the whole input is ~44px tall — same row as the
            buttons — saving the ~50px the previous two-row toolbar wasted
            in idle state. ChatGPT / Claude.app pattern. */}
        <div className="flex items-end gap-0.5 px-1.5 py-1.5">
          {/* Left actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* EngineInfo / Refresh — desktop only. On mobile both go into the
                ⋯ popover so the bottom row stays at 📎 / ⋯  ↑ (4 elements). */}
            <div className="hidden md:flex items-center gap-0.5">
              {engineType ? <EngineInfo engineType={engineType} /> : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              title={t('chat.attach')}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
            {normalizedSlashCommands.length > 0 ?
                (
                  <CommandPicker
                    commands={normalizedSlashCommands}
                    onSelect={cmd => selectSlashCommand(cmd)}
                  />
                ) :
              null}
            <Button
              variant="ghost"
              size="icon"
              title={t('chat.refreshLogs')}
              onClick={onRefreshLogs}
              className="max-md:hidden"
            >
              <RefreshCw className="size-4" />
            </Button>
            {/* Mobile-only ⋯ — surfaces the contents of the (hidden) status bar:
                files-changed badge, Mode / Model / BusyAction selectors. Keeps
                the input chrome to a single visible row on phones. */}
            <div className="md:hidden">
              <Popover>
                <PopoverTrigger
                  render={(
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('chat.moreOptions', 'More')}
                      aria-label="More options"
                    />
                  )}
                >
                  <MoreHorizontal className="size-4" />
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-auto p-2">
                  <div className="flex flex-col items-stretch gap-2 min-w-[200px]">
                    {/* Engine info (was top-left toolbar icon on desktop). */}
                    {engineType ?
                        (
                          <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                            <EngineIcon engineType={engineType} className="size-4 shrink-0" />
                            <span className="font-medium">
                              {t(`createIssue.engineLabel.${engineType}`, engineType)}
                            </span>
                          </div>
                        ) :
                      null}
                    {/* Refresh / Clear session buttons — collapsed from
                        toolbar to keep the visible row clean on phones. */}
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={onRefreshLogs}
                      >
                        <RefreshCw className="size-3.5" />
                        {t('chat.refreshLogs')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        disabled={!issueId || isSessionActive || clearSession.isPending}
                        onClick={() => setClearSessionOpen(true)}
                      >
                        <Eraser className="size-3.5" />
                        {t('chat.clearSession')}
                      </Button>
                    </div>
                    {changedCount > 0 ?
                        (
                          <button
                            type="button"
                            onClick={onToggleDiff}
                            className={`inline-flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs transition-all ${
                              diffOpen ?
                                'bg-primary/10 ring-1 ring-primary/20 text-foreground' :
                                'bg-muted/40 hover:bg-muted/60 text-muted-foreground'
                            }`}
                          >
                            <span>{t('chat.filesChanged', { count: changedCount })}</span>
                            <span className="font-mono tabular-nums">
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                +
                                {additions}
                              </span>
                              <span className="ml-1 text-red-600 dark:text-red-400 font-medium">
                                -
                                {deletions}
                              </span>
                            </span>
                          </button>
                        ) :
                      null}
                    {isSessionActive && !isThinking ?
                        (
                          <BusyActionSelect value={busyAction} onChange={setBusyAction} />
                        ) :
                      null}
                    <ModeSelect value={mode} onChange={setMode} />
                    {models.length > 0 ?
                        (
                          <ModelSelect
                            models={models}
                            value={activeModel}
                            onChange={setSelectedModel}
                            disabled={isSessionActive || modelLocked}
                            locked={modelLocked}
                          />
                        ) :
                      null}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Textarea — flex-1 between the action groups. Auto-grows up to
              ~200px via the useLayoutEffect above, then internally scrolls.
              `field-sizing:fixed` overrides shadcn's auto-sizing so the JS
              path is the single source of truth. */}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={statusId === 'todo' ? t('chat.placeholderTodo') : t('chat.placeholder')}
            rows={1}
            className="flex-1 self-stretch bg-transparent text-base md:text-sm resize-none outline-none border-none shadow-none placeholder:text-muted-foreground/40 leading-relaxed focus-visible:ring-0 overflow-y-auto min-h-[32px] py-1.5 px-1.5 [field-sizing:fixed]"
          />

          {/* Right actions */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              title={t('chat.clearSession')}
              disabled={!issueId || isSessionActive || clearSession.isPending}
              onClick={() => setClearSessionOpen(true)}
              className="max-md:hidden text-muted-foreground/60 hover:text-destructive"
            >
              <Eraser className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              disabled={!canSend || followUp.isPending}
              onClick={handleSend}
              title={t('chat.send')}
              className="rounded-full size-8 shadow-sm transition-transform hover:scale-105 disabled:hover:scale-100"
            >
              {followUp.isPending ?
                  <Loader2 className="size-4 animate-spin" /> :
                  <ArrowUp className="size-4" strokeWidth={2.5} />}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={clearSessionOpen} onOpenChange={setClearSessionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.clearSessionConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('chat.clearSessionConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearSession} disabled={clearSession.isPending}>
              {clearSession.isPending ?
                  (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('chat.clearSessionAction')}
                    </span>
                  ) :
                  (
                    t('chat.clearSessionAction')
                  )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* File preview modal — shadcn Dialog */}
      {previewFile ?
          (
            <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
          ) :
        null}
    </div>
  )
}

// ─── FilePreviewModal ────────────────────────────────────────────────────────
// Replaced custom modal with shadcn Dialog

function FilePreviewModal({ file, onClose }: { file: File, onClose: () => void }) {
  const { t } = useTranslation()
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setImageUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setImageUrl(null)
  }, [file])

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[600px] max-h-[80vh] overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center gap-2 px-4 py-3 border-b border-border/30 space-y-0">
          {file.type.startsWith('image/') ?
              (
                <ImageIcon className="h-4 w-4 shrink-0 text-blue-500" />
              ) :
              (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
          <DialogTitle className="text-sm font-medium truncate">{file.name}</DialogTitle>
        </DialogHeader>

        <div className="p-4 overflow-auto max-h-[calc(80vh-56px)]">
          {imageUrl ?
              (
                <img
                  src={imageUrl}
                  alt={file.name}
                  className="max-w-full max-h-[60vh] rounded-lg object-contain mx-auto"
                />
              ) :
              (
                <div className="space-y-3">
                  <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-muted/60 mx-auto">
                    <FileText className="h-8 w-8 text-muted-foreground/60" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {file.type || t('chat.unknownType')}
                      {' '}
                      &middot;
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
              )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── BusyActionSelect ────────────────────────────────────────────────────────
// Replaced custom dropdown with shadcn DropdownMenu

function BusyActionSelect({
  value,
  onChange,
}: {
  value: BusyAction
  onChange: (v: BusyAction) => void
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground gap-1"
            title={t('chat.busyAction.label')}
          />
        )}
      >
        <span className="truncate max-w-[100px]">{t(`chat.busyAction.${value}`)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[150px] text-xs">
        {(['queue', 'cancel'] as const).map(option => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onChange(option)}
            className={option === value ? 'bg-primary/10 text-primary font-medium' : ''}
          >
            {t(`chat.busyAction.${option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── EngineInfo ──────────────────────────────────────────────────────────────
// Replaced custom popover with shadcn Popover

function EngineInfo({ engineType }: { engineType: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const engineName = t(`createIssue.engineLabel.${engineType}`, engineType)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" title={engineName} />}>
        <EngineIcon engineType={engineType} className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <EngineIcon engineType={engineType} className="h-3 w-3 shrink-0" />
          <span className="font-medium">{engineName}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── ModelSelect ─────────────────────────────────────────────────────────────
// Replaced custom dropdown with shadcn DropdownMenu

function ModelSelect({
  models,
  value,
  onChange,
  disabled = false,
  locked = false,
}: {
  models: EngineModel[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  locked?: boolean
}) {
  const { t } = useTranslation()
  const current = models.find(m => m.id === value)
  const displayName = locked
    ? t('settings.modelGatewayDefault')
    : current
      ? formatModelName(current.name || current.id)
      : formatModelName(value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-6 px-2 text-xs text-muted-foreground gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
          />
        )}
      >
        <span className="truncate max-w-[140px]">{displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[180px] max-h-[320px] overflow-y-auto text-xs">
        {models.map(m => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => onChange(m.id)}
            className={m.id === value ? 'bg-primary/10 text-primary font-medium' : ''}
          >
            {formatModelName(m.name || m.id)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── CommandPicker ────────────────────────────────────────────────────────────
// Replaced custom popover + search with shadcn Popover + Command

function CommandPicker({
  commands,
  onSelect,
}: {
  commands: string[]
  onSelect: (cmd: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" title={t('chat.commands')} />}>
        <SlashSquare className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder={t('chat.commandSearch')} className="text-xs h-8" />
          <CommandList className="max-h-[240px]">
            <CommandEmpty className="text-xs text-muted-foreground/50 px-3 py-2">
              {t('chat.noCommands')}
            </CommandEmpty>
            {commands.map(cmd => (
              <CommandItem
                key={cmd}
                value={cmd}
                onSelect={() => {
                  onSelect(cmd)
                  setOpen(false)
                }}
                className="text-xs px-3 py-1.5"
              >
                <code className="font-mono text-foreground/80">{cmd}</code>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── ModeSelect ───────────────────────────────────────────────────────────────
// Replaced custom dropdown with shadcn DropdownMenu

function ModeSelect({ value, onChange }: { value: ModeOption, onChange: (v: ModeOption) => void }) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground gap-1"
            title={t('createIssue.mode')}
          />
        )}
      >
        <span className="truncate max-w-[84px]">{t(`createIssue.perm.${value}`)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[130px] text-xs">
        {MODE_OPTIONS.map(option => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onChange(option)}
            className={option === value ? 'bg-primary/10 text-primary font-medium' : ''}
          >
            {t(`createIssue.perm.${option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
