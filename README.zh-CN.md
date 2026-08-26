# BKD

AI 驱动的项目管理看板。创建 Issue，分配给 AI 编程代理，实时观看它们工作。

BKD 是 CLI 编程代理的统一前端 —— 支持 [Claude Code](https://github.com/anthropics/claude-code) 和 [Codex](https://github.com/openai/codex)。你管理看板，代理写代码。

[English](README.md)

## 功能

- **看板** — 拖拽 Issue 在 待办 / 进行中 / 审查 / 完成 列之间移动
- **多代理** — 支持 Claude Code、OpenAI Codex 作为执行引擎
- **实时对话** — 流式输出代理运行结果；运行中可发送追加消息
- **Diff 查看器** — GitHub 风格的差异面板，查看代理所做的文件改动
- **文件浏览器** — 浏览、查看项目文件，支持语法高亮
- **Web 终端** — 内置 xterm.js 终端，直接访问 Shell
- **文件上传** — 上传文件作为代理的上下文
- **Webhooks** — 可配置的事件通知，支持 Issue 状态变更推送
- **多轮会话** — 保持完整会话历史，支持连续对话
- **子 agent 可观测** — Claude 子 agent 的工作嵌套在派发它的工具调用下，带实时进度
- **会话导入** — 扫描不由 BKD 管理的 Claude Code / Codex 本地会话，可导入为 Issue
- **定时任务** — Cron 作业，含执行历史和连续失败自动暂停
- **Git Worktree** — Issue 可在独立 worktree 中执行，多个代理并行互不干扰
- **进程管理** — 查看并终止所有正在运行的引擎进程
- **托管更新** — 运行在 lode supervisor 之下：发布包经过校验、重启带健康检查、失败自动回滚
- **国际化** — 中文 / 英文界面
- **暗色模式** — 浅色 / 深色 / 跟随系统
- **移动端适配** — 响应式布局，支持触控

## 安装

BKD 运行在 [lode](https://github.com/dotns/lode) supervisor 之下。lode 负责拉取发布包、校验、
启动 BKD 并执行后续更新——新版本起不来时会自动回滚。支持 Linux 和 macOS，x64 与 arm64。

> 发布包都经过 sha256 校验。lode 同时支持 ed25519 asset 签名校验，但 BKD 目前尚未签名。

```bash
sudo mkdir -p /opt/bkd

# 1. 安装 lode
curl -fsSL https://github.com/dotns/lode/releases/download/v0.1.0/lode-linux-x64.tar.gz \
  | sudo tar -xz -C /usr/local/bin lode lode-cli

# 2. 开箱即用的配置——修改标注 CHANGE ME 的路径（默认 /opt/bkd）
curl -fsSL https://github.com/bkhq/bkd/releases/latest/download/bkd.lode.toml \
  -o /opt/bkd/lode.toml

# 3. 运行——lode 会安装当前版本并接管进程
lode --dir /opt/bkd
```

启动后访问 http://localhost:3000。

> **已经在用 `bkd-launcher-*` 安装？** 它不会更新到当前版本。发布包已从 `bkd-app*.tar.gz`
> 改名为 `bkd-server.tar.gz`，旧 launcher 找不到匹配的 asset，会一直停留在原有版本。请显式
> 迁移——数据库、上传文件和 worktree 都保持原位：
>
> ```bash
> curl -fsSL https://github.com/bkhq/bkd/releases/latest/download/migrate-to-lode.ts -o migrate-to-lode.ts
> bun migrate-to-lode.ts --root /opt/bkd            # 预览
> bun migrate-to-lode.ts --root /opt/bkd --apply
> ```

完整的 `lode.toml` 参考、签名校验、更新策略和日常运维见 [docs/deployment.md](docs/deployment.md)。

## 系统要求

BKD 以子进程方式启动 AI 编程代理，使用前请至少安装其中一个：

### Claude Code（推荐）

```bash
npm install -g @anthropic-ai/claude-code
```

需要在环境变量中设置 `ANTHROPIC_API_KEY`，或通过 `claude` CLI 完成认证。

### OpenAI Codex

```bash
npm install -g @openai/codex
```

需要 `OPENAI_API_KEY` 或 `CODEX_API_KEY`，或通过 `codex` CLI 完成认证。

> BKD 启动时会自动检测已安装的代理，可以任意组合使用。

## BKD Skill

仓库当前只内置了一个 BKD skill，位于 `skills/bkd/`。你可以使用 `npx skills` 安装它，然后通过 REST API 操作正在运行的 BKD 服务。

### 必备条件

使用这个 skill 之前，需要先把 `BKD_URL` 指向 BKD API 根路径：

```bash
export BKD_URL=http://localhost:3000/api
```

### Global（所有项目）

```bash
npx skills add bkhq/bkd --skill bkd --global
```

### Project（仅当前项目）

```bash
npx skills add bkhq/bkd --skill bkd
```

安装完成后重启 Codex。之后可以用 `Use $bkd to list projects` 或 `Use $bkd to check execution capacity` 这样的提示词来调用它。

## 使用方法

1. **创建项目** — 设置项目名称和工作目录（代理将在该仓库中工作）
2. **创建 Issue** — 描述任务内容，选择 AI 引擎和模型
3. **执行** — 点击执行，代理在你的工作目录中启动并开始工作
4. **对话** — 随时发送追加消息、上传文件或取消执行
5. **审查** — 查看 Diff、检查代理的工具调用记录，拖拽 Issue 到完成

## 配置

所有配置通过环境变量完成。在项目根目录创建 `.env` 文件（Bun 自动加载）或设置环境变量。完整模板见 `.env.example`。

| 变量                        | 说明                                                      | 默认值           |
| --------------------------- | --------------------------------------------------------- | ---------------- |
| `PORT`                      | 服务端口                                                  | `3000`           |
| `HOST`                      | 监听地址                                                  | `0.0.0.0`        |
| `ROOT_DIR`                  | 安装根目录——固定 `data/` 位置，使其在升级后保留            | 自动检测         |
| `DB_PATH`                   | SQLite 数据库路径                                         | `data/db/bkd.db` |
| `LOG_LEVEL`                 | 日志级别（`trace` / `debug` / `info` / `warn` / `error`） | `info`           |
| `SERVICE_NAME`              | 日志名称前缀                                              | `bkd`            |
| `LOG_EXECUTOR_IO`           | 记录执行器 stdin/stdout（`1` = 开启，`0` = 关闭）         | `1`              |
| `ANTHROPIC_API_KEY`         | Claude API 密钥                                           | —                |
| `OPENAI_API_KEY`            | OpenAI / Codex API 密钥                                   | —                |
| `CODEX_API_KEY`             | Codex 专用 API 密钥（备选）                               | —                |
| `ENABLE_RUNTIME_ENDPOINT`   | 启用 `/api/runtime` 调试端点                              | 禁用             |

服务器名称、服务器 URL、Webhooks、最大并发数等运行时设置在设置界面中管理，持久化存储在数据库中。环境变量 `SERVER_NAME` 和 `SERVER_URL` 仅作为初始种子值 —— 一旦在界面中设置，数据库中的值优先。

## 开发

参见 [docs/development.md](docs/development.md) 了解开发环境搭建、项目结构和贡献指南。

## 许可证

Apache-2.0
