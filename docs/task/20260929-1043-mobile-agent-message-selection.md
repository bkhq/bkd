# 20260929-1043-mobile-agent-message-selection Make agent messages selectable on touch devices

- **status**: completed
- **priority**: P2
- **owner**: claude/session-main
- **createdAt**: 2026-09-29 10:43

## Description

On a phone, long-pressing an agent message in the chat stream does not start a
text selection, so the message cannot be copied. User messages in the same
stream select normally.

The two message kinds take different render paths. A user message is a plain
`div` (`LogEntry.tsx`, `UserMessageEntry`). An agent message goes through
`MarkdownContent`, which runs the whole message body through Shiki
(`codeToHtml(formatted, 'markdown')`) and injects the result with
`dangerouslySetInnerHTML`. Shiki wraps its output in
`<pre class="shiki ..." tabindex="0">`, and `.markdown-shiki .shiki` in
`index.css` sets `overflow-x: auto`.

Three properties of that `<pre>` — none of which the user message has — suppress
long-press-to-select on touch:

1. `tabindex="0"` (emitted by Shiki, verified against the installed version;
   preserved by DOMPurify, whose default allowlist includes `tabindex` —
   `dompurify/src/attrs.ts`). A long press on a focusable element is resolved as
   focus rather than as the start of a selection.
2. `overflow-x: auto` makes the element a horizontal scroll container, so a
   long press is resolved as a pan gesture. The same rule already sets
   `white-space: pre-wrap` and `word-break: break-word`, so the body wraps and
   the horizontal scroll is redundant.
3. The global `* { touch-action: manipulation }` (`index.css`) compounds 1 and 2.
   It applies to both message kinds, so it is not the differentiator on its own.

This is not a touch-event handler problem: neither message component registers
any pointer or touch handler.

Acceptance criteria:

- The rendered markdown container carries no `tabindex`, so the agent message
  body is not focusable.
- `.markdown-shiki .shiki` is not a horizontal scroll container and opts out of
  the global `touch-action: manipulation`, with text selection explicitly
  enabled.
- A regression test covers the absence of `tabindex` in sanitized output.
- No change to how user messages render.

## ActiveForm

Making agent messages selectable on touch devices

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Not verifiable in this container: `agent-browser`'s bundled Chrome fails to
  start (`libatk-1.0.so.0` missing), and long-press-to-select only reproduces on
  a real touch device anyway. The three causes above are confirmed at the code
  level (Shiki output, CSS rule, DOMPurify allowlist); which one dominates needs
  a check on a phone. If selection still fails after this change, `tabindex` is
  the first suspect.

- complete: `bun run test:frontend` 128/128, `bun run lint` (0 errors, 2 pre-existing
  warnings), `bun run typecheck`, `bun run build`. A new regression test in
  `markdown-content.test.tsx` covers the stripped `tabindex`; the CSS half is not
  unit-testable and needs a phone.
