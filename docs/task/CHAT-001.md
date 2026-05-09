# CHAT-001 Backend Normalization & Frontend Simplification

## Status

`in_progress`

## Owner

Claude

## Context

BKD chat has accumulated ~2600 lines of state-management code across:
- ACP normalizer (676 lines)
- Codex normalizer (861 lines)  
- `useAcpTimeline` (450 lines)
- `useIssueStream` (600 lines)

Bugs persist because 3 engine protocols (ACP, Codex, MCP) output different streaming semantics, and the frontend tries to unify them in `useAcpTimeline`.

## Goal

Normalize all engine output into a single unified timeline format on the backend, reducing frontend state management from ~1050 lines to ~80 lines.

## Acceptance Criteria

- [ ] All engine normalizers output `UnifiedTimelineEntry` with guaranteed monotonicity, deduplication, ordering, and noise filtering
- [ ] Frontend `useAcpTimeline` is deleted
- [ ] Frontend `useIssueStream` is reduced to ~80 lines
- [ ] No regression in ACP, Codex, or MCP engine behavior
- [ ] All existing tests pass

## Related

- PLAN-006: Backend normalization technical design
