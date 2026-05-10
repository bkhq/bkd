# BKD - Plan Index

> Updated: 2026-05-10

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

- [-] [**PLAN-001 Project whiteboard mindmap technical design**](PLAN-001.md) `2026-04-14`
- [-] [**PLAN-002 Whiteboard UI overhaul — edges, collapse badges, markdown**](PLAN-002.md) `2026-04-15`
- [-] [**PLAN-003 Migrate claude executor to @anthropic-ai/claude-agent-sdk**](PLAN-003.md) `2026-04-17`
- [ ] [**PLAN-004 Enable AskUserQuestion in claude-code-sdk executor (web UI answer flow)**](PLAN-004.md) `2026-04-18`
- [x] [**PLAN-005 Fix OpenCode hanging without error on quota exhaustion**](PLAN-005.md) `2026-05-09`
- [~] [**PLAN-006 Backend chat normalization & frontend simplification**](PLAN-006.md) `2026-05-09` (superseded — see PLAN-006 rationale)
- [x] [**PLAN-007 Chat UI ordering root causes + invariant test coverage + markdown copy UX**](PLAN-007.md) `2026-05-10`
