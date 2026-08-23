import type { LocalSession } from '@bkd/shared'
import { AlertTriangle, FolderGit2, Loader2, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { SessionMessages } from '@/components/issue-detail/SessionMessages'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { useImportSession, useLocalSession, useLocalSessions, useProjects } from '@/hooks/use-kanban'

const PAGE_SIZE = 100
/** Entries pulled for the detail view — the tail of the transcript. */
const PREVIEW_ENTRIES = 500

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString()
}

/**
 * Import dialog. Sessions whose `cwd` matches no project are listed like any
 * other, so the mismatch is surfaced here and acknowledged explicitly rather
 * than hidden by filtering them out of the list.
 */
function ImportDialog({
  session,
  onClose,
}: {
  session: LocalSession | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const importSession = useImportSession()

  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [importLogs, setImportLogs] = useState(true)
  const [acknowledged, setAcknowledged] = useState(false)

  const effectiveProjectId = projectId || session?.matchedProjectId || ''
  const selectedProject = projects?.find(p => p.id === effectiveProjectId)
  const cwdMatches = !!selectedProject?.directory && selectedProject.directory === session?.cwd
  const blocked = !effectiveProjectId || (!cwdMatches && !acknowledged)

  const handleImport = () => {
    if (!session || blocked) return
    importSession.mutate(
      {
        projectId: effectiveProjectId,
        engine: session.engine,
        sessionId: session.sessionId,
        title: title.trim() || undefined,
        importLogs,
      },
      {
        onSuccess: (result) => {
          onClose()
          void navigate(`/projects/${result.issue.projectId}/issues/${result.issue.id}`)
        },
      },
    )
  }

  return (
    <Dialog open={!!session} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sessions.import.title')}</DialogTitle>
          <DialogDescription>{session?.title || session?.sessionId}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('sessions.import.project')}</Label>
            <Select value={effectiveProjectId} onValueChange={value => setProjectId(value ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder={t('sessions.import.selectProject')} />
              </SelectTrigger>
              <SelectContent>
                {projects?.map(project => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('sessions.import.issueTitle')}</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={session?.title}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>{t('sessions.import.importLogs')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('sessions.import.importLogsHint')}
              </p>
            </div>
            <Switch checked={importLogs} onCheckedChange={setImportLogs} />
          </div>

          {effectiveProjectId && !cwdMatches
            ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <div className="space-y-2">
                      <p>
                        {t('sessions.import.cwdMismatch', {
                          sessionCwd: session?.cwd || '-',
                          projectDir: selectedProject?.directory || '-',
                        })}
                      </p>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={e => setAcknowledged(e.target.checked)}
                        />
                        {t('sessions.import.acknowledge')}
                      </label>
                    </div>
                  </div>
                </div>
              )
            : null}

          {importSession.isError
            ? (
                <p className="text-xs text-destructive">
                  {importSession.error instanceof Error
                    ? importSession.error.message
                    : t('sessions.import.failed')}
                </p>
              )
            : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={blocked || importSession.isPending} onClick={handleImport}>
            {importSession.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : null}
            {t('sessions.import.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SessionMeta({ session }: { session: LocalSession }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1 truncate">
        <FolderGit2 className="h-3 w-3 shrink-0" />
        {session.cwd || '-'}
      </span>
      <span>{formatTime(session.lastActiveAt)}</span>
      <span>{formatSize(session.sizeBytes)}</span>
      {session.model ? <span>{session.model}</span> : null}
      {session.cliVersion ? <span>{`v${session.cliVersion}`}</span> : null}
    </div>
  )
}

function SessionRow({
  session,
  onOpen,
  onImport,
}: {
  session: LocalSession
  onOpen: (session: LocalSession) => void
  onImport: (session: LocalSession) => void
}) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={() => onOpen(session)}
          className="min-w-0 flex-1 space-y-1 text-left"
        >
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{session.engine}</Badge>
            <span className="truncate text-sm font-medium">
              {session.title || session.sessionId}
            </span>
          </div>
          <SessionMeta session={session} />
        </button>
        <Button size="sm" variant="outline" onClick={() => onImport(session)}>
          {t('sessions.importAction')}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Parsed transcript for one session, rendered with the same chat components as
 * the issue detail page so tool calls and subagent threads look identical.
 */
function SessionDetailSheet({
  session,
  onClose,
  onImport,
}: {
  session: LocalSession | null
  onClose: () => void
  onImport: (session: LocalSession) => void
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { data, isLoading } = useLocalSession(
    session?.engine ?? null,
    session?.sessionId ?? null,
    { limit: PREVIEW_ENTRIES },
  )

  const shown = data?.entries.length ?? 0
  const truncated = (data?.totalEntries ?? 0) > shown

  return (
    <Sheet open={!!session} onOpenChange={open => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle className="truncate">
            {session?.title || session?.sessionId}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px]">
            {session?.sessionId}
          </SheetDescription>
          {session ? <SessionMeta session={session} /> : null}
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading
            ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )
            : null}
          {truncated
            ? (
                <p className="pb-2 text-center text-xs text-muted-foreground">
                  {t('sessions.detail.truncated', { shown, total: data?.totalEntries ?? 0 })}
                </p>
              )
            : null}
          {data ? <SessionMessages logs={data.entries} scrollRef={scrollRef} /> : null}
        </div>

        <SheetFooter className="flex-row justify-between border-t">
          <span className="text-xs text-muted-foreground">
            {t('sessions.detail.entries', { count: data?.totalEntries ?? 0 })}
          </span>
          <Button
            size="sm"
            onClick={() => {
              if (session) onImport(session)
            }}
          >
            {t('sessions.importAction')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export default function LocalSessionsPage() {
  const { t } = useTranslation()
  const [engine, setEngine] = useState('all')
  const [search, setSearch] = useState('')
  const [importTarget, setImportTarget] = useState<LocalSession | null>(null)
  const [detailTarget, setDetailTarget] = useState<LocalSession | null>(null)

  const filters = useMemo(
    () => ({
      engine: engine === 'all' ? undefined : engine,
      search: search.trim() || undefined,
      // Sessions already tracked by BKD belong to their issue, not to this list.
      managed: 'false' as const,
      limit: PAGE_SIZE,
    }),
    [engine, search],
  )
  const { data, isLoading } = useLocalSessions(filters)

  return (
    <main className="min-h-screen text-foreground animate-page-enter">
      <section className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-8">
        <div className="mb-4 flex items-center gap-2.5 md:mb-6">
          <Link to="/" aria-label={t('sidebar.home')}>
            <AppLogo className="h-8 w-8" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">
            {t('sessions.title')}
          </h1>
          {data ? <Badge variant="secondary" className="ml-1">{data.total}</Badge> : null}
        </div>

        <p className="mb-4 text-xs text-muted-foreground">{t('sessions.description')}</p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('sessions.searchPlaceholder')}
              className="pl-8"
            />
          </div>
          <Select value={engine} onValueChange={value => setEngine(value ?? 'all')}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('sessions.allEngines')}</SelectItem>
              <SelectItem value="claude-code">claude-code</SelectItem>
              <SelectItem value="codex">codex</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading
          ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )
          : null}

        {!isLoading && data?.sessions.length === 0
          ? <p className="py-12 text-center text-sm text-muted-foreground">{t('sessions.empty')}</p>
          : null}

        <div className="space-y-2">
          {data?.sessions.map(session => (
            <SessionRow
              key={`${session.engine}:${session.sessionId}`}
              session={session}
              onOpen={setDetailTarget}
              onImport={setImportTarget}
            />
          ))}
        </div>

        {data?.hasMore
          ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {t('sessions.truncated', { count: PAGE_SIZE })}
              </p>
            )
          : null}
      </section>

      <SessionDetailSheet
        session={detailTarget}
        onClose={() => setDetailTarget(null)}
        onImport={setImportTarget}
      />
      <ImportDialog
        session={importTarget}
        onClose={() => {
          setImportTarget(null)
          setDetailTarget(null)
        }}
      />
    </main>
  )
}
