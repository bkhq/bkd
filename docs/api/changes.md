# Issue Changes

## GET /api/projects/:projectId/issues/:id/changes

Get git changes summary for an issue's working directory. Resolves worktree directory if `useWorktree` is enabled.

**Response:**

```json
{
  "success": true,
  "data": {
    "root": "/path/to/repo",
    "gitRepo": true,
    "files": [{
      "path": "...",
      "status": "M ",
      "type": "modified|added|deleted|renamed|untracked|unknown",
      "staged": true,
      "unstaged": false,
      "previousPath": "old/path",
      "additions": 5,
      "deletions": 2
    }],
    "additions": 10,
    "deletions": 5
  }
}
```

Returns `gitRepo: false` with empty files if the directory is not a git repository. When the issue uses a worktree that does not exist (not created yet, or cleaned up), the response carries `worktreeMissing: true` and no files: the main checkout's changes are not the issue's. `timedOut: true` means git did not answer within 15 seconds. A file over 20 MB is flagged `oversized` with a `sizeDisplay` and counts as zero lines.

The web UI reviews changes in the file manager ([fm.md](./fm.md)); these two routes remain for API clients.

## GET /api/projects/:projectId/issues/:id/changes/file

Get diff for a specific file. Returns unified diff patch, old text, and new text.

| Query Param | Type | Description |
|---|---|---|
| `path` | `string` | File path (must not start with `-` or contain `:` per SEC-019) |

**Security:** Path is validated to be inside the working directory root (SEC-019). Previous path (for renames) is also validated.

**Response:**

```json
{
  "success": true,
  "data": {
    "path": "...",
    "patch": "...",
    "oldText": "...",
    "newText": "...",
    "truncated": false,
    "type": "modified|added|deleted|renamed|untracked",
    "status": "M "
  }
}
```

Content is truncated at 200,000 characters with a `[truncated]` marker. An oversized file returns an empty patch with `oversized: true`.
