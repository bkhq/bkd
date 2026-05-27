# Design: Nested Thinking + Tool Context Labels

**Date:** 2026-05-27  
**Topic:** ACP Timeline Thinking Block Rendering  
**Status:** Approved

## Problem Statement

In the ACP (opencode) engine timeline, `thinking` blocks are rendered as independent messages before `assistant` messages. This creates two UX issues:

1. **Visual fragmentation**: The thinking block looks like a separate AI message, disconnecting it from the assistant reply that follows.
2. **Missing tool context**: When the model invokes tools, users cannot see the reasoning/thought process that led to the tool call because the thinking content is either hidden in a collapsed block or contains preamble content ("recap", "summary") instead of actual reasoning.

Root cause: Opencode (and underlying models) do not consistently separate reasoning from reply content. Different models (Claude, GPT, Gemini) handle `agent_thought_chunk` vs `agent_message_chunk` differently. This is an engine-layer issue that BKD cannot fix at the source.

## Design Goal

As an application-layer fix, BKD should render thinking blocks as **part of their associated assistant/tool message** rather than independent messages. This creates a cohesive visual unit while preserving the thinking content for users who want to inspect it.

## Architecture

### Before
```
thinking (independent item)
assistant (independent item)
tool-group (independent item)
```

### After
```
entry [thinking + assistant]  → thinking nested inside assistant message
tool-group [thinking + tools] → thinking summary shown above tool card
```

### Files Changed
- `apps/frontend/src/hooks/use-acp-timeline.ts` — Rebuild logic
- `apps/frontend/src/components/issue-detail/AcpTimeline.tsx` — Render logic
- `apps/frontend/src/components/issue-detail/LogEntry.tsx` — Minor style adjustments

No backend changes. Legacy path (`use-chat-messages.ts`) unchanged.

## Data Model

### Type Changes

```typescript
// use-acp-timeline.ts
export interface AcpTimelineEntryItem {
  type: 'entry'
  id: string
  entry: NormalizedLogEntry
  thinking?: NormalizedLogEntry  // Attached preceding thinking
}

export interface AcpTimelineToolGroupItem {
  type: 'tool-group'
  id: string
  message: ToolGroupChatMessage
  thinking?: NormalizedLogEntry  // Attached preceding thinking
}
```

### Rebuild Logic

```typescript
function rebuildAcpTimeline(entries: TimelineEntry[]): AcpTimelineResult {
  // ... existing setup ...
  let pendingThinking: NormalizedLogEntry | null = null

  for (const entry of entries) {
    if (isHiddenEntry(entry)) continue

    // Pending messages pass through unchanged
    if (entry.entryType === 'user-message' && (entry.metadata?.type === 'pending' || entry.metadata?.type === 'done')) {
      pendingMessages.push(entry)
      continue
    }

    // Cache thinking, don't emit as independent item
    if (entry.type === 'thinking') {
      flushToolBuffer()
      pendingThinking = entry
      continue
    }

    if (entry.type === 'tool') {
      // ... existing tool handling ...
      continue
    }

    if (entry.entryType === 'system-message' && entry.metadata?.subtype === 'plan') {
      // ... existing plan handling ...
      continue
    }

    flushToolBuffer()

    // Attach cached thinking to the next meaningful item
    const attachedThinking = pendingThinking ?? undefined
    pendingThinking = null

    items.push({ type: 'entry', id: entry.id, entry, thinking: attachedThinking })
  }

  flushToolBuffer()
  // If any thinking remains at end, flush as standalone fallback
  if (pendingThinking) {
    items.push({ type: 'thinking', id: pendingThinking.id, entry: pendingThinking, isStreaming: false })
  }

  return { items, pendingMessages }
}
```

## Rendering

### Assistant Message with Nested Thinking

```tsx
// AcpTimeline.tsx
case 'entry':
  return (
    <div className="group">
      {item.thinking && (
        <div className="mb-1">
          <CompletedThinking entry={item.thinking} />
        </div>
      )}
      <LogEntry entry={item.entry} />
    </div>
  )
```

The `CompletedThinking` component (existing) renders as a collapsible block with violet theme. When nested inside the assistant message container, it visually belongs to that message rather than floating as an orphan.

### Tool Group with Thinking Context

```tsx
// AcpTimeline.tsx
case 'tool-group':
  return (
    <div className="group">
      {item.thinking && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-violet-500/50 dark:text-violet-400/50">
          <Lightbulb className="h-3 w-3" />
          <span className="truncate">
            {item.thinking.content.slice(0, 80)}
            {item.thinking.content.length > 80 ? '...' : ''}
          </span>
        </div>
      )}
      <ToolGroupMessage message={item.message} />
    </div>
  )
```

The tool group shows a single-line summary of the preceding thinking as context for why the tools were invoked.

### Visual Result

```
User: 两个都要
┌─────────────────────────────────────┐
│ 🤖 AI                               │
│ ┌─────────────────────────────────┐ │
│ │ 💭 思考过程 ▼                   │ │
│ │   好，继续复盘。补充结果回写...   │ │
│ └─────────────────────────────────┘ │
│                                     │
│ 完整设计：Issue-Role 协作...          │
└─────────────────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│ 🔧 工具调用 (2)                     │
│ 💭 让我先检查当前代码结构...         │
│   📄 Read: src/db/schema.ts         │
│   🖥️ Bash: grep -r "result" src/   │
└─────────────────────────────────────┘
```

## Edge Cases

1. **Orphan thinking at turn end**: If a turn ends with only a thinking block (no subsequent assistant/tool), the thinking is flushed as a standalone item (fallback behavior preserved).
2. **Multiple consecutive thinkings**: Later thinking overwrites earlier cached thinking. In practice, a tool burst or assistant typically has one preceding thinking segment.
3. **Streaming updates**: As thinking content streams in, the attached thinking entry updates in real-time because the timeline rebuild runs on every log change.
4. **Empty thinking**: Empty thinking blocks are skipped and not attached.

## Testing Plan

- Add unit tests in `use-acp-timeline.test.tsx` for:
  - thinking attached to assistant
  - thinking attached to tool-group
  - orphan thinking flushed as standalone
  - multiple consecutive thinkings (last wins)
- Update `AcpTimeline.test.tsx` for new rendering structure
- Visual regression: screenshot test for nested thinking layout

## Trade-offs

| Aspect | Before | After |
|--------|--------|-------|
| Visual cohesion | Poor (independent messages) | Good (unified message unit) |
| Tool context | None | Thinking summary shown |
| Information loss | None | None (thinking still accessible) |
| Implementation complexity | Low | Medium |
| Model dependency | High | Reduced (works regardless of model behavior) |

## Next Steps

1. Implement `use-acp-timeline.ts` changes
2. Implement `AcpTimeline.tsx` rendering changes
3. Add/update tests
4. Visual polish ("整漂亮点" — refine spacing, colors, animations)
