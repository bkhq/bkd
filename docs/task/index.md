# BKD - Task List

> Updated: 2026-10-13

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1428-add-endpoint Add endpoint**](20260907-1428-add-endpoint.md) `P1`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Pending |
| `[-]`  | In progress |
| `[x]`  | Completed |
| `[~]`  | Closed / Won't do |

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Update or delete task entries and their detail files as needed; keep them consistent.
- Record change history and deletion reasons in `docs/changelog.md`; update affected dependency and plan references.
- New tasks append to the end.
- See each `<timestamp>-<feature-slug>.md` for full details.
- Task IDs are UTC minute-precision timestamps plus a feature slug; do not allocate category or sequence numbers. Existing `PREFIX-NNN` files stay valid under their current names.

---

## Tasks

- [x] [**DOCS-001 Add BKD skill installation note to README**](DOCS-001.md) `P2`
- [~] [**WB-001 Implement project-level AI-driven mindmap whiteboard**](WB-001.md) `P1`
- [~] [**WB-002 Improve whiteboard node UI, edges, and markdown rendering**](WB-002.md) `P1`
- [~] [**WB-003 Refactor whiteboard AI: hidden sessions + MCP tools**](WB-003.md) `P1`
- [~] [**WB-004 Whiteboard manual editing UX fixes**](WB-004.md) `P1`
- [~] [**ENG-001 Migrate claude executor to @anthropic-ai/claude-agent-sdk**](ENG-001.md) `P2`
- [~] [**ENG-002 Enable AskUserQuestion in claude-code-sdk executor**](ENG-002.md) `P2`
- [x] [**ENG-003 Remove ACP engine**](ENG-003.md) `P2`
- [x] [**AUTH-001 Remove OIDC authentication**](AUTH-001.md) `P2`
- [x] [**WB-005 Remove whiteboard / mindmap feature**](WB-005.md) `P1`
- [x] [**REL-001 Upgrade launcher Bun runtime**](REL-001.md) `P1`
- [x] [**ENG-004 Extend idle engine timeout**](ENG-004.md) `P2`
- [x] [**ENG-005 Preserve Codex tool actions for grouping**](ENG-005.md) `P1`
- [x] [**ENG-006 Allow unresolved webhook hostnames on save**](ENG-006.md) `P1`
- [x] [**ENG-007 Remove claude-code-sdk engine**](ENG-007.md) `P2`
- [x] [**ENG-008 Add per-project default engine and model**](ENG-008.md) `P2`
- [x] [**ENG-009 Guard drizzle migration/snapshot consistency**](ENG-009.md) `P3`
- [x] [**UI-001 Enable session pin in the issue list panel**](UI-001.md) `P2`
- [x] [**CLI-001 Add a `fix-db` CLI command to the main bkd entry**](CLI-001.md) `P1`
- [x] [**CLI-002 Make launcher --fix-db reuse the shared repair implementation**](CLI-002.md) `P2`
- [x] [**ENG-010 Fix non-monotonic migration journal (0020) + harden fix-db**](ENG-010.md) `P0`
- [x] [**ENG-011 Generic schema safety-net (snapshot-driven self-heal)**](ENG-011.md) `P1`
- [x] [**ENG-012 Create dialog ignores project-level default engine**](ENG-012.md) `P1`
- [x] [**UI-002 Support attachments and image paste in create-issue dialog**](UI-002.md) `P1`
- [x] [**CRON-001 Expose manual pause/resume for cron jobs in the UI**](CRON-001.md) `P2`
- [x] [**ENG-013 Add virtual engines (claude-code + preset env vars)**](ENG-013.md) `P2`
- [x] [**DEV-001 Consolidate dev env onto a single root .env (nsl dev)**](DEV-001.md) `P2`
- [x] [**ENG-014 Virtual engines: dynamic model discovery via provider /v1/models**](ENG-014.md) `P2`
- [x] [**ENG-015 Virtual engines: accept virtual ids in engine settings routes**](ENG-015.md) `P2`
- [x] [**ENG-016 Fix: startup schema self-heal never fires (computeMissing detects 0 tables)**](ENG-016.md) `P1`
- [x] [**ENG-017 Fix PID-lock false "another instance running" on PID reuse**](ENG-017.md) `P1`
- [x] [**ENG-018 Extract base64 image data-URIs from engine messages to attachments**](ENG-018.md) `P1`
- [x] [**ENG-019 Normalize assistant image content blocks (Bifrost) to attachments**](ENG-019.md) `P1`
- [x] [**UI-003 Use nanoid id as the only resource identifier in URLs and API**](UI-003.md) `P2`
- [x] [**ENG-020 Add Claude subscription usage panel in settings**](ENG-020.md) `P2`
- [x] [**DEV-002 Upgrade all workspace dependencies to latest**](DEV-002.md) `P2`
- [x] [**DEV-003 Replace @nsio/nsl with @dotns/nsl**](DEV-003.md) `P3`
- [x] [**ENG-021 Show model-scoped (Fable) usage windows in settings usage panel**](ENG-021.md) `P2`
- [x] [**ENG-022 Fix per-issue token/cost totals parsing (Claude + Codex)**](ENG-022.md) `P1`
- [x] [**ENG-023 Align Codex executor with app-server 0.144.x protocol schema**](ENG-023.md) `P1`
- [x] [**ENG-024 Display per-issue token usage totals**](ENG-024.md) `P1`
- [x] [**ENG-025 Resolve auto/unknown model to engine default at execution time**](ENG-025.md) `P1`
- [x] [**ENG-026 Show live context-window usage for claude-code issues**](ENG-026.md) `P2`
- [x] [**ENG-027 Codex follow-up loses thread config on thread/resume**](ENG-027.md) `P0`
- [x] [**ENG-028 Codex protocol conformance gaps (0.144.x)**](ENG-028.md) `P1`
- [x] [**ENG-029 Engine probe cache never expires (stale Codex model catalog)**](ENG-029.md) `P1`
- [x] [**ENG-030 Claude auth status is wrong on macOS; stale binary paths survive in cache**](ENG-030.md) `P2`
- [x] [**CRON-002 Add persistent cron job deletion to the UI**](CRON-002.md) `P1`
- [-] [**CRON-003 Add one-click cron history cleanup**](CRON-003.md) `P1`
- [x] [**ENG-031 Observe Claude subagent activity in issue chat**](ENG-031.md) `P1`
- [x] [**SES-001 Scan local engine sessions and import them as issues**](SES-001.md) `P1`
- [x] [**SES-002 Hide managed sessions and add a session detail view**](SES-002.md) `P2`
- [x] [**REL-002 Publish lode-compatible signed release assets**](REL-002.md) `P1`
- [x] [**REL-003 Replace the self-upgrade subsystem with the lode SDK**](REL-003.md) `P1`
- [x] [**REL-004 Add a lode migration script and deployment guide**](REL-004.md) `P1`
- [x] [**SES-003 Make the session detail panel a resizable drawer**](SES-003.md) `P2`
- [x] [**UI-004 Unify the panel resize handle**](UI-004.md) `P2`
- [x] [**UI-005 Unify duplicated display formatters**](UI-005.md) `P2`
- [x] [**UI-006 Extract a shared side panel shell**](UI-006.md) `P2`
- [x] [**ENG-032 Fix subagent activity never reaching the chat**](ENG-032.md) `P0`
- [x] [**CI-001 Clear the Node 20 deprecation warning in CI**](CI-001.md) `P3`
- [x] [**CI-002 Make the Typecheck job pass on main**](CI-002.md) `P1`
- [x] [**CI-003 Gate releases on CI**](CI-003.md) `P1`
- [x] [**DOC-001 Bring the READMEs back in line with the lode install**](DOC-001.md) `P1`
- [x] [**DOC-002 Serve lode.toml from the repository instead of every release**](DOC-002.md) `P3`
- [x] [**ENG-033 Stop rendering the CLI activity indicator as chat messages**](ENG-033.md) `P2`
- [x] [**DOC-003 Drop the remaining doc assets from releases**](DOC-003.md) `P3`
- [x] [**SES-004 Delete local sessions from the scan list**](SES-004.md) `P2`
- [x] [**REL-005 Close the release window where latest has no assets**](REL-005.md) `P0`
- [x] [**ENG-034 Stop probing the Claude CLI on every execution**](ENG-034.md) `P1`
- [x] [**ENG-035 Probe engines on demand only, never on a timer**](ENG-035.md) `P1`
- [x] [**ENG-036 Turn settlement misreads subagent and background-task signals**](ENG-036.md) `P1`
- [x] [**UI-007 Upload files from the file browser**](UI-007.md) `P2`
- [x] [**CRON-004 Stop serving soft-deleted cron jobs over the API**](CRON-004.md) `P1`
- [x] [**ENG-037 Show Codex subscription usage in the settings usage panel**](ENG-037.md) `P2`
- [x] [**AUDIT-001 Fix API and repository audit findings**](AUDIT-001.md) `P1`
- [x] [**20260910-0528-uploads-root-dir Resolve data paths from a single DATA_DIR**](20260910-0528-uploads-root-dir.md) `P1`
- [ ] [**20260910-0555-dedupe-issue-log-dir Deduplicate the ISSUE_LOG_DIR constant**](20260910-0555-dedupe-issue-log-dir.md) `P3`
- [x] [**20260910-0724-drop-fable-5 Drop Claude Fable 5 from the model catalog**](20260910-0724-drop-fable-5.md) `P2`
- [x] [**20260912-1920-project-tags Tag and filter projects by tag**](20260912-1920-project-tags.md) `P2`

- [x] [**20260912-2116-message-list-rendering Investigate message list stutter and overlapping rows**](20260912-2116-message-list-rendering.md) `P1`

- [x] [**20260913-0023-create-issue-status-toggle Replace the create-issue status dropdown with a toggle**](20260913-0023-create-issue-status-toggle.md) `P2`

- [x] [**20260916-0520-sidebar-active-project-scroll Keep the active project visible in the sidebar rail**](20260916-0520-sidebar-active-project-scroll.md) `P2`
- [x] [**DEV-004 Upgrade all workspace dependencies to latest**](DEV-004.md) `P2`
- [x] [**UI-008 Render chat markdown with streamdown instead of Shiki highlighting**](UI-008.md) `P2`
- [x] [**UI-009 Move assistant message actions to the footer as copy text / copy Markdown**](UI-009.md) `P2`
- [x] [**UI-010 Render file-browser Markdown with streamdown and drop react-markdown**](UI-010.md) `P2`

- [x] [**20260922-1703-mobile-desktop-ui-parity Align mobile and desktop UI and finish the BKD rename**](20260922-1703-mobile-desktop-ui-parity.md) `P1`

- [ ] [**20260922-1712-api-execution-suite-order-flake Auto-execute test times out in the full API suite**](20260922-1712-api-execution-suite-order-flake.md) `P2`
- [x] [**20260923-1133-grok-engine Add Grok Build CLI as an engine**](20260923-1133-grok-engine.md) `P1`
- [x] [**20260924-0914-cursor-engine Add Cursor CLI as an engine**](20260924-0914-cursor-engine.md) `P1`
- [x] [**20260929-1043-mobile-agent-message-selection Make agent messages selectable on touch devices**](20260929-1043-mobile-agent-message-selection.md) `P2`
- [x] [**20261001-1538-sidebar-project-flyout Show the full project list on sidebar hover**](20261001-1538-sidebar-project-flyout.md) `P2`
- [x] [**20261001-1313-reconciler-start-race Keep the stale-working reconciler away from executions that are starting**](20261001-1313-reconciler-start-race.md) `P1`
- [x] [**20261002-1007-engine-process-leak Kill engine processes that fail registration or the Codex handshake**](20261002-1007-engine-process-leak.md) `P0`
- [ ] [**20261002-1046-api-execution-concurrency-flake Fix order-dependent concurrency failure in api-execution tests**](20261002-1046-api-execution-concurrency-flake.md) `P2`
- [x] [**20261002-1111-worktree-reuse Keep worktree issues out of the main checkout**](20261002-1111-worktree-reuse.md) `P1`
- [x] [**20261002-1111-persist-permission-mode Persist the issue permission mode**](20261002-1111-persist-permission-mode.md) `P1`
- [x] [**20261002-1223-sidebar-flyout-active-anchor Anchor the sidebar flyout to the active project only**](20261002-1223-sidebar-flyout-active-anchor.md) `P2`
- [x] [**20261010-1333-lode-repo-move Point lode references at bkhq/lode**](20261010-1333-lode-repo-move.md) `P2`
- [x] [**20261011-0213-codex-failure-visibility Surface Codex turn failures and stop stall probes from ending Codex turns**](20261011-0213-codex-failure-visibility.md) `P1`
- [x] [**20261011-2129-ime-enter-submit Ignore IME-composition Enter in single-line editors**](20261011-2129-ime-enter-submit.md) `P2`
- [x] [**20261012-0902-chat-markdown-render-toggle Keep the Shiki source view as the default chat renderer, opt into Markdown rendering**](20261012-0902-chat-markdown-render-toggle.md) `P2`
- [x] [**20261012-0911-user-message-footer Give sent messages a footer with time and a copy action**](20261012-0911-user-message-footer.md) `P2`
- [x] [**20261012-0919-issue-right-click-menu Right-click issue menu in the list, same menu in the chat header**](20261012-0919-issue-right-click-menu.md) `P2`
- [x] [**20261012-0927-upgrade-deps-and-cn Upgrade all dependencies and replace clsx + tailwind-merge with cn**](20261012-0927-upgrade-deps-and-cn.md) `P2`
- [x] [**20261012-1000-issue-list-restyle Restyle the issue list panel after the grouped-list reference**](20261012-1000-issue-list-restyle.md) `P2`
- [x] [**20261012-1532-pr145-review-fixes Fix the review findings on #145 before merging**](20261012-1532-pr145-review-fixes.md) `P2`
- [x] [**20261012-1547-lode-update-check Check for updates on demand and soften retried-error styling**](20261012-1547-lode-update-check.md) `P2`
- [x] [**20261012-1817-partial-diff-crash Stop patch diffs from crashing the page**](20261012-1817-partial-diff-crash.md) `P1`
- [x] [**20261012-1926-failed-tool-result-error-box Keep failed tool results inside their tool call**](20261012-1926-failed-tool-result-error-box.md) `P2`
- [x] [**20261012-2028-chat-heading-size-and-agent-bg Flatten chat Markdown headings and give agent messages a background**](20261012-2028-chat-heading-size-and-agent-bg.md) `P2`
- [x] [**20261013-0155-agent-message-card-style Style agent messages as a card matching user messages**](20261013-0155-agent-message-card-style.md) `P2`
- [x] [**20261013-0244-worktree-cleanup-on-delete Clean up worktrees of deleted issues and stop cleanup stats from timing out**](20261013-0244-worktree-cleanup-on-delete.md) `P1`
- [x] [**20261013-0538-files-upload-test-poisons-suite Stop api-files-upload.test.ts from breaking every later API test**](20261013-0538-files-upload-test-poisons-suite.md) `P1`
- [ ] [**20261013-0538-spawn-leak-tests-order-dependent Fix engine-spawn-leak concurrency tests that time out in the full suite**](20261013-0538-spawn-leak-tests-order-dependent.md) `P2`
- [ ] [**20261013-0538-bkd-log-rotation Rotate data/logs/bkd.log and keep data/ out of ESLint**](20261013-0538-bkd-log-rotation.md) `P1`
- [x] [**20261013-0540-chat-turn-navigator Add a turn navigator rail with hover previews to the chat area**](20261013-0540-chat-turn-navigator.md) `P2`
- [x] [**20261013-0553-turn-navigator-full-history Show every turn in the chat turn navigator, including unloaded history**](20261013-0553-turn-navigator-full-history.md) `P2`
- [ ] [**20261013-0614-incremental-chat-messages Rebuild chat messages incrementally instead of on every log change**](20261013-0614-incremental-chat-messages.md) `P2`
- [-] [**20261013-0726-workspace-side-panel Merge the diff and file panels into one tabbed workspace side panel**](20261013-0726-workspace-side-panel.md) `P2`
- [x] [**20261013-1706-tickets Add tickets for decisions and user feedback**](20261013-1706-tickets.md) `P1`
- [x] [**20261013-1950-engine-protocol-drift Fix Claude and Codex wire-protocol drift**](20261013-1950-engine-protocol-drift.md) `P1`
- [x] [**20261013-2004-tool-panel-lazy-render Stop rendering collapsed tool calls, keep Markdown for agent messages only**](20261013-2004-tool-panel-lazy-render.md) `P1`
- [x] [**20261013-2005-decision-capability-probe Add a decision-events capability probe and drop the bundled skill**](20261013-2005-decision-capability-probe.md) `P2`
- [x] [**20261013-2159-decision-telegram-interactive Answer decision events from Telegram**](20261013-2159-decision-telegram-interactive.md) `P2`
- [x] [**20261013-2212-decision-event-retention Delete decided decision events after one day**](20261013-2212-decision-event-retention.md) `P2`
- [ ] [**20261013-2222-api-execution-test-timeout api-execution test times out in the full suite**](20261013-2222-api-execution-test-timeout.md) `P2`
- [x] [**20261013-2219-webhook-local-targets Allow webhooks to target local addresses**](20261013-2219-webhook-local-targets.md) `P2`
- [x] [**20261015-2352-issue-message-search Full-text search over issue messages**](20261015-2352-issue-message-search.md) `P2`
- [x] [**20261016-0448-background-task-as-subagent Background Bash tasks render as subagents in the chat**](20261016-0448-background-task-as-subagent.md) `P2`
