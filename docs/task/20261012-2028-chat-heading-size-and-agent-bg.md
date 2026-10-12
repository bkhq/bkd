# 20261012-2028-chat-heading-size-and-agent-bg Flatten chat Markdown headings and give agent messages a background

- **status**: completed
- **priority**: P2
- **owner**: cd/chat-heading-agent-bg
- **createdAt**: 2026-10-12 20:28

## Description

With "Render Markdown in chat" on, streamdown renders headings at its default
sizes (`h1` is `text-3xl`), which dwarfs the 14px message body and breaks the
visual rhythm of the chat. Agent messages also have no surface of their own, so
they blend into the page background.

Proposal:

- `MarkdownContent` passes custom `h1`-`h6` components to streamdown on a
  compressed, ChatGPT-like `em` scale, and compact table components. Chat
  only; the file-browser `.md` preview keeps document-style headings.
- `AssistantMessage` wraps the message body in a tinted rounded surface,
  applied in both source and render modes, visually distinct from the
  left-bar user message.
- Restore the "View as Markdown" dialog removed by UI-009, as a footer
  action beside the copy buttons. Plan:
  `docs/plan/20261012-2207-chat-message-layout.md`.

Acceptance criteria:

- In render mode headings are at most 1.5x the surrounding text.
- Tables render without the framed wrapper and with tighter cells.
- Agent messages sit on a background distinct from the page and from user
  messages, in light and dark themes.
- The file-browser Markdown preview is unchanged.
- The agent message footer has view and copy actions; view opens a dialog
  with the rendered message.
- Focused vitest cases pass, then the frontend suite, lint, typecheck.

## ActiveForm

Flattening chat Markdown headings and adding an agent message background.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(none)

- complete: Focused tests, frontend suite (185 passed), lint and typecheck passed; not checked visually in a browser.
