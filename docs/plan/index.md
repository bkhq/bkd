# BKD - Plan Index

> Updated: 2026-10-13

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1440-add-endpoint Add endpoint**](20260907-1440-add-endpoint.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Draft / Pending review |
| `[-]`  | Approved / Implementing |
| `[x]`  | Completed |
| `[~]`  | Rejected / Abandoned |

### Rules

- Update or delete plan entries and their detail files as needed; keep them consistent.
- Record change history and deletion reasons in `docs/changelog.md`; update affected task and plan references.
- New plans append to the end.
- See each `<timestamp>-<feature-slug>.md` for full details.
- Plan IDs are UTC minute-precision timestamps plus a feature slug; do not allocate sequence numbers. Existing `PLAN-NNN` files stay valid under their current names.

---

## Plans

- [~] [**PLAN-001 Project whiteboard mindmap technical design**](PLAN-001.md) `2026-04-14`
- [~] [**PLAN-002 Whiteboard UI overhaul — edges, collapse badges, markdown**](PLAN-002.md) `2026-04-15`
- [~] [**PLAN-003 Migrate claude executor to @anthropic-ai/claude-agent-sdk**](PLAN-003.md) `2026-04-17`
- [~] [**PLAN-004 Enable AskUserQuestion in claude-code-sdk executor (web UI answer flow)**](PLAN-004.md) `2026-04-18`
- [x] [**PLAN-005 Remove whiteboard / mindmap feature**](PLAN-005.md) `2026-05-09`
- [x] [**PLAN-006 Upgrade launcher Bun runtime**](PLAN-006.md) `2026-05-11`
- [x] [**PLAN-007 Extend idle engine timeout**](PLAN-007.md) `2026-05-11`
- [x] [**PLAN-008 Preserve Codex tool actions for grouping**](PLAN-008.md) `2026-05-11`
- [x] [**PLAN-009 Allow unresolved webhook hostnames on save**](PLAN-009.md) `2026-05-11`
- [x] [**PLAN-010 Per-project default engine and model**](PLAN-010.md) `2026-05-15`
- [x] [**PLAN-011 fix-db CLI command on the main bkd entry**](PLAN-011.md) `2026-05-16`
- [x] [**PLAN-012 Virtual engines (claude-code executor + preset env vars)**](PLAN-012.md) `2026-05-22`
- [x] [**PLAN-013 Upgrade all workspace dependencies to latest**](PLAN-013.md) `2026-07-17`
- [x] [**PLAN-014 Add persistent cron job deletion**](PLAN-014.md) `2026-08-20`
- [ ] [**PLAN-015 Add one-click cron history cleanup**](PLAN-015.md) `2026-08-21`
- [x] [**PLAN-016 Observe Claude subagent (Task/Agent tool) activity**](PLAN-016.md) `2026-08-22`
- [x] [**PLAN-017 Global local session scanner and session-to-issue import**](PLAN-017.md) `2026-08-22`
- [x] [**PLAN-018 Migrate distribution and self-upgrade to lode**](PLAN-018.md) `2026-08-24`
- [x] [**PLAN-019 Upload files from the file browser**](PLAN-019.md) `2026-09-02`
- [x] [**PLAN-020 Stop serving soft-deleted cron jobs over the API**](PLAN-020.md) `2026-09-08`
- [x] [**PLAN-021 API and repository audit remediation**](PLAN-021.md) `2026-09-10`
- [x] [**20260910-0533-uploads-root-dir Resolve data paths from a single DATA_DIR**](20260910-0533-uploads-root-dir.md) `2026-09-10`
- [x] [**20260912-1945-project-tags Tag and filter projects by tag**](20260912-1945-project-tags.md) `2026-09-12`

- [x] [**20260912-2124-message-list-rendering Stabilize message-list layout and streaming updates**](20260912-2124-message-list-rendering.md) `2026-09-12`
- [x] [**20260909-0230-upgrade-dependencies Upgrade all workspace dependencies to latest**](20260909-0230-upgrade-dependencies.md) `2026-09-09`

- [x] [**20260922-1704-mobile-desktop-ui-parity Align mobile and desktop UI and finish the BKD rename**](20260922-1704-mobile-desktop-ui-parity.md) `2026-09-22`
- [x] [**20260923-1133-grok-engine Add Grok Build CLI as an engine**](20260923-1133-grok-engine.md) `2026-09-23`
- [x] [**20260924-0914-cursor-engine Add Cursor CLI as an engine**](20260924-0914-cursor-engine.md) `2026-09-24`
- [x] [**20261002-1007-engine-process-leak Kill engine processes that fail registration or the Codex handshake**](20261002-1007-engine-process-leak.md) `2026-10-02`
- [x] [**20261002-1111-worktree-reuse Keep worktree issues out of the main checkout**](20261002-1111-worktree-reuse.md) `2026-10-02`
- [x] [**20261002-1111-persist-permission-mode Persist the issue permission mode**](20261002-1111-persist-permission-mode.md) `2026-10-02`
- [x] [**20261011-0213-codex-failure-visibility Surface Codex turn failures and stop stall probes from ending Codex turns**](20261011-0213-codex-failure-visibility.md) `2026-10-11`
- [x] [**20261012-1547-lode-update-check Check for updates on demand and soften retried-error styling**](20261012-1547-lode-update-check.md) `2026-10-12`
- [x] [**20261012-2207-chat-message-layout Flatten chat headings, add an agent message surface, restore message actions**](20261012-2207-chat-message-layout.md) `2026-10-12`
- [x] [**20261013-0244-worktree-cleanup-on-delete Clean up worktrees of deleted issues and stop cleanup stats from timing out**](20261013-0244-worktree-cleanup-on-delete.md) `2026-10-13`
- [x] [**20261013-0540-chat-turn-navigator Add a turn navigator rail with hover previews to the chat area**](20261013-0540-chat-turn-navigator.md) `2026-10-13`
- [x] [**20261013-0553-turn-navigator-full-history Show every turn in the chat turn navigator, including unloaded history**](20261013-0553-turn-navigator-full-history.md) `2026-10-13`
- [x] [**20261013-1706-tickets Add tickets for decisions and user feedback**](20261013-1706-tickets.md) `2026-10-13`
- [x] [**20261013-1950-engine-protocol-drift Fix Claude and Codex wire-protocol drift**](20261013-1950-engine-protocol-drift.md) `2026-10-13`
- [x] [**20261013-2005-decision-capability-probe Add a decision-events capability probe and drop the bundled skill**](20261013-2005-decision-capability-probe.md) `2026-10-13`
- [x] [**20261013-2159-decision-telegram-interactive Answer decision events from Telegram**](20261013-2159-decision-telegram-interactive.md) `2026-10-13`
- [x] [**20261015-0201-issue-menu-and-list-drag Extend the issue menu, add list drag, tidy kanban column headers**](20261015-0201-issue-menu-and-list-drag.md) `2026-10-15`
- [x] [**20261015-0315-dnd-kit-board-restyle Move issue drag to dnd-kit and restyle the kanban board after bks**](20261015-0315-dnd-kit-board-restyle.md) `2026-10-15`
- [x] [**20261015-2352-issue-message-search Full-text search over issue messages**](20261015-2352-issue-message-search.md) `2026-10-15`
- [x] [**20261016-0320-upload-limit-progress Lift the 10 MB upload cap and show global upload progress**](20261016-0320-upload-limit-progress.md) `2026-10-16`
- [x] [**20261016-0424-streaming-multipart-upload Stream multipart uploads to disk instead of buffering**](20261016-0424-streaming-multipart-upload.md) `2026-10-16`
- [x] [**20261016-0448-background-task-as-subagent Background Bash tasks render as subagents in the chat**](20261016-0448-background-task-as-subagent.md) `2026-10-16`
- [x] [**20261016-1829-messages-system Upgrade decision events into a messages system**](20261016-1829-messages-system.md) `2026-10-16`
- [-] [**20261022-0307-skills-management Manage agent skills from the BKD UI**](20261022-0307-skills-management.md) `2026-10-22`
- [x] [**20261024-1445-backend-issue-order Order issues by the backend rule only**](20261024-1445-backend-issue-order.md) `2026-10-24`
- [x] [**20261024-1503-messages-drawer Show the messages inbox in a side drawer**](20261024-1503-messages-drawer.md) `2026-10-24`
