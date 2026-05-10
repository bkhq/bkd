# PLAN-008 Lift attachment upload limit and add upload progress UX

- **status**: completed
- **createdAt**: 2026-05-10 13:30
- **approvedAt**: 2026-05-10 13:45
- **completedAt**: 2026-05-10 15:25
- **relatedTask**: FILE-001

## Context

### Today's upload path

Attach button in `ChatInput.tsx` collects `File[]` from a hidden
`<input type="file" multiple>`. On send, `followUp.mutateAsync` POSTs
`multipart/form-data` to `POST /api/projects/:projectId/issues/:id/follow-up`.

Backend `parseFollowUpBody` calls `await c.req.formData()` and pulls
`files` out of the FormData. Each entry is validated by
`validateFiles` then written via `saveUploadedFile` to
`data/uploads/<ulid>.<ext>`. An `attachments` row is inserted linking the
file to the issue / log entry. The engine receives the absolute paths
via `EngineAttachment[]` and inlines them into the AI prompt.

Cleanup: `cron/actions/builtins/upload-cleanup.ts` walks `data/uploads`
every hour and deletes any file whose mtime is > 7 days. It does not
consult the attachments table, so the cleanup is purely
filesystem-based.

### Where the limits live

| Location | Constant | Value |
|---|---|---|
| `apps/api/src/uploads.ts:6` | `MAX_FILE_SIZE` | 10 * 1024 * 1024 (10 MB) |
| `apps/api/src/uploads.ts:7` | `MAX_FILES` | 10 |
| `apps/frontend/src/components/issue-detail/ChatInput.tsx:51` | `MAX_FILE_SIZE` | 10 * 1024 * 1024 |
| `apps/frontend/src/components/issue-detail/ChatInput.tsx:52` | `MAX_FILES` | 10 |
| Hono / Bun.serve | (no explicit body limit found) | n/a |

### Memory profile (verified)

Bun's `request.formData()` writes files larger than a small inline
threshold to `Bun.tempDir()` automatically and surfaces them as `File`
objects backed by temp files. `Bun.write(absolutePath, file)` then
streams from that temp file. So the upload path is **already streaming
end-to-end** for large files — the 10 MB cap was conservative, not
required by the runtime.

### Engine integration

`message.ts` builds a `--- Attached files ---` block in the prompt and
exposes `engineAttachments` (path + name + mime) to the executor. The
AI sees the absolute path and may run `unzip`, `tar -xf`, or any other
inspection it chooses. This is the natural extension point that lets a
"big zip = project seed" workflow work today *if the size cap is
lifted*.

## Proposal

Three layers, each shippable independently. Each layer is gated by
tests written first where applicable.

### Layer A — Size cap and validation (P0)

#### A1. Bump constants

```ts
// apps/api/src/uploads.ts
export const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB
export const MAX_FILES = 10                    // unchanged
```

```ts
// apps/frontend/src/components/issue-detail/ChatInput.tsx
const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_FILES = 10
```

Final byte value to be confirmed via PLAN annotation. 100 MB covers most
hand-crafted project tarballs (a fresh Node project zips to ~5–20 MB; a
medium TS monorepo with build artefacts zips to ~30–80 MB; if 100 MB is
too tight, the value is a single constant change).

#### A2. Confirm Hono / Bun body-size guard

`apps/api/src/app.ts` is the global Hono app. Audit it for any
`bodyLimit` middleware or `Bun.serve` `maxRequestBodySize` setting; if
present, raise to `MAX_FILE_SIZE * MAX_FILES + 4 MB` headroom for
multipart framing. If absent, document the runtime default.

#### A3. Add a synthetic large-payload test

```ts
// apps/api/test/uploads-large.test.ts
it('accepts a 100 MB synthetic file end-to-end', async () => {
  const buffer = new Uint8Array(100 * 1024 * 1024)
  const file = new File([buffer], 'seed.bin', { type: 'application/octet-stream' })
  const validation = validateFiles([file])
  expect(validation.ok).toBe(true)
  const saved = await saveUploadedFile(file)
  const stat = await Bun.file(saved.absolutePath).stat()
  expect(stat.size).toBe(buffer.byteLength)
})
```

Deliberately not testing through Hono — we only assert that the upload
helpers handle the new ceiling. A full round-trip via `app.fetch` with a
100 MB payload would inflate test time without adding signal.

### Layer B — Frontend progress affordance (P0)

#### B1. Switch upload from fetch to XHR for progress events

`fetch` does not surface upload progress in the browser (only download
progress via `ReadableStream`). The follow-up POST currently goes
through React Query's mutation; we extract the upload submission into a
helper that uses `XMLHttpRequest` so we can observe `upload.onprogress`.

Sketch:

```ts
// apps/frontend/src/lib/kanban-api.ts (new helper)
export interface UploadProgressEvent {
  loaded: number
  total: number
}

export function submitFollowUpWithProgress(
  url: string,
  formData: FormData,
  onProgress?: (e: UploadProgressEvent) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total })
      }
    })
    xhr.onload = () => {
      const headers = new Headers()
      // Reconstruct a Response so the existing mutateAsync code path
      // (which expects fetch's Response) keeps working.
      resolve(new Response(xhr.response, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers,
      }))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(formData)
  })
}
```

#### B2. Track per-file progress in ChatInput

`attachedFiles` state currently holds `File[]`. Extend to
`{ file: File; progress: number; status: 'pending' | 'uploading' | 'done' | 'error' }[]`.
Render a thin progress bar at the bottom of each chip and a `%` label
once `progress > 0`.

Token budgets in proposal: ~40 LoC component change, ~30 LoC for a new
`AttachmentChipProgress` subcomponent, ~10 LoC for the helper.

#### B3. Tests

```tsx
// apps/frontend/src/__tests__/components/ChatInputUpload.test.tsx
it('shows progress percent while uploading a 50 MB file', async () => {
  // Mock XHR with controlled progress events (use vitest spy on
  // XMLHttpRequest.prototype.send).
  ...
  expect(screen.getByText('45%')).toBeInTheDocument()
})

it('renders error state when upload fails', async () => {
  ...
  expect(screen.getByText('chat.uploadFailed')).toBeInTheDocument()
})
```

### Layer C — Tooltip / placeholder language (P1)

#### C1. i18n updates

```json
// en.json
"chat.attachHint": "Attach files (≤ 100 MB each). Archives like zip / tar.gz work — the AI will extract them into the working directory.",
"chat.uploadFailed": "Upload failed",

// zh.json
"chat.attachHint": "附加文件（每个 ≤ 100 MB）。也可以传 zip / tar.gz 压缩包，AI 会自动解压到工作目录。",
"chat.uploadFailed": "上传失败",
```

Update the attach button tooltip and the empty-state hint in
`ChatInput.tsx` to reference the new key.

#### C2. Optional: add a small "?" hover near the attach button

Surfaces the same hint inline so users discover the seed-capable
behaviour without reading docs. ~10 LoC.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 100 MB still too tight for some users | Medium | Low | Single constant change to bump; expose as `appSettings` later if churn is high. |
| Bun multipart temp-file path breaks under 100 MB on disks with limited tmpfs | Low | Medium | Document; users on container hosts may need to bind-mount a larger `/tmp`. Add a runtime warning if temp write fails. |
| Browser memory holding a 100 MB File before upload | Low | Low | The browser already holds the File object regardless of upload size; XHR streams it from there. No extra cost. |
| XHR replacement breaks existing test harness (mocks `fetch`) | Medium | Low | Wrap XHR in a helper so tests can mock the helper. Keep fetch for non-multipart paths. |
| Network failure mid-100MB-upload leaves user in limbo | Medium | Medium | Out of scope for this task — call out chunked / resumable as the followup. Add clear error state + a "remove and retry" affordance per chip in this layer. |
| Engine workflow expects small attach context — sending a 100 MB zip path inlined into the prompt is fine, but engines that try to *embed* file content might choke | Low | Low | Today's prompt only inlines path + name; no engine reads the file content into the prompt automatically. Pinned by inspection of `buildFileContext`. |

## Scope

- Backend: `apps/api/src/uploads.ts` (constants + comment); audit
  `apps/api/src/app.ts` for body-size middleware (likely no change).
- Backend tests: 1 new file `apps/api/test/uploads-large.test.ts`.
- Frontend: `apps/frontend/src/components/issue-detail/ChatInput.tsx`,
  new helper in `apps/frontend/src/lib/kanban-api.ts`, new
  `AttachmentChipProgress` subcomponent.
- Frontend tests: 1 new file under
  `apps/frontend/src/__tests__/components/`.
- i18n: 2 new keys in `en.json` + `zh.json`.

Estimated diff: ~+250 / -30 LoC across ~7 files. No DB migration. No
new endpoints. No dependency changes.

## Alternatives

### Alt 1: Skip XHR, accept "no progress bar"

Pros: zero frontend rework, just a constant bump.
Cons: user pain on slow links is the original motivation. If the only
problem is the cap, this might be acceptable for v1; they can re-attach
on failure since the 10-file cap stays.

Punt risk: deferring B1+B2 means we never collect signal on whether the
new ceiling causes UX problems. Rejected unless user explicitly
prioritises ship-speed.

### Alt 2: Add server-side `appSettings` knob now

Pros: deployment-time tuning per user.
Cons: extra config surface, no clear demand signal yet. Deferred to a
follow-up plan if the constant becomes a friction point.

### Alt 3: Build chunked + resumable now (the original "Y" path)

Pros: solves > 100 MB and flaky-network at once.
Cons: ~10x the effort, new state machine, ongoing maintenance. Plan-007
guideline: don't pay that bill before there's user pressure for it.
Rejected for this iteration.

### Alt 4: Add a `purpose: 'project-seed'` attachment flag and exempt
those from the 7-day cleanup

Pros: cleaner long-term semantics — seed archive survives if user wants
to re-extract later.
Cons: adds a column / migration / cleanup branch. Not justified by the
current workflow (AI extracts on first use; original archive is
disposable). Punt.

## Annotations

- 2026-05-10 13:45 — User approved with `apply 这个方案`. Status moved
  to `implementing`.
- 2026-05-10 14:50 — Layer B2 deviation from proposal: a single
  whole-batch progress bar replaced the per-chip progress affordance
  the proposal hinted at. Rationale: `XMLHttpRequest.upload.progress`
  emits one progress stream for the entire multipart body, not per
  file part. Faking per-file progress would have been visually
  appealing but not truthful. The single bar is labelled with file
  count and percent and lives in the chip-strip slot above the
  textarea.
- 2026-05-10 14:55 — Layer B2 deviation: chips and input are no longer
  cleared synchronously when the user presses send. Instead they
  remain visible during the upload (with the remove button disabled)
  and reset only on success. On failure the chips stay in place so
  the user can retry without re-picking every file — the original
  proposal called for this only as a "remove and retry" affordance,
  but the simpler "leave-them-as-they-were" flow turned out to be
  cleaner.
- 2026-05-10 15:00 — Layer A2 finding: `Bun.serve` had no explicit
  `maxRequestBodySize` setting; Bun's default would have rejected the
  worst-case 1 GB multipart batch (100 MB × 10 files). Set
  `maxRequestBodySize` to 1040 MB explicitly so the new
  `MAX_FILE_SIZE` × `MAX_FILES` ceiling is honoured at the runtime
  layer. Documented in-line in `index.ts`.
- 2026-05-10 15:25 — Verification complete. Backend upload tests
  53 pass / 0 fail (was 48 before, +5). Frontend tests 90 pass / 0 fail
  (was 86 before, +4). Lint: zero new violations from this task.
  Status moved to `completed`.
