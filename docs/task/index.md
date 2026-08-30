# BKD - Task List

> Updated: 2026-08-30

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
