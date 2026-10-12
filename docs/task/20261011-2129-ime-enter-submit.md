# 20261011-2129-ime-enter-submit Ignore IME-composition Enter in single-line editors

- **status**: completed
- **priority**: P2
- **owner**: claude/session-audit-fixes
- **createdAt**: 2026-10-11 21:29

## Description

With a Chinese IME, the Enter that confirms a candidate reaches the issue
title editor as a plain `keydown Enter` and saves the half-typed title.
The same `if (e.key === 'Enter')` pattern is in the kanban panel title
editor, the tag editor and the new-folder input of the directory picker.

Acceptance:

- Enter during IME composition (`nativeEvent.isComposing`, or the Safari
  `keyCode 229` form) does not submit in any of the four inputs; a plain Enter
  still does.
- One helper, unit-tested, used by all four.

## ActiveForm

Ignoring IME-composition Enter in editors

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Standard tier; approval given in the request. The chat input uses
Cmd/Ctrl+Enter and is not affected.

- complete: keyboard.test.ts RED then GREEN; frontend suite 150/150, lint and typecheck pass. Not verified with a real IME in a browser.
