# PLAN-012 ChatInput density refactor + design token primitives

- **status**: completed
- **createdAt**: 2026-05-11 18:00
- **approvedAt**: 2026-05-11 18:05
- **completedAt**: 2026-05-11 18:15
- **relatedTask**: UI-001, UI-002

## Context

### User-stated need

"对话栏，太挤了。" → 推广到整个前端："整个应用的 UI 好像都挺挤的，是不是可以做些优化去调整，美化好看些。"

经过补充澄清，用户接受合并 Engine 信息到 Model 胶囊（不能直接删除），并选择"阶段 1 + 阶段 2"组合方案。

### Current state (from UI audit)

Density problem 的根因是**没有强制的设计 token**，组件各写各的尺寸：

- 图标尺寸 5 个挡位（`size-2.5` / `size-3` / `size-3.5` / `size-4` / `size-5`）
- 按钮高度 4 个挡位（`h-6` / `h-7` / `h-8` / `h-9`），语义不明
- 字号 5 个微调挡位（`text-[9px]` / `text-[10px]` / `text-[11px]` / `text-xs` / `text-sm`）
- 圆角 6 种（`rounded` / `md` / `lg` / `xl` / `full` / `4xl`）同时存在
- 边框透明度 `/30` `/40` `/50` `/60` 在临近组件里换着用
- 背景羽化 `bg-card/{40,60,70}` `bg-muted/{40,50}` `bg-primary/{10,[0.04],[0.07]}` 混用

**密度重灾区**（按严重度）：

1. **ChatInput 工具栏** — 一行 12 个互动元素（`apps/frontend/src/components/issue-detail/ChatInput.tsx`）
2. KanbanColumn 列头
3. ProcessCard
4. Drawer header（`py-1.5` 过矮）
5. HomePage 项目卡尺寸失衡

本 PLAN 只处理 #1（重灾区中最严重的一个），并建立 token 基础设施供后续 PLAN 复用。剩余 4 项留到后续 PLAN。

### Gaps to close

1. ChatInput 工具栏未分组，桌面端单行 4 图标按钮 + 4 胶囊 + 4 右侧按钮 = 12 元素。
2. Engine 胶囊（`ChatInput.tsx:817-827`）不可点击，纯展示，独占胶囊浪费空间。
3. Mode / Model / Engine 三个胶囊语义上耦合（"我用 X 引擎的 Y 模型，处于 Z 模式"），分开展示割裂语义。
4. 桌面端没有"溢出菜单"概念，移动端的 `MobileMoreMenu` 没有桌面对偶。
5. 全应用没有 `<IconButton>` / `<Chip>` 原语，每个组件自己写 `inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-medium border border-border/30 bg-muted/40 ...`，5-8 行重复样板。
6. `index.css` 没有针对组件密度的命名 token —— 数字尺寸散落在 className 字符串里。

## Proposal

### Step 1 — 建立 design tokens（Phase 2）

File: `apps/frontend/src/index.css`

在 `@theme inline` 块下追加组件密度 token（不替换 Tailwind 默认 spacing，只新增语义化别名）：

```css
@theme inline {
  /* Icon size scale — 3 tiers only */
  --size-icon-sm: 0.875rem;  /* 14px — meta icons inside chips */
  --size-icon-md: 1rem;      /* 16px — toolbar icon buttons */
  --size-icon-lg: 1.25rem;   /* 20px — primary actions */

  /* Compact control heights — toolbar/chip context */
  --size-control-xs: 1.5rem;   /* 24px — chip-mounted close 'x' */
  --size-control-sm: 1.75rem;  /* 28px — toolbar icon buttons, chips */
  --size-control-md: 2rem;     /* 32px — standard inputs */
  --size-control-lg: 2.25rem;  /* 36px — page-level primary buttons */
}
```

并在 `index.css` 同层添加 component classes：

```css
@layer components {
  /* Reusable chip surface — replaces the 5-line inline className soup */
  .chip-surface {
    @apply inline-flex items-center gap-1 h-7 px-2.5 rounded-full
           text-[11px] font-medium border border-border/30
           bg-muted/40 text-muted-foreground
           hover:bg-muted/60 transition-colors;
  }
  .chip-surface[data-active='true'] {
    @apply border-primary/30 bg-primary/10 text-foreground;
  }
}
```

Rationale: 既给 `<Chip>` 原语兜底，也允许第三方使用同样的 surface（避免 Chip 强制成唯一入口）。

### Step 2 — 抽 `<IconButton>` 原语（Phase 2）

File (new): `apps/frontend/src/components/ui/icon-button.tsx`

```tsx
type IconButtonProps = {
  size?: 'sm' | 'md' | 'lg'  // 28 / 32 / 36px
  variant?: 'ghost' | 'subtle' | 'primary'
  active?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>
```

Default: `size='sm'`, `variant='ghost'` — 等价于今天 ChatInput 里 `<Button variant="ghost" size="icon" className="size-7">`。`active` 时给 `bg-accent text-foreground`，替换今天散在各处的 `data-active` / `bg-primary/10` hack。

只产出一个内部组件，不动 shadcn `<Button>` —— 兼容性优先。

### Step 3 — 抽 `<Chip>` 原语（Phase 2）

File (new): `apps/frontend/src/components/ui/chip.tsx`

```tsx
type ChipProps = {
  leading?: React.ReactNode  // icon
  trailing?: React.ReactNode // dropdown caret / close x
  active?: boolean
  asChild?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>
```

内部消费 `.chip-surface` class。提供 `Chip.Group` 容器（gap-1，flex wrap）便于工具栏布局。

不依赖 Radix / Base UI —— `<Chip>` 只是带样式的 button，dropdown 等行为由调用方包裹 `DropdownMenuTrigger` / `PopoverTrigger`。

### Step 4 — ChatInput 重排（Phase 1）

File: `apps/frontend/src/components/issue-detail/ChatInput.tsx`

#### 4.1 桌面端工具栏分组改造

新结构（左 → 右）：

```
[📎 附件] [▱ 命令] [⋯ 更多]   │   [🤖 auto · sonnet]   │   ────  [diff 徽章] [↑ 发送]
   高频 IconButtons             组合配置胶囊            填充     状态+主操作
```

- **「⋯ 更多」**: 新增桌面端 IconButton，点击弹出 popover，内含：
  - 「刷新日志」（原 RefreshCw）
  - 「打开文件」（原 FolderOpen）
  - 「清空会话」（原 Eraser，disabled 状态保留）
  - 占用 max-md 既有的 `MobileMoreMenu` 同结构，仅在桌面端少了 Mode/Model（它们被合到组合胶囊）。

- **组合配置胶囊**: 新组件 `EngineConfigChip`（ChatInput 内私有）
  - 显示：`<EngineIcon /> {mode === 'ask' ? 'ask' : 'auto'} · {modelDisplayName}`
  - hover/title：完整引擎名（`createIssue.engineLabel.<type>`）
  - 点击展开 Popover，含三个区：
    - 顶部不可改：引擎名 + EngineIcon（说明"当前会话用的什么"）
    - Mode 切换（auto / ask）
    - Model 列表
  - 模型为空：胶囊只显示 `<EngineIcon /> {mode}`
  - omit-model 锁定：胶囊显示 `<EngineIcon /> {mode} · 默认`，popover 内 Model 区禁用并加 hint
  - 会话运行时整个胶囊不禁用（只 model 区禁用），让用户仍能切 Mode

- **BusyAction 胶囊**: 保留独立胶囊，因为只在 `isSessionActive && !isThinking` 时才出现，复用 EngineConfigChip 会让 popover 闪烁。位置：紧贴组合胶囊右侧。

- **Diff 徽章**: 从中间移到右侧，紧贴 Send 按钮左边。视觉上和"主操作组"绑定。

#### 4.2 删除冗余 UI

- 删除独立的 `ModeSelect` / `ModelSelect` 在 toolbar 的直接渲染（移到 `EngineConfigChip` popover 内）。两个组件函数本身保留（被新组合胶囊内部消费）。
- 删除桌面端独立的 Engine 信息胶囊（817-827 行）—— 信息合并进 `EngineConfigChip` 前缀。
- 删除桌面端中间分隔符（814 行、873-876 行）—— 新分组天然有视觉边界（图标按钮组 vs 胶囊组 vs 右侧主操作）。

#### 4.3 MobileMoreMenu 同步

- 移动端 `MobileMoreMenu` 现在已经包含 Mode/Model/BusyAction/Refresh/Files/Clear，结构保持不变。
- 标题区新增"当前会话"小标题，显示 EngineIcon + 引擎名（移动端没有顶层胶囊，这是唯一展示位置）。

#### 4.4 受影响 i18n keys

新增（en + zh）：

- `chat.more` / "More" / "更多"
- `chat.configChipTitle` / "Engine settings" / "引擎设置"
- `chat.configChipCurrentEngine` / "Current engine" / "当前引擎"

修改：无（沿用 `chat.refreshLogs` / `diff.openFiles` / `chat.clearSession` / `createIssue.mode` / `createIssue.model` / `chat.busyAction.*`）。

### Step 5 — 测试覆盖

新增 vitest：

- `apps/frontend/src/__tests__/components/ChatInputDensity.test.tsx`
  - 桌面宽度下渲染：组合胶囊存在、独立的 Engine/Mode/Model 胶囊不存在
  - 点击「⋯ 更多」按钮：refresh / files / clear 菜单项出现
  - 模型列表为空：组合胶囊不显示 "·" 分隔符
  - omit-model 锁定：Model 区禁用 + hint 可见
  - Diff 徽章位于 Send 按钮左侧（DOM 顺序）

不新增 IconButton / Chip 单测（结构性纯样式组件，覆盖在 ChatInputDensity 里间接验证）。

### Verification

- `bun --filter @bkd/frontend lint`
- `bun run test:frontend`
- 手工：
  - 桌面宽度（≥1024px）— 工具栏单行、组合胶囊显示引擎 icon + mode + model
  - 平板宽度（768-1023px）— 同桌面（沿用 md 断点）
  - 移动宽度（<768px）— 仅 📎 / ▱ / ⋯ 三个按钮 + Send，MobileMoreMenu 内含完整配置
  - 暗色/亮色主题各一遍
  - 切换 issue / 切换 engine / 启动会话 → 胶囊文案与禁用状态正确

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| 合并 popover 后用户找不到原 "切换模型" 入口 | Medium | 胶囊文案末尾就是 model 名（无需展开就能看见当前选择），点击行为符合直觉。i18n title 写明 "Engine settings"。 |
| `EngineConfigChip` popover 在会话运行时半禁用半可用，逻辑分支增多 | Medium | 集中在单个组件内，用 `disabled` 区分 Model 列表；Mode 永远可改，BusyAction 仍走独立胶囊不混入。 |
| 桌面端 `⋯` 菜单与既有 `MobileMoreMenu` 行为不一致 | Low | 抽公共 hook `useMoreMenuActions(...)` 返回菜单项数据，两个渲染壳壳消费同一数据源。 |
| Diff 徽章右移后用户在改动多时找不到 | Low | 紧贴 Send 按钮，视觉位置反而更显眼。徽章自带颜色（+绿 -红）保留。 |
| `<Chip>` / `<IconButton>` 原语未来限制设计自由 | Low | 都是薄包装，逃生口是直接 className override（`className` prop merge via cn()）。 |
| `chip-surface` class 与 Tailwind utility 合并冲突 | Low | 用 `@apply` 展开，避免 specificity 倒挂；调用方仍可 `cn('chip-surface', 'h-8')` 覆盖。 |
| 新增 component layer CSS 影响首屏体积 | Low | 增量 < 1KB gzipped；CSS 复用比 JSX 复用更省 bundle。 |

## Scope

Files touched:

- `apps/frontend/src/index.css` (tokens + chip-surface class)
- `apps/frontend/src/components/ui/icon-button.tsx` (new)
- `apps/frontend/src/components/ui/chip.tsx` (new)
- `apps/frontend/src/components/issue-detail/ChatInput.tsx` (toolbar rewrite, EngineConfigChip private component)
- `apps/frontend/src/i18n/en.json`
- `apps/frontend/src/i18n/zh.json`
- `apps/frontend/src/__tests__/components/ChatInputDensity.test.tsx` (new)

Estimated diff: ~350-500 lines across 7 files. No backend changes.

## Alternatives

### A. 只做 ChatInput 重排，不抽原语

Rejected. ChatInput 在重排过程中就要写 4-5 个新的胶囊样式（EngineConfigChip 内部 popover 分区按钮、桌面"⋯"菜单项等），样板马上扩散。先抽原语成本一致、且后续 PLAN 复用价值高。

### B. 引入完整设计系统（重做 shadcn 主题）

Deferred to a future PLAN. 风险大、外观变化跨页面、需要专门 visual review。本 PLAN 只做"密度问题"和"建立基础设施"，不动配色/typography。

### C. 用 `data-slot` + headless 库（Radix Toolbar）做工具栏

Rejected. ChatInput 工具栏行为简单（IconButton + Chip + Popover 已能覆盖），引入 Toolbar 反而增加耦合。后续如果出现复杂键盘导航需求再考虑。

### D. 完全删除 Engine 胶囊（不合并）

Rejected by user feedback: "删了引擎，那我就不知道当前会话用的是什么引擎了"。EngineIcon 必须始终可见。

## Annotations

(approved 2026-05-11 18:05 by user — "可以。开始")
