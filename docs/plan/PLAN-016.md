# PLAN-016 Observe Claude subagent (Task/Agent tool) activity

- **status**: completed
- **createdAt**: 2026-08-22 07:05
- **approvedAt**: 2026-08-22 07:20
- **relatedTask**: ENG-031

## Context

When a `claude-code` issue dispatches a subagent, BKD shows only the parent
`Task`/`Agent` tool call and its final text result. Everything the subagent does
in between is invisible. Investigation identified three independent causes.

### 1. The CLI does not forward subagent turns unless asked

`claude --help` (2.1.231) documents:

```
--forward-subagent-text   Forward subagent text and thinking blocks as
                          assistant/user messages with parent_tool_use_id set
                          (only works with --print and --output-format=stream-json)
```

`buildSpawnArgs` in `apps/api/src/engines/executors/claude/executor.ts:410-455`
passes `-p --output-format=stream-json --verbose --include-partial-messages`
but never `--forward-subagent-text`, so subagent envelopes never reach the
process stdout BKD consumes.

A live probe (`claude -p --output-format=stream-json --verbose
--forward-subagent-text`, prompt forcing one `general-purpose` subagent)
confirmed the flag forwards more than the help text implies — thinking, text,
`tool_use` and `tool_result` blocks all arrive:

```
{"type":"assistant","parent_tool_use_id":"toolu_01Do38...","subagent_type":"general-purpose",
 "task_description":"Read a.txt and count lines","message":{...,"content":[{"type":"tool_use","name":"Read",...}]}}
{"type":"user","parent_tool_use_id":"toolu_01Do38...","subagent_type":"general-purpose",
 "task_description":"Read a.txt and count lines","message":{"role":"user","content":[{"type":"tool_result",...}]}}
```

Subagent envelopes are distinguishable by three extra top-level fields:
`parent_tool_use_id`, `subagent_type`, `task_description`.

### 2. The lifecycle events BKD receives today are discarded

The same probe shows the CLI already emits subagent lifecycle telemetry on the
main stream, without any flag:

| subtype | payload |
| --- | --- |
| `task_started` | `task_id`, `tool_use_id`, `description`, `subagent_type`, `task_type`, `prompt` |
| `task_progress` | `task_id`, `tool_use_id`, `description`, `subagent_type`, `last_tool_name`, `usage{total_tokens,tool_uses,duration_ms}` |
| `task_updated` | `task_id`, `patch{status,end_time}` |
| `task_notification` | `task_id`, `tool_use_id`, `status`, `output_file`, `summary`, `usage` |
| `background_tasks_changed` | `tasks[{task_id,task_type,description}]` |

`ClaudeLogNormalizer.parseSystem`
(`apps/api/src/engines/executors/claude/normalizer.ts:110-115`) explicitly
suppresses `task_started` and `task_progress`, and the `default` branch
(`normalizer.ts:158-172`) drops `task_updated` / `task_notification` /
`background_tasks_changed` because they carry no `message`/`content` string.
So even the metadata BKD already has today is thrown away.

### 3. Envelope types and tool naming are out of date

- `ClaudeAssistant` / `ClaudeUser` in `normalizer-types.ts:44-60` have no
  `parent_tool_use_id`, `subagent_type` or `task_description` field. If the flag
  were enabled today, subagent turns would be normalized as ordinary
  main-thread messages and interleave into the chat with no attribution.
- CLI 2.1.231 names the tool `Agent`, not `Task`. `normalizer-tool.ts:42` and
  `:151` only handle `'Task'`, so an `Agent` call falls through to the generic
  renderer and loses its `subagent_type` label.
- `parseMessageDelta` (`normalizer.ts:552-560`) already skips token usage when
  `parent_tool_use_id` is set, which is the correct behaviour to preserve: the
  `result` message's `total_cost_usd` already includes subagent cost.

There is no on-disk fallback gap: the CLI also writes a full per-subagent
transcript to `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl`
with a `<...>.meta.json` sidecar (`agentType`, `description`, `name`,
`toolUseId`, `spawnDepth`). That is a richer source but it is post-hoc,
polls the filesystem, and duplicates data the stream already carries — so it is
recorded here as an alternative, not the chosen mechanism.

## Proposal

1. **Probe the capability, then pass the flag.** Extend the claude executor's
   availability probe to detect `--forward-subagent-text` in `claude --help`
   and cache the result alongside the existing engine probe data
   (`startup-probe.ts`, 6 h DB tier). `buildSpawnArgs` appends the flag only
   when supported, so older CLIs keep working.
2. **Type and tag subagent envelopes.** Add `parent_tool_use_id`,
   `subagent_type`, `task_description` to `ClaudeAssistant` / `ClaudeUser`.
   When `parent_tool_use_id` is present, every entry the normalizer emits for
   that envelope carries `metadata.subagent = { toolCallId, type, description }`.
   Token-usage emission stays main-thread only.
3. **Surface the lifecycle events.** Normalize `task_started`,
   `task_progress` and `task_notification` into `system-message` entries whose
   metadata carries `taskId`, `toolCallId`, `subagentType`, `description`,
   `lastToolName`, `usage`, `status` and `summary`. `task_updated` and
   `background_tasks_changed` stay suppressed — `task_notification` already
   carries the terminal status.
4. **Recognise the `Agent` tool name.** Treat `Agent` exactly like `Task` in
   `generateToolContent`, `classifyToolAction` and `classifyToolKind`.
5. **Render subagents nested, collapsed by default.** In the chat rebuilder
   (`engines/issue/store/message-rebuilder.ts`) attach entries tagged with a
   `subagent.toolCallId` to the matching tool group instead of the main
   timeline. `ToolItems.tsx` renders the group as an expandable subagent
   thread showing `subagent_type`, description, live `last_tool_name`, tool
   count / token count from `task_progress`, and the final summary.
6. **i18n** keys for the subagent group in `en.json` and `zh.json`.
7. **TDD**: normalizer unit tests are driven from the captured probe output
   (subagent envelopes, all five `task_*` subtypes), plus an executor test that
   the flag is only appended when the capability is present, plus a rebuilder
   test that subagent entries nest under their parent tool group.

## Risks

- **Log volume.** A single subagent can emit hundreds of entries, all persisted
  to `issues_logs`. The live-log cap (500) and collapsed rendering contain the
  UI impact, but DB growth per issue increases. Accepted; no new pruning.
- **Flag availability.** The exact CLI version that introduced
  `--forward-subagent-text` is unknown; the help-text probe avoids guessing a
  minimum version but adds one `--help` exec to the engine probe.
- **Undocumented payloads.** `task_*` subtypes are not part of a published
  schema and may change shape. All fields are read defensively; unknown shapes
  degrade to a suppressed entry.
- **Nested-agent depth.** `spawnDepth` in the meta sidecar implies subagents can
  spawn subagents. The stream only exposes one `parent_tool_use_id` level;
  deeper nesting renders flat inside the top-level group. Accepted.

## Scope

In scope:

- `apps/api/src/engines/executors/claude/{executor,normalizer,normalizer-types,normalizer-tool}.ts`
- `apps/api/src/engines/startup-probe.ts` (capability flag only)
- `apps/api/src/engines/issue/store/message-rebuilder.ts`
- `apps/frontend/src/components/issue-detail/ToolItems.tsx`
- `packages/shared/src/index.ts` (subagent metadata type)
- `apps/frontend/src/i18n/{en,zh}.json`
- Focused API + frontend tests

Out of scope:

- Codex subagent observability (the app-server protocol exposes no equivalent)
- Reading `subagents/agent-*.jsonl` from disk
- Changing per-issue token/cost accounting
- Cancelling or steering an individual subagent

## Alternatives

- **Tail `~/.claude/projects/<slug>/<sessionId>/subagents/*.jsonl`.** Complete
  fidelity including nested depth, but requires a filesystem watcher per
  running issue, breaks when `CLAUDE_CONFIG_DIR` differs, and lags the stream.
  Rejected as the primary mechanism; still available if the CLI ever drops the
  flag.
- **Lifecycle events only (no `--forward-subagent-text`).** Zero flag risk and
  minimal volume — a progress line per subagent instead of a full thread. This
  is a strict subset of the proposal and is the natural fallback when the
  capability probe reports the flag is unsupported.
