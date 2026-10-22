# 20261021-0915-command-summary-width Let command summaries fill the row instead of a fixed cut

- **status**: completed
- **priority**: P2
- **owner**: main/issue-menu-20261015
- **createdAt**: 2026-10-21 09:15

## Description

Bash rows in a tool group showed the command cut to 80 characters plus " .....", so on a
wide chat the text stopped well short of the row and was truncated anyway. The grouped
command title in `LogEntry` did the same at 90 characters.

Acceptance criteria:

- The summary carries the whole command on one line and CSS truncates it at the row's
  width (`min-w-0` + `truncate`); the full command is the hover title.
- The expanded body still repeats the full command for long or multi-line commands.

## ActiveForm

Letting command summaries fill the row

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

- complete: Width-based truncation; browser-measured at 1400 and 900px
