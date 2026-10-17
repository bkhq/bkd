# 20261016-0424-streaming-multipart-upload Stream multipart uploads to disk instead of buffering

- **status**: completed
- **priority**: P1
- **owner**: claude/streaming-multipart-upload
- **createdAt**: 2026-10-16 04:24

## Description

Multipart uploads (issue create, follow-up, `/files/:root/upload`) are parsed with
`c.req.formData()`, which holds the whole body (up to 1 GB) in memory. Parse the body as a
stream and write each file part to disk as it arrives.

Acceptance:

- A 1 GB upload keeps server RSS bounded (tens of MB), verified against a real server.
- Size and file-count limits are enforced while streaming; an over-limit or malformed upload
  leaves no files behind.
- Request contracts (field names, multipart format, response shapes) are unchanged; the
  frontend needs no change.

## ActiveForm

Streaming multipart uploads to disk

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Follows 20261016-0320-upload-limit-progress.
Plan: [docs/plan/20261016-0424-streaming-multipart-upload.md](../plan/20261016-0424-streaming-multipart-upload.md)

- complete: multipart uploads streamed to disk via @fastify/busboy
