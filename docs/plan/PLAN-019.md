# PLAN-019 Upload files from the file browser

- **status**: completed
- **createdAt**: 2026-09-02 02:45
- **approvedAt**: 2026-09-02 02:53
- **relatedTask**: UI-007

## Context

The file browser API lives in `apps/api/src/routes/files.ts`. Every route is
`/api/files/:root/<op>/*` where `:root` is a base58-encoded absolute path.
`resolveRootPath()` decodes the root, rejects roots outside
`workspace:defaultPath` (SEC-007) and rejects sub-paths that escape the root.
`extractPathAfter()` pulls the relative path out of the URL. Existing
operations: `show` (list/preview), `raw` (download), `delete`, `save` (PUT
text, 5 MB cap). There is no write path that accepts arbitrary bytes or a new
file name.

Multipart handling already exists for issue attachments:
`apps/api/src/routes/issues/create.ts` and `message.ts` branch on the
`multipart/form-data` content type, call `c.req.formData()` and collect the
`files` parts. `apps/api/src/uploads.ts` exports `validateFiles()` with
`MAX_FILE_SIZE = 10 MB` and `MAX_FILES = 10`; those limits are mirrored on the
frontend in `hooks/use-file-attachments.ts`. Backend tests send multipart via
`new FormData()` and `app.request()` (`test/api-issues.test.ts`), and file
route tests build a temp workspace and set `workspace:defaultPath`
(`test/security-fs-hardening.test.ts`, which also exports-imports
`encodeRoot`).

Frontend: `lib/kanban-api.ts` has `listFiles`/`rawFileUrl`/`deleteFile`/
`saveFile` plus a `postFormData()` helper (60 s timeout, envelope parsing).
`hooks/use-kanban.ts` exposes `useDeleteFile`/`useSaveFile` mutations that
invalidate the `['files']` query prefix. `components/files/FileBrowserContent.tsx`
owns the header toolbar (`SidePanelButton` icons: copy path, download, delete,
hide-ignored) and renders `FileList` for directories. The content pane already
uses `AlertDialog` for delete confirmation. `FileList` is a plain table with no
drop handling. No frontend test covers the file browser components; API client
behaviour is covered in `__tests__/lib/kanban-api.test.ts` with a mocked
`fetch`.

`docs/api/files.md` documents each file route; `docs/development.md` lists
`/api/files/*` as `GET/POST`.

## Proposal

1. **API** — add `POST /api/files/:root/upload` and
   `POST /api/files/:root/upload/*` in `routes/files.ts` (`handleUpload`).
   - Resolve the target with `resolveRootPath()`; `stat()` it and require a
     directory (400 `Path is not a directory`, 404 on ENOENT).
   - Parse `multipart/form-data`; collect `files` parts and an optional
     `overwrite` scalar (`"true"`/`"1"`). Reject a non-multipart body or an
     empty file list with 400.
   - Validate with `validateFiles()` from `@/uploads` (10 MB / 10 files).
   - Sanitise names: each name must equal its `basename`, not be `.`/`..`,
     and contain no `/` or NUL, else 400.
   - Unless `overwrite` is set, `stat()` each destination first; if any exists
     respond 409 `{ error: 'Already exists: a.txt, b.txt' }` and write nothing.
   - Write with `Bun.write(resolve(target, name), file)`; respond
     `201 { uploaded: [{ name, size }] }`.
2. **Shared type** — `FileUploadResult { uploaded: Array<{ name, size }> }`
   in `packages/shared/src/index.ts`, re-exported via the frontend types.
3. **API client + hook** — `kanbanApi.uploadFiles(root, path, files, overwrite?)`
   builds a `FormData` and calls `postFormData()`; `useUploadFiles()` mutation
   invalidates `['files']` on success, mirroring `useDeleteFile`.
4. **UI** in `FileBrowserContent.tsx`:
   - An `Upload` `SidePanelButton` in the header while `listing.type ===
     'directory'`, wired to a hidden `<input type="file" multiple>`.
   - Drag-and-drop on the content pane while showing a directory: an overlay
     with `fileBrowser.dropToUpload` appears on drag-over; drop calls the
     mutation for the current path.
   - On a 409 `ApiError`, keep the pending files and open an `AlertDialog`
     (`uploadConflictTitle` / `uploadConflictDesc` with the names from the
     error message); confirming retries with `overwrite: true`.
   - Other errors show as a transient line under the header, cleared after
     5 s (same pattern as `use-file-attachments`).
5. **i18n** — `fileBrowser.upload`, `uploading`, `dropToUpload`,
   `uploadConflictTitle`, `uploadConflictDesc`, `replace` in `en.json` and
   `zh.json`.
6. **Docs** — add the route to `docs/api/files.md`.
7. **TDD** — RED first:
   - `apps/api/test/api-files-upload.test.ts`: happy path to root and to a
     sub-directory, 409 then overwrite, 400 for traversal names / file target /
     empty body / oversize, 403 for a root outside the workspace, 404 for a
     missing directory.
   - `__tests__/lib/kanban-api.test.ts`: `uploadFiles` posts a `FormData`
     with `files` parts (and `overwrite`) to the encoded URL.
   - `__tests__/components/file-browser-content.test.tsx`: upload button
     and drop dispatch the mutation with the current root/path; a 409 opens
     the replace dialog and confirming retries with `overwrite`.

## Risks

- Uploads are buffered in memory by `c.req.formData()`; the 10 MB / 10 file
  cap from `uploads.ts` bounds that. Larger files stay out of scope.
- `overwrite` replaces the on-disk file in place; there is no undo. The
  confirmation dialog makes this explicit, matching the delete flow.
- The existence check and the write are not atomic; a race between two
  uploads of the same name is acceptable for a single-user local tool.
- Symlinked directories inside the root are followed, consistent with the
  existing routes (symlink verification was intentionally removed for
  worktrees).

## Scope

Production changes:

- `apps/api/src/routes/files.ts`
- `packages/shared/src/index.ts`
- `apps/frontend/src/lib/kanban-api.ts`
- `apps/frontend/src/hooks/use-kanban.ts`
- `apps/frontend/src/components/files/FileBrowserContent.tsx`
- `apps/frontend/src/i18n/en.json`, `apps/frontend/src/i18n/zh.json`
- `docs/api/files.md`

Test changes:

- `apps/api/test/api-files-upload.test.ts` (new)
- `apps/frontend/src/__tests__/lib/kanban-api.test.ts`
- `apps/frontend/src/__tests__/components/file-browser-content.test.tsx` (new)

No schema migration or dependency change.

## Alternatives

- **Always overwrite silently**: less code (no 409 / dialog) but a stray drop
  could clobber source files without warning. Rejected.
- **Auto-rename on conflict (`name (1).ext`)**: avoids the dialog but hides
  the collision and produces names the user did not ask for. Rejected.
- **Reuse `PUT /save/*` with a binary body**: one file per request and no
  multipart, so no drag-and-drop of several files; also conflates "edit
  existing text" with "add new file". Rejected.
- **Higher per-file limit for workspace uploads**: possible later by giving
  the route its own constant; kept at the shared 10 MB for now so both
  upload paths behave the same.

## Annotations

- 2026-09-02 02:53 — Approved by the user with "开始实现".
- 2026-09-02 03:01 — Completed after TDD, full test suites, lint, typecheck and build.
