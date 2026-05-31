import {
  ArrowUp,
  Eraser,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Play,
  RefreshCw,
  SlashSquare,
  Square,
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
import { Chip } from '@/components/ui/chip'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { IconButton } from '@/components/ui/icon-button'
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
import { useClearIssueSession, useEngineAvailability, useEngineSettings, useFollowUpIssue, useIssueRoles, useOmitModel, useRestartIssue } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { apiErrorMessage } from '@/lib/api-error'
import { formatFileSize, formatModelName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { BusyAction, EngineModel, SessionStatus } from '@/types/kanban'
import { RoleMentionPicker } from './RoleMentionPicker'
import { RoleCreatorModal } from './RoleCreatorModal'

// Mirrors apps/api/src/uploads.ts. Keep both sides in sync — backend
// rejects via validateFiles() so any drift would surface as a confusing
// 400 after the user already waited for the upload to finish.
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB
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
  onCancel,
  isCancelling = false,
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
  onCancel?: () => void
  isCancelling?: boolean
  onMessageSent?: (messageId: string, prompt: string, metadata?: Record<string, unknown>) => void
  slashCommands?: string[]
  pluginCommands?: Array<{ name: string, path: string }>
  onRefreshLogs?: () => void
  pendingEditContent?: string | null
  onPendingEditConsumed?: () => void
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
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
  // Mobile reading mode: textarea + just enough chrome to keep features
  // reachable (more-menu, send). Tap the textarea or any of the buttons
  // to expand to the full toolbar. ChatBody's scroll compensator keeps
  // the visible content stable through the transition.
  const [isFocused, setIsFocused] = useState(false)
  // Upload progress is whole-batch (XMLHttpRequest emits a single
  // upload.progress event for the entire multipart body, not per file),
  // so a single bar across the chip strip — labelled with file count and
  // total bytes — is the truthful representation. Null when no upload in
  // flight.
  const [uploadProgress, setUploadProgress] =
    useState<{ loaded: number, total: number, fileCount: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isSendingRef = useRef(false)

  const followUp = useFollowUpIssue(projectId ?? '')
  const clearSession = useClearIssueSession(projectId ?? '')
  const restartIssue = useRestartIssue(projectId ?? '')
  const { data: issueRoles } = useIssueRoles(projectId ?? '', issueId ?? '')
  const [clearSessionOpen, setClearSessionOpen] = useState(false)
  const changesSummary = useChangesSummary(projectId, issueId ?? undefined)
  const changedCount = changesSummary?.fileCount ?? 0
  const additions = changesSummary?.additions ?? 0
  const deletions = changesSummary?.deletions ?? 0
  const changesRoot = (changesSummary as { root?: string } | null)?.root
  const openFileBrowser = useFileBrowserStore(s => s.openForIssue)
  const fileBrowserOpen = useFileBrowserStore(s => s.isOpen)

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

  // @ mention detection: show picker when user types @ followed by word characters
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [showRoleCreator, setShowRoleCreator] = useState(false)
  const mentionPickerRef = useRef<HTMLDivElement>(null)

  // Detect @ mention query from current input
  const detectMentionQuery = useCallback((value: string, cursorPos: number) => {
    // Find the text before cursor
    const beforeCursor = value.slice(0, cursorPos)
    // Match @ followed by word characters at the end
    const match = beforeCursor.match(/@(\w*)$/)
    if (match) {
      return match[1]
    }
    return null
  }, [])

  const handleMentionSelect = useCallback((role: import('@/lib/kanban-api').Role | null) => {
    if (role === null) {
      setMentionQuery(null)
      return
    }
    const textarea = textareaRef.current
    if (!textarea) return
    const cursorPos = textarea.selectionStart
    const beforeCursor = input.slice(0, cursorPos)
    const afterCursor = input.slice(cursorPos)
    // Replace @query with @name + space
    const newBefore = beforeCursor.replace(/@\w*$/, `@${role.name} `)
    const newValue = newBefore + afterCursor
    setInput(newValue)
    setMentionQuery(null)
    // Focus and set cursor position after the inserted mention
    setTimeout(() => {
      textarea.focus()
      const newPos = newBefore.length
      textarea.setSelectionRange(newPos, newPos)
    }, 0)
  }, [input])

  const handleMentionCreateNew = useCallback(() => {
    setMentionQuery(null)
    setShowRoleCreator(true)
  }, [])

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
  // Block sending to a "done" issue — the engine will not pick the message up
  // and it just sits forever in the pending list cluttering the chat.
  // User must explicitly move the issue back to working/review first.
  const isDoneIssue = statusId === 'done'
  const canSend =
    (normalizedPrompt.length > 0 || attachedFiles.length > 0)
    && !!issueId
    && !!projectId
    && !isDoneIssue

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
      setSendError(apiErrorMessage(err, t))
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
    // Note: attachedFiles is intentionally NOT cleared here — we keep
    // the chips visible through the upload so users can see progress
    // attached to the artefacts they selected. Cleared on success below;
    // left in place on error so the user can retry without re-picking
    // every file.
    setSendError(null)
    setUploadProgress(
      filesToSend.length > 0
        ? { loaded: 0, total: 0, fileCount: filesToSend.length }
        : null,
    )
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
        onUploadProgress:
          filesToSend.length > 0
            ? ({ loaded, total }) =>
                setUploadProgress({ loaded, total, fileCount: filesToSend.length })
            : undefined,
      })
      setUploadProgress(null)
      setAttachedFiles([])
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
      const msg = apiErrorMessage(err, t)
      setSendError(msg)
      setUploadProgress(null)
      // Restore input on failure — only if still on the same issue.
      // Compare against the ref (live value) rather than the closure-captured
      // issueId, which is always the same value as draftKey's source. Files
      // were never cleared so no restoration needed; the chips users selected
      // remain in place and they can retry without re-picking everything.
      if (issueIdRef.current === issueId) {
        setInput(prompt)
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
    // Block keyboard events when mention picker is active (it handles its own keyboard)
    if (mentionQuery !== null) {
      return
    }

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
    //
    // Mobile exception: there is no Shift key on a phone keyboard, so a bare
    // Enter must insert a newline (browser default) — otherwise the user has
    // no way to write multi-line messages. They send via the explicit button.
    // Cmd/Ctrl+Enter still sends for tablet-with-keyboard users.
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      const hasShortcut = e.metaKey || e.ctrlKey
      if (isMobile && !hasShortcut) {
        // Let the browser insert \n.
        return
      }
      e.preventDefault()
      void handleSend()
    }
  }

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart
    setInput(value)
    // Detect @ mention
    const query = detectMentionQuery(value, cursorPos)
    setMentionQuery(query)
  }, [detectMentionQuery])

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
  // Re-runs when fileBrowserOpen changes so the height recalculates after
  // returning from the fullscreen file-browser overlay on mobile.
  useLayoutEffect(() => {
    if (manualHeight !== null) return
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = '0px'
    const next = Math.min(ta.scrollHeight, 200)
    ta.style.height = `${Math.max(next, 32)}px`
  }, [input, manualHeight, fileBrowserOpen])

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

  const mobileCollapsed =
    isMobile
    && !isFocused
    && input.length === 0
    && attachedFiles.length === 0
    && !isDoneIssue
    && !isDragOver
    && !sendError
    && !showCommandMenu

  return (
    <div
      className="shrink-0 w-full min-w-0 px-2 relative z-30"
      // Add iOS safe-area inset to the bottom padding so the input clears
      // the home indicator on notched devices without making desktop look
      // sparse. Falls back to the previous 0.5rem otherwise.
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div
        className={`rounded-xl border bg-card/60 backdrop-blur-sm transition-all duration-200 focus-within:border-border/70 focus-within:bg-card/80 ${
          isDragOver ?
            'border-primary/50 bg-primary/[0.03] ring-2 ring-primary/20' :
            'border-border/40'
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

        {/* @ mention picker */}
        {mentionQuery !== null && projectId ? (
          <div className="mx-2 mt-1 relative" ref={mentionPickerRef}>
            <RoleMentionPicker
              projectId={projectId}
              query={mentionQuery}
              onSelect={handleMentionSelect}
              onCreateNew={handleMentionCreateNew}
              allowedRoles={issueRoles}
            />
          </div>
        ) : null}

        {/* File preview bar — above the textarea row when files are attached */}
        {attachedFiles.length > 0 ?
            (
              <div
                className="flex flex-col gap-1 px-2 pb-1.5"
                data-testid="chat-input-attachment-strip"
              >
                <div className="flex flex-wrap gap-1.5">
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
                        // Disabled mid-upload — pulling a chip out would
                        // create a confusing partial state where the
                        // backend still receives the file we just
                        // visually removed.
                        disabled={uploadProgress !== null}
                        className="ml-0.5 rounded p-0.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        title={t('chat.removeFile')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {uploadProgress
                  ? (
                      <div
                        className="flex items-center gap-2 text-[11px] text-muted-foreground"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={uploadProgress.total || 100}
                        aria-valuenow={uploadProgress.loaded}
                        data-testid="chat-input-upload-progress"
                      >
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/60">
                          <div
                            className="h-full bg-blue-500/70 transition-[width] duration-150"
                            style={{
                              width: uploadProgress.total > 0
                                ? `${Math.min(100, Math.round((uploadProgress.loaded / uploadProgress.total) * 100))}%`
                                : '5%',
                            }}
                          />
                        </div>
                        <span className="tabular-nums">
                          {uploadProgress.total > 0
                            ? t('chat.uploadProgress', {
                                percent: Math.min(100, Math.round((uploadProgress.loaded / uploadProgress.total) * 100)),
                                count: uploadProgress.fileCount,
                              })
                            : t('chat.uploadStarting', { count: uploadProgress.fileCount })}
                        </span>
                      </div>
                    )
                  : null}
              </div>
            ) :
          null}

        {/* Hidden file input — id="chat-file-input" is used by the label below so
            the file picker opens on HarmonyOS / iOS Safari without relying on
            programmatic element.click() which those browsers block. */}
        <input
          id="chat-file-input"
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Row 1: Full-width textarea. In mobile collapsed mode we tuck
            two compact controls (MobileMoreMenu + send) into the same row
            so the file browser and other actions remain one tap away even
            without expanding the full toolbar. */}
        <div className={mobileCollapsed ? 'flex items-end gap-0.5 pr-1' : ''}>
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={
              isDoneIssue ?
                  t('chat.placeholderDone', 'Issue is done. Move it back to working to continue.') :
                statusId === 'todo' ?
                    t('chat.placeholderTodo') :
                    t('chat.placeholder')
            }
            disabled={isDoneIssue}
            rows={1}
            className="w-full bg-transparent text-base md:text-sm resize-none outline-none border-none shadow-none placeholder:text-muted-foreground/40 leading-relaxed focus-visible:ring-0 overflow-y-auto min-h-[36px] px-3 py-2 [field-sizing:fixed]"
          />
          {mobileCollapsed ? (
            <div data-testid="mobile-collapsed-actions" className="flex items-center gap-0.5 shrink-0 mb-1">
              <MobileMoreMenu
                engineType={engineType}
                mode={mode}
                onModeChange={setMode}
                models={models}
                activeModel={activeModel}
                onModelChange={setSelectedModel}
                modelLocked={modelLocked}
                busyAction={busyAction}
                onBusyActionChange={setBusyAction}
                showBusyAction={isSessionActive && !isThinking}
                isSessionActive={isSessionActive}
                onRefreshLogs={onRefreshLogs}
                onOpenFileBrowser={() => projectId && issueId && openFileBrowser(projectId, issueId, changesRoot)}
                onClearSession={() => setClearSessionOpen(true)}
                clearSessionDisabled={!issueId || isSessionActive || clearSession.isPending}
                slashCommands={normalizedSlashCommands.length > 0 ? normalizedSlashCommands : undefined}
                onSlashCommand={selectSlashCommand}
                compact
              />
              {isThinking && onCancel ? (
                <Button
                  type="button"
                  size="icon"
                  disabled={isCancelling}
                  onMouseDown={e => e.preventDefault()}
                  onClick={onCancel}
                  title={isCancelling ? t('session.cancellingBtn') : t('common.cancel')}
                  className="rounded-full size-8 shadow-sm transition-transform hover:scale-105 disabled:hover:scale-100 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isCancelling ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" strokeWidth={2.5} />}
                </Button>
              ) : isSessionActive ? (
                <Button
                  type="button"
                  size="icon"
                  disabled={!canSend || followUp.isPending}
                  onMouseDown={e => e.preventDefault()}
                  onClick={handleSend}
                  title={t('chat.send')}
                  className="rounded-full size-8 shadow-sm transition-transform hover:scale-105 disabled:hover:scale-100"
                >
                  {followUp.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" strokeWidth={2.5} />}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => textareaRef.current?.focus()}
                  title={t('chat.placeholder')}
                  className="rounded-full size-8 opacity-60 hover:opacity-100 bg-muted text-muted-foreground hover:bg-muted/80"
                >
                  <ArrowUp className="size-3.5" strokeWidth={2.5} />
                </Button>
              )}
            </div>
          ) : null}
        </div>

        {/* Row 2: Toolbar — 3 groups, no dividers (whitespace + flex grouping does the work).
            Left:   high-frequency icon buttons (attach / commands / more).
            Center: combined engine·mode·model chip (replaces 3 separate chips).
            Right:  diff status + restart + send.
            Hidden in mobile collapsed reading mode (mobileCollapsed). */}
        <div data-testid="chat-toolbar" className={`flex flex-wrap items-center gap-1 px-2 pb-2 pt-0.5 ${mobileCollapsed ? 'hidden' : ''}`}>
          {/* Left group */}
          {/* Use <label htmlFor> instead of Button + element.click() so the
              file picker works on HarmonyOS and iOS Safari where programmatic
              clicks on file inputs are blocked. onMouseDown preventsDefault
              stops the textarea from losing focus (which would collapse the
              toolbar and hide the virtual keyboard). */}
          <label
            htmlFor="chat-file-input"
            title={`${t('chat.attach')} — ${t('chat.attachHint')}`}
            onMouseDown={e => e.preventDefault()}
            className="inline-flex items-center justify-center size-11 rounded-md hover:bg-accent cursor-pointer"
          >
            <Paperclip className="size-5" />
          </label>
          {normalizedSlashCommands.length > 0 ?
              (
                <div className="max-md:hidden">
                  <CommandPicker
                    commands={normalizedSlashCommands}
                    onSelect={cmd => selectSlashCommand(cmd)}
                  />
                </div>
              ) :
            null}
          {/* Desktop overflow menu — refresh / files / clear session.
              Moves rarely-used controls off the visible row so the toolbar
              stays scannable. Mobile uses MobileMoreMenu below which already
              folds these in. */}
          <div className="max-md:hidden">
            <DesktopMoreMenu
              onRefreshLogs={onRefreshLogs}
              onOpenFileBrowser={() => projectId && issueId && openFileBrowser(projectId, issueId, changesRoot)}
              onClearSession={() => setClearSessionOpen(true)}
              clearSessionDisabled={!issueId || isSessionActive || clearSession.isPending}
            />
          </div>

          {/* Center: combined chip — desktop only.
              Replaces the previous Engine + Mode + Model trio. Engine icon
              stays visible (user feedback: "删了引擎，那我就不知道当前会话
              用的是什么引擎了"); mode/model live in the popover. */}
          <div className="max-md:hidden">
            <EngineConfigChip
              engineType={engineType}
              mode={mode}
              onModeChange={setMode}
              models={models}
              activeModel={activeModel}
              onModelChange={setSelectedModel}
              modelLocked={modelLocked}
              isSessionActive={isSessionActive}
            />
          </div>
          {isSessionActive && !isThinking ?
              (
                <div className="max-md:hidden">
                  <BusyActionSelect value={busyAction} onChange={setBusyAction} />
                </div>
              ) :
            null}

          {/* Mobile "..." menu — groups settings + actions */}
          <div className="md:hidden">
            <MobileMoreMenu
              engineType={engineType}
              mode={mode}
              onModeChange={setMode}
              models={models}
              activeModel={activeModel}
              onModelChange={setSelectedModel}
              modelLocked={modelLocked}
              busyAction={busyAction}
              onBusyActionChange={setBusyAction}
              showBusyAction={isSessionActive && !isThinking}
              isSessionActive={isSessionActive}
              onRefreshLogs={onRefreshLogs}
              onOpenFileBrowser={() => projectId && issueId && openFileBrowser(projectId, issueId, changesRoot)}
              onClearSession={() => setClearSessionOpen(true)}
              clearSessionDisabled={!issueId || isSessionActive || clearSession.isPending}
              slashCommands={normalizedSlashCommands.length > 0 ? normalizedSlashCommands : undefined}
              onSlashCommand={selectSlashCommand}
            />
          </div>

          {/* Right group: diff status (when relevant) + restart + send.
              Wrapped + ml-auto so it stays together and hugs the right edge;
              on a narrow panel the whole toolbar wraps instead of the row
              overflowing horizontally. */}
          <div className="flex items-center gap-1 ml-auto">
            {hasChanges ?
                (
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={onToggleDiff}
                    data-active={diffOpen || undefined}
                    className="chip-surface px-2 mr-0.5"
                    title={t('diff.changes')}
                  >
                    <FileText className="size-3 shrink-0" />
                    <span className="font-mono tabular-nums">{changedCount}</span>
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
            {sessionStatus === 'failed' || sessionStatus === 'cancelled' ?
                (
                  <Button
                    type="button"
                    size="icon"
                    disabled={!issueId || restartIssue.isPending || isSendingRef.current || !input.trim()}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (!issueId) return
                      restartIssue.mutate(issueId)
                    }}
                    title={t('chat.restart')}
                    className="rounded-full size-9 shadow-sm transition-transform hover:scale-105 disabled:hover:scale-100 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {isSendingRef.current ?
                        <Loader2 className="size-4 animate-spin" /> :
                        <Play className="size-4" strokeWidth={2.5} />}
                  </Button>
                ) :
              null}
            {isThinking && onCancel ?
                (
                  <Button
                    type="button"
                    size="icon"
                    disabled={isCancelling}
                    onMouseDown={e => e.preventDefault()}
                    onClick={onCancel}
                    title={isCancelling ? t('session.cancellingBtn') : t('common.cancel')}
                    className="rounded-full size-9 shadow-sm transition-transform hover:scale-105 disabled:hover:scale-100 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isCancelling ?
                        <Loader2 className="size-4 animate-spin" /> :
                        <Square className="size-4" strokeWidth={2.5} />}
                  </Button>
                ) :
                (
                  <Button
                    type="button"
                    size="icon"
                    disabled={!canSend || followUp.isPending}
                    onMouseDown={e => e.preventDefault()}
                    onClick={handleSend}
                    title={t('chat.send')}
                    className="rounded-full size-9 shadow-sm transition-transform hover:scale-105 disabled:hover:scale-100"
                  >
                    {followUp.isPending ?
                        <Loader2 className="size-4 animate-spin" /> :
                        <ArrowUp className="size-4" strokeWidth={2.5} />}
                  </Button>
                )}
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

      {/* Role creator modal */}
      {projectId && (
        <RoleCreatorModal
          projectId={projectId}
          isOpen={showRoleCreator}
          onClose={() => setShowRoleCreator(false)}
        />
      )}
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
          <button
            type="button"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-medium border border-border/30 bg-muted/40 text-muted-foreground hover:bg-muted/60 transition-colors"
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
      <PopoverTrigger render={<Button variant="ghost" size="icon" title={t('chat.commands')} className="size-11" />}>
        <SlashSquare className="size-5" />
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

// ─── MobileMoreMenu ──────────────────────────────────────────────────────────
// Avoids nested DropdownMenu inside Popover by using simple button lists.

function MobileMoreMenu({
  engineType,
  mode,
  onModeChange,
  models,
  activeModel,
  onModelChange,
  modelLocked,
  busyAction,
  onBusyActionChange,
  showBusyAction,
  isSessionActive,
  onRefreshLogs,
  onOpenFileBrowser,
  onClearSession,
  clearSessionDisabled,
  slashCommands,
  onSlashCommand,
  compact = false,
}: {
  engineType?: string
  mode: ModeOption
  onModeChange: (v: ModeOption) => void
  models: EngineModel[]
  activeModel: string
  onModelChange: (v: string) => void
  modelLocked: boolean
  busyAction: BusyAction
  onBusyActionChange: (v: BusyAction) => void
  showBusyAction: boolean
  isSessionActive: boolean
  onRefreshLogs?: () => void
  onOpenFileBrowser: () => void
  onClearSession: () => void
  clearSessionDisabled: boolean
  slashCommands?: string[]
  onSlashCommand?: (cmd: string) => void
  /** Compact trigger size for the collapsed reading-mode input strip. */
  compact?: boolean
}) {
  const { t } = useTranslation()

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <button
            type="button"
            className={`inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors ${compact ? 'size-8' : 'size-11'}`}
            onMouseDown={e => e.preventDefault()}
          >
            <MoreHorizontal className={compact ? 'size-4' : 'size-5'} />
          </button>
        )}
      />
      <PopoverContent align="start" side="top" className="w-56 p-2 space-y-1">
        {/* Engine info — labeled so users know what their session is bound to.
            Desktop has the equivalent in EngineConfigChip's popover header; on
            mobile this is the only place that information surfaces. */}
        {engineType ? (
          <div className="px-2 pb-1.5 mb-1 border-b border-border/30">
            <div className="text-[10px] text-muted-foreground/60 mb-1 uppercase tracking-wider">
              {t('chat.configChipCurrentEngine')}
            </div>
            <div className="flex items-center gap-2 text-xs text-foreground/80">
              <EngineIcon engineType={engineType} className="size-3.5 shrink-0" />
              <span className="font-medium">{t(`createIssue.engineLabel.${engineType}`, engineType)}</span>
            </div>
          </div>
        ) : null}

        {/* Slash commands */}
        {slashCommands && slashCommands.length > 0 && onSlashCommand ? (
          <>
            <div className="px-2">
              <div className="text-[10px] text-muted-foreground/60 mb-1">{t('chat.commands')}</div>
              <div className="flex flex-wrap gap-1">
                {slashCommands.map(cmd => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => onSlashCommand(cmd)}
                    className="px-2 py-1 rounded text-[11px] font-mono bg-muted/40 text-muted-foreground hover:bg-muted/60 transition-colors"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-px bg-border/30 my-1" />
          </>
        ) : null}

        {/* Mode selector */}
        <div className="px-2">
          <div className="text-[10px] text-muted-foreground/60 mb-1">{t('createIssue.mode')}</div>
          <div className="flex gap-1">
            {MODE_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => onModeChange(option)}
                className={`flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  option === mode
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted/60'
                }`}
              >
                {t(`createIssue.perm.${option}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Model selector */}
        {models.length > 0 ? (
          <div className="px-2">
            <div className="text-[10px] text-muted-foreground/60 mb-1">{t('createIssue.model')}</div>
            <select
              value={activeModel}
              onChange={e => onModelChange(e.target.value)}
              disabled={isSessionActive || modelLocked}
              className="w-full h-7 px-2 rounded text-[11px] bg-muted/40 text-muted-foreground border border-border/30 disabled:opacity-50"
            >
              <option value="">{t('createIssue.modelDefault')}</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {formatModelName(m.name || m.id)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Busy action */}
        {showBusyAction ? (
          <div className="px-2">
            <div className="text-[10px] text-muted-foreground/60 mb-1">{t('chat.busyAction.label')}</div>
            <div className="flex gap-1">
              {(['queue', 'cancel'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onBusyActionChange(option)}
                  className={`flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    option === busyAction
                      ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                      : 'bg-muted/40 text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  {t(`chat.busyAction.${option}`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Divider */}
        <div className="h-px bg-border/30 my-1" />

        {/* Refresh */}
        <button
          type="button"
          onClick={onRefreshLogs}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <RefreshCw className="size-3.5" />
          <span>{t('chat.refreshLogs')}</span>
        </button>

        {/* Files */}
        <button
          type="button"
          onClick={onOpenFileBrowser}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <FolderOpen className="size-3.5" />
          <span>{t('diff.openFiles')}</span>
        </button>

        {/* Clear session */}
        <button
          type="button"
          disabled={clearSessionDisabled}
          onClick={onClearSession}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-40"
        >
          <Eraser className="size-3.5" />
          <span>{t('chat.clearSession')}</span>
        </button>
      </PopoverContent>
    </Popover>
  )
}

// ─── DesktopMoreMenu ─────────────────────────────────────────────────────────
// Folds three rarely-used desktop controls (refresh logs / open file browser /
// clear session) behind a single "⋯" trigger. Keeps the toolbar scannable
// while leaving the actions one click away. The matching mobile flow lives
// in MobileMoreMenu above; the two are intentionally NOT unified into one
// component because the mobile variant also has to host Mode / Model /
// BusyAction (which on desktop live in EngineConfigChip).

function DesktopMoreMenu({
  onRefreshLogs,
  onOpenFileBrowser,
  onClearSession,
  clearSessionDisabled,
}: {
  onRefreshLogs?: () => void
  onOpenFileBrowser: () => void
  onClearSession: () => void
  clearSessionDisabled: boolean
}) {
  const { t } = useTranslation()

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <IconButton size="sm" title={t('chat.more')} aria-label={t('chat.more')} onMouseDown={e => e.preventDefault()} />
        )}
      >
        <MoreHorizontal className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-44 p-1">
        <button
          type="button"
          onClick={onRefreshLogs}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <RefreshCw className="size-3.5" />
          <span>{t('chat.refreshLogs')}</span>
        </button>
        <button
          type="button"
          onClick={onOpenFileBrowser}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <FolderOpen className="size-3.5" />
          <span>{t('diff.openFiles')}</span>
        </button>
        <div className="h-px bg-border/30 my-1" />
        <button
          type="button"
          disabled={clearSessionDisabled}
          onClick={onClearSession}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <Eraser className="size-3.5" />
          <span>{t('chat.clearSession')}</span>
        </button>
      </PopoverContent>
    </Popover>
  )
}

// ─── EngineConfigChip ────────────────────────────────────────────────────────
// Replaces three separate desktop chips (Engine label / Mode / Model) with
// a single combined chip whose surface always shows the EngineIcon and the
// current mode · model. Clicking opens a popover with the same three
// concerns split into sections, plus an immutable "current engine" header
// so users never lose track of what their session is bound to.
//
// BusyAction stays as a sibling chip (not folded in) because it only renders
// when the session is active; cramming a conditional section into this
// popover would make the layout shift between turns.

function EngineConfigChip({
  engineType,
  mode,
  onModeChange,
  models,
  activeModel,
  onModelChange,
  modelLocked,
  isSessionActive,
}: {
  engineType?: string
  mode: ModeOption
  onModeChange: (v: ModeOption) => void
  models: EngineModel[]
  activeModel: string
  onModelChange: (v: string) => void
  modelLocked: boolean
  isSessionActive: boolean
}) {
  const { t } = useTranslation()
  const current = models.find(m => m.id === activeModel)
  const isDefaultModel = !activeModel
  const modelDisplay = modelLocked
    ? t('settings.modelGatewayDefault')
    : isDefaultModel
      ? t('createIssue.modelDefault')
      : current
        ? formatModelName(current.name || current.id)
        : formatModelName(activeModel)

  // Hide the model fragment entirely when the engine exposes no models AND
  // we're not in the locked-gateway state — otherwise the chip would read
  // "auto · " with a dangling separator.
  const showModel = models.length > 0 || modelLocked
  const modeLabel = t(`createIssue.perm.${mode}`)
  const engineLabel = engineType
    ? t(`createIssue.engineLabel.${engineType}`, engineType)
    : ''
  const triggerTitle = engineLabel
    ? `${t('chat.configChipTitle')} — ${engineLabel}`
    : t('chat.configChipTitle')

  // Model list is disabled when the session is running (changing model
  // mid-turn has no effect) or when omit-model gateway mode is locked.
  const modelDisabled = isSessionActive || modelLocked

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Chip
            leading={engineType ? <EngineIcon engineType={engineType} className="size-3" /> : null}
            title={triggerTitle}
            className="max-w-[220px]"
          />
        )}
      >
        <span className="truncate">
          {modeLabel}
          {showModel ? (
            <>
              <span className="text-muted-foreground/40 mx-1">·</span>
              <span className={modelLocked ? 'italic' : ''}>{modelDisplay}</span>
            </>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[260px] p-0">
        {/* Header: current engine — immutable, just identifies the session */}
        {engineType ? (
          <div className="px-3 py-2 border-b border-border/30 flex items-center gap-2">
            <EngineIcon engineType={engineType} className="size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider leading-none mb-0.5">
                {t('chat.configChipCurrentEngine')}
              </div>
              <div className="text-xs font-medium text-foreground/90 truncate">{engineLabel}</div>
            </div>
          </div>
        ) : null}

        {/* Mode — always available, even mid-turn */}
        <div className="px-3 py-2">
          <div className="text-[10px] text-muted-foreground/60 mb-1.5 uppercase tracking-wider">
            {t('createIssue.mode')}
          </div>
          <div className="flex gap-1">
            {MODE_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => onModeChange(option)}
                className={cn(
                  'flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors',
                  option === mode
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted/60',
                )}
              >
                {t(`createIssue.perm.${option}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Model — hidden when neither models nor locked-default state apply */}
        {showModel ? (
          <div className="px-3 pb-2 border-t border-border/20 pt-2">
            <div className="text-[10px] text-muted-foreground/60 mb-1.5 uppercase tracking-wider">
              {t('createIssue.model')}
            </div>
            {modelLocked ? (
              <p className="text-[11px] text-muted-foreground italic px-1 py-1">
                {t('settings.omitModelHint')}
              </p>
            ) : (
              <div className="max-h-[200px] overflow-y-auto -mx-1 space-y-0.5">
                <button
                  type="button"
                  disabled={modelDisabled}
                  onClick={() => onModelChange('')}
                  className={cn(
                    'w-full text-left px-2 py-1 rounded text-[11px] transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    isDefaultModel
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted/40 text-muted-foreground',
                  )}
                >
                  <span className="font-medium">{t('createIssue.modelDefault')}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">
                    (
                    {t('createIssue.modelDefaultHint')}
                    )
                  </span>
                </button>
                {models.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={modelDisabled}
                    onClick={() => onModelChange(m.id)}
                    className={cn(
                      'w-full text-left px-2 py-1 rounded text-[11px] transition-colors',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                      m.id === activeModel
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted/40 text-muted-foreground',
                    )}
                  >
                    <span className="font-medium">{formatModelName(m.name || m.id)}</span>
                    {m.isDefault ? (
                      <span className="text-[10px] text-muted-foreground ml-1">
                        (
                        {t('createIssue.engineLabel.default')}
                        )
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
