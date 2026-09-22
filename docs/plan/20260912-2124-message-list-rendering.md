# 20260912-2124-message-list-rendering Stabilize message-list layout and streaming updates

- **status**: completed
- **createdAt**: 2026-09-12 21:24
- **approvedAt**: 2026-09-13 00:20
- **relatedTask**: 20260912-2116-message-list-rendering

## Context

The user reported frequent stutter and overlapping messages. The working tree was clean before this Full-tier investigation. The findings below describe the baseline before implementation.

The rendering chain is `ChatBody` -> `useIssueStream` -> `useChatMessages` -> `SessionMessages` -> `LogEntry` / `MarkdownContent`. The list switches to absolute-positioned virtual rows at 80 grouped messages. History pagination prepends entries; the live window trims its oldest entries after 500 logs.

Confirmed findings:

1. **P1: Virtual measurements use index identities while React rows use message identities.** `SessionMessages.tsx:293` omits `getItemKey`, so cached sizes follow array indexes after prepending or trimming. Existing DOM rows retain their message keys and dimensions, so ResizeObserver need not emit a replacement measurement. A browser reproduction with 100 variable-height user messages had no overlaps before prepending five older messages. Afterwards, multiple adjacent rows overlapped by 104.75–105.25 px, with other gaps reaching 262.75 px; the defects remained two seconds later. An isolated copy configured with persistent message IDs had no overlaps in the same scenario. This identifies the measurement identity mismatch independently of Markdown rendering.
2. **P2: Streaming can disable bottom following without user input.** `SessionMessages.tsx:188` updates the near-bottom flag for every scroll event, including programmatic smooth scrolling, while lines 219–239 restart smooth scrolling for content growth. In a browser sample of 60 assistant messages, 30 updates spaced 40 ms apart produced only 12 scroll calls and left a 466 px bottom gap. Five more updates produced no scroll calls and increased the gap to 588 px. The code treats its own lagging scroll animation as leaving the bottom.
3. **P2: Updating one message repeats expensive work for unchanged messages.** `use-chat-messages.ts:518` reconstructs every wrapper on log changes, defeating the shallow `ChatMessageRow` memo at `SessionMessages.tsx:13`. `MarkdownContent.tsx:162` calls DOMPurify during each render. A production React browser sample with 60 assistant messages performed 61 sanitizations after one last-message update, and 1,818 sanitizations for 30 updates. HTML cleanup alone took about 304 ms across that latter run. These counts establish unnecessary work; no browser long task over 50 ms occurred in this small sample, so they are not a measurement of the user's device frame rate.

Additional verification targets: history scroll anchoring, threshold crossings, asynchronous highlighting/images, panel-width changes, and session switching. `MarkdownContent` clears highlighted HTML on every content change, creating extra rendering/layout transitions. These are verification targets rather than independently confirmed overlap causes.

Verification performed:

- `bun run test:frontend`: 14 files, 99 tests passed.
- The synthetic browser harness imported actual components and installed dependencies, using production React and existing built CSS; no application API or live records were used.
- Browser: Headless Chromium 124 from the existing local browser image. Scroll container: 800 x 600 px. Numerical values are sample-specific.
- Diagnostic sources are archived in ignored `tmp/message-rendering-20260912-2116/`; they ran from `apps/frontend/tmp/message-rendering/`, which is the relative-import base needed to rerun them. Generated bundles were removed, and the diagnostic server and browser container were stopped. The stable-key variant is an isolated experiment, not an application change.
- No direct virtual-list layout tests exist in the current suite. The local-session page test mocks SessionMessages.
- The installed virtualizer source and [official API documentation](https://tanstack.com/virtual/latest/docs/api/virtualizer#getitemkey) confirm index keys are the default and persistent item IDs should be supplied.

## Proposal

1. Add a regression reproducing history prepend and live-window trim with unequal row heights. Give the virtualizer the same persistent identity as React:

   ```tsx
   const getItemKey = useCallback((index: number) => messages[index].id, [messages])
   const virtualizer = useVirtualizer({
     count: messages.length,
     getItemKey,
     getScrollElement,
     estimateSize: () => 60,
     overscan: 15,
   })
   ```

   Verify measured row positions after insertion, removal, resize, and expansion. Stable keys fix the reproduced overlap; separately preserve the visible message anchor during history insertion and account for content above the list when calculating offsets.
2. Add regressions for sustained streaming while pinned to the bottom and deliberate user scrolling away. Use one coordinated bottom-follow path with animation-frame batching and immediate positioning during streaming. Reconcile dynamic measured heights and preserve deliberate user scrolling; reserve smooth scrolling for explicit navigation actions. Verify both sides of the virtualization threshold.
3. Add a regression counting renders/HTML cleanup for unchanged messages. Make row memoization compare stable render inputs or retain unchanged message references, and memoize sanitized HTML by highlighted HTML value. Ensure duration, tool results, task plans, and subagent updates remain visible. Keep asynchronous highlighting tied to current content without unnecessary intermediate layout churn.
4. Run focused regressions, the full frontend suite, lint/typecheck/build, and `bun run check`. Repeat browser geometry and streaming scenarios on the resulting source.

## Risks

- A custom equality function could hide grouped-tool or metadata updates. Explicitly test those changing inputs.
- Scroll behavior must handle both normal flow and virtual rows while preserving the reader's position during history loading.
- Asynchronous syntax highlighting and lazy images change heights after React commits; verification must await those changes.
- Browser timings vary by device. Operation counts and row geometry are the deterministic acceptance criteria.

## Scope

Frontend rendering and focused regressions, principally `SessionMessages.tsx`, `MarkdownContent.tsx`, and potentially `use-chat-messages.ts` for stable render inputs. Keep existing components and dependencies. No backend, database, API, or framework migration is required.

## Alternatives

- Disable virtualization: removes this cache failure but mounts all loaded history and increases rendering work. Not recommended for long conversations.
- Fix only `getItemKey`: corrects the reproduced overlap, but leaves the independently reproduced scroll-follow failure and unnecessary HTML processing. Suitable if the user chooses an overlap-only scope.

## Annotations

2026-09-13 00:20 UTC: The user approved the proposal. Implementation and regression verification are in progress.


## Implementation and Verification

Completed at 2026-09-13 00:42 UTC.

- The virtualizer and React rows now use the same persistent message IDs. Short lists retain normal document flow while sharing the same measurement cache and end anchor, preserving the reading position when history crosses the 80-row threshold. Row wrappers contain child margins, and list offsets are measured relative to the scroll container.
- Bottom following uses one animation-frame scheduler, immediate positioning, content/viewport resize observation, and no redundant write when already at the bottom. Upward scrolling pauses following. Observers, listeners, native overflow anchoring, and pending frames are cleaned up on unmount.
- Session identity is passed from issue chat and the local-session drawer so scroll state and measurements reset when switching conversations. Initialization also works when the scroll parent mounts in the same commit; short conversations still render without a scroll container.
- Unchanged conversation rows skip rendering. The comparison explicitly includes command output and assistant duration; grouped tools continue receiving updates. Sanitized HTML is cached by highlighted HTML value, and the last highlighted layout remains until its replacement is ready. Stale asynchronous results remain ignored.
- Added 17 regression cases across the two new component test files. Failure was established before each behavior correction; all 116 frontend tests now pass.
- Final browser reproduction with actual components and built CSS: no overlapping rows after history insertion, width changes, or expansion/collapse. Prepending at 20, 79, and 100 rows preserves the same visible message within 0.25 px. Streaming stays at a zero-pixel bottom gap. One update now performs one HTML sanitization instead of 61; 30 updates perform 30 instead of 1,818 (about 16.7 ms versus 304 ms of cleanup in these samples). The final streaming sample had no long tasks; the initial-load sequence recorded one 71 ms task, so this is not a claim that all rendering stalls are eliminated on every device.
- Final gates passed: repository lint (two existing warnings), API/frontend typecheck, all 116 frontend tests, and frontend build. Local diff review found no remaining issues in the changed scope.
- Full `bun run check` was attempted. Its API suite reported 684 pass, 1 skip, 1 fail, and 1 error; the known failure was `Auto-execute on issue creation > async execution transitions to running then completed`, followed by `error: waitFor timed out after 5000ms`. The same test passed in isolation in 213 ms. The existing 2026-09-12 changelog records this full-suite failure on a clean baseline. No backend code was changed for this frontend remediation.

Builds and the final gate sequence ran in the pinned image below with the existing Bun 1.4.0 executable mounted read-only; no software was installed into the working container:

```bash
docker run --rm --label ai-agent=true --network traefik \
  -v /srv/bkhq/bkd:/srv/bkhq/bkd \
  -v /srv/station/work/bin/bun:/usr/local/bin/bun:ro \
  -w /srv/bkhq/bkd \
  node@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d \
  /bin/bash -c 'bun run lint && bun run typecheck && bun run test:frontend && bun run build'
```
