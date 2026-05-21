---
id: COCKPIT-008
title: Cockpit secretary — AI-enriched decision cards + single decision-stream UI
status: in_progress
priority: P1
owner: claude
created: 2026-05-20
updated: 2026-05-20
plan: PLAN-022
---

# COCKPIT-008 — Cockpit secretary: AI-enriched decision cards + decision-stream UI

## Goal

Make the cockpit reduce cognitive load instead of reshuffling it. Insert
an AI "secretary" between the rule classifier and the timeline so each
card arrives pre-digested: a one-line situation, a recommended action,
and 2-3 one-click candidate replies. Collapse the cockpit UI into a
single decision stream and dissolve the separate assistant chat panel
into it.

Anti-goal: not issue linking / join / teams / multi-repo workspace; not
full autonomy. Full design in PLAN-022.

## Problem

COCKPIT-007 shipped a rule-based, template-only timeline; PLAN-015/016
shipped a pull-based assistant chat panel. They are disconnected. Cards
never carry the agent's actual question or options; the assistant is
one more long-reply session to switch into. The user's pain — session
switching, long replies, heavy mental load — is unaddressed.

## Scope (high level — full design in PLAN-022)

### Backend
- New `cockpit/secretary.ts`: per-issue AI enrichment — reads last-turn
  logs, returns an enriched card (situation + recommendation + candidate
  replies) or an `auto-handled` verdict. Plain-text question detection.
- `digest-bridge`: emit rule card immediately, patch with enrichment via
  SSE `op:'update'`.
- Additive migration on `cockpit_timeline_messages` (`recommendation`,
  `enrichedAt`).
- `reply-preset` action kind + dispatch in `routes/cockpit/proposals.ts`.

### Frontend
- `DecisionCard` replacing templated rows: situation, dominant
  recommendation block, candidate-reply buttons, free-text escape
  hatch, progressive-disclosure detail.
- Single-column `CockpitDashboard`: "需要你 (N)" + collapsed "秘书已处理"
  zones; first-class empty state; keyboard triage.
- Dissolve `AssistantPanel` into an inline input on the same surface;
  remove `AssistantFab`; demote/remove matrix + activity + recent-tabs.
- Mobile parity (hard requirement); "全选" on any multi-select; i18n
  en + zh.

### Out of scope
- Issue linking / join / teams / multi-repo workspace.
- Full L3 autonomy beyond M3's gated, default-off auto-handle.
- Per-signal threshold configuration UI.

## Milestones

- **M1** — Secretary enrichment backend (AI-pass spike, `secretary.ts`,
  migration, `reply-preset`, digest-bridge wiring).
- **M2** — Decision-stream UI (`DecisionCard`, single-column cockpit,
  assistant dissolved, mobile parity).
- **M3** — Auto-handle (gated, default off) + unattended notification +
  telemetry.

## Verification

See PLAN-022 "Verification". Per-milestone: focused api + frontend
tests, lint + typecheck both workspaces, manual smoke at 1280px + 375px.

## Progress

### 2026-05-21 — M1 implemented (secretary enrichment backend)

Spike outcome: the secretary runs its AI pass via a **single-shot
`query()`** from `@anthropic-ai/claude-agent-sdk` — no workspace, no
tools (`allowedTools: []`), no `settingSources`, no DB session. This
reuses the Claude binary's own auth (works with subscription *or* API
key), adds no dependency, and pollutes no tables. Every failure path
(no binary, no auth, timeout, parse failure) returns `null`, so the
caller keeps the rule template card — enrichment is strictly additive.

Shipped:
- **Shared types** (`packages/shared`): new `reply-preset`
  `CockpitTimelineAction` kind; `CockpitTimelineMessage` gains
  `recommendation` (`{ actionId, reasoning }`) + `enrichedAt`; new
  `CockpitTimelineRecommendation` interface.
- **Schema + migration**: `cockpit_timeline_messages` gains
  `recommendation` (text/JSON) + `enriched_at` (integer). Migration
  `0024_sudden_robin_chapel.sql` — additive `ALTER TABLE`, existing
  rows read back as null.
- **`cockpit/secretary.ts`** (new): `enrichReplyCard` orchestrator,
  `loadLastTurnContext` (bounded last-turn blob), `runOneShot`
  (45 s deadline `query()` wrapper), pure `parseEnrichment` (tolerates
  code fences / prose, clamps bad indices) and `buildEnrichedReplyCard`
  (candidate replies → `reply-preset` actions, free-text escape hatch
  always kept, recommended candidate toned `primary`).
- **`cockpit/timeline.ts`**: `applyEnrichment(id, patch)` — patches
  body/actions/recommendation/`enrichedAt` on still-`open` cards only,
  emits an `update` delta; `hydrate` now carries the new fields.
- **`cockpit/digest-bridge.ts`**: `appendAndMaybeEnrich` — appends the
  rule template card instantly, then fires `enrichReplyCard` in the
  background for `suggest_reply` cards and patches via `applyEnrichment`.
  All five classifier call sites routed through it.

Verification:
- New `test/cockpit-secretary.test.ts` — 14 tests (parseEnrichment
  valid/fenced/clamped/invalid; buildEnrichedReplyCard actions +
  recommendation tone + navigate omission; enrichReplyCard guards;
  applyEnrichment patch + update delta + skips non-open cards).
- Full cockpit suite: 97 pass / 0 fail across 12 files.
- `tsc --noEmit`: no errors in touched/new files (pre-existing errors
  in `timeline-converter.ts` / `cockpit-server.ts` are unrelated).
- ESLint clean on all touched files.

Scope note — **plain-text question detection deferred to M2**. M1
enriches only `suggest_reply` cards (fired by the classifier on an
`AskUserQuestion` tool call). Detecting a plain-text question at
turn end would require an AI scan of every `suggest_merge` candidate
(cost) plus a card kind-change in `applyEnrichment`; deferred to keep
M1's blast radius small.

Pending:
- M2 — Decision-stream UI (`DecisionCard`, single-column cockpit,
  `AssistantPanel` dissolved, mobile parity). `reply-preset` clicks
  map to the existing `send_reply` proposal — purely frontend.
- M3 — Auto-handle (gated) + unattended notification + telemetry.
- Manual smoke of the live AI enrichment path (needs a running server
  + Claude binary + an issue that fired `AskUserQuestion`).

### 2026-05-21 — M1 revised: engine-agnostic + engine setting

The first M1 cut ran enrichment via a Claude-SDK `query()` one-shot —
hardcoded to Claude. If the user has no Claude / is rate-limited,
enrichment would silently always fail. Reworked the AI pass to be
engine-agnostic:

- **`secretary.ts`** — `runOneShot` (`query()`) replaced by
  `runEnrichment`: resets and reuses a hidden singleton "secretary"
  issue, dispatches the enrichment prompt via
  `issueEngine.executeIssue` on the configured engine, waits for the
  `done` event (120 s timeout), reads back the last assistant turn.
  Runs serialized through a promise chain. New `getSecretaryEngine`
  reads the `cockpit:secretaryEngine` setting (default
  `claude-code-sdk`).
- **`ensure-singleton.ts`** — extracted `ensureSingletonIssue`;
  added `ensureSecretaryIssue` (hidden `[Cockpit] Secretary` issue).
- **`classifier.ts`** — `loadIssue` now skips `isHidden` issues, so
  the secretary/assistant singletons never generate timeline cards
  about themselves.
- **Routes** — `GET/POST /api/cockpit/secretary-engine` to read/set
  the secretary engine.
- The pure functions (`parseEnrichment`, `buildEnrichedReplyCard`,
  context loading, prompt) are unchanged.

Verification: full cockpit suite 103 pass / 0 fail (13 files; +3
engine-setting tests in `cockpit-secretary.test.ts`); `tsc` + ESLint
clean on all touched files.

UI for switching the engine (a picker) lands in M2 with the cockpit
settings surface; the setting + API exist now.

### 2026-05-21 — M1: degradation chain + observability/config/test

Completed the three-rung degradation chain so a card never drops
straight from "enriched" to "useless template", and made the secretary
observable, configurable, and testable.

Degradation chain:
- **Level 2 (non-AI floor)** — `classifier.ts` `loadAskUserQuestion`
  reads the agent's own `AskUserQuestion` tool call from
  `issues_logs_tools_call.raw` (`toolAction.questions[].options`,
  `recommendedIndex`) and builds a `structured` card: real question +
  real options as one-click `reply-preset` buttons + the agent's own
  recommended option — zero AI, zero tokens, always available.
- Level 1 (AI enrich) and level 3 (template) unchanged; cards now
  carry an explicit rung.

Observability — `cockpit_timeline_messages` gains `enrichmentStatus`
(`template` | `structured` | `enriched`) and `enrichmentError`
(`no_context` | `timeout` | `run_failed` | `parse_failed`, null
otherwise). Migration `0025_early_morg.sql` (additive). `enrichReplyCard`
now returns a discriminated `EnrichResult`; `digest-bridge` applies the
patch on success or calls the new `timeline.recordEnrichmentError` on
failure, so the UI can show *which rung a card is on and why*.

Config — `cockpit:secretaryEnabled` master switch (`isSecretaryEnabled`,
default on); when off, cards stay at the structured/template rung and no
tokens are spent.

Test/observability hook — `dryRunEnrichment` + `POST
/api/cockpit/secretary/dry-run { issueId }` runs enrichment for one
issue and returns `{ engine, context, raw, reason, parsed }` without
touching the timeline. Plus `GET /api/cockpit/secretary` (engine +
enabled) and `POST /api/cockpit/secretary-enabled`.

Verification: cockpit suites 118 pass / 0 fail (16 files) — including
new classifier level-2 tests (structured card from `AskUserQuestion`
options; template fallback when no tool-call row) and secretary
enabled-toggle tests. `tsc` + ESLint clean on all touched files.

The UI badges that render `enrichmentStatus`/`enrichmentError` land in
M2 with `DecisionCard`; the data + API exist now.

### 2026-05-21 — M1: closed the cheap test gaps

Added DB-level coverage for the parts that were exercised only
indirectly:
- `POST /api/cockpit/secretary/dry-run` — `no_context` branch (issue
  with no logs) + missing-`issueId` 400.
- `recordEnrichmentError` — annotates the failure reason on an open
  card without changing its rung + emits an `update` delta; returns
  null for a superseded card.
- classifier `loadAskUserQuestion` edge cases — malformed `raw` JSON
  and an `AskUserQuestion` with empty options both fall back to a
  level-3 template card.
- classifier `isHidden` skip — a hidden issue produces no card.

Cockpit suites: 125 pass / 0 fail (16 files). `tsc` + ESLint clean.

Known remaining gap (accepted): the live engine path — `runEnrichment`
(`executeIssue` → `done` → read result) and the `enrichReplyCard`
success path end-to-end — has no automated test, since it spawns a
real engine. Covering it would need an injectable engine-call seam
(deferred — not done). Until then it relies on manual smoke.

### 2026-05-21 — M2 slice A: decision cards in the existing timeline

M2 is being shipped in slices (A: decision cards in place; B: settings
UI; C: single-column layout; D: dissolve AssistantPanel). Slice A —
no layout change, just enrich the existing `BotTimeline` rows so M1's
data becomes usable:

- `reply-preset` actions render as one-click buttons; clicking sends
  the drafted text via the existing `send_reply` proposal (new
  `dispatchSendReply` helper; `runAction` `reply-preset` case).
- `recommendation.reasoning` renders as a one-line hint above the
  actions; the recommended candidate keeps its backend-set `primary`
  tone.
- `enrichmentStatus` / `enrichmentError` render as small badges
  (`enriched` / `options` / `AI failed`) — the observability surface.
- i18n keys `cockpit.timeline.badge.*` in en + zh.

Verification: `BotTimeline.test.tsx` + `use-cockpit-timeline.test.ts`
— 22 pass (2 new: enriched reply card renders candidate/recommendation/
badge and sends preset on click; AI-failed badge). Frontend `tsc`
clean; ESLint clean on touched files.

Pending M2 slices B/C/D and M3.
