# 20261012-0902-chat-markdown-render-toggle Keep the Shiki source view as the default chat renderer, opt into Markdown rendering

- **status**: completed
- **priority**: P2
- **owner**: cd
- **createdAt**: 2026-10-12 09:02

## Description

#144 (UI-008) replaced the chat renderer outright: assistant messages and tool
results went from Shiki-highlighted Markdown *source* to streamdown-rendered
Markdown. The user wants the previous view back as the default, with Markdown
rendering available behind a display setting.

Proposal:

- Restore the pre-#144 renderer (the `cd3e991` version, which already carries
  the touch-selection fix) as `MarkdownSource.tsx`, together with its
  `.markdown-shiki` CSS.
- `MarkdownContent` becomes a dispatcher over a new `renderMarkdown`
  preference in `useViewModeStore` (localStorage, default `false`), so the
  three call sites in `LogEntry` / `ToolItems` need no change.
- Settings > General gets a "Render Markdown in chat" switch next to
  "Full-width chat"; it is a per-browser display preference like that one,
  not a server setting.
- In source mode the footer shows only "Copy Markdown": rendered text and
  source are identical there, so "Copy text" would duplicate it.
- Out of scope: the file-browser `.md` preview stays on streamdown (its
  previous renderer, react-markdown, was already a Markdown renderer).

Acceptance criteria:

- With the switch off (default), assistant messages show highlighted Markdown
  source exactly as before #144, including the touch-selection fix.
- With the switch on, messages render through streamdown as in #144.
- The switch persists across reloads; i18n keys exist in `en.json` and
  `zh.json`.
- Footer copy actions: one button in source mode, two in render mode.
- Focused vitest cases pass, then the frontend suite, lint, typecheck, build.

## ActiveForm

Adding the chat Markdown render toggle.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Requested by the user on 2026-10-12 after reviewing #144 on the
  `release` branch; implemented directly on `release` and noted in #145.
- `MarkdownSource.tsx` is the `cd3e991` renderer verbatim apart from the
  export name; its `.markdown-shiki` CSS block is restored unchanged.
- The preference is a `useViewModeStore` field (`bkd-render-markdown` in
  localStorage), so the settings switch lives beside "Full-width chat".

- complete: focused tests, frontend suite, lint, typecheck and build passed.

## Verification

- `markdown-content.test.tsx`: new default-mode case (source shown, no
  rendered `strong`), existing streamdown cases now opt in via the store.
- `assistant-message-actions.test.tsx`: new case, one copy button in source
  view.
- New `view-mode-store.test.ts`: default `false`, persisted to localStorage.
- Frontend suite: 25 files, 164 passed. `bun run lint` 0 errors (2
  pre-existing warnings), `bun run typecheck` both workspaces, `bun run build`.
