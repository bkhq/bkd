# 20261015-2352-issue-message-search Full-text search over issue messages

- **status**: completed
- **createdAt**: 2026-10-15 23:52
- **approvedAt**: 2026-10-16 03:20
- **relatedTask**: 20261015-2352-issue-message-search

## Context

- Messages live in `issues_logs` (`entry_type`, `content`, `visible`, `is_deleted`, `turn_index`).
  It is a rowid table (text ULID primary key, implicit `rowid`).
- Rows are written from many paths: `engines/issue/persistence/log-entry.ts`, `db/pending-messages.ts`
  (insert, `visible` flips, hard delete), `routes/issues/duplicate.ts`, `routes/issues/import-session.ts`;
  hard-deleted by `cron/actions/builtins/issue-log-retention.ts` and `routes/settings/cleanup.ts`.
- Existing search is client-side title filtering only: `IssueListPanel.tsx` and `KanbanBoard.tsx`
  (`searchQuery` from `KanbanHeader`). No server search endpoint exists.
- Bun's bundled SQLite (3.53) supports FTS5 with the `trigram` tokenizer, verified to match CJK
  substrings (`登录跳` in `修复登录跳转问题`). `unicode61` would not segment CJK.
- drizzle-kit cannot model virtual tables or triggers; a `drizzle-kit generate --custom` migration
  carries raw SQL and does not change `schema.ts`, so the CI `Migrations` job stays clean.

## Proposal

### 1. Index (custom migration `0028_*`)

```sql
CREATE VIRTUAL TABLE issues_logs_fts USING fts5(
  content, issue_id UNINDEXED, tokenize = 'trigram'
);
-- triggers keep it in sync; key = issues_logs.rowid
CREATE TRIGGER issues_logs_fts_ai AFTER INSERT ON issues_logs
  WHEN new.entry_type IN ('user-message','assistant-message') AND new.visible = 1 AND new.is_deleted = 0
  BEGIN INSERT INTO issues_logs_fts(rowid, content, issue_id) VALUES (new.rowid, new.content, new.issue_id); END;
CREATE TRIGGER issues_logs_fts_ad AFTER DELETE ON issues_logs
  BEGIN DELETE FROM issues_logs_fts WHERE rowid = old.rowid; END;
CREATE TRIGGER issues_logs_fts_au AFTER UPDATE ON issues_logs
  BEGIN
    DELETE FROM issues_logs_fts WHERE rowid = old.rowid;
    INSERT INTO issues_logs_fts(rowid, content, issue_id)
      SELECT new.rowid, new.content, new.issue_id
      WHERE new.entry_type IN ('user-message','assistant-message') AND new.visible = 1 AND new.is_deleted = 0;
  END;
-- backfill
INSERT INTO issues_logs_fts(rowid, content, issue_id)
  SELECT rowid, content, issue_id FROM issues_logs
  WHERE entry_type IN ('user-message','assistant-message') AND visible = 1 AND is_deleted = 0;
```

Only user and agent messages are indexed: tool output, thinking and system noise would dominate hits.

### 2. API

`GET /api/projects/:projectId/issues/search?q=<text>&limit=<n>` (new `routes/issues/search.ts`,
Zod + OpenAPI, verifies the project). Returns one hit per issue, best match first:

```ts
interface IssueSearchHit {
  issue: Issue // same shape as the list endpoint
  matchCount: number
  snippet: string // fts5 snippet() around the first match, markers stripped to plain text + ranges
  logId: string
  turnIndex: number
}
```

- `q` is trimmed and sent as one quoted FTS5 phrase (double quotes escaped), so user input is never
  parsed as FTS syntax.
- Trigram needs >= 3 characters; for 1–2 characters fall back to `content LIKE %q%` on the FTS table
  (escaped `%`/`_`), still filtered by project.
- Joins `issues` to filter `project_id = :projectId AND is_deleted = 0`; ranked by `bm25`, limit default 20, max 50.

### 3. Frontend

- `kanban-api.ts` `searchIssues()`, `use-kanban.ts` `useIssueSearch(projectId, q)` (debounced 300 ms,
  enabled when `q.trim().length >= 2`).
- `IssueListPanel.tsx`: keep the instant title filter; below it, a "Message matches" section lists
  hits not already shown (title, `#number`, snippet with the match highlighted). Click navigates to
  the issue.
- i18n keys in `en.json` / `zh.json`.
- Kanban board search stays title-only (out of scope; can reuse the hook later).

### 4. Tests (RED first)

`apps/api/test/api-issues-search.test.ts`: matches assistant + user messages, CJK substring,
2-character fallback, excludes other projects, deleted issues, `visible = 0` logs and tool-use
entries, index follows log update/delete, FTS syntax characters in `q` do not error.
Frontend: a component test for the message-match section.

## Risks

- Migration backfill runs once at startup; cost is linear in message volume (tiny on this install,
  seconds at worst on large ones).
- Storage: the FTS table copies message text plus a trigram index (roughly 2–3x the indexed text).
- Every log insert pays the trigger cost; inserts are already per-entry, overhead is small.
- A downgrade to an older BKD keeps the table and triggers; harmless because older code ignores them
  (triggers still work since they only reference existing columns).

## Scope

~8 files: migration SQL + journal/snapshot, `routes/issues/search.ts` + router mount, shared type,
`kanban-api.ts`, `use-kanban.ts`, `IssueListPanel.tsx`, i18n x2, tests x2, CLAUDE.md route list.

## Alternatives

- Plain `LIKE` over `issues_logs` without an index: no migration, but a full scan of all log content
  (including large tool outputs) per keystroke. Acceptable only for tiny installs.
- `unicode61` tokenizer: smaller index and word-level ranking, but CJK text is not searchable.
- Global (cross-project) search page: useful later; the endpoint shape can be lifted to `/api/issues/search`.

## Annotations

(none)
