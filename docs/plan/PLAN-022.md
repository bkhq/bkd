---
id: PLAN-022
title: Cockpit secretary — AI-enriched decision cards + single decision-stream UI
status: approved
created: 2026-05-20
updated: 2026-05-20
tasks: [COCKPIT-008]
---

# PLAN-022 — Cockpit secretary: AI-enriched decision cards + single decision-stream UI

## Context

PLAN-020 / COCKPIT-007 shipped the always-on bot timeline: a rule-based
classifier (`cockpit/classifier.ts`) detects signals and posts templated
cards into `cockpit_timeline_messages`. PLAN-015/016 shipped the cockpit
AI assistant (`routes/cockpit/assistant.ts`) — a singleton issue running
a real engine with read-only `cockpit_*` MCP tools.

These two are disconnected:

- The **rule pipeline** (classifier + timeline + digest-bridge) is a
  dumb pipe: it detects *which* issue needs attention, wraps it in a
  fixed template string, and posts it. It never reads message content,
  so a card never carries the agent's actual question, the options the
  agent is weighing, or any recommendation.
- The **assistant** is a pull-based Q&A chat panel. The user must open
  it, type, and read a long reply. It cannot see or write timeline
  cards. It reproduces the exact pain it was meant to solve: one more
  long-reply chat session to switch into.

Result: the cockpit reshuffles cognitive load instead of reducing it.
The user explicitly named the pain — switching between sessions, replies
too long, heavy mental load — and the desired shape: when an item is
delivered, it should already carry the likely replies, so acting is one
click, not authoring from scratch.

## Goal

Turn the cockpit into a **human-in-the-loop hub with a thinking router**
(a "secretary"), not a dumb message broker:

1. The secretary reads each flagged issue's last turn, decides what it
   can handle itself, and for what it can't, produces a digested
   one-line situation + a recommendation + 2-3 concrete candidate
   replies.
2. The timeline card becomes a self-contained **decision card**:
   situation, recommended action (visually dominant), candidate
   replies (one-click), a free-text escape hatch, and collapsed detail.
3. The cockpit UI collapses to a single **decision stream** — the
   separate `AssistantPanel` chat dissolves into an inline input on the
   same surface; the matrix / activity / recent-tabs furniture is
   removed or demoted.

Non-goal: issue linking / join / teams / multi-repo workspace — earlier
discussion concluded these are not the lever. Not full L3 autonomy.

## Current State

- `cockpit/classifier.ts` — pure rules. `lastTurnSignals()` reads only
  `entryType` + substring-matches `metadata` for `AskUserQuestion` tool
  names and `"error"`/`"failed"`. Five kinds: `suggest_merge`,
  `suggest_reply`, `alert_off_track`, `alert_repeat_fail`,
  `alert_stale_working`. `buildReplyMessage` body is a fixed template
  ("is waiting on your reply.") — no question, no options.
- `cockpit/timeline.ts` — `appendOrReplace` upsert by `signalKey`;
  `ack`/`snooze`/`dismiss`; SSE via `subscribeTimeline`. Card actions
  schema `CockpitTimelineAction` already supports `proposal` /
  `navigate` / `snooze` / `dismiss` / `reply-input`.
- `cockpit/digest-bridge.ts` — event-driven wiring; cold-start scan;
  10-min stale sweep.
- `routes/cockpit/assistant.ts` — singleton-issue chat; `cockpit_*`
  read tools + `cockpit_propose_action`. No timeline connection.
- `components/cockpit/` — `BotTimeline`, `ProjectMatrix`,
  `ActivityStream`, `RecentTabs`, `AssistantPanel`, `AssistantFab`,
  `MiniMatrix`, `CockpitProposalsBanner`, etc.

## Feasibility findings (investigation)

- **"Agent asking" detection**: only partial today. Caught only when
  the engine fires a tool literally named `AskUserQuestion`/`ask_user`,
  via brittle substring match. A plain-text question ("A or B?") at
  turn end is not detected. → The secretary's AI pass must read the
  last turn's content to catch plain-text questions.
- **Options the agent is weighing**: not captured at all today, but the
  raw material exists in the DB — `AskUserQuestion` tool input carries
  the question + choices; plain-text questions sit in
  `assistant-message` content. The classifier just discards it.
- **Card schema**: extending it for candidate replies is additive — a
  new action kind plus an optional recommendation field.

Conclusion: feasible. The missing piece is exactly an AI step, and the
secretary (already an engine integration) is the natural place for it.

## Approach

### Architecture: secretary as an enrichment stage

Insert the secretary between the rule classifier and the timeline:

```
event → rule classifier (cheap: which issue needs a look)
      → secretary enrichment (AI: read last turn → digest + recommend
        + draft candidates  OR  decide it is auto-handleable)
      → decision card → timeline
```

The rule classifier is kept and narrowed to a cheap pre-filter. The
secretary enrichment is a new module.

#### Resolved — how the secretary runs the AI pass

The enrichment is an automated per-issue AI call, not a chat.

Spike conclusion (revised): the first cut used a Claude-SDK `query()`
one-shot — light and fast, but **bound to Claude**. If the user has no
Claude (or it is rate-limited), enrichment would silently always fail.
Rejected.

Final decision: the secretary runs enrichment through the
**engine-agnostic issue pipeline** — `issueEngine.executeIssue` on a
single hidden "secretary" issue, on whatever engine the user selects
via the `cockpit:secretaryEngine` setting (Claude, Codex, …). Runs are
serialized through the one shared singleton issue and the session is
reset per run. Slightly heavier than a one-shot (full engine spawn,
hidden log rows) but enrichment is background — the template card
already showed instantly — so latency is irrelevant. Resilience and
engine choice win.

### Data model

Extend `cockpit_timeline_messages` (additive drizzle migration):

| field | type | notes |
|-------|------|-------|
| recommendation | text (JSON) ? | `{ actionId, reasoning }` — secretary's recommended action + one-line why; null for un-enriched cards |
| enrichedAt | integer ? | unix ms; null = not yet enriched (card still shows rule template) |

Candidate replies ride in the existing `actions` JSON via a new action
kind (see below) — no column needed.

### Shared types (`packages/shared`)

- New `CockpitTimelineAction` kind `reply-preset`:
  `{ id, label, kind: 'reply-preset', tone?, payload: { issueId, text } }`
  — clicking sends `text` as a follow-up to that issue.
- `CockpitTimelineMessage` gains `recommendation?: { actionId, reasoning }`
  and `enrichedAt?: string | null`.

### Backend

- New `cockpit/secretary.ts`:
  - `enrich(issueId, baseCard): Promise<EnrichedCard | AutoHandled>` —
    reads last-turn logs, runs the AI pass, returns either an enriched
    card (situation + recommendation + 2-3 `reply-preset` actions, free
    `reply-input` escape hatch kept) or an `auto-handled` verdict with
    the action to take.
  - Hard rules: escape hatch always present; enrichment failure falls
    back to the existing rule template (never blocks the card).
- `cockpit/digest-bridge.ts` — after `classifyIssue` produces a base
  card, call `secretary.enrich` before `appendOrReplace`; emit the card
  immediately with rule template, then patch it via `op:'update'` once
  enrichment returns (so the card is never delayed by the AI call).
- `routes/cockpit/proposals.ts` — handle `reply-preset` dispatch
  (follow-up with the preset text); already has `send_reply` plumbing
  from COCKPIT-007 M2 — reuse it.
- Auto-handle (M3): secretary verdict `auto-handled` posts a thin
  `info` card into the collapsed "handled" zone and triggers the
  action (auto-restart / auto-follow-up) without a user gate, gated by
  a setting (default off).

### Frontend — single decision stream

- `CockpitDashboard` collapses to one vertical column. Remove
  `ProjectMatrix` / `ActivityStream` / `RecentTabs` as primary
  furniture (keep matrix only behind the existing "raw activity"
  disclosure, or drop entirely — decided in M2).
- New `DecisionCard.tsx` replacing the templated row render:
  - header: project/issue + title;
  - situation: secretary's one-line digest (falls back to rule body);
  - recommendation block: visually dominant, recommended action is the
    primary button, with the secretary's one-line reasoning;
  - candidate replies: `reply-preset` buttons;
  - escape hatch: `reply-input` ("我来说…") always present;
  - progressive disclosure: full agent question + diff collapsed under
    a `▸` expander.
- Layout: two zones — "需要你 (N)" (decision cards, urgency-sorted) and
  "秘书已处理 (N) ▸" (collapsed one-line audit log of auto-handled).
- Empty state is a first-class screen: "✅ 没有需要你的事 · N 个在跑"
  — the trust contract made visible.
- `AssistantPanel` dissolves: the free-form chat becomes an inline
  input at the stream's top/bottom (same surface). `AssistantFab`
  removed. The singleton-assistant backend stays; only its UI host
  changes.
- Keyboard triage: `j/k` move, `Enter` take recommendation, `1/2/3`
  pick candidate, `e` expand, `s` snooze.
- Mobile: same single column, candidate buttons stack vertically and
  full-width; ships alongside desktop (hard requirement). Any
  list-style multi-select keeps the "全选" toggle per CLAUDE.md.
- i18n: new keys under `cockpit.decision.*` in en + zh.

## Milestones

**M1 — Secretary enrichment backend**
- Spike: pick the AI-pass mechanism (A vs B above).
- `cockpit/secretary.ts` enrichment (digest + recommendation +
  candidate drafts); plain-text question detection.
- Schema migration (`recommendation`, `enrichedAt`); shared types;
  `reply-preset` action kind + dispatch.
- `digest-bridge` emits rule card immediately, patches with enrichment.
- Tests: enrichment fallback on AI failure, escape hatch always
  present, `reply-preset` dispatch.

**M2 — Decision-stream UI**
- `DecisionCard` + single-column `CockpitDashboard`; two zones; empty
  state; progressive disclosure; keyboard triage.
- Dissolve `AssistantPanel` into inline input; remove `AssistantFab`.
- Demote/remove matrix + activity + recent-tabs.
- Mobile parity. i18n en + zh.
- Tests: card render, recommendation/candidate click, empty state,
  inline assistant input.

**M3 — Auto-handle + unattended**
- Secretary `auto-handled` verdict → collapsed zone + gated
  auto-action (setting, default off).
- Unattended push notification on new decision cards.
- Telemetry: accepted-recommendation / picked-alternative /
  used-escape-hatch / reversed.

## Risks

- **Enrichment latency / cost** — AI call per flagged issue. Mitigation:
  card appears instantly with the rule template, enrichment patches it
  in via SSE `op:'update'`; cache by `signalKey`; only enrich cards
  that actually need a human (skip pure `suggest_merge`).
- **Bad candidate replies** — same unreliable AI generates them.
  Mitigation: escape hatch always present; card must always show "why
  the agent is stuck" so the user can judge; recommendation carries
  explicit reasoning, never a bare button.
- **Plain-text question detection false positives/negatives** — the AI
  pass may misjudge whether a turn is awaiting the user. Mitigation:
  only run enrichment on review/stale issues already flagged by the
  cheap classifier; on uncertainty, fall back to the existing rule
  card, never auto-handle.
- **Removing matrix/activity** — reversible; kept behind disclosure in
  M2 until confirmed unused.
- **Auto-handle blast radius** — M3 only; setting default off; verdict
  must be high-confidence; never auto-handles a decision-type signal.

## Scope

In:
- New `cockpit/secretary.ts` + enrichment wiring in `digest-bridge`.
- Additive migration on `cockpit_timeline_messages`.
- `reply-preset` action kind + dispatch; shared types.
- `DecisionCard` + single-column cockpit; `AssistantPanel` dissolved
  into inline input; matrix/activity demoted.
- Keyboard triage; empty state; mobile parity; i18n en + zh.
- Auto-handle (M3, gated, default off) + unattended notification.

Out:
- Issue linking / join / teams / multi-repo workspace.
- Full L3 autonomy beyond the gated M3 auto-handle.
- Per-signal threshold configuration UI.

## Alternatives considered

1. **Stronger rule parser for `AskUserQuestion` input** — render the
   tool's structured options directly, no AI. Cheap, but only covers
   structured questions, misses plain-text questions, and can never
   produce a recommendation. Rejected as the primary path; may be a
   fast-path inside the secretary.
2. **Keep `AssistantPanel` as the main surface, just add card links**
   — leaves the two-surface split and the long-reply problem intact.
   Rejected.
3. **Full autonomy (no human gate)** — high risk; deferred (M3 gated
   auto-handle is the conservative slice).

## Verification

API (`apps/api/test/`):
- `cockpit-secretary.test.ts`: enrichment returns digest + ≥1
  `reply-preset` + escape hatch; AI-failure falls back to rule card;
  `auto-handled` verdict shape.
- Extend `cockpit-proposals` test: `reply-preset` dispatch sends
  follow-up with preset text.
- Migration test: existing rows readable with null `recommendation`.

Frontend (`apps/frontend/src/__tests__/`):
- `DecisionCard.test.tsx`: render situation/recommendation/candidates;
  recommendation = primary button; candidate click dispatches;
  escape-hatch present; expander toggles detail.
- `CockpitDashboard` test: two zones, empty state, inline assistant
  input, keyboard triage.

Manual smoke (1280px + 375px):
- Engine settles an issue with an `AskUserQuestion` → card carries the
  question + recommendation + candidates within seconds (template
  first, enriched patch follows).
- Plain-text question issue → still produces a decision card.
- Click recommendation → follow-up sent, card leaves.
- Escape hatch → free text sent.
- Empty cockpit → trust-contract empty state.
- Mobile 375px: candidates stack full-width; no desktop-only gaps.

Lint + typecheck both workspaces.
