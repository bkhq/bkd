# PLAN-006 Backend Chat Normalization & Frontend Simplification

## Status

`implementing`

## Created

2026-05-09

## Context

BKD chat state management has become unmaintainable:
- 3 engine normalizers (ACP, Codex, MCP) each handle streaming differently
- Frontend `useAcpTimeline` (450 lines) and `useIssueStream` (600 lines) try to paper over the differences
- Result: bugs like duplicate thinking, noise fragments ("version"), wrong ordering, content concatenation

## Goals

1. Backend: All normalizers output a unified `TimelineEntry` format with strict guarantees
2. Frontend: Reduce state management from ~1050 lines to ~80 lines
3. UI: Keep existing components, just simplify data flow

## Non-Goals

- Not changing the database schema
- Not adding new UI features
- Not migrating to Vercel AI SDK or Assistant UI (decided against framework coupling)

## Proposal

### 1. Unified Timeline Protocol

Define `TimelineEntry` with these backend guarantees:

| Guarantee | Description |
|-----------|-------------|
| **Monotonicity** | Same `id` updates always contain previous content (or complete replacement) |
| **Deduplication** | One `thinking` + one `assistant` per turn |
| **Ordering** | `entry_index` order, within turn: thinking → tool → assistant |
| **Noise filter** | `< 10` char pure-word entries dropped at normalizer |
| **Stable IDs** | `turn-{n}-thinking`, `turn-{n}-assistant` |

### 2. Backend Changes

**ACP Normalizer:**
- Accumulate `agent_thought_chunk` into `turnState.thinking`
- Accumulate `agent_message_chunk` into `turnState.assistant`
- Output `TimelineEntry` with stable IDs on every chunk
- On `acp-prompt-result`, mark `completed: true`

**Codex Normalizer:**
- Accumulate `item/reasoning/textDelta` into `turnState.thinking`
- Accumulate `item/agentMessage/delta` into `turnState.assistant`
- Same stable ID scheme
- On `turn/completed`, mark `completed: true`

### 3. Frontend Changes

**Delete `useAcpTimeline`** — no longer needed.

**Rewrite `useIssueStream`:**
```typescript
function useIssueStream(options) {
  const [live, setLive] = useState<TimelineEntry[]>([])
  
  // Load history
  const { data: history } = useQuery(...)
  
  // SSE: simple id-based replace
  useEffect(() => {
    const es = new EventSource(url)
    es.onmessage = e => {
      const entry = JSON.parse(e.data)
      setLive(prev => {
        const idx = prev.findIndex(x => x.id === entry.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = entry
          return next
        }
        return [...prev, entry]
      })
    }
    return () => es.close()
  }, [])
  
  // Merge: Map by id, live wins
  const logs = useMemo(() => {
    const map = new Map(history?.map(e => [e.id, e]) ?? [])
    for (const e of live) map.set(e.id, e)
    return Array.from(map.values()).sort(compareById)
  }, [history, live])
  
  return { logs }
}
```

### 4. UI Component Changes

Minimal — just update prop types from `NormalizedLogEntry` to `TimelineEntry`.

## Risks

| Risk | Mitigation |
|------|-----------|
| Normalizer accumulation bugs | Unit tests for each engine covering full streaming lifecycle |
| Historical data compatibility | API layer converts old format; or add migration |
| Real-time latency | Accumulation is in-memory, < 1ms overhead |
| Tool call pairing | Keep existing `toolCallId` pairing logic in normalizer |

## Scope

- `apps/api/src/engines/executors/acp/normalizer.ts`
- `apps/api/src/engines/executors/codex/normalizer.ts`
- `apps/frontend/src/hooks/use-issue-stream.ts`
- `apps/frontend/src/hooks/use-acp-timeline.ts` (delete)
- `apps/api/src/engines/types.ts`
- Tests

## Timeline

| Phase | Work | Days |
|-------|------|------|
| Phase 1 | Define `TimelineEntry` type + protocol doc | 0.5 |
| Phase 2 | Refactor ACP normalizer | 1 |
| Phase 3 | Refactor Codex normalizer | 1 |
| Phase 4 | Frontend: rewrite `useIssueStream`, delete `useAcpTimeline` | 1 |
| Phase 5 | Regression testing (ACP, Codex, refresh, interrupt) | 1 |
| **Total** | | **4.5** |

## Alternatives Considered

- **Vercel AI SDK**: Rejected — architecture model mismatch (BKD is subprocess-driven, not chat-driven)
- **Assistant UI**: Rejected — components tightly coupled to runtime, adaptation cost > benefit
- **Keep patching**: Rejected — bug surface too large, 2600 lines of state management is unmaintainable

## Decision

Proceed with backend normalization + frontend simplification.
