# BKD - Plan Index

> Updated: 2026-09-02

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/PLAN-NNN.md`.

### Format

- [ ] [**PLAN-001 Short plan title**](PLAN-001.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Draft / Pending review |
| `[-]`  | Approved / Implementing |
| `[x]`  | Completed |
| `[~]`  | Rejected / Abandoned |

### Rules

- Only update the checkbox marker; never delete the line.
- New plans append to the end.
- See each `PLAN-NNN.md` for full details.

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
