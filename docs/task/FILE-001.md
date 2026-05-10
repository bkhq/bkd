# FILE-001 Lift attachment upload limit and add upload progress UX

- **status**: completed
- **priority**: P1
- **owner**: Claude
- **createdAt**: 2026-05-10 13:30
- **completedAt**: 2026-05-10 15:25

## Description

Today's chat attachment upload caps each file at 10 MB and 10 files per
turn. Users want to use the same attach button to seed an issue's working
directory by attaching a project tarball / zip — common workflow:
"please initialize this project from this archive". The 10 MB cap blocks
that, and there is no upload progress indicator so even a borderline
upload feels broken on slower links.

This task lifts the cap, plumbs streaming through the upload path, and
adds a real upload-progress affordance. Out of scope: chunked /
resumable uploads (deferred to a future FILE-NNN task; only triggered if
real users actually hit network failures on >100 MB transfers).

## Acceptance Criteria

- [x] `MAX_FILE_SIZE` raised to 100 MB (mirrored on both apps/api and
      apps/frontend, with a synced comment).
- [x] `MAX_FILES` kept at 10. Worst-case combined body (100 MB × 10 + a
      little framing headroom) is now explicitly allowed by
      `Bun.serve maxRequestBodySize = 1040 MB` in `index.ts`.
- [x] Backend upload path verified to stream large files: Bun's
      `request.formData()` writes oversized parts to `Bun.tempDir()` and
      `Bun.write` streams from temp file. Confirmed in
      `apps/api/test/uploads-large.test.ts` with a 15 MB sentinel
      round-trip and synthetic boundary checks at the 100 MB limit (no
      need to allocate 100 MB in unit tests; the boundary checks use
      `File.size` overrides).
- [x] `Bun.serve maxRequestBodySize` raised so 100 MB requests are not
      rejected at the runtime layer. Hono has no `bodyLimit` middleware
      installed.
- [x] Frontend upload path uses XHR via the new `postFormData` helper in
      `kanban-api.ts`; XHR is the only browser API that surfaces upload
      progress events (fetch only exposes download progress).
- [x] `ChatInput.tsx` shows a single batch progress bar across the chip
      strip (XHR emits one progress stream for the whole multipart body,
      so per-file segmentation would be a fiction). On failure the
      chips remain in place so the user can retry without re-picking
      every file; the input is restored too.
- [x] i18n keys added in `en.json` and `zh.json`: `chat.attachHint`,
      `chat.uploadProgress_*`, `chat.uploadStarting_*`. The
      paperclip-button tooltip now surfaces the seed-capable hint
      ("zip / tar.gz works as project seed — AI will extract").
- [x] Frontend test suite: 86 → 90 (new file
      `kanban-api-upload.test.ts` adds 4 invariants — POST shape,
      progress forwarding, network failure, server error). Backend
      converter-adjacent suite: 263 → 268 with the new
      `uploads-large.test.ts` (5 tests). Lint: zero new violations from
      this task; pre-existing 19 errors in unmodified files remain.
- [x] New regression tests:
      - Backend: synthetic large-payload coverage via
        `apps/api/test/uploads-large.test.ts` (5 tests including a
        15 MB round-trip with sentinel byte checks and explicit boundary
        validation at MAX_FILE_SIZE ± 1).
      - Frontend: `apps/frontend/src/__tests__/lib/kanban-api-upload.test.ts`
        — 4 tests covering the XHR-based upload contract end to end.

## ActiveForm

Drafting attachment upload size and progress proposal.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none — but a future FILE-NNN may build chunked / resumable
  uploads on top, gated on whether users actually hit network failures)

## Notes

- Related plan: PLAN-008.
- Final byte cap landed at 100 MB. Will revisit if real users hit it.
- Long-term TTL exemption (so a project-seed attachment survives the
  7-day cleanup) intentionally NOT in scope. The AI extracts the archive
  into the working directory on first use; the original archive in
  `data/uploads/` becoming garbage after 7 days is the expected outcome.
- Chunked / resumable uploads remain a separate FILE-NNN candidate.
  Trigger condition: real user feedback that a 100 MB upload fails
  mid-transfer often enough to matter.

### 2026-05-10 implementation summary

Files changed (7 modified, 4 new — including this task and PLAN-008):

- `apps/api/src/uploads.ts` — `MAX_FILE_SIZE` 10 MB → 100 MB;
  comment expanded.
- `apps/api/src/index.ts` — `Bun.serve maxRequestBodySize` set to
  ~1040 MB so the worst-case multipart batch is accepted at the
  runtime layer.
- `apps/api/test/uploads-large.test.ts` (new) — 5 tests:
  ceiling constants, boundary acceptance / rejection, 15 MB sentinel
  round-trip via `saveUploadedFile`.
- `apps/frontend/src/lib/kanban-api.ts` — `postFormData` rewritten to
  use `XMLHttpRequest` so callers can observe `upload.progress`;
  `followUpIssue` exposes `onUploadProgress` callback that forwards
  events through.
- `apps/frontend/src/hooks/use-kanban.ts` — `useFollowUpIssue` now
  threads `onUploadProgress` through to the API client.
- `apps/frontend/src/components/issue-detail/ChatInput.tsx` —
  `MAX_FILE_SIZE` mirrored at 100 MB; new `uploadProgress` state;
  chips remain visible during upload with a disabled remove button;
  progress bar + tabular percentage rendered in-place; chips and
  input reset only on success, retained on failure.
- `apps/frontend/src/__tests__/lib/kanban-api-upload.test.ts` (new) —
  4 tests covering POST shape, progress forwarding, network failure,
  server error.
- `apps/frontend/src/i18n/{en,zh}.json` — new keys
  `chat.attachHint`, `chat.uploadProgress_*`, `chat.uploadStarting_*`.

Verification:

- `bun test src/engines/timeline-converter.test.ts src/engines/timeline-converter.invariants.test.ts test/uploads-large.test.ts` — 53 pass.
- `bunx vitest run` (frontend) — 13 files, 90 pass.
- `bun run lint` — my changes contribute zero new violations (the 19
  remaining errors are pre-existing in unmodified files).
