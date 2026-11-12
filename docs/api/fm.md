# File Manager

The file browser is the vendored [bkhq/filemanager](https://github.com/bkhq/filemanager) router
(`apps/api/src/fm/`). Its routes follow the upstream `hono-openapi` contract and are not part of BKD's OpenAPI
document (`docs/decisions/2026-11-05-filemanager-openapi-exception.md`); this page lists them for orientation.
The upstream repository is the reference for request and response shapes.

Two routers are mounted:

| Base | Mounts |
|---|---|
| `/api/fm/:projectId` | `project` (the project directory) and `wt-<issueId>` for each existing issue worktree. None for an unknown project or one outside `workspace:defaultPath` (SEC-007). |
| `/api/skills/fm/:projectId` | One mount per skill, id `<location>~<name>`, rooted at the skill directory. `:projectId` is `global` when no project is selected. Managed skills are read-only mounts. |

A mount's trash and upload staging folders live under `data/fm/<hash of the root>/` (override with
`BKD_FM_DATA_DIR`), never inside the served directory.

## Routes

All paths below are relative to a base above; `:mount` is a mount id.

| Method | Path | Description |
|---|---|---|
| GET | `/mounts` | List the mounts |
| GET | `/m/:mount/stat` | Metadata of one path |
| GET | `/m/:mount/list` | List a directory |
| GET | `/m/:mount/read` | File bytes (ranges supported) |
| GET | `/m/:mount/thumb` | Image thumbnail |
| GET | `/m/:mount/search` | Search file names |
| GET | `/m/:mount/usage` | Size of a path |
| GET | `/m/:mount/archive` | Download paths as a zip |
| GET | `/m/:mount/zip/entries` | List the entries of a zip file |
| GET | `/m/:mount/zip/read` | Read one entry of a zip file |
| GET | `/m/:mount/changes` | Changed files against the baseline (git status of a work tree) |
| GET | `/m/:mount/changes/base` | Baseline content of a changed file |
| PUT | `/m/:mount/write` | Write a file |
| POST | `/m/:mount/mkdir` | Create a directory |
| POST | `/m/:mount/ops` | Copy, move, rename or delete paths (delete moves to the trash) |
| GET | `/m/:mount/trash` | List the trash |
| POST | `/m/:mount/trash/restore` | Restore trashed items |
| POST | `/m/:mount/trash/purge` | Delete trashed items for good |
| POST | `/m/:mount/uploads` | Start a chunked upload |
| GET | `/m/:mount/uploads/:id` | Upload status |
| PUT | `/m/:mount/uploads/:id/parts/:n` | Upload one part |
| POST | `/m/:mount/uploads/:id/complete` | Assemble the parts into the target file |
| DELETE | `/m/:mount/uploads/:id` | Abort an upload |

## Notes

- Compression and the JSON content-type check are skipped for these routes.
- File bytes (`read`, `thumb`, `zip/read`) are served with a sandboxing CSP plus `frame-ancestors 'self'`; PDFs
  drop `sandbox` so the browser viewer can render them.
- Trashed items are purged after 7 days by the `trash-cleanup` cron action.
