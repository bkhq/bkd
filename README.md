# BKD

AI-powered project management board. Create issues, assign them to AI coding agents, and watch them work in real time.

BKD is a unified frontend for CLI-based coding agents — [Claude Code](https://github.com/anthropics/claude-code) and [Codex](https://github.com/openai/codex). You manage a Kanban board; the agents write the code.

[中文说明](README.zh-CN.md)

## Features

- **Kanban Board** — Drag-and-drop issues across Todo / Working / Review / Done columns
- **Multi-Agent** — Supports Claude Code and OpenAI Codex as execution engines
- **Real-time Chat** — Stream agent output as it runs; send follow-up messages mid-session
- **Diff Viewer** — See file changes made by the agent in a GitHub-style diff panel
- **File Browser** — Browse, view, and navigate project files with syntax highlighting
- **Web Terminal** — Built-in xterm.js terminal for direct shell access
- **File Upload** — Attach files to issues as context for the agent
- **Webhooks** — Configurable event notifications for issue status changes
- **Multi-turn Sessions** — Continue conversations with full session history
- **Sub-agent Visibility** — Work a Claude sub-agent does is nested under the call that dispatched it, with live progress
- **Session Import** — Scan Claude Code and Codex sessions run outside BKD and adopt one as an issue
- **Scheduled Tasks** — Cron jobs with execution history and auto-pause after repeated failures
- **Git Worktrees** — Run an issue in its own worktree so parallel agents never collide
- **Process Manager** — See and terminate every running engine process
- **Supervised Updates** — Runs under the lode supervisor: verified releases, health-checked restarts, automatic rollback
- **i18n** — Chinese and English UI
- **Dark Mode** — Light / Dark / System theme
- **Mobile Friendly** — Responsive layout with touch support

## Installation

BKD runs under the [lode](https://github.com/dotns/lode) supervisor, which fetches a release,
verifies it, starts BKD, and applies later updates — rolling back automatically if a new
version fails to come up. Linux and macOS, x64 and arm64.

> Releases are sha256-verified. lode also checks an ed25519 asset signature when the
> publisher provides one; BKD releases are not signed yet.

```bash
sudo mkdir -p /opt/bkd

# 1. lode itself
curl -fsSL https://github.com/dotns/lode/releases/download/v0.1.0/lode-linux-x64.tar.gz \
  | sudo tar -xz -C /usr/local/bin lode lode-cli

# 2. the ready-to-use config — edit the paths marked CHANGE ME (default /opt/bkd)
curl -fsSL https://github.com/bkhq/bkd/releases/latest/download/bkd.lode.toml \
  -o /opt/bkd/lode.toml

# 3. run — lode installs the current release and supervises it
lode --dir /opt/bkd
```

Open http://localhost:3000 once it is up.

> **Already running a `bkd-launcher-*` install?** It will not reach current releases. The
> package was renamed from `bkd-app*.tar.gz` to `bkd-server.tar.gz`, so the old launcher
> finds no matching asset and keeps running whatever it has. Migrate deliberately — your
> database, uploads and worktrees stay where they are:
>
> ```bash
> curl -fsSL https://github.com/bkhq/bkd/releases/latest/download/migrate-to-lode.ts -o migrate-to-lode.ts
> bun migrate-to-lode.ts --root /opt/bkd            # preview
> bun migrate-to-lode.ts --root /opt/bkd --apply
> ```

[docs/deployment.md](docs/deployment.md) is the full guide: `lode.toml` reference, signature
verification, update policy, and day-to-day operations.

## System Requirements

BKD spawns AI coding agents as child processes. Install at least one before using:

### Claude Code (Recommended)

```bash
npm install -g @anthropic-ai/claude-code
```

Requires `ANTHROPIC_API_KEY` in your environment or configured via `claude` CLI.

### OpenAI Codex

```bash
npm install -g @openai/codex
```

Requires `OPENAI_API_KEY` or `CODEX_API_KEY`, or authenticate via `codex` CLI.

> BKD auto-detects which agents are installed at startup. You can use any combination.

## BKD Skill

This repository includes a single BKD skill package at `skills/bkd/`. Install it with `npx skills` and use it to operate a running BKD server through the REST API.

### Prerequisite

Before using the skill, point `BKD_URL` at the BKD API root:

```bash
export BKD_URL=http://localhost:3000/api
```

### Global (all projects)

```bash
npx skills add bkhq/bkd --skill bkd --global
```

### Project (current project only)

```bash
npx skills add bkhq/bkd --skill bkd
```

Restart Codex after installing the skill. You can then invoke it with prompts such as `Use $bkd to list projects` or `Use $bkd to check execution capacity`.

## Usage

1. **Create a project** — Give it a name and set the workspace directory (the repo the agents will work in)
2. **Create an issue** — Describe the task, pick an AI engine and model
3. **Execute** — Click execute; the agent spawns in your workspace and starts working
4. **Chat** — Send follow-up messages, upload files, or cancel at any time
5. **Review** — View diffs, check the agent's tool calls, drag the issue to Done

## Configuration

All configuration is done via environment variables. Create a `.env` file in the project root (Bun auto-loads it) or set them in your shell. See `.env.example` for a full template.

| Variable                    | Description                                               | Default          |
| --------------------------- | --------------------------------------------------------- | ---------------- |
| `PORT`                      | Server port                                               | `3000`           |
| `HOST`                      | Listen address                                            | `0.0.0.0`        |
| `ROOT_DIR`                  | Install root — pins `data/` so it survives an upgrade     | auto-detected    |
| `DB_PATH`                   | SQLite database path                                      | `data/db/bkd.db` |
| `LOG_LEVEL`                 | Log level (`trace` / `debug` / `info` / `warn` / `error`) | `info`           |
| `SERVICE_NAME`              | Logger name prefix                                        | `bkd`            |
| `LOG_EXECUTOR_IO`           | Log executor stdin/stdout (`1` = on, `0` = off)           | `1`              |
| `ANTHROPIC_API_KEY`         | Claude API key                                            | —                |
| `OPENAI_API_KEY`            | OpenAI / Codex API key                                    | —                |
| `CODEX_API_KEY`             | Codex-specific API key (fallback)                         | —                |
| `ENABLE_RUNTIME_ENDPOINT`   | Enable `/api/runtime` debug endpoint                      | disabled         |

Server name, server URL, webhooks, max concurrency, and other runtime settings are managed in the Settings UI and persisted in the database. Environment variables `SERVER_NAME` and `SERVER_URL` are used as initial seed values only — once set in the UI, database values take precedence.

## Development

See [docs/development.md](docs/development.md) for development setup, project structure, and contribution guidelines.

## License

Apache-2.0
