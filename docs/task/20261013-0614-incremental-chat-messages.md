# 20261013-0614-incremental-chat-messages Rebuild chat messages incrementally instead of on every log change

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-10-13 06:14

## Description

`useChatMessages(logs)` regroups the whole log list (live + loaded older
pages) on every change, so each SSE event during a running turn costs
O(total loaded entries). With thousands of loaded history entries (many
"load more" clicks, or a navigator jump to an early turn) live streaming can
stutter. Process appended entries incrementally and only rebuild on prepends
or edits.

Acceptance: identical `ChatMessage[]` output to the current rebuild (existing
`use-chat-messages` tests plus an equivalence test); appending one entry
does not walk the full list.

## ActiveForm

Making chat message grouping incremental.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Raised while planning `20261013-0553-turn-navigator-full-history`.
