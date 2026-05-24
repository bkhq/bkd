# BKD - Task List

> Updated: 2026-05-12 (CHAT-007, CHAT-008)

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
- [x] [**CHAT-004 Floating current-prompt hint while scrolling chat history**](CHAT-004.md) `P2`
- [x] [**CHAT-005 Pin TimelineEntry sequence on same-id upsert**](CHAT-005.md) `P1`
- [x] [**FILE-002 Clickable file path chips in chat with quick file preview drawer**](FILE-002.md) `P1`
- [x] [**UI-001 ChatInput toolbar density refactor**](UI-001.md) `P1`
- [x] [**UI-002 Design token primitives: IconButton, Chip, chip-surface**](UI-002.md) `P1`
- [x] [**CHAT-006 Mermaid diagram zoom viewer**](CHAT-006.md) `P2`
- [x] [**CHAT-007 Mobile auto-load older history reliability fixes**](CHAT-007.md) `P1`
- [x] [**CHAT-008 Kill duplicate user-message renders + raise bubble contrast**](CHAT-008.md) `P1`
- [x] [**COCKPIT-001 Global cockpit page skeleton via /review upgrade**](COCKPIT-001.md) `P1`
- [x] [**COCKPIT-A1 Cockpit AI assistant (read-only) + responsive cockpit**](COCKPIT-A1.md) `P1`
- [x] [**COCKPIT-A2 Cockpit AI write tools with approval gate**](COCKPIT-A2.md) `P1`
- [x] [**COCKPIT-002 Cross-project full-text log search (FTS5)**](COCKPIT-002.md) `P2`
- [x] [**COCKPIT-A3 Cockpit assistant session reset + suggested prompts**](COCKPIT-A3.md) `P2`
- [x] [**COCKPIT-003 Bulk operations on review list**](COCKPIT-003.md) `P1`
- [x] [**COCKPIT-004 Issue templates in create dialog**](COCKPIT-004.md) `P2`
- [x] [**COCKPIT-005 Diff hover preview on done cards**](COCKPIT-005.md) `P2`
- [-] [**COCKPIT-006 Cockpit reachability upgrade (TopBar, RecentTabs, MiniMatrix, ⌘K, QuickCreate)**](COCKPIT-006.md) `P1`
- [x] [**SEARCH-001 In-chat full-text search with CJK-friendly tokenizer**](SEARCH-001.md) `P1`
- [-] [**COCKPIT-007 Replace cockpit Overview with always-on bot timeline**](COCKPIT-007.md) `P1`
- [x] [**FORK-001 One-click fork current issue into a new spawned issue**](FORK-001.md) `P1`
- [x] [**BUG-002 Worktree creation fails on repos without main/master**](BUG-002.md) `P1`
- [x] [**UPGRADE-001 Graceful drain before upgrade restart**](UPGRADE-001.md) `P1`
- [x] [**UPGRADE-002 Apply a locally-installed app package via the graceful drain path**](UPGRADE-002.md) `P1`
- [-] [**COCKPIT-008 Cockpit secretary — AI-enriched decision cards + decision-stream UI**](COCKPIT-008.md) `P1`
- [x] [**BUG-003 Fix create issue and process manager access in cockpit (ReviewPage)**](BUG-003.md) `P0`
