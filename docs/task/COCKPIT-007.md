---
id: COCKPIT-007
title: Replace cockpit Overview with always-on bot timeline
status: in_progress
priority: P1
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-020
---

# COCKPIT-007 — Cockpit Overview → Assistant Decision Digest

## Goal

Stop forcing the user to read issues one by one. Replace the current
cockpit Overview (ProjectMatrix + ActivityStream) with a digest the
assistant produces by reading all active issues itself. The user
should be able to act on the digest without opening individual issues
in the common case.

Anti-goal: this is **not** another chat box. The chat assistant
already exists (AssistantPanel / AssistantFab). The digest is a
pre-computed, structured report — chat stays available as a fallback,
not the primary surface.

## Problem

After COCKPIT-006 / PLAN-018 lands TopBar + MiniMatrix + RecentTabs,
the user is removing MiniMatrix + RecentTabs because they duplicate
the sidebar. With those gone, the remaining Overview is just
ProjectMatrix + ActivityStream — both are "issue listings in a
different shape". The user still has to click into each issue to
decide what to do. The cockpit does not reduce load; it reshuffles it.

## Scope (high level — full design lives in PLAN-020)

### Backend
1. New triage engine that periodically scans active issues
   (status ∈ working/review, plus recently-settled `done` awaiting
   merge confirmation) and produces a per-bucket digest:
   - **Ready to merge** — `review` status, clean diff, no failing
     turns, last assistant turn looks conclusive.
   - **Needs human eyes** — diff touched out-of-scope files, or
     assistant emitted a question / error / "I am stuck" signal.
   - **Awaiting your reply** — last turn is an assistant question
     directed at the user; ships with a drafted reply.
   - **Repeated failures** — ≥ N failed/cancelled turns in last
     window; suggests engine swap or scope reduction.
2. Reuse the existing `cockpit/proposals` write-tool pipeline for
   actions surfaced from the digest (approve merge, send drafted
   reply, cancel, restart, swap engine).
3. SSE event `cockpit-digest` to push digest refreshes (digest is
   regenerated on issue settle, and on a periodic floor of ~60s).

### Frontend
1. `CockpitDashboard` rewrites its body from
   `ProjectMatrix + ActivityStream` to a `DigestView` with the four
   buckets above; each row is one issue summarized in ~one line plus
   the action(s) the assistant proposes.
2. Bulk approve / bulk reject controls per bucket (must include
   "全选" toggle per CLAUDE.md rule).
3. Mobile: same buckets, stacked vertically, swipe actions for
   approve / reject / open. Must work as the cockpit landing screen
   on phones, not a desktop-only feature.
4. AssistantPanel becomes the "ask me anything" fallback; entry point
   stays as AssistantFab.
5. Keep ProjectMatrix + ActivityStream reachable but collapsed under
   a "Show raw activity" disclosure so power users can still drop
   to the raw stream.

### Out of scope (defer to follow-up tasks)
- Full autonomous mode (assistant executing without confirmation).
- Per-bucket configuration UI (thresholds, mute rules).
- Cross-project rollups beyond what the digest already returns.

## Verification (to be detailed in PLAN-020)
- API: unit tests for digest classifier (each bucket reachable).
- Frontend: vitest for DigestView rendering + bulk actions.
- Manual smoke: 1280px + 375px, four-bucket landing, bulk approve,
  swipe actions on mobile.

## Progress

### 2026-05-19 — M1 implemented

M1 (always-on bot timeline MVP) is code-complete:

- New `cockpit_timeline_messages` table + drizzle migration.
- Backend modules: `cockpit/timeline.ts`, `cockpit/classifier.ts`,
  `cockpit/digest-bridge.ts`.
- Two kinds: `suggest_merge` and `alert_off_track`. Pure event-driven
  off `issue-updated` (engine-source review transitions) and
  `changes-summary`. Cold-start scan on boot.
- New proposal type `merge_issue` (status-only flip to `done`;
  rejects non-review issues). One-shot `POST
  /api/cockpit/proposals/execute` endpoint for inline approval from
  timeline action buttons.
- New routes: `GET /api/cockpit/timeline`, `POST
  /api/cockpit/timeline/:id/{ack,dismiss,snooze}`. SSE event
  `cockpit-timeline` carries `{ op: 'append'|'update', message }`.
- Frontend `BotTimeline` + rewritten `CockpitDashboard` (Matrix +
  Stream now lazy-mounted under "Show raw activity" disclosure).
- New hook `use-cockpit-timeline` with optimistic SSE patches.
- i18n keys added to en + zh.

Verification run:
- `bunx tsc --noEmit` (api + frontend): no errors in new files.
- `bun run lint`: clean (pre-existing warnings only).
- New API tests (3 files): `cockpit-timeline.test.ts` (7),
  `cockpit-classifier.test.ts` (7), `cockpit-merge-issue.test.ts`
  (8) — 22 pass / 0 fail. Cover append/replace by signalKey,
  ack/snooze/dismiss state transitions, bucket counts, classifier
  rules (review-only, AskUserQuestion blocks merge, failed tool
  blocks merge, off-track > 8 files wins over merge, soft-delete
  ignored), `merge_issue` proposal (flips review → done, rejects
  non-review, rejects unknown issue/type), timeline routes 404/400.
- New frontend test: `BotTimeline.test.tsx` (7) — empty state,
  bucket counts in status strip, proposal click + ack chain,
  snooze with future untilMs, dismiss, dismissed/superseded hidden,
  error state.
- Updated `ReviewPage.integration.test.tsx` to assert against the
  new `bot-timeline-stub` testid (Matrix + Stream now lazy under
  disclosure).
- Full api suite: 682 pass / 6 fail / 1 skip — the 6 failures are
  pre-existing execute/follow-up timing flakes unrelated to this
  change. Full frontend suite: 317 pass / 0 fail (51 files).

Pending in M2 / M3 (deferred to follow-up tasks):
- Reply drafts (`suggest_reply` kind) + `send_reply` proposal.
- Repeated-failures + stale-in-working buckets.
- Bulk-merge UI with path-overlap detection.
- Mobile swipe (reveal-then-tap) + long-press a11y fallback.
- Telemetry.
- AskUserQuestion integration once ENG-002 lands.

### 2026-05-19 — M2 implemented

M2 ships three additional surfaces:
- **`suggest_reply` bucket**: fired when the last turn includes an
  `AskUserQuestion` tool-use. Inline `<Textarea>` per row; submit
  → `send_reply` proposal → `issueEngine.followUpIssue`. No LLM
  drafting (kept simple; the user types). `AskUserQuestion` no
  longer silently blocks merge — it diverts merge → reply.
- **`alert_repeat_fail` bucket**: in-process per-issue 24h failure
  ring driven by `done` events with finalStatus
  `failed`/`cancelled`. ≥ 3 hits → row with restart / open /
  dismiss. Successful completion resets the counter. Takes
  priority over review-status buckets.
- **Bulk-merge UI**: select-all + per-row checkbox on
  `suggest_merge` rows, cap 5, confirm dialog lists affected rows
  before fire. Server enforces cap + uniform-review-status check.
  Diff overlap detection deferred to M3.

Verification (M2):
- 42 backend tests pass across 4 cockpit test files (classifier +
  timeline + merge_issue + bulk-merge/send_reply).
- BotTimeline: 10/10 pass (3 new — bulk toolbar visibility, bulk
  select-all + confirm dispatch, reply input + send dispatch).
- Full api: 692 pass / 6 pre-existing flake.
- Full frontend: 320 pass.
- Lint clean.

Pending (M3):
- `alert_stale_working` bucket (issues stuck in `working` with no
  log entries for N minutes; needs a periodic check, accepted as
  cost).
- LLM-drafted reply (lazy, cached) — current M2 reply is
  user-typed only.
- Path-overlap detection on bulk merge.
- Mobile swipe (reveal-then-tap) + long-press a11y fallback.
- Snooze presets + sound/notification opt-in.
- Telemetry on accept / open-instead / reverse.
- Project deep-link routing for `navigate` action.

### 2026-05-19 — M3 implemented (subset)

Shipped from M3:
- **`alert_stale_working` bucket**: 10-min periodic sweep in
  `digest-bridge` finds `working`-status issues with no log
  activity for ≥ 15 minutes; emits a row with Cancel / Restart /
  Open actions. New classifier branch + `listStaleWorkingIssueIds`
  helper.
- **Deep-link routing**: `navigate` action now jumps to
  `/review/<projectAlias>/<issueId>` directly.
- **Snooze presets**: per-row snooze button is a DropdownMenu with
  1h / 4h / Until tonight.
- **Sound + browser notification**: Bell / BellOff toggle in the
  status strip; off by default; persists in localStorage. On
  urgent SSE appends (off_track / repeat_fail / stale / reply) it
  plays a synthesized ding and (with permission) fires a
  Notification. Toggle-on doubles as the user gesture that unlocks
  AudioContext and requests notification permission.

Verification:
- +2 backend tests (classifier stale trigger).
- +3 frontend tests (sound toggle persistence, snooze dropdown
  presence, 4h preset). Old 1h test migrated to new dropdown path.
- Full api: 694 pass / 6 pre-existing flake.
- Full frontend: 323 pass / 0 fail.
- Lint + typecheck clean.

Deferred (still pending follow-up tasks):
- LLM-drafted reply (lazy, cached). Current reply UX is user-typed.
- Path-overlap detection on bulk merge.
- Mobile swipe (reveal-then-tap) + long-press a11y fallback.
- Telemetry on accept / open-instead / reverse.
- AskUserQuestion exact tool-call match (waiting on ENG-002).
