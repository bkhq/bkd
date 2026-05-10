# CHAT-004 Floating current-prompt hint while scrolling chat history

- **status**: completed
- **priority**: P2
- **owner**: Claude
- **createdAt**: 2026-05-10
- **completedAt**: 2026-05-10

## Description

When reading a long assistant reply, scrolling past the corresponding user
prompt makes it easy to lose track of which question this answer belongs to.
Add a small sticky banner pinned to the top of the chat scroll area that
shows the user prompt of the turn currently being read, and hides itself
once that prompt re-enters the viewport.

Symptoms reported by the user (verbatim, paraphrased):

> 我滑动的时候经常不知道看到了哪个回答上 — wants the current prompt to
> hover while scrolling.

## Scope

Frontend-only UI enhancement in `apps/frontend/src/components/issue-detail/`.
No backend, no schema, no data-hook changes.

## Plan

1. Add a stable DOM anchor to the user-message branch of `LogEntry`:
   `data-user-turn={turnIndex}` on the outer container, so the new component
   can query/observe these nodes from `scrollRef.current`.
2. New component `CurrentPromptHover.tsx`:
   - Props: `messages`, `scrollRef`, `enabled` (false when only one user
     turn — nothing to disambiguate).
   - Uses `IntersectionObserver` rooted on `scrollRef.current` to track
     which user-message anchors are above / inside / below the viewport.
   - Active prompt = the most recent user message whose anchor has
     scrolled out the top edge AND whose anchor is currently above the
     viewport (i.e. user is reading its assistant reply).
   - Falls back to scanning visible anchors directly when virtualization
     is in use (`messages.length > 80`) — anchors below an off-screen
     index are not in the DOM, but the topmost rendered user anchor still
     identifies the active turn.
   - Click handler scrolls the original prompt back into view via
     `scrollIntoView({ block: 'start', behavior: 'smooth' })`.
3. Mount in `ChatBody.tsx` next to existing `ThinkingHover`, vertically
   stacked above it (the prompt hover is the higher-priority context).
   Hidden by default; only renders when `activePrompt` resolves.
4. i18n keys `chat.currentPrompt.viewing` (en + zh) and ARIA label.
5. Tests in `apps/frontend/src/__tests__/components/CurrentPromptHover.test.tsx`:
   - Renders nothing when zero/one user turns exist.
   - Renders the most-recent above-viewport user message's content.
   - Updates when a different user turn scrolls past the top.
   - Click triggers `scrollIntoView` on the matching anchor.
   - Truncates long content to a single line (`line-clamp-1` class
     present + raw content available via `title` attribute).

## Out of scope

- Reworking `ThinkingHover` or the existing scroll buttons.
- Persisting the active prompt across reload.
- Anchoring to assistant-message turns (only user prompts are surfaced).

## Verification

- `bun --filter @bkd/frontend lint`
- `bun run test:frontend` (or scoped `bunx vitest run` on the new test file)
- Manual smoke: open a multi-turn issue, scroll up — banner appears with
  the right prompt; scroll the prompt back into view — banner disappears.
