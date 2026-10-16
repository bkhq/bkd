# 20261016-0424-streaming-multipart-upload Stream multipart uploads to disk instead of buffering

- **status**: completed
- **approvedAt**: 2026-10-16 04:55
- **task**: [20261016-0424-streaming-multipart-upload](../task/20261016-0424-streaming-multipart-upload.md)
- **createdAt**: 2026-10-16 04:24

## Findings

- `Bun.serve()` already streams request bodies: draining a 1000 MB body via `req.body` peaked at
  55 MB RSS. The buffering is entirely in `formData()`.
- `@remix-run/multipart-parser` 1.0.0 is streaming at the message level but collects each part's
  content (`MultipartPart.content: Uint8Array[]`), so one 1 GB file still lands in memory.
- `@fastify/busboy` 3.2.3 (MIT, zero dependencies, published 2026-10-10) emits each file as a
  Node stream with backpressure and supports `files` / `fileSize` limits. Prototype under Bun:
  1000 MB file piped to disk at 68 MB peak RSS, output byte-identical.
- The file browser client appends `overwrite` after the file parts, so the flag is only known
  once all files have been received.

## Proposal

1. Add `@fastify/busboy` to `@bkd/api`.
2. `uploads.ts`: `parseMultipartUpload(request, dir)` streams every `files` part into `dir`,
   collects string fields, enforces `MAX_FILES` and the 1 GB total while streaming, and unlinks
   everything it wrote on any failure. It replaces `saveUploadedFile` / `validateFiles`.
3. Issue create / follow-up: stream straight into `data/uploads/` (final names, same
   `SavedFile` shape); every rejection after parsing (schema, unknown engine, model change,
   rolled-back insert) unlinks the saved files. Follow-up checks the issue exists before reading
   the body.
4. `/files/:root/upload`: check the target directory and file names before writing, stream into
   hidden staging files in the target directory, then rename into place after the conflict check;
   staging files are removed on conflict or error.
5. Errors: malformed body 400, too many files 400, over the size limit 413 (JSON envelope).

## Tests

- Parser: fields and files land on disk with correct content; over-limit and too-many-files fail
  and leave the directory empty; malformed body is 400.
- Routes: create/follow-up rejections leave `data/uploads/` unchanged; file browser upload with
  `overwrite` after the files succeeds; a conflict leaves no staging files.
- Manual: 1 GB upload against a real server with RSS measured.

## Risks

- New runtime dependency in the request path (mitigated: zero transitive deps, widely used via
  undici/fastify).
- A client disconnect mid-upload must abort the parse and clean up; covered by the error path.

## Outcome

- Implemented as proposed. Deviations found while implementing:
  - busboy strips path components from file names by default; `preservePath: true` keeps them so
    `/files/:root/upload` still rejects `../x` instead of silently writing `x`.
  - Under Bun, `Readable.fromWeb(request.body)` emits only `close` (no `error`/`end`) when the
    client disconnects; the parser treats `close` before `end` as an abort, otherwise the request
    hung forever and left a partial file.
  - Follow-up re-reads the issue after the body is received (the pre-check only guards against
    writing uploads for a missing issue), since state can change during a long upload.
  - A follow-up whose dispatch fails keeps its files: the message may already have reached the
    engine. The hourly `upload-cleanup` job reclaims them.
- Real server, 1000 MB random file: issue create and file-browser upload both 201, files
  byte-identical, process peak RSS 104 MB -> 157 MB. 1030 MB file: 413 JSON, nothing left on disk.
  Client killed mid-upload on both routes: no partial or staging files left.
