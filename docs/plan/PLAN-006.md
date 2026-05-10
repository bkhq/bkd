# PLAN-006 Backend Chat Normalization & Frontend Simplification

## Status

`superseded` (2026-05-10)

## Superseded By

Targeted nine-bug fix landed 2026-05-10. See commit history around the
`TimelineConverter` rewrite — `apps/api/src/engines/timeline-converter.ts`
+ `apps/api/src/engines/issue/pipeline/timeline-emit.ts` plus the frontend
edits in `use-issue-stream.ts`, `use-acp-timeline.ts`, `AcpTimeline.tsx`,
`LogEntry.tsx`, `ToolItems.tsx`.

## Superseded Rationale

Root-cause analysis on 2026-05-10 (with live data sampling against issue
`8ebt9csy`) identified nine concrete bugs causing the chat UI symptoms
(挤一团 / 抽风 / 刷新才好 / tab freeze / 重复渲染历史 / 流式回复尾部缺失).
**Format unification (UIMessage migration) addresses zero of them.**

The real causes were:

1. `toTimelineEntry` (SSE per-entry) and `toTimeline` (HTTP batch) had divergent
   rules — single-entry path didn't split thinking/assistant segments or merge
   chunks, batch path did. Live and refresh views diverged.
2. Streaming chunks weren't persisted (DB only had final snapshots) so
   refresh produced different content from live for delta-style engines.
3. `done` SSE event raced ahead of the last `log` events; frontend's
   "drop logs after done" guard then erased the tail.
4. Frontend `useAcpTimeline` re-implemented thinking dedup and chunk
   merging on top of backend output — every chunk re-ran heuristics and
   produced flickering intermediate states.
5. Frontend sort fell back to `TYPE_ORDER` (thinking < tool < assistant)
   on timestamp ties — entries jumped position as new chunks updated
   timestamps on stable-id buffers.
6. `buildToolGroup(toolBuffer).id` was called twice with `Date.now()`
   fallback, producing two different ids for the same group within a
   single render — React keys drifted, historical groups unmounted on
   every chunk.
7. LRU cache merge direction wrote cached entries OVER the freshly
   fetched canonical data, surfacing stale streaming snapshots after
   tab switches.
8. `ToolGroupMessage` / `LogEntry` / thinking blocks weren't memoized,
   so every SSE chunk re-rendered the entire timeline including
   historical turns. With `MarkdownContent` + Shiki inside, this is the
   tab-freeze cause.
9. `buildToolGroup` stored kinds (`execute`, `read`, `edit`) that
   `getGroupSummaryLabel` didn't recognize (it expected `command-run`,
   `file-read`, `file-edit`) — every group degenerated to "N other".

The applied fix is ~500 net lines and touches:

- **Backend**: rewrite `timeline-converter.ts` as a stateful per-issue
  `TimelineConverter` class shared by both SSE and HTTP paths; add a new
  `timeline-entry` event channel emitted from a new pipeline stage at
  order 90 (`pipeline/timeline-emit.ts`); flush + reset on settle
  (`lifecycle/settle.ts`); add `sequence` field to `TimelineEntry`.
- **Frontend**: sort by `sequence`, drop `done`-guard + refetch on done,
  reverse cache merge direction, simplify `useAcpTimeline` (no more
  thinking dedup or chunk merging), normalize tool `kind` vocabulary,
  add `React.memo` with structural equality to `ToolGroupMessage` /
  `LogEntry` / `AcpPlanCard` / streaming + completed thinking blocks.
- **Tests**: 12 new tests pin "streaming-via-`ingest()`" output to
  "batch-via-`toTimeline()`" output — divergence is a regression.

PLAN-006 was abandoned because:

- Its premise ("two duplicate reconstruction paths, one frontend one backend")
  was already half-fixed by the earlier `TimelineConverter` commit
  (`f73c2c4`); the remaining drift was inside the backend (the two converter
  functions), not between backend and frontend.
- Switching to AI SDK `UIMessage` would not have fixed any of the nine
  root causes — they're React/state/contract bugs orthogonal to the
  message format.
- The proposed rewrite (~2000 net lines, delete 4 core files) had a much
  larger blast radius than the actual ~500-line targeted fix, with
  higher regression risk and zero additional benefit.

## Created

2026-05-09

## Context

BKD chat has accumulated ~4500 lines of frontend code across 14 files, with bugs that resist fixing:

- `useChatMessages.ts` (404 lines) — frontend message rebuilding (tool pairing, thinking defer, task plan extraction)
- `useIssueStream.ts` (430 lines) — SSE + LRU cache + older logs pagination + state merging
- `event-bus.ts` (410 lines) — global SSE connection management
- `SessionMessages.tsx` (330 lines) — virtualization + auto-scroll + scroll position persistence
- `LogEntry.tsx` (589 lines) + `ToolItems.tsx` (919 lines) — conditional rendering chaos

**Root cause identified**: The system uses **custom/non-standard message formats** end-to-end. Data transforms 4 times before reaching the UI:

```
Engine → NormalizedLogEntry → TimelineEntry → ChatMessage → React UI
         ↑_____________↑______________↑
              All custom formats
```

Both backend (`message-rebuilder.ts`, 273 lines) and frontend (`useChatMessages.ts`, 404 lines) maintain **duplicate message reconstruction logic**. Any discrepancy creates bugs.

## Goals

1. **Single source of truth**: Only backend reconstructs messages; frontend receives render-ready messages
2. **Standard message format**: Adopt AI SDK `UIMessage` / `UIMessagePart` as the unified format
3. **Drastically simplify frontend**: Delete `useChatMessages.ts` entirely; reduce `useIssueStream.ts` by ~80%
4. **Preserve UX**: All existing UI behavior (tool groups, thinking blocks, diff viewer, attachments) remains

## Non-Goals

- Not migrating to Vercel AI SDK `useChat` hook (architecture mismatch — BKD is subprocess-driven, not request-response chat)
- Not using Assistant UI components (custom rendering too extensive; components would all be overridden)
- Not changing database schema
- Not adding new UI features

## Proposal

### Overview

**Backend** adds a pipeline stage that converts `NormalizedLogEntry` → `UIMessage` in real-time. SSE pushes `UIMessage` directly. Frontend stores and renders without reconstruction.

```
Before:
  Backend: Engine → NormalizedLogEntry → appEvents → SSE → TimelineEntry
  Frontend: SSE → TimelineEntry[] → useIssueStream (cache/merge) → useChatMessages (rebuild) → ChatMessage[] → render

After:
  Backend: Engine → NormalizedLogEntry → appEvents → ChatMessageConverter → SSE → UIMessage
  Frontend: SSE → UIMessage[] → render (no rebuild)
```

### 1. Unified Message Format: AI SDK UIMessage

Use `ai` package's `UIMessage` type as the single format from backend SSE to frontend render.

**BKD → UIMessage mapping:**

| BKD Concept | UIMessage Representation |
|------------|------------------------|
| `assistant-message` | `role: 'assistant'`, `parts: [{ type: 'text', text }]` |
| `thinking` | `role: 'assistant'`, `parts: [{ type: 'reasoning', text }]` |
| `tool-use` (action) | `role: 'assistant'`, `parts: [{ type: 'tool-call', toolCallId, toolName, args }]` |
| `tool-use` (result) | `role: 'assistant'`, `parts: [{ type: 'tool-result', toolCallId, toolName, result }]` |
| `user-message` | `role: 'user'`, `parts: [{ type: 'text', text }]` |
| `error-message` | `role: 'system'`, `parts: [{ type: 'data', data: { kind: 'error', ... } }]` |
| `system-message` | `role: 'system'`, `parts: [{ type: 'data', data: { kind: 'system', subtype, ... } }]` |
| TodoWrite task plan | `role: 'assistant'`, `parts: [{ type: 'data', data: { kind: 'task-plan', todos } }]` |
| File attachments | `role: 'user'`, `parts: [{ type: 'file', ... }]` |

**Tool group handling**: Backend does NOT fold tools into groups. Each tool call/result is a separate `tool-call` / `tool-result` part. Frontend rendering collapses adjacent `tool-call` + `tool-result` pairs into the existing `ToolGroupMessage` visual component.

### 2. Backend Changes

#### 2.1 New: `apps/api/src/engines/chat/chat-message-converter.ts` (~250 lines)

Replaces `message-rebuilder.ts`. Converts `NormalizedLogEntry` stream → `UIMessage` stream in real-time.

**Responsibilities:**
- Tool action ↔ result pairing (by `toolCallId`)
- Thinking accumulation (merge streaming chunks)
- Assistant message accumulation (merge streaming chunks)
- TodoWrite extraction → `task-plan` data part
- System message filtering (drop noise, keep actionable ones)
- Error message formatting

**State machine per issue:**
```
Entry arrives → identify type → upsert into UIMessage buffer → emit chat-message event
```

The converter maintains an in-memory `Map<issueId, UIMessage[]>` that accumulates messages. On each new entry, it either:
- Appends a new `UIMessage`
- Updates an existing message (for streaming text/reasoning)
- Adds a part to an existing message (for tool results arriving after tool calls)

#### 2.2 Modified: `apps/api/src/engines/issue/pipeline/index.ts`

Add new pipeline stage at order 90 (before SSE broadcast at order 100):

```typescript
export function registerLogPipeline(ctx: EngineContext): void {
  // ... existing stages (order 10-40) ...
  
  // NEW: Convert to UIMessage (order 90)
  registerChatMessageStage(ctx, on)
}
```

The `registerChatMessageStage` subscribes to `log` events, runs entries through `chat-message-converter`, and emits new `chat-message` events.

#### 2.3 Modified: `apps/api/src/routes/events.ts`

Add `chat-message` event to SSE broadcast:

```typescript
const unsubChatMessage = appEvents.on('chat-message', (data) => {
  writeEvent('chat-message', { 
    issueId: data.issueId, 
    message: data.message 
  })
})
```

Format: `data: {"issueId": "...", "message": {"id": "...", "role": "...", "parts": [...]}}`

#### 2.4 New API: `GET /api/projects/:projectId/issues/:issueId/chat-messages`

Returns historical messages as `UIMessage[]`.

Implementation: Query `NormalizedLogEntry` from DB → run through `chat-message-converter` → return `UIMessage[]`.

Replaces the existing logs API for chat purposes. The old logs API (`GET /:id/logs`) remains for other consumers.

#### 2.5 Deleted: `apps/api/src/engines/issue/store/message-rebuilder.ts`

No longer needed. Message reconstruction logic is consolidated in `chat-message-converter.ts`.

### 3. Frontend Changes

#### 3.1 Install dependency

```bash
bun add ai
```

Only uses `ai` for type definitions (`UIMessage`, `UIMessagePart`) and utility functions. **Does NOT use `@ai-sdk/react` `useChat` hook** (architecture mismatch).

#### 3.2 New types: `apps/frontend/src/types/chat.ts`

```typescript
import type { UIMessage, UIMessagePart } from 'ai'
export type { UIMessage, UIMessagePart }

// BKD-specific part types
export interface BKDDataPart {
  type: 'data'
  data: 
    | { kind: 'task-plan'; todos: Array<{ content: string; status: string; activeForm?: string }> }
    | { kind: 'error'; content: string }
    | { kind: 'system'; subtype: string; content: string }
    | { kind: 'command-output'; content: string }
}
```

#### 3.3 Rewritten: `apps/frontend/src/hooks/use-issue-stream.ts` (~80 lines)

**Before**: 430 lines managing TimelineEntry[], LRU cache, older logs, state merging, `useChatMessages` integration.

**After**: Simple UIMessage accumulator:

```typescript
export function useIssueStream({ projectId, issueId }: { projectId: string; issueId: string }) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  
  // Load history
  const { data: history } = useQuery({
    queryKey: ['chat-messages', projectId, issueId],
    queryFn: () => kanbanApi.getChatMessages(projectId, issueId),
  })
  
  useEffect(() => {
    if (history) setMessages(history)
  }, [history])
  
  // Subscribe to SSE chat-message events
  useEffect(() => {
    const cleanup = eventBus.subscribe(issueId, {
      onChatMessage: (message: UIMessage) => {
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === message.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = message
            return next
          }
          return [...prev, message]
        })
      },
      // ... other event handlers (state, done, etc.)
    })
    return cleanup
  }, [issueId])
  
  return { messages }
}
```

Key simplifications:
- No LRU cache (messages are the cache)
- No older/live merge (single `UIMessage[]` array)
- No `useChatMessages` call (messages are already reconstructed)
- No `TimelineEntry` conversion

#### 3.4 Deleted: `apps/frontend/src/hooks/use-chat-messages.ts`

404 lines of message reconstruction logic. **No longer needed** — backend handles this.

#### 3.5 Rewritten: `apps/frontend/src/components/issue-detail/SessionMessages.tsx` (~150 lines)

**Before**: 330 lines with `useChatMessages`, virtualization threshold, complex auto-scroll, `useVirtualizer`.

**After**: Direct UIMessage rendering:

```typescript
export function SessionMessages({ messages }: { messages: UIMessage[] }) {
  return (
    <div className="flex flex-col py-3 px-4">
      {messages.map(message => (
        <BKDMessageRenderer key={message.id} message={message} />
      ))}
    </div>
  )
}
```

**Virtualization**: Consider removing. React 19 + smaller component tree should handle hundreds of messages. If performance issues arise, re-add `@tanstack/react-virtual` later.

**Auto-scroll**: Simplified to basic "scroll to bottom on new message" (20 lines).

#### 3.6 New: `apps/frontend/src/components/issue-detail/BKDMessageRenderer.tsx` (~200 lines)

Single entry point for rendering a `UIMessage`:

```typescript
function BKDMessageRenderer({ message }: { message: UIMessage }) {
  switch (message.role) {
    case 'user':
      return <UserMessage message={message} />
    case 'assistant':
      return <AssistantMessage message={message} />
    case 'system':
      return <SystemMessage message={message} />
    default:
      return null
  }
}
```

Each role handler renders its `parts`:
- `text` → `MarkdownContent`
- `reasoning` → `ThinkingBlock`
- `tool-call` + `tool-result` → `ToolGroupMessage` (adjacent pairs auto-folded)
- `file` → attachment chips/images
- `data` (BKD custom) → `TaskPlanMessage`, `ErrorBlock`, `SystemBlock`

#### 3.7 Adapted: `apps/frontend/src/components/issue-detail/ToolItems.tsx`

**Before**: Renders `ToolGroupChatMessage` (custom BKD type).

**After**: Renders adjacent `tool-call` + `tool-result` parts from `UIMessage`. Visual output identical — only input type changes.

#### 3.8 Adapted: `apps/frontend/src/components/issue-detail/LogEntry.tsx`

Most functionality moves into `BKDMessageRenderer.tsx`. `LogEntry.tsx` either becomes a thin wrapper or is deleted.

#### 3.9 Simplified: `apps/frontend/src/components/issue-detail/ChatBody.tsx`

**Before**: Orchestrates `useIssueStream` + `usePendingMessages` + `useChatMessages` + scroll management + cancel state.

**After**: Uses simplified `useIssueStream` (returns `UIMessage[]` directly). Pending messages can be represented as `user` role messages with `metadata.status = 'pending'`.

### 4. File Change Summary

| File | Action | Lines |
|------|--------|-------|
| `apps/api/src/engines/chat/chat-message-converter.ts` | **New** | ~250 |
| `apps/api/src/engines/chat/index.ts` | **New** | ~20 |
| `apps/api/src/engines/issue/pipeline/chat-message-stage.ts` | **New** | ~60 |
| `apps/api/src/routes/issues/chat-stream.ts` | **New** | ~80 |
| `apps/api/src/routes/issues/logs.ts` | Modify | +30 |
| `apps/api/src/routes/events.ts` | Modify | +15 |
| `apps/api/src/engines/issue/store/message-rebuilder.ts` | **Delete** | -273 |
| `apps/frontend/src/hooks/use-issue-stream.ts` | **Rewrite** | ~80 (was 430) |
| `apps/frontend/src/hooks/use-chat-messages.ts` | **Delete** | -404 |
| `apps/frontend/src/components/issue-detail/SessionMessages.tsx` | **Rewrite** | ~150 (was 330) |
| `apps/frontend/src/components/issue-detail/BKDMessageRenderer.tsx` | **New** | ~200 |
| `apps/frontend/src/components/issue-detail/ChatBody.tsx` | Simplify | -200 |
| `apps/frontend/src/components/issue-detail/LogEntry.tsx` | Delete/Merge | -589 |
| `apps/frontend/src/components/issue-detail/ToolItems.tsx` | Adapt | -300 |
| `apps/frontend/src/types/chat.ts` | **New** | ~30 |
| `apps/frontend/src/lib/kanban-api.ts` | Add endpoint | +10 |
| `packages/shared/src/index.ts` | Update types | +20 |

**Net change**: ~-2000 lines (deleting duplicate reconstruction logic and custom format layers)

### 5. Migration Path

| Phase | Work | Files | Risk |
|-------|------|-------|------|
| Phase 1 | Create `chat-message-converter.ts` + stage | Backend: 3 new, 2 modified | Low — additive |
| Phase 2 | Add SSE `chat-message` event + `chat-messages` API | Backend: 2 modified | Low — parallel to existing |
| Phase 3 | Frontend: create `BKDMessageRenderer`, rewrite `useIssueStream` | Frontend: 2 new, 3 modified | Medium — switchover point |
| Phase 4 | Delete old files (`message-rebuilder.ts`, `use-chat-messages.ts`, `LogEntry.tsx`) | 3 deleted | Low — cleanup |
| Phase 5 | Regression testing (all engines: ACP, Codex, Claude) | All | Medium |

**Switchover strategy**: Phase 1-2 run in parallel with existing code. Phase 3 creates new frontend components alongside old ones. Feature flag or route parameter controls which path is active. Once stable, Phase 4 deletes old code.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Chat converter misses edge case | Medium | High | Extensive unit tests; run alongside old code for comparison |
| Streaming latency increase | Low | Low | Converter is in-memory, < 1ms per entry |
| Frontend performance without virtualization | Low | Medium | Test with 500+ messages; re-add virtualizer if needed |
| Historical data compatibility | Low | Medium | New API endpoint; old API remains for non-chat consumers |
| Tool rendering regressions | Medium | Medium | Preserve existing `ToolItems.tsx` rendering logic; only input type changes |

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-09 | Rejected Vercel AI SDK `useChat` | Architecture mismatch — BKD is subprocess-driven with global SSE, not request-response chat |
| 2026-05-09 | Rejected Assistant UI | Custom rendering (diff viewer, task plan, tool groups) exceeds component library's value |
| 2026-05-10 | Adopt AI SDK `UIMessage` type | Industry-standard message format; eliminates custom format proliferation; future-proofs for potential AI SDK integration later |
| 2026-05-10 | Backend-only reconstruction | Single source of truth; frontend becomes pure renderer |

## Decision

Proceed with backend `UIMessage` normalization + frontend simplification.

**Next step**: Implement Phase 1 (backend converter + pipeline stage) behind feature flag, then run both old and new paths in parallel for validation.
