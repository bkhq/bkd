# Changelog

## 2026-03-08 [progress]

- FEAT-001: 添加 `SERVER_NAME` 和 `SERVER_URL` 环境变量支持
  - 后端 `/api/settings/system-info` 新增 `server.name` / `server.url` 字段
  - 前端页面标题动态显示 `SERVER_NAME`（未设置时保持 "BKD"）
  - 复制链接使用 `SERVER_URL` 拼接外部 URL（未设置时回退 `window.location.origin`）
  - Webhook payload 自动注入 `issueUrl` 和 `projectId`（当 `SERVER_URL` 设置时）
  - 新增 `server-store.ts` Zustand store 和 `getIssueUrl()` 工具函数
