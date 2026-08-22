# PLAN-017 Global local session scanner and session-to-issue import

- **status**: completed
- **createdAt**: 2026-08-22 07:05
- **approvedAt**: 2026-08-22 07:20
- **relatedTask**: SES-001

## Context

Every CLI session run outside BKD still leaves a complete transcript on disk,
but BKD has no way to see or adopt it. Today an issue only ever gets an
`issues.external_session_id` when BKD itself spawned the engine
(`apps/api/src/db/schema.ts:69`).

### On-disk layouts (verified on this host)

**Claude Code** — `~/.claude/projects/<cwd-with-slashes-replaced-by-dashes>/`

```
<sessionId>.jsonl                       main transcript (178 files, 167 MB total)
<sessionId>/subagents/agent-<id>.jsonl  per-subagent transcript
<sessionId>/subagents/agent-<id>.meta.json
<sessionId>/tool-results/*.txt          spilled large tool results
```

Every transcript line carries `sessionId`, `cwd`, `version`, `gitBranch`,
`timestamp`, `uuid`, `parentUuid`, `isSidechain`, plus `type` in
`user | assistant | attachment | queue-operation | last-prompt`. The
`user`/`assistant` lines are shaped like the stream-json envelopes
`ClaudeLogNormalizer` already parses, so the existing normalizer can be reused
for import with only tolerance for the extra line types.

**Codex** — `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
(518 files, 428 MB total). The first line is `session_meta` with
`payload.{id,cwd,originator,cli_version,model_provider,base_instructions}`.
Remaining lines are `turn_context`, `event_msg` and `response_item`. 89 of the
518 rollouts are subagent threads, identified by
`payload.source.subagent.thread_spawn.{parent_thread_id,depth}`; they must not
appear as top-level sessions.

### Constraints this imposes

- ~600 MB across ~700 files: the list endpoint must be metadata-only
  (`stat` + bounded head read), never a full parse.
- BKD-managed sessions are written to the same directories, so the list must
  mark rows whose `sessionId` already appears in `issues.external_session_id`.
- Resume only works from the original `cwd`: `claude --resume <id>` reads
  `~/.claude/projects/<slug-of-cwd>/`, and Codex `thread/resume` re-sends
  `cwd`. An imported session whose `cwd` differs from the target project path
  will not resume cleanly.

The frontend already hosts global pages at `/review`, `/cron` and `/terminal`
(`apps/frontend/src/main.tsx:179-242`), so a global `/sessions` page fits the
existing shell without new layout work.

## Proposal

1. **Scanner module** `apps/api/src/sessions/` with one adapter per engine
   (`claude.ts`, `codex.ts`) behind a small `SessionSource` interface:
   `list()`, `read(sessionId)`. Roots resolve from `CLAUDE_CONFIG_DIR` /
   `CODEX_HOME` when set, otherwise `~/.claude` and `~/.codex`.
   `list()` returns metadata only: `{ engine, sessionId, cwd, title, startedAt,
   lastActiveAt, sizeBytes, gitBranch, cliVersion, model }`, derived from
   `stat()` plus a bounded (64 KB) head read. Results are cached in the
   existing LRU (`cache.ts`) keyed by root mtime, so repeat listings are cheap.
2. **Filtering and annotation.** Codex subagent rollouts are excluded from the
   top-level list. A single `issues` query annotates each row with
   `managedByIssueId` when its `sessionId` is already an
   `external_session_id`, and with `suggestedProjectId` when its `cwd` matches
   a project path.
3. **Routes** (`app.route('/api/sessions', sessionRoutes)`):
   - `GET /api/sessions` — `engine`, `search`, `managed`, `limit`, `cursor`
     query params; newest first.
   - `GET /api/sessions/:engine/:sessionId` — normalized preview (first and
     last N entries) built with the existing engine normalizers.
   - `POST /api/projects/:projectId/issues/import-session` — body
     `{ engine, sessionId, title?, statusId?, importLogs?, allowCwdMismatch? }`.
     Creates the issue with `engineType`, `model`, `prompt` (first user
     message), `externalSessionId = sessionId`, `sessionStatus = 'completed'`,
     then backfills `issues_logs` / `issues_logs_tools_call` by streaming the
     transcript through the engine normalizer and the existing persistence
     path. `importLogs` selects the import mode: full transcript backfill, or
     a metadata-only link. A `cwd` that does not match the project path is not
     rejected — the response reports `cwdMatches` and the UI requires an
     explicit acknowledgement. A session already bound to another issue is
     rejected.
4. **Security.** `sessionId` is validated against a strict UUID / rollout-id
   pattern, the resolved path must stay inside the scan root after `realpath`
   (same guard as `routes/filesystem.ts:16-34`), and transcript bodies are
   never echoed outside the preview and import endpoints.
5. **Frontend.** New lazy page `pages/LocalSessionsPage.tsx` at `/sessions`
   plus a nav entry: engine filter, search, list rows showing title, `cwd`,
   last-active, size and a "managed" badge; a preview sheet reusing
   `SessionMessages`; an "Import to project" dialog with project picker,
   title field, status picker and an import-mode choice (full transcript or
   link only). Sessions whose `cwd` matches a project and sessions that match
   none are both listed; the dialog shows whether the chosen project matches
   the session `cwd` and requires an explicit acknowledgement when it does
   not. API wrappers in `lib/kanban-api.ts`, hooks in `hooks/use-kanban.ts`
   with new `queryKeys` entries.
6. **i18n** keys in `en.json` and `zh.json`.
7. **TDD**: adapter tests over fixture session trees (claude + codex, including
   a subagent rollout that must be filtered out), route tests for pagination,
   traversal rejection, duplicate-import rejection and cwd-mismatch handling,
   and frontend tests for the list, the import dialog and the mutation.

After import the issue behaves like any other BKD issue: follow-up resumes the
original session via the existing `--resume` / `thread/resume` paths.

## Risks

- **Resume fidelity.** Claude resolves `--resume` through the cwd-derived
  project directory. If the operator imports a session recorded under a
  different `cwd`, follow-up starts a fresh session instead of resuming.
  Mismatched sessions stay listed and importable by decision; the dialog
  surfaces the mismatch and requires acknowledgement so the trade-off is
  visible rather than silent.
- **Import cost.** A 2 MB transcript expands to thousands of log rows. The
  import runs synchronously in the request; large transcripts will be slow.
  Mitigation: cap imported entries (newest N turns) with the cap surfaced in
  the response, and keep `importLogs` optional so a metadata-only link is
  possible.
- **Format drift.** Both on-disk formats are internal to their CLIs. Parsing is
  defensive: an unrecognised line is skipped, never fatal.
- **Data exposure.** The scan reads every local session on the host, including
  ones unrelated to any BKD project. The endpoints are as exposed as the rest
  of the BKD API; no new auth layer is introduced, which is a deliberate
  scoping decision to record.
- **Codex normalizer coupling.** The Codex normalizer targets the app-server
  JSON-RPC stream; rollout files use `event_msg` / `response_item` shapes that
  overlap but are not identical. Some adapter-side translation is expected.

## Scope

In scope:

- `apps/api/src/sessions/` (new), `apps/api/src/routes/sessions.ts` (new),
  `apps/api/src/routes/issues/import-session.ts` (new), `app.ts` mount
- `apps/frontend/src/pages/LocalSessionsPage.tsx` (new), `main.tsx` route,
  nav entry, `lib/kanban-api.ts`, `hooks/use-kanban.ts`
- `packages/shared/src/index.ts` (`LocalSession`, import request/response)
- `apps/frontend/src/i18n/{en,zh}.json`
- Focused API + frontend tests

Out of scope:

- Importing subagent transcripts as separate issues
- Watching session directories for live changes (list is on-demand)
- Deleting or editing local session files
- Engines other than `claude-code` and `codex`

## Alternatives

- **Metadata-only link (no log import).** Create the issue with just
  `externalSessionId` and let follow-up rebuild context. Much smaller change,
  but the issue opens with an empty chat, which defeats "analyse local
  sessions". Retained as the `importLogs: false` path rather than as the
  default.
- **Import by pointing at a file path.** Skips the scanner entirely and reuses
  `routes/filesystem.ts`. Simpler, but the user explicitly asked for a global
  scan, and a picker over 700 files is unusable without the derived metadata.
- **Background indexing into a DB table.** Faster repeat listings and enables
  full-text search, but adds a migration, a job and a staleness problem for a
  feature whose corpus is read rarely. Rejected for now; the LRU cache covers
  the realistic access pattern.
