# 20261016-0320-upload-limit-progress Lift the 10 MB upload cap and show global upload progress

- **status**: completed
- **approvedAt**: 2026-10-16 03:30
- **task**: [20261016-0320-upload-limit-progress](../task/20261016-0320-upload-limit-progress.md)
- **createdAt**: 2026-10-16 03:20

## Findings

- `apps/api/src/uploads.ts`: `MAX_FILE_SIZE = 10 MB`, `MAX_FILES = 10`; `validateFiles()` is used by
  issue create, follow-up and `/files/:root/upload`.
- `apps/frontend/src/hooks/use-file-attachments.ts`: client-side mirror of the 10 MB cap.
- `Bun.serve()` in `server-main.ts` sets no `maxRequestBodySize`, so Bun's default 128 MB per request
  is the hidden second cap.
- `postFormData()` in `kanban-api.ts` uses `fetch` (no upload progress) with a 60 s abort timeout.
- Bodies are parsed with `c.req.formData()`, which buffers the whole request in memory.
- Attachments reach engines as file paths, not inline content, so size does not affect prompts.

## Proposal

1. Backend: replace the per-file cap with `MAX_UPLOAD_SIZE` (1 GB, total across the files of one
   request) and set `Bun.serve({ maxRequestBodySize })` to that plus 16 MB for form fields.
2. Frontend: drop the hard-coded 10 MB mirror to the same value.
3. Replace `fetch` in `postFormData()` with `XMLHttpRequest` to get `upload.onprogress`; replace the
   fixed 60 s timeout with an idle timeout (abort only when no progress for 60 s).
4. Add a small zustand `upload-store` (id, label, loaded, total, status) fed by `postFormData()`, and an
   `UploadProgress` floating component mounted once in `main.tsx` (bottom-right, one row per upload,
   auto-hide after completion). i18n keys in `en.json` / `zh.json`.
5. Tests: backend test for a >10 MB upload accepted and over-limit rejected; frontend tests for the
   store and component.

## Risks

- `formData()` buffers in memory: a 1 GB upload costs ~1 GB RSS while parsing. Streaming multipart
  parsing is out of scope.
- A reverse proxy in front of BKD (traefik/nginx) may impose its own body limit.

## Outcome

- Implemented as proposed with the 1 GB total cap (user chose option a).
- Verified against a real server: a 300 MB multipart issue create returns 201; a 1.1 GB body is
  rejected by Bun with 413, which the client reports as `Upload failed (HTTP 413)`.
