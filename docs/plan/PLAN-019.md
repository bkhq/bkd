---
id: PLAN-019
title: In-chat FTS search + CJK bigram tokenizer upgrade
status: completed
created: 2026-05-19
approvedAt: 2026-05-19
completedAt: 2026-05-19
relatedTask: SEARCH-001
---

# PLAN-019 — In-chat FTS search + CJK bigram tokenizer upgrade

## Context

- Backend already ships FTS5 over `issues_logs.content` via migration
  `0020_cockpit_logs_fts.sql` with `tokenize='porter unicode61'` and
  AFTER INSERT/UPDATE/DELETE triggers.
- `searchLogs()` in `apps/api/src/mcp/cockpit-tools.ts` and the
  `/api/search/logs` route are wired into the cockpit `SearchContent`.
- The current tokenizer effectively splits CJK text per-codepoint, so
  Chinese queries fall back to noisy prefix matches.
- Issue chat (`apps/frontend/src/components/issue-detail/`) has no
  inline search affordance — users must leave the issue to find old
  history.

## Proposal

### Backend

1. **Migration `0021_fts_bigram_rebuild.sql`**
   - Drop existing triggers `issues_logs_ai|au|ad`.
   - Drop existing `issue_logs_fts`.
   - Recreate as `CREATE VIRTUAL TABLE issue_logs_fts USING fts5(log_id UNINDEXED, content, tokenize='unicode61 remove_diacritics 2')`.
   - Migration leaves the table empty; backfill runs at server boot.

2. **`apps/api/src/db/fts.ts` (new)**
   - `toBigram(text)` — lowercases, normalizes whitespace, emits a
     space-joined string of overlapping 2-grams; single ASCII tokens
     (≥2 chars) are kept verbatim so English search still works.
   - `bigramQuery(raw)` — same transform applied to the query, joined
     with `AND`; trailing prefix `*` on the last token.
   - `indexLog(logId, content)` — runs `INSERT INTO issue_logs_fts ...`.
   - `removeLog(logId)` — `DELETE FROM issue_logs_fts WHERE log_id=?`.
   - `reindexAll()` — batched (1000/tx) idempotent rebuild from
     `issues_logs WHERE is_deleted=0 AND visible=1`, using
     `INSERT OR IGNORE`; progress recorded in `app_settings`
     (`fts.tokenizer_version` = `'bigram-v1'`, `fts.rebuild_cursor`).

3. **Startup backfill (`apps/api/src/db/index.ts` or `app.ts`)**
   - After migrations, read `fts.tokenizer_version`; if missing or not
     `bigram-v1`, call `reindexAll()` and write the setting.

4. **Replace SQL trigger sync with app-layer double-write**
   - `apps/api/src/engines/issue/persistence/log-entry.ts`: after the
     `issues_logs` insert, call `indexLog()` inside the same
     transaction.
   - `apps/api/src/db/pending-messages.ts`: same.
   - For DB-level deletes / soft-deletes we already mark
     `is_deleted=1` instead of physical delete; remove FTS row via
     `removeLog()` at the same call site (audit `update(...isDeleted=1)`
     paths on `issues_logs` — there are none currently for logs, only
     for issues; logs are never deleted post-write).

5. **Search updates**
   - `searchLogs()` switches to `bigramQuery()` for the MATCH clause.
   - Accept an optional `issueId` filter (`searchLogs(raw, limit, opts)`).
   - Fallback path (try/catch) still degrades to LIKE.

6. **New endpoints**
   - `GET /api/search/logs?q=&limit=&issueId=` — extend existing route
     with optional `issueId` filter.
   - `GET /api/projects/:projectId/issues/:id/logs/around/:logId?window=20`
     — returns the 20 entries (default) bracketing the given logId
     ordered by `(turnIndex, entryIndex)`. Used by the chat search UI
     to jump to a log outside the loaded window.

### Frontend

1. **`useChatSearch` hook (new)** in
   `apps/frontend/src/hooks/use-chat-search.ts`:
   - debounced query → `kanbanApi.searchLogs(query, 50, { issueId })`
   - manages `hits[]`, `activeIndex`, `goNext / goPrev / open / close`.
   - exposes `loadAround(logId)` that calls the new around endpoint
     and merges results into `useIssueStream`'s `olderLogs`.

2. **`ChatSearchBar` component (new)** in
   `apps/frontend/src/components/issue-detail/ChatSearchBar.tsx`:
   - sticky bar inside `ChatBody`; search input, "n/m" counter,
     ↑/↓/✕ buttons; all controls ≥44px on mobile.

3. **`ChatArea.tsx` / `IssueDetail.tsx` integration**
   - Add a search icon to existing chat header (both desktop and
     mobile rows).
   - Bind `Ctrl+F` / `⌘F` to open the search bar while focus is
     inside the issue route (preventing browser find).

4. **Highlighting**
   - Pass `highlightTerms` from the search hook into `ChatBody`.
   - In each rendered message, walk text nodes (skip `<code>` and
     `<pre>` to avoid breaking Shiki output) and wrap matches with
     `<mark class="bg-yellow-200 dark:bg-yellow-700/50">`.
   - Active hit gets a slightly stronger `mark` class.

5. **kanban-api**
   - `searchLogs(query, limit, opts?: { issueId? })` extended signature.
   - `getLogsAround(projectId, issueId, logId, window=20)` new.

6. **i18n** — keys in `en.json` / `zh.json`:
   `chat.search.placeholder`, `chat.search.empty`, `chat.search.openShortcut`.

### Tests

| # | Test | Implementation |
|---|------|----------------|
| 1 | `apps/api/test/fts-bigram.test.ts` — Chinese phrase search returns ranked hits; English still works; existing `cockpit-search-fts.test.ts` stays green | `db/fts.ts` + migration |
| 2 | `apps/api/test/search-issue-filter.test.ts` — `/api/search/logs?issueId=` scopes results | route + searchLogs filter |
| 3 | `apps/api/test/logs-around.test.ts` — around endpoint returns ±N entries | new route |
| 4 | `apps/frontend/src/__tests__/components/ChatSearchBar.test.tsx` — input → hits, ↑↓ navigation, esc closes | component |

## Risks

- **Index drift between source and shadow** — mitigated by
  app-layer double-write inside `db.transaction()` and by a startup
  reindex that is idempotent (`INSERT OR IGNORE`) and re-runs whenever
  `fts.tokenizer_version` setting changes.
- **Index size growth** — bigram encoding ~doubles indexed token
  count; for typical chat volume still well under the source size.
- **Snippet quality** — bigram queries make `snippet()` output noisy;
  we render snippets from the *original* content, not the indexed
  bigram form (the FTS row stores bigram only; the source `content`
  is loaded via JOIN as today).
- **Removing SQL triggers** — must ensure every code path that
  inserts/updates `issues_logs` is updated. Audited:
  `persistence/log-entry.ts` and `db/pending-messages.ts` are the
  only writers.
- **Cockpit search regression** — `cockpit-search-fts.test.ts` runs
  unchanged; the bigram transform is the identity for ASCII-only
  multi-char tokens, so its existing assertions still pass.

## Scope

Backend: 1 migration + 1 new module + 3 edits + 2 new tests.
Frontend: 1 new component + 1 new hook + 3 edits + 1 new test.
Estimated ~1.5 days.

## Alternatives

- **Custom FTS5 tokenizer C extension** — best quality but requires
  native build, hostile to the single-binary distribution.
- **Trigram** — slightly better recall, ~50% larger index, marginal
  gain for our content volume.
- **External engine (Tantivy / Meilisearch)** — overkill; loses the
  zero-dependency story.

## Annotations

- 2026-05-19: User approved A+B direction and asked about UI
  interaction + data-loss safety; addressed in chat (sticky bar,
  ⌘F binding, mobile parity, double-write in same tx, idempotent
  rebuild, LIKE fallback). Proceeding to implementation.
