# 20261022-0307-skills-management Manage agent skills from the BKD UI

- **status**: implementing
- **createdAt**: 2026-10-22 03:07
- **approvedAt**: 2026-10-22 03:20
- **relatedTask**: 20261022-0307-skills-management

## Context

On the live host (2026-10-22):

| Location | Content | Managed by |
|---|---|---|
| `~/.agents/skills/<name>/` | 21 skills from `zzci/skills` (13), `wuchendi/skills` (6), `JimLiu/baoyu-design`, `vercel-labs/skills` | `skills` CLI; lock `~/.agents/.skill-lock.json` v3 (source, sourceUrl, skillPath, skillFolderHash, installedAt, updatedAt) |
| `~/.claude/skills/<name>` | 21 symlinks into `~/.agents/skills`, plus one local dir (`synced`) | read by Claude Code |
| `<project>/.claude/skills/<name>/SKILL.md` | project-level skills | the project repo |

- `skills` CLI 1.7.4 (`npx skills`): `ls -g --json` returns `[{name, path, scope, agents:
  ["Claude Code","Codex"], source, sourceUrl, sourceType}]`; non-interactive `add <pkg> -g
  -s <skills> -a <agents> -y --json`, `add <pkg> -l --json` (list a repo without installing),
  `update [names] -g -y`, `remove <names> -g -y`; telemetry off via `DISABLE_TELEMETRY=1` /
  `DO_NOT_TRACK=1`. It reports Codex as reading `~/.agents/skills` too.
- `skills update` rewrites a managed skill from its source, so local edits to a managed
  skill are lost; `~/.claude/skills/x` is a symlink, so editing through it changes the
  shared copy every agent reads.
- BKD: slash-command discovery lists skill names only, via `claude -p -- /` (OAuth touch,
  on demand only per ENG-035) — not a data source for this page. `routes/files.ts` can save
  text files but restricts roots to `workspace:defaultPath` (SEC-007); the frontend has a
  CodeMirror editor (`components/files/CodeEditor.tsx`).
- BKD runs as the same OS user as the engine CLIs, so `HOME` is the right base.

## Proposal

### Backend: `apps/api/src/skills/` + `routes/skills.ts` (zod-openapi, shared types)

Roots are computed from `HOME` at call time (tests point `HOME` at a temp dir):
`user` = `~/.claude/skills` entries that are real directories; `shared` = `~/.agents/skills`
(managed when listed in the lock); `project` = `<project.directory>/.claude/skills` and
`<project.directory>/.agents/skills`. A skill is a directory with `SKILL.md`; name and
description come from its frontmatter. This is an explicit allowlist of skill roots; it does
not relax the workspace check for the file browser.

- `GET /api/skills?projectId=` — skills grouped by scope: `name, description, scope, path,
  managed, source, sourceUrl, updatedAt, linkedFrom` (the `~/.claude/skills` symlink, if any).
  Read from disk + the lock file; no CLI call.
- `GET /api/skills/:scope/:name/files` and `.../file?path=` — file tree and content.
- `PUT .../file` — save; `POST /api/skills` — create from a template (name + description →
  `SKILL.md`); `POST .../copy` — copy a managed skill to a new local name in `user` scope;
  `DELETE /api/skills/:scope/:name` — local skills only, moved to `data/trash/skills/<ts>/`
  so it can be recovered.
- Guards: names match `^[a-z0-9][a-z0-9._-]{0,63}$`; file paths resolve (realpath) inside
  the skill directory; writes to managed skills return 409; project scope verifies the
  project exists.

### Backend: CLI operations (C)

- `POST /api/skills/operations` with `{ op: 'preview' | 'add' | 'update' | 'remove', source?,
  skills?, scope: 'global' | 'project', projectId?, agents? }`; `GET /api/skills/operations/:id`;
  `POST .../:id/cancel`.
- Runs `npx -y skills@1.7.4 <args> --json -y` through `spawnNode` (argv, no shell), env
  `DISABLE_TELEMETRY=1 DO_NOT_TRACK=1`, cwd `HOME` (global) or the project directory
  (project). Version pinned in one constant. `source` must be `owner/repo` or an
  `https://github.com/...` URL; skill names follow the name rule. Default agents:
  `claude-code` and `codex`.
- One operation at a time (serial lock, 409 while busy), 5-minute timeout, output lines
  streamed as a `skills-operation` SSE event on the existing bus; the list query is
  invalidated when an operation ends.
- `GET /api/skills` reports whether `npx` is available; install/update/remove are
  disabled in the UI otherwise.

### Frontend: `/skills` page (sidebar entry)

- Scope sections (User / Installed / Project with a project picker), search, badges
  (source, "managed", linked agents).
- Detail pane: file tree + CodeEditor. Managed skills open read-only with a
  "Copy to local skill" action; local skills save in place.
- Dialogs: New skill; Install (enter repo → preview list via `add -l --json` → pick skills,
  scope, agents → install with live log); Update (all or one); Remove (confirm).
- API client in `kanban-api.ts`, hooks in `use-kanban.ts`, i18n in `en.json` / `zh.json`.

### Delivery

Two PRs into `release` (two features in flight): B (read/edit) first, then C (CLI
operations). Docs: `CLAUDE.md` / `docs/architecture.md` sections for skills.

## Risks

- `skills update` overwrites managed skills; mitigated by making them read-only in the UI.
- Editing a shared skill affects every agent reading `~/.agents/skills`; the UI shows
  `linkedFrom` and agents.
- Trust: skills steer agents that run Bash. Same trust level as the existing web
  terminal; roots stay an explicit allowlist and paths are realpath-checked.
- C needs `npx` and network at runtime; CLI output format may change between versions
  (pinned; parse only `--json`).
- Someone running the CLI on the host while BKD runs an operation: the serial lock only
  covers BKD.
- Tests must not hit the network: the CLI runner is injected and mocked.

## Scope

- New: `apps/api/src/skills/*`, `apps/api/src/routes/skills.ts`, tests; shared types in
  `packages/shared/src/index.ts`
- New: `apps/frontend/src/pages/SkillsPage.tsx` + components, sidebar entry, route in
  `main.tsx`, API client, hooks, i18n, tests
- Docs: `CLAUDE.md`, `AGENTS.md`, `docs/architecture.md`, changelog

Out of scope: plugins/marketplaces, `skills find` search, the stray loose `.md` files in
this repo's `.claude/skills/` (separate task), engines other than Claude Code and Codex.

## Alternatives

- A only (add skill dirs to the file browser allowlist): small, but no scopes, sources or
  managed/read-only distinction.
- Reimplement install/update instead of calling the CLI: no `npx` dependency, but
  duplicates the lock format and GitHub fetching that the CLI already owns.
