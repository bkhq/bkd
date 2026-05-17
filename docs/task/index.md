# BKD - Task List

> Updated: 2026-05-11

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
