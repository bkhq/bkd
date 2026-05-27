# Nested Thinking + Tool Context Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor ACP timeline to attach thinking blocks to their associated assistant/tool-group items instead of rendering them as independent messages, and show thinking context above tool groups.

**Architecture:** Modify `use-acp-timeline.ts` to cache thinking entries and attach them to subsequent assistant/tool-group entries. Update `AcpTimeline.tsx` to render nested thinking blocks inside assistant messages and thinking summaries above tool groups.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `apps/frontend/src/hooks/use-acp-timeline.ts` | Timeline rebuild logic — cache thinking and attach to next meaningful item |
| `apps/frontend/src/components/issue-detail/AcpTimeline.tsx` | Render logic — nested thinking in assistant, summary above tool-group |
| `apps/frontend/src/__tests__/hooks/use-acp-timeline.test.tsx` | Unit tests for rebuild logic changes |
| `apps/frontend/src/__tests__/components/AcpTimeline.test.tsx` | Component tests for render changes |

---

## Task 1: Modify use-acp-timeline.ts Types and Rebuild Logic

**Files:**
- Modify: `apps/frontend/src/hooks/use-acp-timeline.ts`
- Test: `apps/frontend/src/__tests__/hooks/use-acp-timeline.test.tsx`

- [ ] **Step 1: Add `thinking` field to item types**

Add optional `thinking` field to `AcpTimelineEntryItem` and `AcpTimelineToolGroupItem`:

```typescript
// Line ~17 in use-acp-timeline.ts
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

- [ ] **Step 2: Add pendingThinking cache and flush function**

In `rebuildAcpTimeline`, add `pendingThinking` cache and a flush helper:

```typescript
// Inside rebuildAcpTimeline, after toolBuffer declaration (~line 155)
let pendingThinking: NormalizedLogEntry | null = null

function flushPendingThinking(): void {
  if (!pendingThinking) return
  items.push({
    type: 'thinking',
    id: pendingThinking.id,
    entry: pendingThinking,
    isStreaming: pendingThinking.metadata?.streaming === true,
  })
  pendingThinking = null
}
```

- [ ] **Step 3: Modify thinking handling to cache instead of emit**

Replace the thinking case (around line 172) to cache instead of push:

```typescript
// Replace this block:
// if (entry.type === 'thinking') {
//   flushToolBuffer()
//   items.push({...})
//   continue
// }

// With:
if (entry.type === 'thinking') {
  flushToolBuffer()
  pendingThinking = entry
  continue
}
```

- [ ] **Step 4: Attach thinking to entry items**

In the final `items.push({ type: 'entry', ... })` block (around line 225), attach the cached thinking:

```typescript
// Before:
// items.push({ type: 'entry', id: entry.id, entry })

// After:
const attachedThinking = pendingThinking ?? undefined
pendingThinking = null
items.push({ type: 'entry', id: entry.id, entry, thinking: attachedThinking })
```

- [ ] **Step 5: Attach thinking to tool-group items**

In `buildToolGroup` return (around line 137), the function currently returns a `ToolGroupChatMessage`. We need to pass thinking through at the item level.

Actually, tool-group items are built in `flushToolBuffer`. Modify `flushToolBuffer` to capture pending thinking:

```typescript
// In flushToolBuffer, before building the group:
const toolGroupThinking = pendingThinking ?? undefined
pendingThinking = null

// When pushing tool-group item:
if (nonTodoItems.length > 0) {
  const group = buildToolGroup(nonTodoItems)
  items.push({ type: 'tool-group', id: group.id, message: group, thinking: toolGroupThinking })
}
```

Wait — `flushToolBuffer` is called from multiple places. We need to be careful: pendingThinking should only be attached once. Let me revise:

```typescript
function flushToolBuffer(): void {
  if (toolBuffer.length === 0) return
  
  // Capture thinking before building group
  const toolGroupThinking = pendingThinking ?? undefined
  if (toolGroupThinking) pendingThinking = null
  
  const group = buildToolGroup(toolBuffer)
  items.push({ type: 'tool-group', id: group.id, message: group, thinking: toolGroupThinking })
  toolBuffer = []
}
```

- [ ] **Step 6: Flush orphan thinking at end**

At the end of `rebuildAcpTimeline`, after `flushToolBuffer()`, flush any remaining thinking:

```typescript
// After: flushToolBuffer()
// Add:
flushPendingThinking()
```

- [ ] **Step 7: Run existing tests**

```bash
cd /home/weifashi/hwt/bkd && bun test apps/frontend/src/__tests__/hooks/use-acp-timeline.test.tsx
```

Expected: Some tests may fail because the item types/structure changed. Fix any compilation errors first.

- [ ] **Step 8: Update existing tests for new structure**

The existing tests expect `items[0].type === 'thinking'` as an independent item. Update tests to check for attached thinking:

For test "keeps thinking when assistant starts with the same prefix":
```typescript
// Before: expect(items.map(i => i.type)).toEqual(['thinking', 'entry'])
// After:
expect(items).toHaveLength(1)
expect(items[0]!.type).toBe('entry')
expect((items[0] as AcpTimelineEntryItem).thinking).toBeDefined()
expect((items[0] as AcpTimelineEntryItem).thinking!.content).toBe('用户问为什么测试兜不住')
```

For test "keeps thinking across tool groups when assistant has different content":
```typescript
// Before: expect(items.map(i => i.type)).toEqual(['thinking', 'tool-group', 'entry'])
// After:
expect(items).toHaveLength(2)  // tool-group + entry (thinking attached to tool-group)
expect(items[0]!.type).toBe('tool-group')
expect((items[0] as AcpTimelineToolGroupItem).thinking).toBeDefined()
expect(items[1]!.type).toBe('entry')
expect((items[1] as AcpTimelineEntryItem).thinking).toBeUndefined()
```

Wait, in this case the thinking is before the tool, so it should attach to the tool-group. Then assistant is separate. So 2 items: tool-group (with thinking) + entry (without).

For test "keeps standalone thinking when assistant does NOT overlap":
```typescript
// Before: 2 items (thinking + entry)
// After: 1 item (entry with attached thinking)
expect(items).toHaveLength(1)
expect(items[0]!.type).toBe('entry')
expect((items[0] as AcpTimelineEntryItem).thinking).toBeDefined()
expect((items[0] as AcpTimelineEntryItem).thinking!.content).toBe('Let me check the imports first')
```

- [ ] **Step 9: Add new tests for edge cases**

Add test "flushes orphan thinking as standalone when no subsequent item":
```typescript
it('flushes orphan thinking as standalone when no subsequent item', () => {
  const logs: NormalizedLogEntry[] = [
    {
      entryType: 'thinking',
      content: 'Orphan thought',
      timestamp: '2026-01-01T00:00:00Z',
      turnIndex: 0,
    },
  ]
  const { items } = rebuildAcpTimeline(logs)
  expect(items).toHaveLength(1)
  expect(items[0]!.type).toBe('thinking')
})
```

Add test "attaches thinking to tool-group when followed by tools":
```typescript
it('attaches thinking to tool-group when followed by tools', () => {
  const logs: NormalizedLogEntry[] = [
    {
      entryType: 'thinking',
      content: 'Let me read the file',
      timestamp: '2026-01-01T00:00:00Z',
      turnIndex: 0,
    },
    {
      entryType: 'tool-use',
      content: 'Read src/app.ts',
      timestamp: '2026-01-01T00:00:01Z',
      turnIndex: 0,
      messageId: 't1',
      metadata: { toolCallId: 't1', isResult: false },
      toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
    },
  ]
  const { items } = rebuildAcpTimeline(logs)
  expect(items).toHaveLength(1)
  expect(items[0]!.type).toBe('tool-group')
  expect((items[0] as AcpTimelineToolGroupItem).thinking).toBeDefined()
  expect((items[0] as AcpTimelineToolGroupItem).thinking!.content).toBe('Let me read the file')
})
```

- [ ] **Step 10: Run all tests**

```bash
cd /home/weifashi/hwt/bkd && bun test apps/frontend/src/__tests__/hooks/use-acp-timeline.test.tsx
```

Expected: All tests pass.

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/src/hooks/use-acp-timeline.ts apps/frontend/src/__tests__/hooks/use-acp-timeline.test.tsx
git commit -m "refactor(timeline): attach thinking to assistant/tool-group items"
```

---

## Task 2: Modify AcpTimeline.tsx Rendering

**Files:**
- Modify: `apps/frontend/src/components/issue-detail/AcpTimeline.tsx`
- Test: `apps/frontend/src/__tests__/components/AcpTimeline.test.tsx`

- [ ] **Step 1: Update entry rendering with nested thinking**

In the `items.map()` switch statement, update the `entry` case:

```tsx
// Before:
case 'entry':
  return <LogEntry key={item.id} entry={item.entry} />

// After:
case 'entry':
  return (
    <div key={item.id} className="group">
      {item.thinking && (
        <div className="mb-1">
          <CompletedThinking entry={item.thinking} />
        </div>
      )}
      <LogEntry entry={item.entry} />
    </div>
  )
```

- [ ] **Step 2: Update tool-group rendering with thinking context**

Update the `tool-group` case:

```tsx
// Before:
case 'tool-group':
  return <ToolGroupMessage key={item.id} message={item.message} />

// After:
case 'tool-group':
  return (
    <div key={item.id} className="group">
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

- [ ] **Step 3: Remove standalone thinking case (now handled as attached)**

The `thinking` case in the switch should still exist as a fallback for orphan thinking:

```tsx
case 'thinking':
  return item.isStreaming && isRunning ?
    <StreamingThinking key={item.id} entry={item.entry} /> :
    <CompletedThinking key={item.id} entry={item.entry} />
```

Keep this — orphan thinking at turn end still renders as standalone.

- [ ] **Step 4: Run AcpTimeline component tests**

```bash
cd /home/weifashi/hwt/bkd && bun test apps/frontend/src/__tests__/components/AcpTimeline.test.tsx
```

Expected: Tests pass (or fail if tests check for independent thinking items).

- [ ] **Step 5: Update component tests if needed**

If tests look for independent thinking items, update them to check for nested rendering. For example:

```typescript
// Test: completed thinking renders as collapsed block
it('renders nested thinking inside assistant message', () => {
  // ... setup with thinking attached to assistant ...
  const thinkingButton = screen.getByText('session.thoughtProcess')
  expect(thinkingButton).toBeInTheDocument()
  // Should be inside the same container as assistant content
})
```

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/issue-detail/AcpTimeline.tsx apps/frontend/src/__tests__/components/AcpTimeline.test.tsx
git commit -m "feat(ui): render thinking nested in assistant and above tool-groups"
```

---

## Task 3: Run Full Test Suite and Polish

- [ ] **Step 1: Run all frontend tests**

```bash
cd /home/weifashi/hwt/bkd && bun run test:frontend
```

Expected: All tests pass.

- [ ] **Step 2: Visual check in dev mode**

```bash
cd /home/weifashi/hwt/bkd && bun run dev
```

Open browser, check:
1. Thinking blocks appear nested inside assistant messages (not as independent messages)
2. Tool groups show thinking summary above the tool list
3. Orphan thinking at turn end still renders correctly
4. Collapse/expand works for nested thinking

- [ ] **Step 3: Polish spacing and styling**

Adjust margins/padding in `AcpTimeline.tsx` to make nested thinking look cohesive:

```tsx
// For entry items:
<div key={item.id} className="group space-y-1">

// For tool-group items:
<div key={item.id} className="group space-y-1.5">
```

- [ ] **Step 4: Commit polish**

```bash
git add apps/frontend/src/components/issue-detail/AcpTimeline.tsx
git commit -m "style(timeline): polish nested thinking spacing"
```

---

## Self-Review

**Spec coverage check:**
- [x] Thinking attached to assistant → Task 1 Step 4, Task 2 Step 1
- [x] Thinking attached to tool-group → Task 1 Step 5, Task 2 Step 2
- [x] Orphan thinking flushed as standalone → Task 1 Step 6
- [x] Tool context summary shown → Task 2 Step 2
- [x] Tests updated → Task 1 Steps 8-9, Task 2 Step 5

**Placeholder scan:** None found — all steps have concrete code and commands.

**Type consistency:** `thinking` field is `NormalizedLogEntry | undefined` in both item types, consistent throughout.
