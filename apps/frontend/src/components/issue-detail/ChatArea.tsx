import { ArrowLeft, Check, GitBranch, Link, Search } from 'lucide-react'
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
import { ParticipantPanel } from './ParticipantPanel'
import { RoleCreatorModal } from './RoleCreatorModal'
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
  hideTitleBar = false,
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
  /**
   * Suppress the in-chat title bar. Used by cockpit desktop layouts where
   * CockpitTopBar already owns the breadcrumb + identity + actions, so the
   * second header row is redundant. Mobile cockpit and the Kanban path
   * leave this `false` because they have no TopBar.
   */
  hideTitleBar?: boolean
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
  const [showRoleCreator, setShowRoleCreator] = useState(false)
  const isMobile = useIsMobile()
  const showFileBrowser = useFileBrowserStore(s => s.isOpen && !s.isDrawer && s.issueId === issueId)
  const closeFileBrowser = useFileBrowserStore(s => s.close)

  // Auto-hide title bar (mobile only) to maximise reading area.
  // Semantics align with Safari / Twitter / Instagram:
  //
  //   – scroll DOWN (scrollTop ↑ toward bottom) → HIDE  (reading, the
  //     bar is just chrome — give it up for more space)
  //   – scroll UP   (scrollTop ↓ toward history) → SHOW  (navigating,
  //     user wants controls back)
  //   – at the top OR within 80px of the bottom → always SHOW
  //
  // Hysteresis: accumulate per-direction distance and only flip once a
  // minimum continuous scroll is reached. Resets the opposite accumulator
  // on every direction change so a hesitant nudge the other way doesn't
  // flap the bar. Bottom chrome (status bar + chat input) intentionally
  // stays pinned — same pattern as Telegram / WhatsApp / iMessage.
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
    }

    const attach = () => {
      el = scrollRef.current
      if (!el) return false
      lastTop = el.scrollTop
      el.addEventListener('scroll', onScroll, { passive: true })
      cleanup = () => {
        el?.removeEventListener('scroll', onScroll)
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

  // SEARCH-001: in-chat search panel. Opened from the header search
  // button only — we deliberately do NOT hijack ⌘F / Ctrl+F so the
  // browser's native page find keeps working.
  const [searchOpen, setSearchOpen] = useState(false)

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
              copy-link buttons remain tappable while chat scrolls behind.
            Suppressed entirely when `hideTitleBar` is set — cockpit desktop
            uses CockpitTopBar for the same concerns. */}
        {!hideTitleBar ? (
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
                {issue.parentIssueId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${projectId}/issues/${issue.parentIssueId}`)}
                    className="shrink-0 inline-flex items-center gap-0.5 rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                    title={t('chat.fork.lineage.from')}
                  >
                    <GitBranch className="size-3" />
                    {t('chat.fork.lineage.from')}
                  </button>
                )}
                {issue.forks && issue.forks.length > 0 && (
                  <span
                    className="shrink-0 inline-flex items-center gap-0.5 rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums"
                    title={t('chat.fork.lineage.forks', { count: issue.forks.length })}
                  >
                    <GitBranch className="size-3" />
                    {t('chat.fork.lineage.forks', { count: issue.forks.length })}
                  </span>
                )}
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
              title={t('chat.search.openShortcut', '搜索此对话')}
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
        ) : null}

        {/* Cockpit overview that "follows" the user into an issue — they no
            longer lose the global matrix when reading a single chat. Desktop
            only; mobile has the explicit Cockpit segmented tab. Hidden via
            the TopBar ⊞ button (toggleMiniMatrix). */}
        {!isMobile ? <MiniMatrix /> : null}

        {/* Shared chat body: messages + metadata bar + input.
            Inner wrapper MUST be `flex flex-col` — ChatBody returns a fragment
            of three siblings (messages, metadata bar, input) that rely on a
            flex column parent so the messages region takes `flex-1` and the
            input stays pinned at the bottom. Without `flex flex-col` here,
            the messages region collapses to content height and the input is
            clipped off-screen by the wrapper's overflow-hidden. */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
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
          {/* Participant panel — desktop only */}
          {!isMobile && (
            <ParticipantPanel
              projectId={projectId}
              issueId={issueId}
            />
          )}
        </div>

        {/* Role creator modal */}
        <RoleCreatorModal
          projectId={projectId}
          isOpen={showRoleCreator}
          onClose={() => setShowRoleCreator(false)}
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
