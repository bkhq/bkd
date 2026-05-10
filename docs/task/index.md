# BKD - Task List

> Updated: 2026-05-10

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/PREFIX-NNN.md`.

### Format

- [ ] [**PREFIX-001 Short imperative title**](PREFIX-001.md) `P1`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Pending |
| `[-]`  | In progress |
| `[x]`  | Completed |
| `[~]`  | Closed / Won't do |

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Only update the checkbox marker; never delete the line.
- New tasks append to the end.
- See each `PREFIX-NNN.md` for full details.

---

## Tasks

- [x] [**DOCS-001 Add BKD skill installation note to README**](DOCS-001.md) `P2`
- [-] [**WB-001 Implement project-level AI-driven mindmap whiteboard**](WB-001.md) `P1`
- [-] [**WB-002 Improve whiteboard node UI, edges, and markdown rendering**](WB-002.md) `P1`
- [x] [**WB-003 Refactor whiteboard AI: hidden sessions + MCP tools**](WB-003.md) `P1`
- [x] [**WB-004 Whiteboard manual editing UX fixes**](WB-004.md) `P1`
- [-] [**ENG-001 Migrate claude executor to @anthropic-ai/claude-agent-sdk**](ENG-001.md) `P2`
- [ ] [**ENG-002 Enable AskUserQuestion in claude-code-sdk executor**](ENG-002.md) `P2`
- [x] [**BUG-001 Fix OpenCode hanging without error on quota exhaustion**](BUG-001.md) `P1`
- [-] [**CHAT-001 Backend normalization & frontend simplification**](CHAT-001.md) `P0`
- [x] [**CHAT-002 Fix chat UI ordering root causes and close test invariant gaps**](CHAT-002.md) `P0`
- [x] [**FILE-001 Lift attachment upload limit and add upload progress UX**](FILE-001.md) `P1`
- [x] [**CHAT-003 Eliminate OpenCode double-emit assistant/thinking bubbles**](CHAT-003.md) `P1`
