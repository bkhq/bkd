# PLAN-004 Enable AskUserQuestion in claude-code-sdk executor (web UI answer flow)

- **status**: draft — awaiting approval
- **createdAt**: 2026-04-18
- **approvedAt**:
- **relatedTask**: ENG-002

## Progress

- Not started. Feasibility analysis complete (see Context).

## Context

The legacy `claude-code` executor and the new `claude-code-sdk` executor both
block the SDK's built-in `AskUserQuestion` tool via `disallowedTools`. Current
sites on the SDK path:

- `apps/api/src/engines/executors/claude-sdk/executor.ts:305` — discovery query
- `apps/api/src/engines/executors/claude-sdk/executor.ts:376` — `startQuery`

The legacy executor also disables it in its `CommandBuilder` flag list (out of
scope for this plan; scope is SDK backend only).

### Why it was disabled

When the integration was first built there was no bidirectional surface for the
web UI to receive a tool call, pause the run, collect the user's choice, and
return a tool result. Blocking the tool prevented the model from stalling on an
unanswered question.

### Why it is feasible now

The SDK exposes two primitives that together let us implement the round trip
without protocol hacks:

1. `AskUserQuestion` is a *normal tool* from the model's perspective. The SDK
   emits it as an assistant `tool_use` with the question payload in the tool
   input. We already observe every `SDKMessage` in `startBridge`
   (`executor.ts:147`) and normalize it through `ClaudeSdkNormalizer`.
2. The prompt stream is user-controlled. `protocolHandler.sendUserMessage`
   already pushes `SDKUserMessage` into the `PushableStream`. A user message
   whose `content` is an array of `tool_result` ContentBlocks is how the SDK
   conveys "here is the answer to that tool call" — the same shape the SDK's
   internal permission tool uses.

So the mechanism is: **allow the tool, capture `tool_use_id` from the stream,
surface the question to the UI, then inject a `tool_result` user message when
the user answers.**

### Tool input shape (from SDK 0.2.114)

`AskUserQuestion` tool input is:

```typescript
{
  questions: Array<{
    question: string            // prompt text
    header: string              // short title (≤12 chars per SDK)
    multiSelect: boolean        // allow multiple answers
    options: Array<{
      label: string             // option title (≤28 chars)
      description: string       // sub-label
    }>
  }>
}
```

Result shape expected by the model (wrap in `tool_result.content`):

```typescript
{
  answers: Array<{ header: string, selected: string[] }>
}
```

Plan-level contract: one AskUserQuestion tool call = one "ask-user-question"
log entry emitted with `{tool_use_id, questions}` metadata, parked until the
UI posts the answers, then a `tool_result` injected back and a paired result
entry recorded for the chat timeline.

### Downstream touch points

| Layer | File | Change |
|---|---|---|
| SDK executor | `executors/claude-sdk/executor.ts` | Remove `AskUserQuestion` from `disallowedTools`; detect the tool_use in stream; register pending question with the issue engine |
| Normalizer | `executors/claude-sdk/normalizer.ts` | Special-case `AskUserQuestion` tool_use → emit dedicated entry type so the UI can render a question bubble instead of generic tool card |
| Shared types | `packages/shared/src/index.ts` | Add `'ask-user-question'` to `LogEntryType`; add `AskUserQuestionMeta` shape |
| Persistence | `engines/issue/streams/persistence.ts` (or log classifier) | Route the new entry type identically to other tool entries; store questions blob in metadata |
| Pending-answer registry | new `engines/issue/ask-user-question.ts` | Map `issueId -> {tool_use_id, questions, createdAt}`; cleared when the answer posts or the run cancels |
| API route | `routes/issues/ask-user-question.ts` (new) | `POST /api/projects/:projectId/issues/:id/answer-question` — validates answer shape, looks up executor's `protocolHandler.sendUserMessage`, pushes `tool_result`, records "user answer" log entry |
| Frontend hook | `hooks/use-kanban.ts` | `useAnswerQuestion` mutation |
| Frontend UI | `components/issue-detail/chat/AskUserQuestionBubble.tsx` (new) | Renders question + option buttons; disabled after answer or when engine is not `claude-code-sdk`; wires into `ChatBody` message rendering |
| i18n | `i18n/{en,zh}.json` | Strings: "Waiting for your answer…", "Send answer", "Cancelled", etc. |

### Not in scope

- Legacy `claude-code` executor (still disables the tool; can be lifted after
  PLAN-003 Step 4 flips SDK default).
- Interactive approval for other tools (those remain auto-approved by the
  `canUseTool` callback).
- Rich answer types beyond option buttons (freeform text, file picker, etc.).

## Proposal

### Step 1 — Unblock the tool + capture tool_use_id in the stream

- Remove `'AskUserQuestion'` from `disallowedTools` at `executor.ts:305` and
  `executor.ts:376`.
- In `startBridge` (`executor.ts:105`), while iterating `SDKMessage`s, detect
  assistant messages with a `tool_use` block whose `name === 'AskUserQuestion'`.
  Extract `tool_use_id` and `input.questions`.
- Register the pending question via a new `AskUserQuestionRegistry`
  (`engines/issue/ask-user-question.ts`). Registry is a singleton `Map<issueId,
  PendingQuestion>` with `set`, `get`, `take`, `clearForIssue`. Only one
  outstanding question per issue at a time (simple; revisit if model starts
  chaining calls).
- The executor does **not** block the for-await loop. The SDK itself awaits
  the tool_result via its own `AsyncIterable` prompt contract — we just need
  to push it when ready.

**Files**: `executors/claude-sdk/executor.ts`, new
`engines/issue/ask-user-question.ts`.

**Exit criteria**: sending a prompt that triggers AskUserQuestion (e.g.
a prompt containing "ask me which color") produces exactly one
registry entry with `{issueId, tool_use_id, questions}`, visible via a
temporary `logger.info` dump.

### Step 2 — Surface the question as a log entry + SSE event

- Add `'ask-user-question'` to `LogEntryType` in `packages/shared/src/index.ts`
  and an `AskUserQuestionMeta` helper type.
- In `ClaudeSdkNormalizer.parseMessage`, when an assistant tool_use is
  `AskUserQuestion`, emit a dedicated entry with `entryType:
  'ask-user-question'`, `toolDetail.toolCallId = tool_use_id`, and
  `metadata.questions = input.questions` (serialize as JSON string per
  existing `NormalizedLogEntry` convention if needed).
- The entry is persisted to `issueLogs` by the existing persistence path (no
  schema change). Chat rebuild on frontend picks it up like any other entry.
- `SSE` log event already forwards arbitrary `NormalizedLogEntry`. Nothing to
  add server-side — the new entry type rides the existing `log` event.

**Files**: `packages/shared/src/index.ts`,
`executors/claude-sdk/normalizer.ts`, any log-classification helpers
(`engines/log-entry.ts` if it asserts on the union).

**Exit criteria**: one SSE `log` event carrying the new entry type arrives at
the browser when the model calls AskUserQuestion. Existing chat renderer
shows an unstyled placeholder (acceptable until Step 4).

### Step 3 — Answer injection endpoint

- New route `POST /api/projects/:projectId/issues/:id/answer-question` with
  Zod validator:

  ```typescript
  z.object({
    toolUseId: z.string(),
    answers: z.array(z.object({
      header: z.string(),
      selected: z.array(z.string()),
    })),
  })
  ```

- Handler:
  1. Verify issue ownership + currently running session on
     `claude-code-sdk` engine.
  2. Look up the pending question via `AskUserQuestionRegistry.take(issueId)`.
     If missing or `toolUseId` mismatch → 409.
  3. Call `IssueEngine.answerQuestion(issueId, toolUseId, answers)`. Internally
     this reaches the running process's `protocolHandler.sendUserMessage` with
     a structured content array:

     ```typescript
     {
       type: 'user',
       parent_tool_use_id: null,
       message: {
         role: 'user',
         content: [{
           type: 'tool_result',
           tool_use_id: toolUseId,
           content: JSON.stringify({ answers }),
         }],
       },
     }
     ```

     NOTE: current `sendUserMessage(content: string)` signature only passes
     plain text. We extend `protocolHandler.sendUserMessage` to accept
     `string | ContentBlock[]` and the SDK executor's
     `makeUserMessage` to handle both shapes. Other executors keep the
     string-only path (they don't use AskUserQuestion).
  4. Persist a synthetic `user-message` log entry
     (`content: "Answered: <summary>"`, metadata carries full answer) so the
     chat timeline shows the choice next to the question bubble.

- Cancellation: when `IssueEngine.cancelIssue` fires while a question is
  pending, clear the registry entry and emit a synthetic log entry marking it
  cancelled. The SDK's underlying run is already interrupted; we do not need
  to inject a tool_result in that path — the subprocess settles.

**Files**: `routes/issues/ask-user-question.ts` (new),
`routes/issues/index.ts` (mount), `engines/issue/engine.ts` (new
`answerQuestion` method), `engines/types.ts` (`protocolHandler.sendUserMessage`
signature), `executors/claude-sdk/executor.ts` (updated `makeUserMessage`).

**Exit criteria**: manual curl-equivalent with a valid `toolUseId` + answers
triggers the model to continue its turn with the answer injected. `bun test:api`
adds integration test that mocks the registry + protocolHandler.

### Step 3b — Auto-mode auto-answer by recommendation

When the issue is running in **auto mode** (`permissionPolicy === 'auto'`), the
UI is expected not to block on user input. AskUserQuestion violates that
contract by design — so in auto mode we must answer the question ourselves
without waiting for the user.

**Behaviour**

- On `AskUserQuestion` tool_use detection, check the current issue's
  permission policy (stored per-session; default `'auto'`).
- If `policy !== 'auto'` → follow Step 3 as written (register question, wait
  for UI answer).
- If `policy === 'auto'` → resolve the question programmatically and inject
  a synthetic `tool_result` immediately.

**Selection strategy (ordered)**

1. **Explicit `(Recommended)` marker** — if any option's `label` contains the
   case-insensitive suffix `(Recommended)`, select that option. This matches
   the `ScheduleWakeup`-style convention used in Claude Code skills (see
   `gsd-code-review` etc.).
2. **Explicit `recommended: true` field** — if we extend the schema later and
   the SDK/plugin provides a structured flag, prefer that over (1).
3. **AI evaluation fallback** — when neither marker exists, call a lightweight
   model (e.g. the engine's current model via a one-shot `query()` or the
   in-process LLM wrapper reused from `upgrade/` notes generation) with:
   - System: "You are choosing on behalf of the user in autonomous mode. Pick
     the option the user most likely wants. Respond with the exact option
     `label` only."
   - User: the `question` text + JSON-serialized options.
   - Parse the reply, match case-insensitively against option labels, fall
     back to the first option if no match.

The chosen answer is injected via the same `tool_result` path as Step 3
(`IssueEngine.answerQuestion`), and a synthetic log entry is persisted with
`metadata.autoAnswered = true` + `metadata.selectionReason` (`'recommended'`,
`'ai-evaluated'`, or `'default-first'`) so the chat timeline shows the choice
and the user can audit why.

**Files**:

- `engines/issue/ask-user-question.ts` — add `resolveAutoAnswer(pending,
  policy, engineCtx)` helper.
- `executors/claude-sdk/executor.ts` — in the tool_use detection branch,
  branch on policy and call `resolveAutoAnswer` instead of registering for
  UI.
- New `engines/issue/ai-pick-option.ts` — thin wrapper around a short model
  call; no streaming, 30s timeout, falls back to first option on any error.
- `engines/types.ts` — add `permissionPolicy` to the session context passed
  through `SpawnOptions` if not already threaded.

**Exit criteria**:

- Prompt that triggers AskUserQuestion while `policy === 'auto'` completes
  the turn without UI interaction, with a log entry showing the auto-picked
  answer and reason.
- Prompt that triggers AskUserQuestion while `policy !== 'auto'` still
  surfaces the question bubble (Step 4).
- Integration test covers all three selection strategies.

### Step 4 — Frontend question bubble + answer flow

- Add `AskUserQuestionBubble.tsx` under
  `apps/frontend/src/components/issue-detail/chat/`. Renders:
  - Title (first question's `header`), body (question text)
  - Option buttons with description sub-label
  - If `multiSelect === true`, checkboxes + a "Send" button; else single-click
    sends immediately
  - Greyed-out state after answer posted (derive from "user answer" entry for
    the same `toolUseId` adjacent in timeline)
- Extend `ChatBody` rebuild to recognize `entryType === 'ask-user-question'`
  and render the bubble instead of the generic tool group.
- Add `useAnswerQuestion(issueId)` mutation in `hooks/use-kanban.ts` + API
  client fn in `lib/kanban-api.ts`.
- i18n keys in both `en.json` and `zh.json`.

**Files**: `components/issue-detail/chat/AskUserQuestionBubble.tsx` (new),
`components/issue-detail/chat/ChatBody.tsx`, `hooks/use-kanban.ts`,
`lib/kanban-api.ts`, `i18n/{en,zh}.json`.

**Exit criteria**: clicking an option in the UI posts to the new endpoint,
shows the "Answered: X" bubble below, and the model's next assistant message
appears within a few seconds.

### Step 5 — Test coverage + documentation

- `apps/api/test/claude-sdk.test.ts`: add cases for
  (a) normalizer emits `ask-user-question` entry, (b) registry
  set/take/clearForIssue invariants, (c) `answerQuestion` dispatches to
  `protocolHandler.sendUserMessage` with correct ContentBlock shape,
  (d) mismatched tool_use_id rejected.
- `apps/frontend/src/__tests__/`: unit test for bubble component (render +
  click dispatches mutation).
- Update `CLAUDE.md` engine section: document the new route and that
  AskUserQuestion is supported only on `claude-code-sdk` backend.

**Files**: `apps/api/test/claude-sdk.test.ts`,
`apps/frontend/src/__tests__/components/AskUserQuestionBubble.test.tsx`
(new), `CLAUDE.md`.

**Exit criteria**: `bun run test`, `bun run lint`, `bun run typecheck` all
green. Manual smoke on dev server with a prompt that reliably triggers
AskUserQuestion.

## Risks

1. **Concurrent questions per issue** — SDK may theoretically emit multiple
   AskUserQuestion calls in one turn. Mitigation: registry rejects a second
   `set` while one is outstanding and logs a warning; model typically issues
   one at a time per SDK docs. If real traffic shows chaining, upgrade the
   registry to a per-`tool_use_id` queue.
2. **Answer race after cancel** — user clicks an option just as `cancelIssue`
   fires. Endpoint checks session state first; if session no longer running,
   returns 409 and UI shows a "cancelled" state.
3. **`tool_use_id` leakage / spoofing** — endpoint verifies that
   `toolUseId` matches the registry entry for that issue. Endpoint is also
   auth-gated by the existing project-scoped auth middleware.
4. **Protocol-handler signature change** — widening `sendUserMessage` from
   `string` to `string | ContentBlock[]` touches every executor. Codex / ACP
   handlers can keep the string path; type union is safe because they only
   receive calls from the issue engine's existing follow-up flow which always
   passes strings.
5. **Legacy `claude-code` executor still blocks the tool** — unchanged by
   this plan. If a user on the legacy backend asks the model in a way that
   would trigger AskUserQuestion, the model simply doesn't see the tool.
   Document the limitation in CLAUDE.md.
6. **Restart / resume behaviour** — if the server restarts while a question
   is pending, the registry is lost and the subprocess is dead. Reconciler
   already moves stale `running` sessions to `failed`; the UI's question
   bubble then shows a "cancelled" state because the underlying log entry's
   issue is no longer running. Acceptable for v1; persisting pending
   questions across restart is out of scope.
7. **Model abuse** — nothing stops the model from asking dozens of questions.
   We already rate-limit elsewhere; add a per-issue counter that auto-cancels
   the run after N unanswered prompts (N=5 default, behind an app setting).
8. **i18n drift** — missed translation keys fail lint. Run `bun run lint`
   before merging.
9. **Auto-mode AI selection cost / latency** — Step 3b's AI evaluation
   fallback spends a small model call per question. Mitigation: only invoked
   when (1) and (2) fail; short prompt, capped at 30s; falls back to first
   option on timeout. Log entry records the reason so mis-selections are
   auditable.
10. **Auto-mode wrong choice** — AI may pick a destructive option if labels
    are ambiguous. Mitigation: auto-answer logs include the full question +
    selected label so users can intervene in subsequent turns; future work
    can add an opt-in "pause on auto-mode questions" setting per issue.

## Verification Plan

- **Step 1**: manual prompt known to trigger AskUserQuestion; confirm exactly
  one registry entry appears via debug log; no `bun test` regressions.
- **Step 2**: confirm SSE log event reaches the browser with the new entry
  type; check DB row in `issueLogs` table matches the emitted shape.
- **Step 3**: integration test in `apps/api/test/` with mocked
  `protocolHandler`. Verify payload shape is:
  `{ type: 'tool_result', tool_use_id, content: '{"answers":[...]}' }`.
  Invalid / mismatched IDs return 409.
- **Step 4**: manual browser smoke. Multi-select case with 2 selected options
  round-trips through the model. Cancel mid-question resets bubble state.
- **Step 5**: `bun run test` / `bun run lint` / `bun run typecheck` green.
  `bun test --filter ask-user-question` passes all new cases.

## Out of Scope

- Freeform answer inputs (text box, file picker).
- Cross-restart persistence of pending questions.
- Enabling AskUserQuestion on the legacy `claude-code` executor.
- Permission prompting for other tools (kept auto-approved).

## Alternatives Considered

1. **Do nothing** — keep the tool disabled. Cost: model cannot disambiguate
   underspecified tasks; degrades long interactive sessions where it would
   otherwise ask. Rejected now that the SDK gives us the primitives.
2. **Use `canUseTool` as the question channel** — intercept AskUserQuestion
   in `canUseTool`, return a hanging promise that resolves after the user
   answers, and feed the user's choice as `updatedInput`. Rejected:
   `canUseTool` signals permission (allow/deny/updatedInput to mutate the
   tool call), not tool_result. The SDK would execute the tool after the
   callback resolves, producing its own internal result — we'd be
   double-answering, and `updatedInput` can't return the chosen option in a
   shape the model will parse.
3. **Build a generic "pause and ask" mechanism for any tool** — too broad.
   AskUserQuestion has a well-defined contract; other tools don't. Revisit
   only if concrete demand appears.
4. **Replace the SDK's AskUserQuestion with a custom MCP tool** — possible,
   but duplicates what Claude Code already ships with. Adds maintenance
   surface for no user-visible benefit.
