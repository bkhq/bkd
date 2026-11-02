# 20261102-1023-file-browser-polish File browser fixes, recoverable delete, create/rename, quick open, virtual tree

- **status**: completed
- **createdAt**: 2026-11-02 10:23
- **approvedAt**: 2026-11-02 10:23
- **relatedTask**: 20261102-1023-file-browser-polish

## Context

- `apps/api/src/routes/files.ts`: `show` reads up to 1 MB before the binary check and
  can cut a UTF-8 sequence at the cap; directory listings stat entries one by one;
  `raw` sends no validators; `delete` is a permanent `rm -rf`. No create, rename or
  search endpoints.
- Frontend: `FileList` shows relative English dates ("3d ago"), keeps a dead
  `breadcrumb` prop and a second delete dialog; `FileTree` re-sorts entries the
  server already sorted and renders every row of an expanded directory.

## Proposal

A. Fixes
1. `FileList` dates: concrete local date and time.
2. `show`: sniff the first 8 KB for binary, read text only then.
3. Truncated text drops a trailing partial UTF-8 sequence.
4. Directory entries are stat'ed in parallel.
5. `FileList`: drop `breadcrumb` and its own delete dialog; deletes go through the
   browser's dialog.
6. `FileTree`: use the server order.
7. `raw`: `Last-Modified` + `Cache-Control: no-cache`, 304 on `If-Modified-Since`.

B. Features
1. Delete moves into `data/trash/files/` (copy + remove across filesystems); a
   daily builtin cron `trash-cleanup` purges entries older than 7 days.
2. `POST /files/:root/create/*` (`{ type: file | directory }`, 409 if it exists) and
   `POST /files/:root/rename/*` (`{ to }`, root-relative, 409 if the target exists).
   UI: "New file" / "New folder" on directories and the tree header, "Rename" on every
   entry, via one name dialog; drafts under a renamed path are dropped, an open file
   follows its rename.
3. `GET /files/:root/search?q=`: candidates from `git ls-files -co --exclude-standard`
   in a git checkout, else a bounded walk (skips `.git`, `node_modules`, symlinked
   dirs); fuzzy-ranked server side, top 50. UI: a quick-open command dialog from a
   tree header button and Ctrl/Cmd+P inside the browser.
4. `FileTree` flattens expanded directories into rows rendered with
   `@tanstack/react-virtual`.

## Verification

- API tests for show/raw/delete/create/rename/search; frontend tests for FileList
  dates, name dialog flows, quick open, virtual tree.
- `bun run check`.
