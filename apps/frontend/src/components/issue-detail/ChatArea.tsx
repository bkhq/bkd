import { ArrowLeft, Check, Link, Search } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { Button } from '@/components/ui/button'
import { useIssue, useProject, useUpdateIssue } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { addRecentIssue } from '@/hooks/use-recent-issues'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { getIssueUrl } from '@/stores/server-store'
import { MiniMatrix } from '@/components/cockpit/MiniMatrix'
import { ChatBody } from './ChatBody'
import {
  createAutoHideState,
  DEFAULT_AUTO_HIDE_THRESHOLDS,
  nextAutoHideState,
} from './title-auto-hide'

const LazyDiffPanel = lazy(() => import('./DiffPanel').then(m => ({ default: m.DiffPanel })))
const LazyFileBrowserPanel = lazy(() => import('../files/FileBrowserPanel').then(m => ({ default: m.FileBrowserPanel })))

export function ChatArea({
  projectId,
  issueId,
  showDiff,
  diffWidth,
  onToggleDiff,
  onDiffWidthChange,
  onCloseDiff,
  fileBrowserWidth,
  onFileBrowserWidthChange,
  showBackToList,
  backPath,
}: {
  projectId: string
  issueId: string
  showDiff: boolean
  diffWidth: number
  onToggleDiff: () => void
  onDiffWidthChange: (w: number) => void
  onCloseDiff: () => void
  fileBrowserWidth: number
  onFileBrowserWidthChange: (w: number) => void
  showBackToList?: boolean
  backPath?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: issue, isLoading, isError } = useIssue(projectId, issueId)
  const { data: project } = useProject(projectId)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Track recently visited issues for global search
  useEffect(() => {
    if (issue && project) {
      addRecentIssue({
        id: issue.id,
        title: issue.title,
        issueNumber: issue.issueNumber,
        projectAlias: project.alias,
        projectName: project.name,
        statusId: issue.statusId,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, project?.alias])
  const [copied, setCopied] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const isMobile = useIsMobile()
  const showFileBrowser = useFileBrowserStore(s => s.isOpen && !s.isDrawer && s.issueId === issueId)
  const closeFileBrowser = useFileBrowserStore(s => s.close)

  // Auto-hide title bar (mobile only) to maximise reading area. The chat
  // lands at the bottom by default, so the OLD heuristic ("hide on
  // scrollTop-increasing scroll") could never trigger — the user starts at
  // scrollTop=max and the only way to go is back up. Reversed semantics:
  //
  //   – scroll UP toward history  (scrollTop ↓)  →  HIDE  (give the
  //     reader as much vertical space as possible while skimming history)
  //   – scroll DOWN toward latest (scrollTop ↑)  →  SHOW  (re-anchor the
  //     reader as they return to the live conversation)
  //   – at the top OR within 80px of the bottom →  always SHOW
  //   – any scroll motion idle for IDLE_HIDE_MS away from the bottom
  //     anchor →  HIDE (reader has settled on a passage to read; the bar
  //     is just chrome at that point)
  //
  // Hysteresis: accumulate per-direction distance and only flip once a
  // minimum continuous scroll is reached. Resets the opposite accumulator
  // on every direction change so a hesitant nudge the other way doesn't
  // flap the bar. Bottom chrome (status bar + chat input) intentionally
  // stays pinned — same pattern as Telegram / WhatsApp / iMessage.
  const IDLE_HIDE_MS = 1500
  const [titleVisible, setTitleVisible] = useState(true)
  useEffect(() => {
    if (!isMobile) {
      setTitleVisible(true)
      return
    }

    let el = scrollRef.current
    let lastTop = el?.scrollTop ?? 0
    let state = createAutoHideState()
    let cleanup: (() => void) | undefined
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const clearIdle = () => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    // After the user stops scrolling away from the live conversation,
    // collapse the title so the passage they're reading isn't framed by
    // chrome. Skipped when we're already at the top home anchor or near
    // the bottom (live anchor) — those positions always show.
    const armIdle = (sample: { scrollTop: number, scrollHeight: number, clientHeight: number }) => {
      clearIdle()
      const distanceFromBottom = sample.scrollHeight - sample.scrollTop - sample.clientHeight
      const atTop = sample.scrollTop < 8
      const atBottom = distanceFromBottom < DEFAULT_AUTO_HIDE_THRESHOLDS.bottomAnchor
      if (atTop || atBottom) return
      idleTimer = setTimeout(() => {
        idleTimer = null
        state = { ...state, visible: false, upAccum: 0, downAccum: 0 }
        setTitleVisible(false)
      }, IDLE_HIDE_MS)
    }

    const onScroll = () => {
      if (!el) return
      const sample = {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }
      state = nextAutoHideState(state, lastTop, sample, DEFAULT_AUTO_HIDE_THRESHOLDS)
      lastTop = sample.scrollTop
      setTitleVisible(state.visible)
      armIdle(sample)
    }

    const attach = () => {
      el = scrollRef.current
      if (!el) return false
      lastTop = el.scrollTop
      el.addEventListener('scroll', onScroll, { passive: true })
      cleanup = () => {
        el?.removeEventListener('scroll', onScroll)
        clearIdle()
      }
      return true
    }

    if (!attach()) {
      // scrollRef not ready yet — retry on next frame
      const rafId = requestAnimationFrame(() => {
        if (!attach()) {
          // still not ready, try once more after a short delay
          const timeoutId = setTimeout(attach, 100)
          cleanup = () => {
            clearTimeout(timeoutId)
            clearIdle()
          }
        }
      })
      return () => {
        cancelAnimationFrame(rafId)
        cleanup?.()
      }
    }

    return () => cleanup?.()
  }, [isMobile])

  const updateIssue = useUpdateIssue(projectId)

  const saveTitle = useCallback(() => {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== issue?.title) {
      updateIssue.mutate({ id: issueId, title: trimmed })
    }
    setEditingTitle(false)
  }, [titleDraft, issue?.title, updateIssue, issueId])

  const startEditingTitle = useCallback(() => {
    if (issue) {
      setTitleDraft(issue.title)
      setEditingTitle(true)
    }
  }, [issue])

  const defaultBack = showBackToList ? `/projects/${projectId}/issues` : `/projects/${projectId}`
  const resolvedBackPath = backPath ?? defaultBack

  const handleAfterDelete = useCallback(() => {
    void navigate(resolvedBackPath)
  }, [navigate, resolvedBackPath])

  // SEARCH-001: in-chat search panel. Toggled via ⌘F / Ctrl+F or the
  // header search button.
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isFind = (e.key === 'f' || e.key === 'F') && (e.metaKey || e.ctrlKey)
      if (isFind && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (isError || !issue) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive">{t('issue.notFound')}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={() => navigate(backPath ?? `/projects/${projectId}`)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {backPath ? t('issue.backToList') : t('issue.backToBoard')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-w-0 bg-background overflow-hidden">
      {/* Chat column */}
      <div className="relative flex flex-1 min-w-0 flex-col">
        {/* Title bar — on desktop sits in-flow as before. On mobile we
            promote it to an absolute-positioned translucent overlay (iOS
            Safari / Mail / Messages pattern):
            – chat content fills the full viewport height; the top ~45px is
              visible THROUGH the blurred title bar instead of being pushed
              down by it, so there's no layout reflow when toggling.
            – auto-hide is now a smooth `transform: translateY` slide rather
              than a max-height collapse, eliminating the jank when content
              behind it suddenly grows or shrinks.
            – pointer-events stay enabled so the back button / title /
              copy-link buttons remain tappable while chat scrolls behind. */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 border-b border-border/60 min-h-[36px] md:gap-2.5 md:px-3 md:py-2.5 md:min-h-[45px] bg-background/80 backdrop-blur-sm transition-transform duration-200 ease-out
            md:shrink-0
            max-md:absolute max-md:top-0 max-md:left-0 max-md:right-0 max-md:z-20
            ${titleVisible ? '' : 'max-md:-translate-y-full'}`}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 md:h-7 md:w-7 text-muted-foreground hover:text-foreground shrink-0 transition-colors"
            onClick={() => navigate(resolvedBackPath)}
            title={
              backPath ?
                  t('issue.backToList') :
                showBackToList ?
                    t('issue.backToList') :
                    t('issue.backToBoard')
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                #
                {issue.issueNumber}
              </span>
              {editingTitle ?
                  (
                    <input
                      className="text-sm font-semibold bg-transparent border-b-2 border-primary outline-none min-w-0 flex-1 tracking-tight"
                      value={titleDraft}
                      onChange={e => setTitleDraft(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveTitle()
                        } else if (e.key === 'Escape') {
                          setEditingTitle(false)
                        }
                      }}
                      autoFocus
                    />
                  ) :
                  (
                    <span
                      className="text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors duration-200 tracking-tight decoration-primary/30 hover:underline underline-offset-2"
                      onClick={startEditingTitle}
                      title={t('issue.editTitle')}
                    >
                      {issue.title}
                    </span>
                  )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 md:h-7 md:w-7 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            title={t('chat.search.openShortcut', '搜索此对话 (⌘F)')}
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 md:h-7 md:w-7 shrink-0 transition-all duration-200 ${copied ? 'text-emerald-500 scale-110' : 'text-muted-foreground hover:text-foreground'}`}
            title={t('issue.copyLink')}
            onClick={() => {
              navigator.clipboard
                .writeText(getIssueUrl(projectId, issueId))
                .then(() => {
                  setCopied(true)
                  setTimeout(setCopied, 2000, false)
                })
                .catch(() => {})
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Link className="h-3.5 w-3.5" />}
          </Button>
          {/* Mobile-only quick access to terminal / settings / notes / project switch.
              Without this, reaching settings from the chat required two back-navs
              (chat → list → hamburger). MobileSidebarTrigger is itself md:hidden. */}
          <MobileSidebar activeProjectId={projectId} side="right" />
        </div>

        {/* Cockpit overview that "follows" the user into an issue — they no
            longer lose the global matrix when reading a single chat. Desktop
            only; mobile has the explicit Cockpit segmented tab. Hidden via
            the TopBar ⊞ button (toggleMiniMatrix). */}
        {!isMobile ? <MiniMatrix /> : null}

        {/* Shared chat body: messages + metadata bar + input */}
        <ChatBody
          projectId={projectId}
          issueId={issueId}
          issue={issue}
          showDiff={showDiff}
          onToggleDiff={onToggleDiff}
          scrollRef={scrollRef}
          onAfterDelete={handleAfterDelete}
          titleVisible={titleVisible}
          searchOpen={searchOpen}
          onCloseSearch={() => setSearchOpen(false)}
        />
      </div>

      {/* Diff panel — full-screen overlay on mobile, inline on desktop */}
      {showDiff ?
          (
            isMobile ?
                (
                  <div className="fixed inset-0 z-40 bg-background flex flex-col">
                    <Suspense
                      fallback={(
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                          {t('common.loading')}
                        </div>
                      )}
                    >
                      <LazyDiffPanel
                        projectId={projectId}
                        issueId={issueId}
                        width={0}
                        onWidthChange={onDiffWidthChange}
                        onClose={onCloseDiff}
                        fullScreen
                        useWorktree={issue?.useWorktree}
                      />
                    </Suspense>
                  </div>
                ) :
                (
                  <Suspense
                    fallback={(
                      <div className="flex w-[360px] shrink-0 items-center justify-center border-l border-border bg-background text-sm text-muted-foreground">
                        {t('common.loading')}
                      </div>
                    )}
                  >
                    <LazyDiffPanel
                      projectId={projectId}
                      issueId={issueId}
                      width={diffWidth}
                      onWidthChange={onDiffWidthChange}
                      onClose={onCloseDiff}
                      useWorktree={issue?.useWorktree}
                    />
                  </Suspense>
                )
          ) :
        null}

      {/* File browser panel — full-screen overlay on mobile, inline on desktop */}
      {showFileBrowser
        ? (
            isMobile
              ? (
                  <div className="fixed inset-0 z-40 bg-background flex flex-col">
                    <Suspense
                      fallback={(
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                          {t('common.loading')}
                        </div>
                      )}
                    >
                      <LazyFileBrowserPanel
                        width={0}
                        onWidthChange={onFileBrowserWidthChange}
                        onClose={closeFileBrowser}
                        fullScreen
                      />
                    </Suspense>
                  </div>
                )
              : (
                  <Suspense
                    fallback={(
                      <div className="flex w-[360px] shrink-0 items-center justify-center border-l border-border bg-background text-sm text-muted-foreground">
                        {t('common.loading')}
                      </div>
                    )}
                  >
                    <LazyFileBrowserPanel
                      width={fileBrowserWidth}
                      onWidthChange={onFileBrowserWidthChange}
                      onClose={closeFileBrowser}
                    />
                  </Suspense>
                )
          )
        : null}

    </div>
  )
}
