# SEARCH-001 In-chat full-text search with CJK-friendly tokenizer

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-05-19 14:00
- **completedAt**: 2026-05-19 14:45

## Description

Add per-issue inline full-text search in `ChatBody` (desktop + mobile)
backed by FTS5, and upgrade the existing FTS5 index with a bigram
preprocessor so CJK queries return useful results.

Acceptance criteria:

- A search bar can be opened from the chat header (button on both
  desktop and mobile) and via `Ctrl+F` / `⌘F` inside the issue route.
- Typing a query (Chinese or English ≥ 2 chars) returns ranked hits
  inside the current issue; ↑/↓ navigates, with a "current/total"
  counter. `Esc` closes.
- Matches in the visible bubbles are highlighted with `<mark>`.
- Hits outside the loaded log window load a 20-entry window around the
  target log and scroll/highlight it.
- The existing cockpit cross-project search (`/api/search/logs`) keeps
  working with the new tokenizer; existing tests stay green.
- Re-indexing is safe: source `issues_logs` is never touched; on
  failure the system falls back to `LIKE` search.

## ActiveForm

Building in-chat FTS search with CJK bigram tokenizer.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Bigram is applied at the application layer (no native tokenizer
  extension; ships cleanly in the standalone Bun binary).
- Triggers on `issues_logs` are replaced by application-layer
  double-write inside the same transaction.
- A one-time backfill runs on startup if the FTS table is empty or the
  `fts.tokenizer_version` setting does not match.

### 2026-05-19 — Completed

- Migration `0021_fts_bigram_rebuild.sql` drops the legacy triggers and
  recreates `issue_logs_fts` with `tokenize='unicode61 remove_diacritics 2'`.
- New `apps/api/src/db/fts.ts` provides `tokenize / encodeContent /
  buildMatchQuery / indexLog / removeLog / reindexAll /
  ensureFtsTokenizerVersion`. Startup hook in `apps/api/src/index.ts`
  calls `ensureFtsTokenizerVersion()` which rebuilds the shadow on
  first boot after the migration.
- Persistence double-writes wired in `engines/issue/persistence/log-entry.ts`
  and `db/pending-messages.ts` (insert + soft/hard delete paths).
- `searchLogs()` switched to `buildMatchQuery()` and now accepts
  `{ issueId }` to scope to a single conversation; `/api/search/logs`
  exposes the same filter. New endpoint
  `GET /api/projects/:projectId/issues/:id/logs/around/:logId?window=20`
  returns a ±N window around a pivot log.
- Frontend: `ChatSearchBar` (sticky bar inside the chat scroll viewport)
  + `Search` icon and `⌘F` / `Ctrl+F` binding in `ChatArea`. Jumping
  to a hit scrolls the corresponding `[data-message-id]` element into
  view with a yellow ring flash; out-of-window hits fall back to a
  "scroll up to load more" toast.
- Tests: `test/fts-bigram.test.ts` (8 cases: tokenizer + CJK search +
  issueId filter + GET endpoint); existing `test/cockpit-search-fts.test.ts`
  updated for the new app-layer double-write path and still passes.

### 2026-05-20 — Post-review fixes

User feedback on the first cut:

1. *Jumping to an out-of-window hit only showed a "scroll up" toast.*
   Fixed: `useIssueStream` now exposes `loadLogWindow(logId)` which
   fetches `/logs/around/:logId` and merges the window into `olderLogs`
   (type-filtered to the stream's concise set, target always kept).
   A new `chat-search-store` (`requestJump`) hands the scroll off to
   `SessionMessages` — the virtualized branch calls
   `virtualizer.scrollToIndex()` so off-screen rows mount before we
   scroll + flash-highlight (`.bkd-search-flash`, see `index.css`).
2. *⌘F no longer reached the browser's native find.* Fixed: removed the
   `Ctrl/⌘+F` interception entirely; the search panel opens from the
   header 🔍 button only.
