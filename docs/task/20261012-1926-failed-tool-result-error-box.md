# 20261012-1926-failed-tool-result-error-box Keep failed tool results inside their tool call

- **status**: completed
- **priority**: P2
- **owner**: roy/failed-tool-result-error-box
- **createdAt**: 2026-10-12 19:26

## Description

A tool call that fails (`is_error: true`, e.g. a Bash command exiting non-zero)
shows up in the chat as a standalone red error box, while the tool call itself
renders with no output. Ordinary output lands in the error box too: `git diff`
exiting 1 prints its whole diff there.

The normalizers emit a failed tool result as `error-message` with
`isResult: true`. `rebuildMessages` (`use-chat-messages.ts`) pairs results with
their call only when the entry type is `tool-use`, so a failed result is never
paired and falls through to the generic `error-message` branch.

Acceptance:

- A failed tool result is paired with its tool call and produces no error message.
- An `error-message` without the result flag still renders as an error.

## ActiveForm

Pairing failed tool results with their tool call

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Standard tier; the bug report is the request to fix.

- complete: use-chat-messages.test.ts RED then GREEN; lint and typecheck pass; frontend 181/181. Not checked in a browser.
