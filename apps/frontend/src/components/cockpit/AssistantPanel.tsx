import { Bot, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EngineIcon } from '@/components/EngineIcons'
import { ChatBody } from '@/components/issue-detail/ChatBody'
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useCockpitAsk, useCockpitAssistant } from '@/hooks/use-cockpit-assistant'
import { useCockpitReset, useCockpitSetEngine } from '@/hooks/use-cockpit-proposals'
import { useEngineAvailability, useIssue } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { CockpitProposalsBanner } from './CockpitProposalsBanner'
import { SuggestedPrompts } from './SuggestedPrompts'

const MCP_ENGINE = 'claude-code-sdk'

export function AssistantPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { data: assistant } = useCockpitAssistant()
  const { data: issue, isLoading } = useIssue(
    assistant?.projectId ?? '',
    assistant?.issueId ?? '',
  )
  const ask = useCockpitAsk()
  const reset = useCockpitReset()
  const setEngine = useCockpitSetEngine()
  const { data: discovery } = useEngineAvailability(true)
  const installedEngines = (discovery?.engines ?? []).filter(
    a => a.installed && a.executable !== false,
  )
  const currentEngine = issue?.engineType ?? MCP_ENGINE
  const supportsMcp = currentEngine === MCP_ENGINE
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    if (!open || isMobile) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmReset) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, isMobile, onClose, confirmReset])

  if (!open) return null

  const hasConversation = !!issue?.sessionStatus && issue.sessionStatus !== 'pending'

  const inner = (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold tracking-tight shrink-0">
            {t('cockpit.assistant.title', 'AI Assistant')}
          </h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Engine picker — unlike a regular issue (where engine is
              session-bound and immutable), the cockpit assistant treats
              engine as a user preference. Switching invalidates the session
              server-side so the next message starts a fresh first turn. */}
          {installedEngines.length > 0 && issue ?
              (
                <div className="flex items-center gap-1 mr-1">
                  <EngineIcon engineType={currentEngine} className="h-3.5 w-3.5 shrink-0" />
                  <select
                    data-testid="assistant-panel-engine"
                    value={currentEngine}
                    disabled={setEngine.isPending}
                    onChange={(e) => {
                      const next = e.target.value
                      if (next === currentEngine) return
                      setEngine.mutate(next)
                    }}
                    title={t('cockpit.assistant.engineTitle', 'Change engine (resets session)')}
                    className="rounded-md border border-border/40 bg-background/80 px-1.5 py-0.5 text-[11px] text-foreground/85 hover:bg-accent cursor-pointer disabled:opacity-50"
                  >
                    {installedEngines.map(eng => (
                      <option key={eng.engineType} value={eng.engineType}>
                        {t(`createIssue.engineLabel.${eng.engineType}`, eng.engineType)}
                      </option>
                    ))}
                  </select>
                </div>
              ) :
            null}
          <button
            type="button"
            data-testid="assistant-panel-reset"
            onClick={() => setConfirmReset(true)}
            disabled={reset.isPending}
            aria-label={t('cockpit.assistant.reset', 'Reset session')}
            title={t('cockpit.assistant.reset', 'Reset session')}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="assistant-panel-close"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Warning shown when current engine cannot use the cockpit_* MCP tools. */}
      {!supportsMcp && issue ?
          (
            <div
              data-testid="assistant-panel-mcp-warning"
              className="px-4 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/40 text-[11px] text-amber-700 dark:text-amber-300"
            >
              {t(
                'cockpit.assistant.engineNoMcp',
                'cockpit_* tools require claude-code-sdk; selected engine cannot call them.',
              )}
            </div>
          ) :
        null}

      <CockpitProposalsBanner />

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {isLoading || !issue || !assistant ?
            (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
                {t('common.loading', 'Loading…')}
              </div>
            ) :
            (
              <>
                {!hasConversation ?
                    (
                      <SuggestedPrompts
                        onSelect={(prompt) => {
                          ask.mutate({ prompt })
                        }}
                      />
                    ) :
                  null}
                <div className="flex-1 min-h-0">
                  <ChatBody
                    projectId={assistant.projectId}
                    issueId={assistant.issueId}
                    issue={issue}
                    showDiff={false}
                    onToggleDiff={() => {}}
                  />
                </div>
              </>
            )}
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cockpit.assistant.resetConfirmTitle', 'Reset AI session?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cockpit.assistant.resetConfirmBody', 'The conversation history will be archived and a fresh session will start on your next message. Pending proposals are unaffected.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                reset.mutate(undefined, {
                  onSettled: () => setConfirmReset(false),
                })
              }}
            >
              {t('cockpit.assistant.reset', 'Reset')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={v => !v && onClose()}>
        <SheetContent
          data-testid="assistant-panel-mobile-sheet"
          side="bottom"
          className="h-[85vh] p-0"
          showCloseButton={false}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t('cockpit.assistant.title', 'AI Assistant')}</SheetTitle>
          </SheetHeader>
          {inner}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      data-testid="assistant-panel-desktop-dock"
      className="fixed right-4 top-16 bottom-4 z-40 w-[380px] flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
    >
      {inner}
    </div>
  )
}
