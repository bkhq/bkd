# 20261110-1220-claude-dynamic-models Fetch the claude-code model list from the CLI

- **status**: completed
- **priority**: P2
- **owner**: claude/session-models
- **createdAt**: 2026-11-10 12:20

## Description

Replace the hardcoded `CLAUDE_MODELS` catalog with the model list the Claude Code CLI returns in its
`initialize` control response, cached like every other engine's probe data.

Acceptance: `ClaudeCodeExecutor.getModels()` returns the CLI's models with no static catalog in code; the default
model follows the CLI's `default` entry; discovery caches them in memory + DB with no static overlay; an engine
that cannot answer `initialize` yields an empty list and the resolver passes the requested model through.

## ActiveForm

Fetching Claude models from the CLI

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: [20261110-1220-claude-dynamic-models](../plan/20261110-1220-claude-dynamic-models.md)

- complete: Verified against Claude Code 2.1.322: 16 models + 8 [1m] variants, default claude-opus-5-5, ~300 ms.
