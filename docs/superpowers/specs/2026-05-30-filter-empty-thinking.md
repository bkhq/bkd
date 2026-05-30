# Design: Filter Empty Thinking Chunks

**Date:** 2026-05-30  
**Topic:** Claude Engine Empty Thinking Chunks  
**Status:** Approved

## Problem

Claude engine (via ACP/opencode adapter) emits multiple empty `agent_thought_chunk` entries before the actual assistant content. Each empty chunk creates a separate thinking segment in the timeline, resulting in multiple collapsed "thinking" blocks in the UI with no content inside.

## Root Cause

ACP normalizer converts `agent_thought_chunk` to `entryType: 'thinking'` entries. When Claude sends empty thinking content, these entries flow through timeline-converter and appear as empty thinking segments in the UI.

## Solution

Filter empty thinking chunks at two layers:

### 1. Backend (`timeline-converter.ts`)

In `ingest()`, drop thinking entries with empty/whitespace-only content before processing:

```typescript
if (type === 'thinking') {
  if (!entry.content.trim()) return []
  // ... normal processing
}
```

### 2. Frontend (`use-acp-timeline.ts`)

As a safety net, skip empty thinking entries during timeline rebuild:

```typescript
if (entry.type === 'thinking') {
  flushToolBuffer()
  if (entry.content.trim().length > 0) {
    pendingThinking = entry
  }
  continue
}
```

### 3. Test

Add test in `timeline-converter.test.ts` verifying empty thinking chunks are dropped.

## Files Changed

- `apps/api/src/engines/timeline-converter.ts`
- `apps/frontend/src/hooks/use-acp-timeline.ts`
- `apps/api/src/engines/timeline-converter.test.ts`

## Impact

- Empty thinking blocks no longer appear in UI
- Reduces SSE traffic and DB storage for empty chunks
- All engines benefit (not just Claude)
