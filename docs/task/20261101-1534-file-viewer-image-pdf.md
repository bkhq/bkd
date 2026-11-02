# 20261101-1534-file-viewer-image-pdf Preview images and PDFs in the file browser

- **status**: completed
- **priority**: P2
- **owner**: main
- **createdAt**: 2026-11-01 15:34

## Description

The file browser previews text and renders Markdown, but images and PDFs show a
"binary file" placeholder, and SVG shows as XML source.

Goal: show images (incl. SVG, with a source toggle) inline via the raw-file API,
and PDFs in an iframe using the browser's built-in viewer. The raw route gains
`?inline=1`, honored for PDFs only, which serves `Content-Disposition: inline`
and relaxes `frame-ancestors` to `'self'` for that response. Everything else
keeps downloading as an attachment.

## ActiveForm

Adding image and PDF previews to the file browser

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Scope moved from the dead `FileViewer`/`FileBrowserPage` (unrouted) to `FileEditor`, which the drawer renders; both dead files and their orphaned `fileBrowser.*` i18n keys were removed.
- SVG follows the Markdown pattern: opens in the editor, the preview toggle shows the image.
- Inline PDF responses also get `object-src 'self'` for Chrome's plugin-based viewer.
- complete: bun run check passed (999 API, 409 frontend tests). Not verified in a real browser (no browser in the container).
