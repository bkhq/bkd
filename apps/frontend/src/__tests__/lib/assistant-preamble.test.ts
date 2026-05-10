import { describe, expect, it } from 'vitest'
import { splitAssistantPreamble } from '@/lib/assistant-preamble'

describe('splitAssistantPreamble', () => {
  it('splits opencode preamble from actual reply', () => {
    const content = `## Goal
- Validate profit report data semantics

## Constraints & Preferences
- Strict code alignment

## Progress
### Done
- Validated metrics

## 修改内容
### 1. 代码

实际回复内容...`

    const { preamble, reply } = splitAssistantPreamble(content)
    expect(preamble).toContain('## Goal')
    expect(preamble).toContain('## Constraints & Preferences')
    expect(preamble).toContain('## Progress')
    expect(preamble).not.toContain('## 修改内容')
    expect(reply.startsWith('## 修改内容')).toBe(true)
  })

  it('returns full content as reply when no preamble detected', () => {
    const content = '这是一段普通的回复，没有 Goal/Progress 这种 preamble'
    const { preamble, reply } = splitAssistantPreamble(content)
    expect(preamble).toBeNull()
    expect(reply).toBe(content)
  })

  it('does not split when only one preamble header present (too weak signal)', () => {
    // A single "## Goal" header could legitimately be part of the user's
    // reply (e.g. user asked about goals). Need at least 2 known sections.
    const content = '## Goal\n这是回答问题：你的目标是...'
    const { preamble, reply } = splitAssistantPreamble(content)
    expect(preamble).toBeNull()
    expect(reply).toBe(content)
  })

  it('handles preamble-only content (mid-stream, reply not yet emitted)', () => {
    const content = `## Goal
- doing thing

## Progress
### In Progress
- still working`
    const { preamble, reply } = splitAssistantPreamble(content)
    expect(preamble).toContain('## Goal')
    expect(preamble).toContain('## Progress')
    expect(reply).toBe('')
  })

  it('preserves H3 sub-headers within the reply', () => {
    const content = `## Goal
- x

## Constraints & Preferences
- y

## 实际回复
### 子标题1
content
### 子标题2
more content`
    const { preamble, reply } = splitAssistantPreamble(content)
    expect(preamble).not.toBeNull()
    expect(reply).toContain('### 子标题1')
    expect(reply).toContain('### 子标题2')
  })

  it('handles the full real captured turn 109 shape', () => {
    // Trimmed real example. If splitting breaks on this shape, users see
    // "thinking混在回复里" and complain — so this is the screenshot regression.
    const content = `## Goal
- Validate profit report data semantics, resolve discrepancy

## Constraints & Preferences
- Strict code alignment

## Progress
### Done
- A
- B
### In Progress
- C
### Blocked
- D

## Key Decisions
- decided X

## Next Steps
- next thing

## Critical Context
- ctx

## Relevant Files
- file1.py

## 修改内容
### 1. 代码 (\`profit_margin_report.py\`)
代码改了什么

### 2. 列名
列名改了什么

## 新的四列结构
| col | desc |
|---|---|
| a | b |

## 以 001号店超值套餐5 为例
最终结论。`

    const { preamble, reply } = splitAssistantPreamble(content)
    expect(preamble).not.toBeNull()
    // All preamble headers should be in the preamble, not the reply
    for (const h of [
      '## Goal',
      '## Constraints & Preferences',
      '## Progress',
      '## Key Decisions',
      '## Next Steps',
      '## Critical Context',
      '## Relevant Files',
    ]) {
      expect(preamble).toContain(h)
      expect(reply).not.toContain(h)
    }
    // All reply headers should be in the reply
    expect(reply).toContain('## 修改内容')
    expect(reply).toContain('## 新的四列结构')
    expect(reply).toContain('## 以 001号店超值套餐5 为例')
  })
})
