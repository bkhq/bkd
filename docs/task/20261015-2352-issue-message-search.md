# 20261015-2352-issue-message-search Full-text search over issue messages

- **status**: completed
- **priority**: P2
- **owner**: claude/issue-message-search
- **createdAt**: 2026-10-15 23:52

## Description

Add full-text search over issue chat messages so a user can find the issue a message belongs to.
Today the issue list and kanban search only filter loaded issues by title on the client.

Acceptance:

- A query matches user and agent messages (including CJK text) and returns the owning issues,
  with a snippet of the matching message.
- Results are scoped to the project; deleted issues and hidden/deleted logs never match.
- The issue list search box shows message matches alongside title matches; clicking opens the issue.

## ActiveForm

Adding full-text search over issue messages

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261015-2352-issue-message-search.md`.

- complete: API search tests (9) and component tests (4) pass; bun run check passes except the known api-execution timeout (20261013-2222), which passes alone.
