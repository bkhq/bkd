# Changelog

## 2026-03-08 14:30 [progress]

CHAT-001 Phase 1 完成：聊天界面 UI 优化后端基础设施

新增文件：
- `packages/shared/src/index.ts` — ChatMessage 类型（7 种变体）+ ToolProgressEvent/ToolGroupEvent + SSEEventMap 更新
- `apps/api/src/engines/issue/store/execution-store.ts` — 内存 SQLite per-execution 存储，RingBuffer 兼容接口
- `apps/api/src/engines/issue/store/message-rebuilder.ts` — 纯函数 rebuildMessages()，工具分组/配对/过滤
- `apps/api/test/execution-store.test.ts` — 10 个测试
- `apps/api/test/message-rebuilder.test.ts` — 10 个测试

关联方案：PLAN-001
