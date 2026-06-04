# PTY launch feasibility probes

Standalone experiments evaluating whether Claude Code can be driven through a
**PTY (interactive TUI)** instead of the current headless
`claude -p --output-format=stream-json` SDK protocol. Nothing here is imported by
the app — these are throwaway probes kept for reference.

Run (binary auto-resolves to `/root/.local/bin/claude`, override with `CLAUDE_BIN`):

```bash
bun scripts/pty-feasibility/scrape-probe.ts   # why scraping the PTY output fails
bun scripts/pty-feasibility/hybrid-probe.ts   # the viable hybrid path, end-to-end
```

Raw PTY captures are written to `/tmp/claude-pty-feasibility/` (outside the repo).

## Context

`--input-format` / `--output-format` are **print-only** (`claude --help`), so in
PTY interactive mode there is **no stream-json**. Structured data must come from
the per-session transcript file at:

```
~/.claude/projects/<encode(cwd)>/<sessionId>.jsonl
encode = cwd.replace(/[^a-zA-Z0-9]/g, '-')
```

## Findings (measured on claude 2.1.161, bun 1.3.14)

### scrape-probe.ts — parsing the PTY byte stream: NOT feasible
- PTY output is pure ANSI TUI rendering (~6–11 KB/turn), **0 parseable JSON lines**.
- ANSI cursor positioning **drops inter-word spaces** on capture
  (`Quick safety check` → `Quicksafetycheck`), so on-screen state cannot be
  reliably detected — you are forced into blind, position-based keystrokes.

### hybrid-probe.ts — PTY for display + transcript for data: FEASIBLE
Verified end-to-end (`user → assistant → system:stop_hook_summary → turn_duration`,
reply `"PONG"` parsed):

| Linchpin | Result |
|---|---|
| `--session-id` → deterministic transcript path (no dir-diffing) | OK (cwd-encoding matched) |
| `fs.watch` + safety-poll tailer → incremental structured records | OK |
| turn-completion marker | OK — `system` subtype `turn_duration` (≈ stream-json `result`) |
| folder-trust gate | one-time, **NOT** bypassed by `--dangerously-skip-permissions`; clear via pre-seeding `~/.claude.json` `projects[cwd].hasTrustDialogAccepted=true`, or a blind Enter |

Transcript record types per turn: keep `user` / `assistant` / `system` (subtypes);
ignore TUI bookkeeping `last-prompt` / `mode` / `permission-mode` / `attachment` /
`file-history-snapshot` / `ai-title`.

## Known risks of the hybrid path
1. **Input is keystroke simulation** (`terminal.write(text + '\r')`) — fragile
   around bracketed-paste, multiline, and `/` slash-command interception. Weakest link.
2. **Transcript schema is internal/undocumented** → version-pin claude and
   snapshot-test the parser.
3. **Turn end is a heuristic marker** (`turn_duration`), not a documented field.
4. **No control protocol** → permissions become skip-all or screen+keystroke;
   interrupt = send Esc/Ctrl-C to the PTY.
