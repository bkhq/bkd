import {
  Eraser,
  FolderOpen,
  Loader2,
  Paperclip,
  RefreshCw,
  SlashSquare,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AttachmentChips } from '@/components/AttachmentChips'
import { EngineIcon } from '@/components/EngineIcons'
import { FilePreviewModal } from '@/components/FilePreviewModal'
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
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useChangesSummary } from '@/hooks/use-changes-summary'
import { useSkills } from '@/hooks/use-skills'
import { defaultFilter } from 'cmdk'
import type { SlashCommandGroup, TaggedCommand } from './slash-command-groups'
import { commandFromKey, commandKey, groupSlashCommands } from './slash-command-groups'
import { useFileAttachments } from '@/hooks/use-file-attachments'
import { useClearIssueSession, useEngineAvailability, useEngineProfiles, useEngineSettings, useFollowUpIssue, useUpdateIssue, useVirtualEngines } from '@/hooks/use-kanban'
import { formatModelName } from '@/lib/format'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { EFFORT_LEVELS } from '@bkd/shared'
import type { BusyAction, EffortLevel, EngineModel, SessionStatus } from '@/types/kanban'

type EffortOption = EffortLevel | 'auto'
const EFFORT_OPTIONS: EffortOption[] = ['auto', ...EFFORT_LEVELS]

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
  scrollRef,
  engineType,
  baseEngine,
  model,
  effort,
  sessionStatus,
  statusId,
  isThinking = false,
  onMessageSent,
  slashCommands = [],
  pluginCommands = [],
  onRefreshLogs,
  pendingEdit,
  onPendingEditConsumed,
}: {
  projectId?: string
  issueId?: string
  scrollRef?: React.RefObject<HTMLDivElement | null>
  /** The issue's engine: a virtual engine id or a real engine type. */
  engineType?: string
  /** The issue's real engine; engines sharing it can be switched to. */
  baseEngine?: string
  model?: string
  effort?: EffortLevel | null
  sessionStatus?: SessionStatus | null
  statusId?: string
  isThinking?: boolean
  onMessageSent?: (messageId: string, prompt: string, metadata?: Record<string, unknown>) => void
  slashCommands?: string[]
  pluginCommands?: Array<{ name: string, path: string }>
  onRefreshLogs?: () => void
  pendingEdit?: { content: string, files: File[] } | null
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
  const [sendError, setSendError] = useState<string | null>(null)
  const attach = useFileAttachments()
  const {
    attachedFiles,
    attachError,
    isDragOver,
    previewFile,
    setPreviewFile,
    handlePaste,
    getRootProps,
    getInputProps,
    openPicker,
    reset: resetAttachments,
  } = attach
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Fill input and attachments from pending message edit (recall)
  const setAttachedFiles = attach.setAttachedFiles
  useEffect(() => {
    if (pendingEdit) {
      setInput(pendingEdit.content)
      setAttachedFiles(pendingEdit.files)
      textareaRef.current?.focus()
      onPendingEditConsumed?.()
    }
  }, [pendingEdit, setAttachedFiles, onPendingEditConsumed])
  const isSendingRef = useRef(false)
  const [textareaH, setTextareaH] = useState(36)
  const dragRef = useRef({ active: false, startY: 0, startH: 0 })
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const followUp = useFollowUpIssue(projectId ?? '')
  const clearSession = useClearIssueSession(projectId ?? '')
  const [clearSessionOpen, setClearSessionOpen] = useState(false)
  const changesSummary = useChangesSummary(projectId, issueId ?? undefined)
  const changedCount = changesSummary?.fileCount ?? 0
  const additions = changesSummary?.additions ?? 0
  const deletions = changesSummary?.deletions ?? 0
  const toggleFileBrowserDrawer = useFileBrowserStore(s => s.toggleDrawer)

  // Models of every engine sharing the issue's base engine, hidden ones filtered out
  const { data: discovery } = useEngineAvailability(!!engineType)
  const { data: engineSettings } = useEngineSettings(!!engineType)
  const { data: virtualEngines } = useVirtualEngines(!!engineType)
  const engineGroups = useMemo(() => {
    if (!engineType) return []
    const base = baseEngine ?? engineType
    const ids = [base, ...(virtualEngines ?? []).filter(v => v.baseEngine === base).map(v => v.id)]
    if (!ids.includes(engineType)) ids.push(engineType)
    return ids.map((id) => {
      const all = discovery?.models[id] ?? []
      const hidden = new Set(engineSettings?.engines[id]?.hiddenModels ?? [])
      return { engineId: id, models: hidden.size > 0 ? all.filter(m => !hidden.has(m.id)) : all }
    }).filter(g => g.models.length > 0)
  }, [engineType, baseEngine, virtualEngines, discovery, engineSettings])
  const [selectedEngine, setSelectedEngine] = useState(engineType || '')
  const [selectedModel, setSelectedModel] = useState(model || '')
  const [selectedEffort, setSelectedEffort] = useState<EffortOption>(effort ?? 'auto')
  // Sync selections when the issue changes
  useEffect(() => {
    setSelectedEngine(engineType || '')
  }, [engineType])
  useEffect(() => {
    setSelectedModel(model || '')
  }, [model])
  useEffect(() => {
    setSelectedEffort(effort ?? 'auto')
  }, [effort])
  const updateIssue = useUpdateIssue(projectId ?? '')
  // Outside working a pick is saved right away; a working issue takes it with the next message.
  const handleModelChange = (engineId: string, value: string) => {
    setSelectedEngine(engineId)
    setSelectedModel(value)
    if (!issueId || statusId === 'working') return
    if (engineId === (engineType || '') && value === (model || '')) return
    updateIssue.mutate(
      { id: issueId, model: value, ...(engineId !== engineType ? { engineType: engineId } : {}) },
      {
        onError: () => {
          setSelectedEngine(engineType || '')
          setSelectedModel(model || '')
        },
      },
    )
  }
  const handleEffortChange = (value: EffortOption) => {
    setSelectedEffort(value)
    if (!issueId || statusId === 'working' || value === (effort ?? 'auto')) return
    updateIssue.mutate(
      { id: issueId, effort: value === 'auto' ? null : value },
      { onError: () => setSelectedEffort(effort ?? 'auto') },
    )
  }
  const showEffort = (baseEngine ?? engineType) === 'claude-code'
  const [mode, setMode] = useState<ModeOption>('auto')
  const [busyAction, setBusyAction] = useState<BusyAction>('queue')
  const activeModel = selectedModel || model || ''
  const activeEngine = selectedEngine || engineType || ''
  const isSessionActive = sessionStatus === 'running' || sessionStatus === 'pending'
  const effectiveBusyAction: BusyAction | undefined = isSessionActive ?
    isThinking ?
      'queue' :
      busyAction :
    undefined

  // Installed skills (global and this project's) tell skill commands apart from built-ins
  const { data: skillsData } = useSkills(projectId)
  const skillNames = useMemo(() => new Set(skillsData?.skills.map(s => s.name)), [skillsData])
  const commandGroups = useMemo(
    () => groupSlashCommands(slashCommands, pluginCommands, skillNames),
    [slashCommands, pluginCommands, skillNames],
  )
  const allCommands = useMemo(() => commandGroups.flatMap(g => g.items), [commandGroups])

  // All command values for command detection in handleSend
  const normalizedCommands = useMemo(() => allCommands.map(c => c.value), [allCommands])

  // Inline command menu: show when input starts with "/" and has no spaces yet
  const commandQuery = useMemo(() => {
    const trimmed = input.trimStart()
    if (!trimmed.startsWith('/')) return null
    if (trimmed.includes(' ')) return null
    return trimmed.slice(1).toLowerCase()
  }, [input])

  const filteredGroups = useMemo(() => {
    if (commandQuery === null) return [] as SlashCommandGroup[]
    if (commandQuery === '') return commandGroups
    const matches = (item: TaggedCommand) => {
      const target = item.value.toLowerCase()
      let ti = 0
      for (let qi = 0; qi < commandQuery.length; qi++) {
        ti = target.indexOf(commandQuery[qi], ti)
        if (ti === -1) return false
        ti++
      }
      return true
    }
    return commandGroups
      .map(g => ({ ...g, items: g.items.filter(matches) }))
      .filter(g => g.items.length > 0)
  }, [commandQuery, commandGroups])
  const filteredCommands = useMemo(() => filteredGroups.flatMap(g => g.items), [filteredGroups])

  const showCommandMenu = filteredCommands.length > 0
  // Selected command (cmdk value); back to the first match whenever the list changes
  const [commandValue, setCommandValue] = useState('')
  // Compared by content: the command arrays are rebuilt on every render
  const filteredKeys = filteredGroups.flatMap(g => g.items.map(item => commandKey(g.id, item)))
  const filteredKey = filteredKeys.join('\n')
  const [prevFilteredKey, setPrevFilteredKey] = useState(filteredKey)
  if (prevFilteredKey !== filteredKey) {
    setPrevFilteredKey(filteredKey)
    setCommandValue(filteredKeys[0] ?? '')
  }
  const commandRootRef = useRef<HTMLDivElement>(null)

  const normalizedPrompt = normalizePrompt(input)
  const canSend =
    (normalizedPrompt.length > 0 || attachedFiles.length > 0) && !!issueId && !!projectId

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
    // Clear persisted draft
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey)
      } catch {
        /* ignore */
      }
    }
    resetAttachments()
    setSendError(null)
    try {
      const isTodo = statusId === 'todo'
      const isDone = statusId === 'done'
      const isWorking = statusId === 'working'
      const result = await followUp.mutateAsync({
        issueId,
        prompt,
        model: activeModel || undefined,
        engineType: activeEngine && activeEngine !== engineType ? activeEngine : undefined,
        effort: selectedEffort !== (effort ?? 'auto') ? selectedEffort : undefined,
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
        attach.setAttachedFiles(filesToSend)
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
    if (showCommandMenu && !e.nativeEvent.isComposing) {
      // The textarea keeps focus; cmdk moves the selection, scrolls it into view and
      // selects on Enter. Forwarded only while the menu is open, so the keys behave
      // normally in the textarea otherwise.
      const forwardKey =
        e.key === 'ArrowDown' || e.key === 'ArrowUp' ? e.key :
            (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab' ? 'Enter' :
              null
      if (forwardKey) {
        e.preventDefault()
        commandRootRef.current?.dispatchEvent(new KeyboardEvent('keydown', { key: forwardKey, bubbles: true }))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // Add a space to dismiss the menu while keeping the text
        setInput(prev => `${prev} `)
        return
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }, [])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      // Clean up any previous drag listeners (shouldn't happen, but be safe)
      dragCleanupRef.current?.()
      dragRef.current = {
        active: true,
        startY: e.clientY,
        startH: textareaH,
      }
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current.active) return
        const delta = dragRef.current.startY - ev.clientY
        setTextareaH(Math.max(36, Math.min(480, dragRef.current.startH + delta)))
      }
      const cleanup = () => {
        dragRef.current.active = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', cleanup)
        dragCleanupRef.current = null
      }
      dragCleanupRef.current = cleanup
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', cleanup)
    },
    [textareaH],
  )
  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  return (
    <div className="shrink-0 w-full min-w-0 px-2 pb-2 relative z-30">
      {/* Slash-command menu: floats above the input card so it never changes its height */}
      {showCommandMenu ?
          (
            <div data-slot="command-menu" className="absolute inset-x-2 bottom-full z-50 mb-1 overflow-hidden rounded-lg border border-border/40 shadow-md">
              <Command ref={commandRootRef} shouldFilter={false} loop value={commandValue} onValueChange={setCommandValue} label={t('chat.commands')}>
                <CommandList className="max-h-[200px]">
                  {filteredGroups.map(group => (
                    <CommandGroup key={group.id} heading={t(`chat.commandGroups.${group.id}`)}>
                      {group.items.map(item => (
                        <CommandItem
                          key={commandKey(group.id, item)}
                          value={commandKey(group.id, item)}
                          // Keep focus in the textarea
                          onMouseDown={e => e.preventDefault()}
                          onSelect={() => {
                            setInput(resolveCommandInput(item))
                            textareaRef.current?.focus()
                          }}
                          className="px-3 py-1.5 text-xs"
                        >
                          <code className="font-mono">{item.value}</code>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </div>
          ) :
        null}
      <div
        className={`rounded-xl border bg-card/80 backdrop-blur-sm shadow-sm transition-all duration-200 focus-within:border-border focus-within:shadow-md ${
          isDragOver ?
            'border-primary/50 bg-primary/[0.03] ring-2 ring-primary/20' :
            'border-border/60'
        }`}
        {...getRootProps()}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="flex items-center justify-center h-2 cursor-ns-resize group/resize"
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

        {/* Status bar */}
        {/* Sized by the chat column: on narrow ones the changes label folds to its count and the selects shrink */}
        <div className="@container flex items-center gap-1.5 px-2 py-1.5 border-b border-border/30">
          <button
            type="button"
            onClick={() => projectId && toggleFileBrowserDrawer(projectId, issueId)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-muted-foreground bg-muted/40 hover:bg-muted/60 transition-all duration-200"
            title={t('diff.openFiles')}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="@md:hidden tabular-nums">{changedCount}</span>
            <span className="hidden @md:inline">{t('chat.filesChanged', { count: changedCount })}</span>
            <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
              +
              {additions}
            </span>
            <span className="font-mono tabular-nums text-red-600 dark:text-red-400 font-medium">
              -
              {deletions}
            </span>
          </button>
          <div className="ml-auto flex min-w-0 items-center justify-end gap-1">
            {isSessionActive && !isThinking ?
                (
                  <BusyActionSelect value={busyAction} onChange={setBusyAction} />
                ) :
              null}
            <ModeSelect value={mode} onChange={setMode} />
            {showEffort ?
                (
                  <EffortSelect value={selectedEffort} onChange={handleEffortChange} disabled={isSessionActive} />
                ) :
              null}
            {engineGroups.length > 0 ?
                (
                  <ModelSelect
                    groups={engineGroups}
                    engineId={activeEngine}
                    value={activeModel}
                    onChange={handleModelChange}
                    disabled={isSessionActive}
                  />
                ) :
              null}
          </div>
        </div>

        {/* Error banner — combines send + attach errors */}
        {(sendError ?? attachError) ?
            (
              <div className="mx-2 mt-2 rounded-lg bg-destructive/10 border border-destructive/20 px-2 py-2 text-xs text-destructive">
                {sendError ?? attachError}
              </div>
            ) :
          null}

        {/* Textarea — shadcn Textarea, style overrides to match original */}
        <div className="px-2 py-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={statusId === 'todo' ? t('chat.placeholderTodo') : t('chat.placeholder')}
            style={{ height: `${textareaH}px` }}
            className="w-full bg-transparent text-base md:text-sm resize-none outline-none border-none shadow-none placeholder:text-muted-foreground/40 leading-relaxed focus-visible:ring-0 overflow-y-auto"
          />
        </div>

        {/* File preview bar — below textarea */}
        <AttachmentChips files={attachedFiles} onPreview={setPreviewFile} onRemove={attach.removeFile} />

        {/* Hidden file input */}
        <input {...getInputProps()} />

        {/* Toolbar */}
        <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
          <div className="flex items-center gap-0.5">
            {activeEngine ? <EngineInfo engineType={activeEngine} /> : null}
            <Button
              variant="ghost"
              size="icon"
              title={t('chat.attach')}
              onClick={openPicker}
            >
              <Paperclip className="size-4" />
            </Button>
            {commandGroups.length > 0 ?
                (
                  <CommandPicker
                    groups={commandGroups}
                    onSelect={cmd => selectSlashCommand(cmd)}
                  />
                ) :
              null}
            <Button
              variant="ghost"
              size="icon"
              title={t('chat.refreshLogs')}
              onClick={onRefreshLogs}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              title={t('chat.clearSession')}
              disabled={!issueId || isSessionActive || clearSession.isPending}
              onClick={() => setClearSessionOpen(true)}
            >
              <Eraser className="size-4" />
            </Button>
            <Button type="button" disabled={!canSend || followUp.isPending} onClick={handleSend}>
              {followUp.isPending ?
                  (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('session.sending')}
                    </span>
                  ) :
                  (
                    t('chat.send')
                  )}
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
            <FilePreviewModal item={{ kind: 'file', file: previewFile }} onClose={() => setPreviewFile(null)} />
          ) :
        null}
    </div>
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

function useEngineName(engineType: string): string {
  const { t } = useTranslation()
  // Virtual engines have no i18n label; fall back to their configured name.
  const { data: profiles } = useEngineProfiles(true)
  const profileName = profiles?.find(p => p.engineType === engineType)?.name
  return t(`createIssue.engineLabel.${engineType}`, profileName ?? engineType)
}

function EngineInfo({ engineType }: { engineType: string }) {
  const [open, setOpen] = useState(false)
  const engineName = useEngineName(engineType)

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
// Models grouped by engine; engines share the issue's base engine.

interface EngineGroup {
  engineId: string
  models: EngineModel[]
}

function ModelSelect({
  groups,
  engineId,
  value,
  onChange,
  disabled = false,
}: {
  groups: EngineGroup[]
  engineId: string
  value: string
  onChange: (engineId: string, model: string) => void
  disabled?: boolean
}) {
  const current = groups.find(g => g.engineId === engineId)?.models.find(m => m.id === value)
  const displayName = current ? formatModelName(current.name || current.id) : formatModelName(value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            // min-w-0: the model name is what gives way (ellipsis) when the row is tight
            className="h-6 min-w-0 px-2 text-xs text-muted-foreground gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
          />
        )}
      >
        <span className="truncate max-w-[140px]">{displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[180px] max-h-[320px] overflow-y-auto text-xs">
        {groups.map(g => (
          <DropdownMenuGroup key={g.engineId}>
            {groups.length > 1 ? <EngineGroupLabel engineId={g.engineId} /> : null}
            {g.models.map(m => (
              <DropdownMenuItem
                key={`${g.engineId}:${m.id}`}
                onSelect={() => onChange(g.engineId, m.id)}
                className={g.engineId === engineId && m.id === value ? 'bg-primary/10 text-primary font-medium' : ''}
              >
                {formatModelName(m.name || m.id)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EngineGroupLabel({ engineId }: { engineId: string }) {
  const engineName = useEngineName(engineId)
  return (
    <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px]">
      <EngineIcon engineType={engineId} className="h-3 w-3 shrink-0" />
      {engineName}
    </DropdownMenuLabel>
  )
}

// ─── EffortSelect ────────────────────────────────────────────────────────────

function EffortSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: EffortOption
  onChange: (v: EffortOption) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            title={t('chat.effort')}
            className="h-6 px-2 text-xs text-muted-foreground gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
          />
        )}
      >
        {t(`chat.effortLevel.${value}`)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[120px] text-xs">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px]">{t('chat.effort')}</DropdownMenuLabel>
          {EFFORT_OPTIONS.map(o => (
            <DropdownMenuItem
              key={o}
              onSelect={() => onChange(o)}
              className={o === value ? 'bg-primary/10 text-primary font-medium' : ''}
            >
              {t(`chat.effortLevel.${o}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── CommandPicker ────────────────────────────────────────────────────────────
// Replaced custom popover + search with shadcn Popover + Command

function CommandPicker({
  groups,
  onSelect,
}: {
  groups: SlashCommandGroup[]
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
        {/* Rows are keyed by group too; search only the command text */}
        <Command filter={(value, search, keywords) => defaultFilter(commandFromKey(value), search, keywords)}>
          <CommandInput placeholder={t('chat.commandSearch')} className="text-xs h-8" />
          <CommandList className="max-h-[240px]">
            <CommandEmpty className="text-xs text-muted-foreground/50 px-3 py-2">
              {t('chat.noCommands')}
            </CommandEmpty>
            {groups.map(group => (
              <CommandGroup key={group.id} heading={t(`chat.commandGroups.${group.id}`)}>
                {group.items.map(item => (
                  <CommandItem
                    key={commandKey(group.id, item)}
                    value={commandKey(group.id, item)}
                    onSelect={() => {
                      onSelect(item.value)
                      setOpen(false)
                    }}
                    className="text-xs px-3 py-1.5"
                  >
                    <code className="font-mono text-foreground/80">{item.value}</code>
                  </CommandItem>
                ))}
              </CommandGroup>
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
