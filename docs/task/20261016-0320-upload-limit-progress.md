# 20261016-0320-upload-limit-progress Lift the 10 MB upload cap and show global upload progress

- **status**: completed
- **priority**: P2
- **owner**: claude/upload-limit-progress
- **createdAt**: 2026-10-16 03:20

## Description

Uploads (issue create / follow-up attachments, file browser upload) are capped at 10 MB per file
by `apps/api/src/uploads.ts` and mirrored in `apps/frontend/src/hooks/use-file-attachments.ts`.
Lift the cap and add a global floating progress bar that shows upload progress.

Acceptance:

- Files larger than 10 MB upload through all three entry points.
- A floating progress indicator shows bytes sent / percentage for every in-flight upload and
  disappears when uploads finish or fail.
- Large uploads are not killed by the 60 s client timeout.

## ActiveForm

Lifting the upload cap and adding upload progress

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: [docs/plan/20261016-0320-upload-limit-progress.md](../plan/20261016-0320-upload-limit-progress.md)

- complete: 1 GB total cap, XHR progress, floating UploadProgress panel
