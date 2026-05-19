---
id: PLAN-020
title: Cockpit Overview → Always-On Bot Timeline
status: approved
created: 2026-05-19
updated: 2026-05-19
tasks: [COCKPIT-007]
---

# PLAN-020 — Cockpit Overview → Always-On Bot Timeline

## Context

PLAN-014..018 built the cockpit page, AI assistant (read-only + write-
via-proposals), FTS search, bulk ops, and reachability upgrades. The
current Overview (`CockpitDashboard.tsx`) is
`ProjectMatrix + ActivityStream + QuickCreate + AssistantFab` — i.e.
another issue listing. It does not reduce the "翻看 issue 一个个" load.

The user's actual use case: **keep this page open on a side monitor /
split screen all day**, glance over occasionally, click a button to
approve / send / open, and drop new issues into the input without
switching windows.

Therefore the redesign is not "a better table". It is an **always-on
bot timeline**: a persistent, conversational stream of what the bot
saw, what it suggests, and what actions it's offering. Buckets become
internal signals that drive *what messages the bot posts*, not a
visible grouping.

## Always-On Design Constraints (hard)

These are derived from the side-monitor use case and apply to every
component below:

- **Glanceable**: a top status strip readable from across the room
  ("🟢 3 ready · 2 awaiting you · 1 off-track"). Color-coded.
- **Never steals focus**: no modals, no system notifications by
  default, no auto-scroll. State changes flash a row briefly, never
  re-layout the page.
- **Low visual noise**: no spinners, no persistent animations. Use
  static color tags + a single "live" dot in the status strip.
- **Quiet by default, sound opt-in**: optional "ding once" on a small
  set of urgent kinds (off-track / awaiting-you over N minutes).
- **Quick new-issue capture**: a single always-visible input at the
  top — `/` focuses, Enter submits — replaces the right-corner
  QuickCreate as the primary entry.
- **Persistent across reload**: timeline is server-stored; refresh
  restores last N messages with a read-watermark, nothing is lost.
- **Dark-mode friendly**: default theme tuned for all-day display.

## Existing Assets (reuse, don't replace)

- `apps/api/src/cockpit/proposals.ts` — already dispatches
  `cancel_issue` / `restart_issue` / `bulk_update_status` /
  `create_issue`. Extending for new action types is a small additive
  change.
- `apps/api/src/events.ts` (`appEvents`) — already emits
  `issue-updated`, `done`, `changes-summary`, `cockpit-proposal`.
  These are the only triggers we need.
- `apps/api/src/routes/events.ts` — SSE pipe; add one event type.
- `AssistantPanel` + `AssistantFab` — kept as free-form chat fallback;
  timeline rows that need discussion open the panel pre-filled.

## Approach

### Data model

New table `cockpitTimelineMessages` (drizzle migration):

| field | type | notes |
|-------|------|-------|
| id | text (ULID) | PK |
| kind | text | `suggest_merge` `suggest_reply` `alert_off_track` `alert_repeat_fail` `ack` `info` |
| projectId | text? | nullable for global messages |
| issueId | text? | nullable; foreign key to issues |
| body | text | rendered markdown line(s) |
| actions | text (JSON) | `[{ id, label, kind: 'proposal'|'navigate'|'snooze'|'dismiss', payload }]` |
| signalKey | text | dedupe key, e.g. `merge:#issueId:${lastEntryUlid}` — same key replaces previous open message |
| status | text | `open` `acknowledged` `snoozed` `dismissed` `superseded` |
| snoozedUntil | integer? | unix ms |
| createdAt | integer | unix ms |
| updatedAt | integer | unix ms |
| isDeleted | integer | soft delete |

### Backend modules

- `apps/api/src/cockpit/timeline.ts`
  - `appendOrReplace(msg)` — upsert by `signalKey` (open → superseded).
  - `list({ limit, after })` — paged read, newest first, excludes
    `dismissed`/`superseded`/snoozed-future.
  - `ack(id)` / `snooze(id, untilMs)` / `dismiss(id)`.
  - `subscribe(fn)` — in-process emitter, drives SSE.
- `apps/api/src/cockpit/classifier.ts`
  - Pure functions: `classifyIssueOnReview(issue, lastEntry, changes)`
    → `{ kind, body, actions, signalKey } | null`.
  - Deterministic, no LLM. Order: hazard first (off-track), then
    awaiting (only when `AskUserQuestion` tool call present — until
    ENG-002 lands this returns null), then merge-ready (tight rule:
    intentional review transition + no `AskUserQuestion` + diff
    inside scope + no failing tool call last turn).
  - Repeated-failures + stale-in-working: deferred to M2.
- `apps/api/src/cockpit/digest-bridge.ts`
  - Listens on `appEvents`:
    - `issue-updated` with status crossing into `review` → classify →
      `timeline.appendOrReplace`.
    - `changes-summary` for a `review`-status issue → re-classify.
    - `cockpit-proposal` approved for `merge_issue` / `send_reply` →
      post an `ack` message and mark the originating suggestion
      `superseded`.
  - Cold-start: on boot, scan all `review`-status issues once and
    seed timeline (idempotent via `signalKey`).

### Routes

- `GET /api/cockpit/timeline?limit=50&before=<ts>` — paged.
- `POST /api/cockpit/timeline/:id/ack` — mark read.
- `POST /api/cockpit/timeline/:id/snooze` body `{ untilMs }`.
- `POST /api/cockpit/timeline/:id/dismiss`.
- SSE event `cockpit-timeline` carrying `{ op: 'append'|'update', message }`.
- Extend `proposals.ts` dispatcher:
  - `merge_issue { issueId }` → set `statusId = 'done'`. No git ops.
  - `send_reply { issueId, body }` → post follow-up via existing
    follow-up route. **Deferred until reply drafts ship in M2** —
    M1 only adds `merge_issue`.

### Frontend

- New `components/cockpit/BotTimeline.tsx` — the main always-on
  surface. Layout:
  ```
  ┌─ Status strip ─────────────────────────────┐
  │ 🟢 3 ready · 2 awaiting · 1 off-track  ⚙🔕🌙│
  ├─ Quick capture ────────────────────────────┤
  │  /  下发新 issue…                            │
  ├─ Timeline list (virtualized, newest top) ──┤
  │ 🤖 09:12  body + [actions]                  │
  │ ✓ 09:14  ack body                           │
  │ ...                                          │
  └────────────────────────────────────────────┘
  ```
- `CockpitDashboard.tsx` body becomes:
  ```tsx
  <BotTimeline />
  <details className="mt-6"><summary>Show raw activity</summary>
    {/* lazy-mounted */}
    <ProjectMatrix />
    <ActivityStream />
  </details>
  ```
  ProjectMatrix + ActivityStream **lazy-mount on open**; closed
  disclosure does not subscribe to SSE.
- New hook `hooks/use-cockpit-timeline.ts`:
  - Initial fetch via React Query.
  - SSE `cockpit-timeline` deltas patch the cache in place.
  - Exposes `ack` / `snooze` / `dismiss` mutations.
- New component `CockpitStatusBar.tsx` — reads timeline buckets,
  shows colored counts + sound/notification toggles + theme toggle.
- Quick-capture input: extract the project picker + 立刻执行 from
  existing `CockpitQuickCreate.tsx` into a horizontal compact form
  fixed at the top.
- i18n keys under `cockpit.timeline.*` (en + zh).
- **No swipe gestures in M1** — mobile uses plain action buttons.
  Swipe + a11y long-press deferred to M3.
- **全选** toggle: any list-style action (e.g. bulk-approve from a
  multi-row suggest_merge) must include a select-all per project
  convention. M1 ships per-row actions only, so this lands when
  bulk lands in M2.

### Safety / scope guardrails on `merge_issue`

- Action sets `statusId = done` only. Does **not** run `git commit` /
  `git push`. Working tree stays dirty; user owns git step.
- Bulk merge (multi-select) is **deferred to M2** because of overlap
  risk; M1 ships per-row "Merge" buttons only.

## Milestones

**M1 — Always-on timeline MVP (this PR)**
- Data model + migration.
- `timeline.ts` + `classifier.ts` (`suggest_merge` + `alert_off_track`
  kinds only) + `digest-bridge.ts`.
- `merge_issue` proposal type.
- Routes + SSE event.
- `BotTimeline` + `CockpitStatusBar` + quick-capture.
- Disclose old views; lazy mount.
- Verification (below).

**M2 — Reply drafts + bulk + more buckets**
- `suggest_reply` kind, lazy reply-draft endpoint, `send_reply`
  proposal.
- `alert_repeat_fail` + `alert_stale_working` kinds.
- Bulk-merge with path-overlap detection + confirm dialog (≤5 rows).
- Snooze defaults / "today" / "until next event" presets.
- Sound + browser notification opt-in.

**M3 — Polish**
- Mobile swipe (reveal-then-tap) + long-press a11y fallback.
- Per-action telemetry (accepted / opened-instead / reversed).
- "All caught up" empty state with three distinct sub-states
  (idle / loading / classifier-error).
- AskUserQuestion integration once ENG-002 lands.

## Risks

- **Classifier false-positive on merge** — M1 mitigations: tight
  rule set + per-row action (no bulk in M1) + status-only flip (no
  git). If still noisy, raise the bar in M2.
- **Timeline noise** — if every event posts a new line, the wall
  becomes a yelling todo list. Mitigation: `signalKey`-based
  supersede so each issue has at most one open suggestion; `ack` /
  `snooze` / `dismiss` hide rows permanently / until time / forever.
- **Always-on perf** — virtualize the list; cap in-memory window at
  200 messages; older paginate on scroll.
- **SSE gap on flaky network** — emit a monotonic `seq` on each
  delta; client refetches when it sees a gap.
- **Removing Matrix/Stream** is reversible — kept under disclosure.

## Scope

In (M1):
- New backend table + module + routes + SSE.
- One `digest-bridge` driven by existing events; no polling.
- Two timeline kinds (`suggest_merge`, `alert_off_track`) +
  `ack`/`info`.
- `merge_issue` proposal type.
- New frontend `BotTimeline` + `CockpitStatusBar` + quick-capture;
  disclose old views.
- i18n en + zh.
- Mobile: same components, no swipe.

Out (M1 — explicit):
- Reply drafts and `send_reply`.
- Bulk merge UI.
- Repeated-failures / stale-in-working buckets.
- Swipe gestures.
- Telemetry.
- Killing AssistantPanel.

## Alternatives considered

1. **Static four-bucket table (previous PLAN-020 draft)** — does not
   feel like a coworker; user explicitly rejected.
2. **LLM summary per refresh** — cost prohibitive; not necessary for
   the "voice" effect, which mostly needs templated messages keyed
   off classifier output.
3. **Full L3 autonomy** — high risk; deferred indefinitely.

## Verification

API (`apps/api/test/`):
- `cockpit-timeline.test.ts`: append/replace by signalKey, ack/snooze/
  dismiss state transitions, list filtering.
- `cockpit-classifier.test.ts`: each bucket reachable, ready-merge
  refuses when AskUserQuestion present, refuses when diff out of
  scope.
- `cockpit-proposals.test.ts` extended: `merge_issue` flips status,
  rejects non-review issues.

Frontend (`apps/frontend/src/__tests__/`):
- `BotTimeline.test.tsx`: render messages, fire ack/snooze/dismiss,
  apply SSE delta.
- `CockpitStatusBar.test.tsx`: bucket counts derive from message
  state.

Manual smoke (1280px + 375px):
- Land on `/review` empty → "All caught up" message.
- Move an issue to review (engine settles) → suggest_merge appears
  within seconds; merge button flips it to done; ack message
  appears; row supersedes.
- Snooze a row → disappears; reappears at snooze expiry.
- Dismiss → gone permanently.
- Quick-capture: `/`, type, Enter → new issue created in chosen
  project, ack posts to timeline.
- Reload page → last messages restored with unread watermark.
- Mobile 375px: same buttons, no swipe; layout stacks vertically.
- Disclosure closed by default; opening mounts ProjectMatrix +
  ActivityStream (verify they were not mounted before).

Lint + typecheck both workspaces.
