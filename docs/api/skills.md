# Skills

Agent skills on disk, in the layout of the `skills` CLI: the shared store `.agents/skills/<name>/` and
`.claude/skills/`, under `HOME` (global) or under a project directory. A skill is a directory with a `SKILL.md`
whose frontmatter gives its name and description.

`location` is one of `global-agents`, `global-claude`, `project-agents`, `project-claude`. A skill installed by
the CLI is *managed*: it is read-only here (`409`), because `skills update` would overwrite local edits. Copy it
to get an editable local skill. Skill files are browsed and edited through the file manager at
`/api/skills/fm/:projectId` ([fm.md](./fm.md)).

## GET /api/skills

List global skills, plus the project's when `projectId` is given.

**Response:** `{ skills: Skill[], cliAvailable: boolean }`

`Skill`: `{ location, scope, name, description, path, managed, source, sourceUrl, sourcePath, sourceRef, updatedAt, agents }`

## POST /api/skills

Create a local skill in `.agents/skills/` with a symlink in `.claude/skills/`. Returns `201`.

| Field | Type | Required | Description |
|---|---|---|---|
| `scope` | `"global" \| "project"` | Yes | |
| `name` | `string` (`^[a-z0-9][\w.-]{0,63}$`) | Yes | Directory name |
| `description` | `string` (1-1024) | Yes | Written to the SKILL.md frontmatter |
| `projectId` | `string` | When `scope` is `project` | |

## POST /api/skills/:location/:name/copy

Copy a skill to a new local skill. Returns `201`.

**Request Body:** `{ name: string, projectId?: string }`

## DELETE /api/skills/:location/:name

Move a local skill to `data/trash/skills/` and drop its link. `?projectId=` for project skills.

## POST /api/skills/upload

Upload skills as `multipart/form-data`: a `.md` file (one SKILL.md) or a `.zip` / `.skill` archive with SKILL.md at
its root or in top-level folders. Limits: 20 MB upload, 1000 files and 50 MB unpacked. An existing name is never
overwritten.

**Response:** `{ created, conflicts, skipped }`

## GET /api/skills/updates

Whether installed global skills have a newer version on GitHub. Checked on request, not cached. Pass `location`
and `name` to check one skill. Project skills are not checked.

**Response:** `{ updates }`, each with a status of `latest`, `update`, `removed` or `unknown`.

## POST /api/skills/operations

Run the `skills` CLI (`npx -y skills@1.7.4 …`). One operation runs at a time (`409` while busy), with a
five-minute timeout. Returns `202` with the operation; poll it for output.

| Field | Type | Required | Description |
|---|---|---|---|
| `op` | `"preview" \| "add" \| "update" \| "remove"` | Yes | Preview a repository, install, update or uninstall |
| `scope` | `"global" \| "project"` | Yes | |
| `projectId` | `string` | When `scope` is `project` | Refused when the project directory is `HOME` |
| `source` | `string` | For `preview` and `add` | `owner/repo` or `https://github.com/…` |
| `skills` | `string[]` | No | Skills of the repository to install |
| `names` | `string[]` | For `update` and `remove` | Installed skill names |
| `agents` | `("claude-code" \| "codex")[]` | No | Agents to install for |

**Response:** `{ id, op, scope, status, output, error, result, startedAt, finishedAt }`

## GET /api/skills/operations/:id

The operation with its output lines so far.

## POST /api/skills/operations/:id/cancel

Cancel the running operation.
