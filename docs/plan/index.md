# BKD - Plan Index

> Updated: 2026-05-12 (PLAN-013)

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
- [x] [**PLAN-008 Lift attachment upload limit and add upload progress UX**](PLAN-008.md) `2026-05-10`
- [x] [**PLAN-009 OpenCode assistant/thinking double-emit fix via dbOnly pipeline lane**](PLAN-009.md) `2026-05-10`
- [x] [**PLAN-010 Pin TimelineEntry sequence on same-id upsert**](PLAN-010.md) `2026-05-11`
- [x] [**PLAN-011 Clickable file path chips with quick preview drawer**](PLAN-011.md) `2026-05-11`
- [x] [**PLAN-012 ChatInput density refactor + design token primitives**](PLAN-012.md) `2026-05-11`
- [x] [**PLAN-013 Mermaid diagram zoom viewer**](PLAN-013.md) `2026-05-12`
- [x] [**PLAN-014 Global cockpit skeleton via /review upgrade**](PLAN-014.md) `2026-05-19`
- [x] [**PLAN-015 Cockpit AI assistant (read-only MCP) + responsive cockpit**](PLAN-015.md) `2026-05-19`
- [x] [**PLAN-016 Cockpit write tools + FTS5 search + reset/suggested prompts**](PLAN-016.md) `2026-05-19`
- [x] [**PLAN-017 Bulk ops + issue templates + done diff hover**](PLAN-017.md) `2026-05-19`
- [-] [**PLAN-018 Cockpit reachability upgrade**](PLAN-018.md) `2026-05-19`
- [x] [**PLAN-019 In-chat FTS search + CJK bigram tokenizer upgrade**](PLAN-019.md) `2026-05-19`
- [-] [**PLAN-020 Cockpit Overview → Always-On Bot Timeline**](PLAN-020.md) `2026-05-19`
- [x] [**PLAN-021 One-click fork current issue into a new spawned issue**](PLAN-021.md) `2026-05-19`
- [-] [**PLAN-022 Cockpit secretary — AI-enriched decision cards + single decision-stream UI**](PLAN-022.md) `2026-05-20`
