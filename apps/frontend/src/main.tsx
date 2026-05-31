import { QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { lazy, Suspense, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GlobalCommandPalette } from './components/GlobalCommandPalette'
import { Toaster } from './components/ui/sonner'
import { useAuth } from './hooks/use-auth'
import { useReviewNotifications } from './hooks/use-review-notifications'
import { useSystemInfo } from './hooks/use-kanban'
import { eventBus } from './lib/event-bus'
import { useFileBrowserStore } from './stores/file-browser-store'
import { useNotesStore } from './stores/notes-store'
import { useProcessManagerStore } from './stores/process-manager-store'
import { useServerStore } from './stores/server-store'
import { useTerminalStore } from './stores/terminal-store'
import './i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
      // Disable window-focus refetch: on mobile, locking/unlocking the screen
      // triggers focus, which causes every active query to reload and produces
      // a jarring "flash" in the message stream. SSE already pushes updates
      // in real time, so this default behaviour is unnecessary.
      refetchOnWindowFocus: false,
      // Required for query persistence: persist-client only persists queries
      // whose `gcTime` is longer than the persistence write interval, otherwise
      // they get garbage-collected before the dehydrate snapshot is taken.
      gcTime: 1000 * 60 * 60 * 24, // 24h
    },
  },
})

// localStorage-backed persister: dehydrates the query cache so that on next
// page load the previously-fetched data is rendered immediately while the
// network refetch happens in the background. Critical for mobile UX where
// every tab close + reopen previously meant a cold-load wait.
const persister = createSyncStoragePersister({
  storage: typeof window === 'undefined' ? undefined : window.localStorage,
  key: 'bkd:react-query-cache',
  // Throttle writes to 1s — protects against thrashing during rapid SSE updates.
  throttleTime: 1000,
})

// Invalidate all queries on SSE reconnect so stale statuses get refreshed
eventBus.onConnectionChange((connected) => {
  if (connected) queryClient.invalidateQueries()
})
// Invalidate issue queries when any issue status changes via SSE
eventBus.onIssueUpdated(() => {
  queryClient.invalidateQueries({ queryKey: ['projects'] })
  // Match all useReviewIssues variants (with or without status filter) + stats
  queryClient.invalidateQueries({
    predicate: q => q.queryKey[0] === 'issues' && (q.queryKey[1] === 'review' || q.queryKey[1] === 'stats'),
  })
})
// Debounced invalidation of changes queries on any issue activity (log/state/done)
{
  let activityTimer: ReturnType<typeof setTimeout> | null = null
  eventBus.onIssueActivity(() => {
    if (activityTimer) clearTimeout(activityTimer)
    activityTimer = setTimeout(() => {
      activityTimer = null
      queryClient.invalidateQueries({
        queryKey: ['projects'],
        predicate: q => q.queryKey.includes('changes') || q.queryKey.includes('processes'),
      })
    }, 2000)
  })
}

const HomePage = lazy(() => import('./pages/HomePage'))
const KanbanPage = lazy(() => import('./pages/KanbanPage'))
const IssueDetailPage = lazy(() => import('./pages/IssueDetailPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const TerminalPage = lazy(() => import('./pages/TerminalPage'))
const CronPage = lazy(() => import('./pages/CronPage'))
const WhiteboardPage = lazy(() => import('./pages/WhiteboardPage'))
const WorkspaceCreatePage = lazy(() => import('./pages/WorkspaceCreatePage'))
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const LoginCallbackPage = lazy(() => import('./pages/LoginCallbackPage'))
const LazyTerminalDrawer = lazy(() =>
  import('./components/terminal/TerminalDrawer').then(m => ({
    default: m.TerminalDrawer,
  })),
)
const LazyFileBrowserDrawer = lazy(() =>
  import('./components/files/FileBrowserDrawer').then(m => ({
    default: m.FileBrowserDrawer,
  })),
)
const LazyProcessManagerDrawer = lazy(() =>
  import('./components/processes/ProcessManagerDrawer').then(m => ({
    default: m.ProcessManagerDrawer,
  })),
)
const LazyNotesDrawer = lazy(() =>
  import('./components/notes/NotesDrawer').then(m => ({
    default: m.NotesDrawer,
  })),
)

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false,
  )
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return isMobile
}

function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()
  return (
    <div className="w-full" style={{ height: '100dvh' }}>
      {children}
      <ReviewNotificationsMount />
      <Toaster position={isMobile ? 'top-center' : 'top-right'} />
    </div>
  )
}

function ReviewNotificationsMount() {
  useReviewNotifications()
  return null
}

function TerminalDrawerMount() {
  const isOpen = useTerminalStore(s => s.isOpen)

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <LazyTerminalDrawer />
    </Suspense>
  )
}

function FileBrowserDrawerMount() {
  const isOpen = useFileBrowserStore(s => s.isOpen)

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <LazyFileBrowserDrawer />
    </Suspense>
  )
}

function ProcessManagerDrawerMount() {
  const isOpen = useProcessManagerStore(s => s.isOpen)

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <LazyProcessManagerDrawer />
    </Suspense>
  )
}

function NotesDrawerMount() {
  const isOpen = useNotesStore(s => s.isOpen)

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <LazyNotesDrawer />
    </Suspense>
  )
}

/**
 * EventBusManager: Gates SSE connection on auth state.
 * - Auth disabled → connect immediately.
 * - Auth enabled + authenticated → connect.
 * - Auth enabled + unauthenticated → disconnect (no reconnect loop).
 */
function EventBusManager() {
  const { authEnabled, isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) return

    const shouldConnect = !authEnabled || isAuthenticated
    if (shouldConnect) {
      eventBus.connect()
    } else {
      eventBus.disconnect()
    }

    return () => {
      eventBus.disconnect()
    }
  }, [authEnabled, isAuthenticated, isLoading])

  return null
}

function ServerConfigLoader() {
  const { data } = useSystemInfo(true)
  const setServerInfo = useServerStore(s => s.setServerInfo)

  useEffect(() => {
    if (!data) return
    const { name, url } = data.server
    setServerInfo(name, url)
    if (name) {
      document.title = name
    }
  }, [data, setServerInfo])

  return null
}

/**
 * AuthGate: When auth is enabled and user has no token, redirect to /login.
 * When auth is disabled, render children directly.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { authEnabled, isAuthenticated, isLoading, isError } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  // Config fetch failed → block rendering (fail closed, never fail open)
  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">Unable to verify authentication configuration.</p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    )
  }

  // Auth not enabled → render app directly
  if (!authEnabled) return <>{children}</>

  // Auth enabled but no token → redirect to login
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return <>{children}</>
}

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // 24h cap: anything older than this is dropped during rehydrate.
        maxAge: 1000 * 60 * 60 * 24,
        // Bump on schema-incompatible changes to flush stale shapes.
        buster: 'v1',
        dehydrateOptions: {
          // Skip queries that are explicitly meant to be live (FREQUENT tier
          // staleTime ≤ 5s). Persisting them just causes a stale flash before
          // the immediate refetch lands.
          shouldDehydrateQuery: (q) => {
            if (q.state.status !== 'success') return false
            // Live process / download status / SSE-driven views — don't persist.
            const k = q.queryKey
            if (k.includes('processes') || k.includes('downloadStatus')) return false
            return true
          },
        },
      }}
    >
      <BrowserRouter>
        <ErrorBoundary>
          <AppShell>
            <Suspense
              fallback={(
                <div className="flex h-full items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              )}
            >
              <Routes>
                {/* Auth routes — always accessible */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/login/callback" element={<LoginCallbackPage />} />

                {/* Protected routes — wrapped in AuthGate */}
                <Route
                  path="/"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <HomePage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/projects/:projectId"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <KanbanPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/projects/:projectId/issues"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <IssueDetailPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/projects/:projectId/issues/:issueId"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <IssueDetailPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/review"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <ReviewPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/review/:projectAlias/:issueId"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <ReviewPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/terminal"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <TerminalPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/cron"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <CronPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/projects/:projectId/whiteboard"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <WhiteboardPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/workspace/new"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <WorkspaceCreatePage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/workspace/:wid"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <WorkspacePage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/search"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <SearchPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppShell>
          <TerminalDrawerMount />
          <FileBrowserDrawerMount />
          <ProcessManagerDrawerMount />
          <NotesDrawerMount />
          <EventBusManager />
          <ServerConfigLoader />
          <GlobalCommandPalette />
        </ErrorBoundary>
      </BrowserRouter>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </PersistQueryClientProvider>,
  )
}
