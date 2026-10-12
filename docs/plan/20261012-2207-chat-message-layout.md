# 20261012-2207-chat-message-layout Flatten chat headings, add an agent message surface, restore message actions

- **status**: completed
- **createdAt**: 2026-10-12 22:07
- **approvedAt**: 2026-10-12 22:20
- **relatedTask**: 20261012-2028-chat-heading-size-and-agent-bg

## Context

- `MarkdownContent` dispatches on the `renderMarkdown` preference: `MarkdownSource`
  (Shiki-highlighted source, default) or streamdown.
- In render mode streamdown's default headings are `text-3xl` / `text-2xl` /
  `text-xl` / `text-lg` (30 / 24 / 20 / 18px) against a 14px message body.
- `AssistantMessage` in `LogEntry.tsx` has no surface; user messages have a left
  bar and `bg-muted/30`.
- Before #144 (UI-009) assistant messages had two top-right hover actions:
  "View as Markdown" (a 90vw dialog rendering the message through
  `MarkdownRenderer`) and "Copy message". UI-009 replaced them with footer
  icon buttons (copy text / copy Markdown) and removed the dialog and the
  `session.viewMessage` key. `session.copyMessage` still exists.

## Proposal

1. Headings (`MarkdownContent.tsx`, render mode only): custom `h1`-`h6`
   streamdown components on a compressed, ChatGPT-like scale in `em`
   (1.5 / 1.25 / 1.1 / 1), bold or semibold, no `#` marker, more space above
   than below.
   Tables: custom `table` / `thead` / `th` / `td` components without the
   double frame and control bar, rows separated by hairlines, tighter cells.
2. Agent surface (`LogEntry.tsx`): wrap the assistant body in a rounded tinted
   container, in both render modes, without the left bar user messages have.
3. Actions (`LogEntry.tsx`): restore "View as Markdown" (dialog rendering the
   message through `MarkdownRenderer`) as a footer icon button beside the copy
   actions. Re-add `session.viewMessage` to `en.json` and `zh.json`.
4. Tests first: heading marker and size in `markdown-content.test.tsx`;
   surface, restored actions and dialog in `assistant-message-actions.test.tsx`.

## Risks

- The dialog renders document-style headings (file-browser renderer), not the
  flattened chat headings.

## Scope

`MarkdownContent.tsx`, `LogEntry.tsx`, `en.json`, `zh.json`, two test files,
`docs/changelog.md`. Frontend only.

## Alternatives

- Body-size headings with a `#` marker (source-view look); rejected by the
  user in favour of the ChatGPT-like scale.
- Top-right hover actions as before UI-009; the user chose the footer.

## Annotations

- 2026-10-12: user chose ChatGPT-style headings and asked for more compact
  tables.
