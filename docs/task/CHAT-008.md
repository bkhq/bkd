# CHAT-008 Kill duplicate user-message renders + raise bubble contrast

- **status**: completed
- **priority**: P1
- **owner**: Claude
- **createdAt**: 2026-05-12 06:32
- **completedAt**: 2026-05-12 06:35

## Description

User reported two chat-UI regressions from a single screenshot:

1. **"重复渲染"** — the same user message rendered twice as adjacent
   identical bubbles. Root cause: `useIssueStream`'s `logs` useMemo
   merged `olderLogs` + `liveLogs` with `id`-only deduplication. An
   optimistic entry (`id = raw messageId`) in `liveLogs` and its
   canonical counterpart (`id = turn-N-user-{messageId}`) in
   `olderLogs` carried different ids, so both survived the merge and
   both rendered. Existing `findExisting` matched by `messageId`
   inside `appendEntry`/`upsertEntry`, but only within a single
   source array — the cross-array case was not handled.
2. **Low contrast** — user bubbles used `bg-muted/40` on a light
   theme, which sat at ~98% lightness against the page background
   and was effectively invisible. AI replies are plain text, so the
   two speakers blurred together.

### Acceptance criteria

- A user message renders exactly once even when its optimistic id
  and canonical id end up in different source arrays.
- User bubbles are clearly distinguishable from AI replies at a
  glance, including on light themes.
- Pending / done variants keep their amber / emerald accents.
- No backend or API changes.

## ActiveForm

Killing user-message dup renders + raising bubble contrast.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Shipped in commit `1c5cc66 fix(chat): kill duplicate user-message
rendering + raise user bubble contrast`.

### Dedup

Added a second pass in the `logs` useMemo: after the `id`-keyed
dedup, walk the survivors and collapse entries that share a
`messageId` but have different ids, preferring the canonical
(`turn-N-...`) form (its id contains a hyphen; optimistic ids are
bare 26-char ULIDs).

### Visual

`LogEntry.tsx` user-message:

- `bg-muted/40` → `bg-muted` (full opacity)
- `border-l-[2px] border-foreground/40` →
  `border-l-[3px] border-primary/70`
- Added `rounded-r-md` so the bubble reads as a quoted-prompt card.
- Pending (amber) / done (emerald) variants raised to `/80` border +
  `/10` background for the same contrast bump.

All 145 frontend tests stay green; no test changes required.
