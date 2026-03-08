# CHAT-001 聊天界面 UI 优化（对标 Claude Code）

- **status**: in_progress
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-03-08 12:00

## 描述

对标 Claude Code Web 聊天界面，优化 BKD 的 issue 聊天 UI，提升信息密度和交互体验。

## 进度

### Phase 1: 后端基础设施 ✅

- [x] ChatMessage 类型定义（packages/shared）— 7 种消息变体 + ToolProgressEvent/ToolGroupEvent
- [x] ExecutionStore（内存 SQLite）— 替代 RingBuffer，完整记录所有 normalized entries
- [x] MessageRebuilder（分组/配对/过滤纯函数）— entries → ChatMessage[]
- [x] 单元测试 — 20 个测试全部通过

### Phase 2: 后端 Pipeline 切换 ⏳

- [ ] 修改 normalizer 移除 write filter 拦截
- [ ] 修改 consumer 写入 ExecutionStore
- [ ] 改造 pipeline（persist/ring-buffer/SSE）

### Phase 3: 前端适配 ⏳

- [ ] use-issue-stream 处理新 SSE 事件
- [ ] 重写 SessionMessages + ToolGroupMessage
- [ ] 合并 ChatInput 状态栏 + i18n
