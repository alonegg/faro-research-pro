# Faro Research Pro — Frontend 完整功能规格

本文档是**重新设计前端时的事实清单**。涵盖：现有功能、状态模型、API 契约、UX 流程、关键不变量。

> 凡是带 ⚠️ 的部分是**底层契约 / 不变量**，重新设计 UI 可以变样子，但行为不能破坏。

---

## 0. 技术栈

- **构建**：Vite 5 + React 18 + TypeScript 5
- **包管理**：pnpm
- **依赖（运行时）**：
  - `react` / `react-dom`
  - `framer-motion` — 入场/退场动画
  - `sonner` — Toast 通知（替代 `confirm()` / `alert()`）
  - `react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js` — Markdown 渲染（含 GFM 表格、代码块语法高亮）
- **没有依赖**：
  - 没用 Tailwind（CSS 全部手写在 `styles.css`，用 CSS variables）
  - 没用状态管理库（Zustand / Redux 都没有，单 hook `useChatStore`）
  - 没用 router（设置是 modal，不是路由切换）
  - 没用 UI 组件库（自己实现 Button / Field / Switch / Spinner）

---

## 1. 顶层布局（IA）

```
┌──────────────────────────────────────────────────────────────────┐
│ Sidebar (260px / 56px collapsed)        │  Main                  │
│                                         │                         │
│ ┌─ Brand Header ──────────────────────┐ │  ┌─ TopBar ──────────┐  │
│ │ F  Faro Research [PRO]    ‹ collapse│ │  │ 标题 + Sub +       │  │
│ └─────────────────────────────────────┘ │  │ 协作 Switch +      │  │
│ ┌─ + 新会话 ───────────────────────────┐│  │ Provider pill + ⚙│  │
│ └─────────────────────────────────────┘ │  └────────────────────┘  │
│ [搜索框 ⌘K]                             │                         │
│ [全部] [tag1] [tag2] [tag3] ...        │  Thread (scroll)         │
│                                         │  ┌─────────────────────┐ │
│ 📌 置顶                                 │  │ EmptyState 或       │ │
│   · session A                          │  │ history 消息流 +    │ │
│   · session B                          │  │ live turns          │ │
│ 今天                                    │  │                     │ │
│   · session C                          │  │                     │ │
│ 昨天 / 本周 / 本月 / 更早               │  └─────────────────────┘ │
│                                         │                         │
│ 🗑 回收站 [3]                           │  ┌─ Composer ──────────┐ │
│   ↺ 还原 / × 永久删除                  │  │ [textarea]  [发送]  │ │
│                                         │  │ hint  ⌘ Enter      │ │
│                                         │  └────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

         (顶层覆盖层)
         AuthGate Modal — 当未鉴权时显示
         Settings Modal — 当 ⚙ 点击时显示（满屏覆盖）
```

**Grid**：`grid-template-columns: 260px 1fr` (默认) / `56px 1fr` (折叠)。0.18s easing 切换。

---

## 2. 三个顶层视图

| 视图 | 触发 | 描述 |
|---|---|---|
| **Main thread** | 默认 | Sidebar + TopBar + Thread + Composer |
| **AuthGate** | `auth_required && (!me \|\| authError)` | 全屏 modal 强制登录，输入 API key |
| **Settings Modal** | TopBar `⚙` 点击 / 未来快捷键 | 11 个 tab 的覆盖层；Esc 关 |

**Main 视图**还有两个**子状态**：
- **Empty**：`!activeId && turns.length === 0` → 显示 `<EmptyState>` 带 5 个建议按钮
- **Active**：有 activeId 或有 live turns → 显示 history + turns

---

## 3. 状态模型

### 3.1 服务端持久化（SQLite）

| 资源 | 表/路径 | scope |
|---|---|---|
| Sessions | `session` 表 | per-user |
| Messages | `message` 表（每行属于一个 session） | per-session |
| Pro 元数据 | `pro_session_metadata`（pinned/tags/deleted_at/auto_titled） | per-session |
| Pro 设置 | `pro_settings`（key/value JSON） | global |
| Memory | `data/memory/{user_id}/` 文件目录 | per-user |
| Audit log | `audit` 表 | per-user |
| Users | `user` 表 | global |

### 3.2 浏览器 localStorage

| Key | 类型 | 用途 |
|---|---|---|
| `faro_api_key` | string | Bearer token，每个请求带 |
| `faro_pro_collab` | "0" \| "1" | 协作模式开关 |
| `faro_pro_sidebar_collapsed` | "0" \| "1" | 侧栏折叠状态 |

### 3.3 React state（`useChatStore` hook，集中管理）

```typescript
{
  // 数据
  sessions: SessionMeta[]              // 当前用户全部 session
  visibleSessions: SessionMeta[]       // 经过 search + tagFilter 过滤的
  deletedSessions: SessionMeta[]       // 回收站（按需加载）
  allTags: string[]                    // 所有 session tag 的并集
  activeId: string | null              // 当前打开的 session
  history: PersistedMessage[]          // 当前 session 的历史消息（来自 server）
  turns: UITurn[]                      // 当前 session 的 live turns（流中）
  running: boolean                     // 是否有流在跑
  
  // 服务器信息
  info: ServerInfo                     // {provider, version, auth_required}
  me: MeResponse                       // 当前登录用户
  authError: string | null
  
  // UI 偏好
  collabMode: boolean                  // 协作模式开关
  sidebarCollapsed: boolean            // 侧栏折叠
  searchQuery: string                  // 搜索关键词
  tagFilter: string | null             // 当前选中的 tag
  
  // Actions
  setActiveId / setCollabMode / setSidebarCollapsed / toggleSidebarCollapsed
  setSearchQuery / setTagFilter
  newSession / deleteSession / renameSession
  restoreSession / purgeSession / refreshDeleted
  setPinned / setTags
  submit                               // 发送提问，启动 SSE 流
}
```

### 3.4 ⚠️ 关键不变量

| ID | 不变量 | 为什么 |
|---|---|---|
| **A** | useChatStore 的 `lastLoadedSession` ref：只在**真正切换 session**（一个 id → 另一个 id）时清 `turns`，**不**在初次设置 activeId 时清 | 否则 submit 中 ensureSession→setActiveId→useEffect→setTurns([]) 会抹掉刚插入的 pending turn，UI 永远停在"等待中" |
| **B** | 每个 UITurn 带 `sessionId` | 切换会话后，旧流的事件 (`onEvent`) 不应染到新会话上 |
| **C** | 切换 session 时 `abortRef.current?.abort()` | 否则旧流跑完前新会话的输入框被锁，且会写错 session |
| **D** | submit 时若 `isNew` 为真，把 sid 加入 `pendingAutoTitle` set；流跑完后 `tryAutoTitle(sid)` 一次性触发 | 自动标题只对**第一条提问**触发一次 |
| **E** | SSE 中 Researcher inner-loop 的 `final` 事件**不应**到达前端 | 前端把 `final` 当 turn 完结，会提前结束并隐藏 Reviewer phase |

---

## 4. 后端 API 契约（前端要用的）

### 4.1 鉴权

每个请求：`Authorization: Bearer <faro_api_key>` （从 localStorage）

| Endpoint | 用途 |
|---|---|
| `GET /api/health` | `{status, version, provider, auth_required}` |
| `GET /api/auth/me` | 当前用户 `{id, email, role, created_at}` |

### 4.2 Sessions

| Endpoint | 用途 |
|---|---|
| `GET /api/pro/sessions?include_deleted=&only_deleted=` | Pro 列表（带 pinned/tags/deleted_at） |
| `GET /api/sessions/{id}` | session + messages |
| `POST /api/sessions` `{title?}` | 新建（OSS endpoint） |
| `PATCH /api/sessions/{id}` `{title}` | 重命名（OSS endpoint） |
| `DELETE /api/pro/sessions/{id}` | 软删（tombstone） |
| `POST /api/pro/sessions/{id}/restore` | 还原 |
| `DELETE /api/pro/sessions/{id}/purge` | 永久删 |
| `PATCH /api/pro/sessions/{id}/metadata` `{pinned?, tags?}` | 设元数据 |
| `POST /api/pro/sessions/{id}/auto-title` | LLM 生成标题（idempotent） |

### 4.3 Streaming

| Endpoint | Method | 用途 |
|---|---|---|
| `POST /api/sessions/{id}/ask/stream` | POST | OSS 单 agent 流 |
| `POST /api/sessions/{id}/ask/collab/stream` | POST | Pro 多 agent (Researcher + Reviewer) 流 |

**协议**：`text/event-stream`。前端用 `fetch` + `getReader()` 手解析（EventSource 不支持 POST）。
事件分隔符 `\n\n`，每事件结构：
```
event: <type>
data: <JSON>

```

### 4.4 ⚠️ SSE 事件协议（重新设计 UI 必须保留）

| Type | 何时 | 字段 |
|---|---|---|
| `phase_start` | Researcher 或 Reviewer 阶段开始（仅 collab） | `phase: "researcher"\|"reviewer"`, `round: int` |
| `phase_done` | 阶段结束 | `phase`, `round`, `draft?: str` |
| `turn_start` | Agent 内部循环开始一轮（OSS） | `turn: int` |
| `tool_call` | Agent 调用工具 | `tool_call_id, name, args` |
| `tool_result` | 工具返回 | `tool_call_id, name, latency_ms, result_chars, error` |
| `review_verdict` | Reviewer 评分 | `round, verdict, score, summary, issues: [{category, detail}]` |
| `final` | 流完结，最终答案 | `answer, turns, tool_calls, latency_total_ms, rounds?, reviews?` |
| `error` | 错误 | `message` |
| `done` | 服务端关闭流 | `{}` |

### 4.5 Settings

| Endpoint | 用途 |
|---|---|
| `GET /api/pro/settings` | 19 个键的 dict |
| `PATCH /api/pro/settings` `{key: value}` | 更新（白名单 key） |
| `GET /api/pro/settings/status` | 只读快照（含 masked secrets / version / counts） |
| `PUT /api/pro/settings/memory` `{soul, rules}` | 更新 memory |
| `POST /api/pro/settings/test/{kind}` | 连接测试 (`llm_main`/`llm_small`/`tushare`/`fd_ai`) |
| `POST /api/pro/settings/purge_all_sessions` | 清空当前用户所有 session |

### 4.6 Users (admin only)

| Endpoint | 用途 |
|---|---|
| `GET /api/pro/users` | 列表（带 sessions_count, last_seen） |
| `POST /api/pro/users` `{email, role}` | 创建 → 返回 plain_key 一次 |
| `DELETE /api/pro/users/{id}` | 删用户 + sessions + memory |
| `POST /api/pro/users/{id}/regenerate_key` | 新 key（旧的失效） |

### 4.7 Export

| Endpoint | 用途 |
|---|---|
| `GET /api/sessions/{id}/export.md` | 下载 Markdown |
| `GET /api/sessions/{id}/export.pdf` | 下载品牌 PDF |

---

## 5. 组件清单（按文件）

### 5.1 顶层

| 文件 | 职责 |
|---|---|
| `main.tsx` | ReactDOM root + `<Toaster />`(sonner) |
| `App.tsx` | 取 `useChatStore`，拼装 Sidebar + Main + Composer + SettingsModal；处理 ⌘K/⌘\\/⌘N 全局快捷键 |
| `markdown.tsx` | `<Markdown text>` — react-markdown + remarkGfm + rehypeHighlight |

### 5.2 UI primitives (`components/ui/`)

| 组件 | Props | 行为 |
|---|---|---|
| `Button` | `variant: primary\|ghost\|destructive\|default`, `size: sm\|md\|icon`, 其他原生 button props | 透明色 + transform:scale(0.98) on active |
| `Spinner` | `label?` | 紫色脉冲点 + 可选文字 |
| `Kbd` | `children` | 键位徽章（`<kbd class="kbd">`） |
| `AuthGate` | `onSuccess()` | 全屏 modal，password input + 登录按钮，提示"localStorage only" |

### 5.3 Chat (`components/chat/`)

| 组件 | 职责 |
|---|---|
| `Sidebar` | 折叠/展开两态；品牌头 + + 新会话 + 搜索 + tag chips + grouped session list + 回收站抽屉 |
| `TopBar` | 标题 + Sub + 协作 Switch + provider pill + ⚙ 设置 + 退出按钮 |
| `Thread` | 滚动容器，`scrollKey` 变化时自动滚到底 |
| `EmptyState` | 居中欢迎 + 5 个 chip 建议 |
| `Composer` | textarea 自动撑高（22-192px）+ 发送按钮 + ⌘+Enter hint |
| `Message` | 导出 `UserMessage`, `AssistantMessage`, `PersistedMessageView`, `TurnView` |
| `PhaseTag` | 紫/橙圆角徽章；framer-motion 入场（y:-4 → 0） |
| `ReviewCard` | 评分卡（绿/橙左边框），含 verdict + summary + issues 列表 |
| `ToolsTrace` | `<details>` 折叠列表；显示 tool name pill + args + 耗时/错误 |
| `ExportMenu` | 两个按钮：下载 Markdown / 下载 PDF（用 toast.promise 显示进度） |

### 5.4 Settings (`components/settings/`)

| 组件 | 职责 |
|---|---|
| `SettingsModal` | overlay shell；左 11 tab 导航，右内容；Esc 关；admin-only tab 自动隐藏 |
| `Field.tsx` | 三个 helper：`<Section>` `<Field label hint>` `<ReadOnly>` `<Switch>` |

#### 11 个 sections（顺序固定，admin tab 在第 7 位）

| # | Tab | 编辑 | 用途 |
|---|---|---|---|
| 1 | 🧠 LLM 模型 | 只读 | 主模型 + 小模型基础信息 + 2 个 ping 测试 |
| 2 | 📊 数据源 | 只读 | Tushare / FD.ai / AKShare 状态 + 3 个连接测试 |
| 3 | 🤖 Agent 行为 | 可编辑 | 协作默认 / max rounds / skills/memory 启用 |
| 4 | 💬 会话默认 | 可编辑 | 自动标题开关 / 用小模型 / 回收站保留天数 |
| 5 | 🎨 品牌 / PDF | 可编辑 | 项目名 / slogan / URL / 主色 / 深色 / 作者 / 机密水印 |
| 6 | 🧬 Memory & Skills | 可编辑 | Soul + Rules 文本 (dirty/save/undo) + memory count + skills 列表 |
| 7 | 👥 用户管理 (admin) | 可编辑 | 用户表 + 创建模态 + plain_key 一次性显示 + 重置/删除 |
| 8 | 🔐 认证 | 部分 | auth_required 状态 + 当前用户 + 退出 + 版本 |
| 9 | 🛡️ 审计 / 隐私 | 可编辑 | record_query 开关 / DB 路径 / 清空全部 (三次确认) |
| 10 | ⌨️ 快捷键 | 只读 | 静态表格 |
| 11 | ✨ 外观 | 可编辑 | 主题 / 字号 / 侧栏宽度 / 语言 |

---

## 6. UX 流程

### 6.1 ⚠️ 提问流程（核心）

1. 用户在 Composer 输 query，`⌘+Enter` 或点"发送"
2. `submit(raw)` 在 useChatStore 内：
   - `setRunning(true)`
   - `await ensureSession()` —— 没 active 就 `api.createSession()` 后**先把 `lastLoadedSession.current = sid`**（防 wipe race），再 `setActiveId(sid)`
   - 如果 `isNew`：`pendingAutoTitle.add(sid)`
   - `setTurns(prev => [...prev, {id, query, status:'pending', sessionId:sid, ...}])`
   - 创建 `AbortController`，存到 `abortRef.current`
   - `await askStream(sid, query, onEvent, signal, mode)`
3. SSE 事件不断到达 → `onEvent(turnId, ev)` 更新对应 turn 的字段
4. 用户切换 session → `abortRef.current.abort()` 立即中止
5. finally：`setRunning(false)` → `refreshSessions()` → `tryAutoTitle(sid)`

### 6.2 自动标题流程 ⚠️

- **触发条件**：`pendingAutoTitle.has(sid)` 为真（即 ensureSession 创建了新 session）
- **后端**：调 `/api/pro/sessions/{sid}/auto-title` → 用小模型 (Qwen) 生成 6-12 字
- **幂等**：服务端检查 `auto_titled` flag，已设过就 skip
- **UI 反馈**：标题异步刷新进 sidebar；用户看到 "新会话" → ~1 秒后变成 "贵州茅台财务表现分析" 这种

### 6.3 切换 session 流程 ⚠️

- 点 sidebar item → `setActiveId(id)` → `_setActiveId` wrapper 检查若 `prev !== id && abortRef.current`，则 `.abort()` 并 `setRunning(false)`
- useEffect 监听 activeId → 计算 `switched = lastLoadedSession.current !== null && !== activeId`
- `api.getSession(id)` → 设 history
- 如果 switched：`setTurns([])`；否则保留（首次设置或同 id 不清）

### 6.4 软删除 + 撤销流程

- 点 × → toast "删除这个会话?" 带 "删除" 按钮，6 秒倒计时
- 用户点"删除"：`api.deleteSession(id)` → 服务端写 `deleted_at` → 从 sessions 移除 → toast.success "已移到回收站" 带 "撤销" 按钮 8 秒
- 用户点"撤销"：`api.restoreSession(id)` → 加回 sessions

### 6.5 重命名流程

- 双击 session item title → 切换到 input
- Enter 提交：`api.rename(id, title)`（OSS endpoint）
- Esc 取消，恢复原值
- onBlur 也提交

### 6.6 标签编辑流程

- 点 `#` 按钮 → 切换到 inline input，预填当前 tags
- 用 `,` `，` `、` 任意分隔
- Enter / onBlur 提交：`api.setTags(id, parsedTags)`
- Esc 取消

### 6.7 鉴权流程

- App boot：`api.health()` → 知道 `auth_required` 与否
- 若 required：`api.me()` 试，401 → 设 authError
- `showAuthModal = auth_required && (!me || authError) && info` → 渲染 `<AuthGate>`
- 用户输 key → setApiKey() → location.reload() → 走完整 boot

### 6.8 创建用户流程 (admin)

1. ⚙ → 用户管理 → "+ 创建新用户"
2. 弹 modal：邮箱输入 + 角色 radio (user / admin)
3. 提交 → `api.createUserAdmin(email, role)` → 返回 `{...user, plain_key}`
4. 弹"已生成 key"modal：显示 key + 复制按钮 + 警告"只显示一次"
5. 用户复制后关闭 → 列表刷新

---

## 7. 键盘快捷键（全局，App.tsx 注册）

| 键 | 行为 |
|---|---|
| `⌘+Enter` (Composer 内) | 发送当前输入 |
| `⌘+K` | 聚焦搜索框（若侧栏折叠则先展开） |
| `⌘+\` | 折叠/展开侧栏 |
| `⌘+N` | 新建会话（注意避开 `⌘+Shift+N` = 浏览器无痕） |
| `Esc` (Settings 内) | 关闭 Settings modal |
| `Esc` (Sidebar 输入框) | 清空搜索 / 取消重命名 / 取消标签编辑 |
| 双击 session 标题 | 重命名 |

---

## 8. 设计 tokens（CSS variables）

定义在 `styles.css` 的 `:root`：

### 8.1 颜色

```css
/* 表面层级 */
--bg: #f8f7f3              /* app 背景（warm cream） */
--surface: #ffffff
--surface-2: #f3f1ec       /* 侧栏 / 输入框背景 */

/* 文字层级 */
--ink-1: #1d1c19           /* 主文字 */
--ink-2: #4a4843           /* 次要文字 */
--ink-3: #8a857c           /* hint / 辅助 */
--ink-4: #b5b0a6           /* 禁用 */

/* 线条 */
--border: #e1ddd4
--divider: #ecebe5

/* 品牌色（紫，区别于 OSS 的蓝） */
--accent: #7a3cf3
--accent-soft: #f1ebfe     /* 浅紫底 */
--accent-strong: #6028d9   /* hover 加深 */
--accent-2: #4a6cf7        /* 渐变第二色 */

/* 语义色 */
--pos: #16a34a
--pos-soft: #f0fdf4
--neg: #dc2626
--neg-soft: #fee2e2
--warn: #b85b00            /* Reviewer 阶段配色 */
--warn-soft: #fff4e5

/* 焦点环 */
--ring: rgba(122, 60, 243, 0.32)
```

### 8.2 形状

```css
--radius-sm: 6px           /* 按钮、徽章 */
--radius-md: 8px           /* 卡片、输入框 */
--radius-lg: 12px          /* 大卡、modal */
```

### 8.3 阴影

```css
--shadow-1: 0 1px 2px rgba(15,12,8,0.04), 0 1px 1px rgba(15,12,8,0.03)
--shadow-2: 0 4px 12px rgba(15,12,8,0.08), 0 2px 4px rgba(15,12,8,0.04)
--shadow-3: 0 12px 32px rgba(15,12,8,0.12), 0 4px 8px rgba(15,12,8,0.06)  /* modal */
```

### 8.4 字体

- 系统字体栈：`-apple-system, "PingFang SC", "Helvetica Neue", system-ui, sans-serif`
- 等宽：`ui-monospace, SF Mono, Menlo, monospace`
- 默认字号 14px，可在 ⚙→外观 调到 13/14/15
- `-webkit-font-smoothing: antialiased`

### 8.5 间距

- 没显式 token，靠经验值（4/6/8/10/12/14/16/18/20/24/28px）
- 内容区最大宽 880px，居中
- 侧栏 260px / 56px 折叠

---

## 9. 视觉特征 / 微交互

| 元素 | 特征 |
|---|---|
| 用户消息气泡 | 右对齐，紫色软底 (`accent-soft`)，右下角直角，左/右上/左下大圆角 |
| 助手消息卡 | 白底 + 1px border + shadow-1，左上角直角，其他大圆角 |
| 紫色 Researcher 标签 | `accent-soft` 背景，圆角 999px，framer-motion `y:-4 → 0` 入场 |
| 橙色 Reviewer 标签 | `warn-soft` 背景，同形 |
| 评分卡 | 左侧 4px 色条（绿=approve，橙=revise），scale 0.97→1 入场 |
| 工具调用 | `<details>` 折叠，summary 前带 ▸/▾ 旋转 |
| Pending dot | 紫色 8px 圆点 + `pulse` 动画 1.2s 循环（透明度 + scale） |
| Active session | 左侧 3px 紫竖条 + shadow-1 + 白底 |
| 折叠侧栏 | 56px 仅留品牌图标 + + 按钮，0.18s 过渡 |
| Switch 开关 | 28×16px 轨道 + 12px 滑块，关 → 灰，开 → 紫，0.18s |
| Pinned 图标 | 紫色 📌，hover 才出 → 已置顶则常驻 |
| Tag chip | 圆角 999px，hover 边框变紫，active 紫底 |

---

## 10. 后端运行时配置（前端关心的）

| Setting key | 默认 | 影响 |
|---|---|---|
| `agent.default_collab` | false | Composer 协作 switch 初始值（首次） |
| `agent.collab_max_rounds` | 2 | 多 agent 循环上限 |
| `session.auto_title_enabled` | true | 第一条提问后是否触发自动标题 |
| `session.auto_title_use_small_model` | true | 用小模型 vs 主模型 |
| `session.trash_retention_days` | 30 | 回收站保留天数 |
| `brand.project_name` | "Faro Research Pro" | PDF 封面 / TopBar 副标题 |
| `brand.tagline` | "AGPL · 多 agent A 股研究" | PDF 封面 |
| `brand.accent_color` | "#7a3cf3" | PDF 主色（不影响前端运行时） |
| `brand.confidential` | false | PDF 加机密水印 |
| `audit.record_query_text` | true | 是否在 audit log 写 query 内容 |
| `ui.theme` | "light" | 主题（dark 实际未实现，预留） |
| `ui.font_size` | 0 | -1/0/1，对应 13/14/15 px |
| `ui.sidebar_width` | 260 | 侧栏宽度（预留，当前固定） |

---

## 11. 已知限制 / 重新设计可考虑的方向

### 已实现但简陋

- **暗色主题** — 仅 token 预留，没真正配置 `[data-theme="dark"]`
- **侧栏宽度** — 设置存了，没真应用到 grid
- **导出 .zip** — 按钮存在但 toast 提示"未实现"
- **登录历史** — 设置 - 认证 提到但未实现
- **多语言** — 提到但只有中文

### 缺失（重设计可加）

- **会话搜索的全文检索**（当前只搜标题）
- **消息内 in-place 编辑/重生成**（assistant-ui 风格）
- **草稿自动保存**（关浏览器再开输入框是空的）
- **附件上传**（当前不支持文件 / 截图分析）
- **协作进度可视化**（多 agent 阶段当前是平铺 tag，可改成 timeline / Stepper）
- **会话内全文导航 / 跳到第 N 轮**
- **手机端响应式**（当前是 desktop-only，没做 breakpoint）
- **Stickered messages / system messages 区分**（当前 PersistedMessageView 跳过 system/tool 角色）
- **可分享的只读会话链接**（用户明确提到下版本做）

### 重新设计**不要破坏**的

- ⚠️ 不变量 A-E（见 §3.4）
- ⚠️ SSE 事件协议（见 §4.4）
- ⚠️ localStorage key 名字（迁移成本）
- ⚠️ AuthGate 永不暴露 key 给后端以外的方
- ⚠️ admin tab 必须客户端隐藏 + 服务端 enforce（不能只靠隐藏 UI）
- ⚠️ deleteSession 默认走软删（`/api/pro/sessions/{id}` not OSS DELETE），purge 是双重确认
- ⚠️ 自动标题触发只一次，不能每轮提问都重命名

---

## 12. 文件依赖图（高层）

```
main.tsx
└─ App.tsx
   ├─ useChatStore (state/useChatStore.ts)
   │  └─ api (api.ts)
   ├─ Sidebar
   │  ├─ Button
   │  ├─ groupSessions (lib/groupSessions.ts)
   │  └─ SessionItem (内嵌)
   ├─ TopBar
   │  └─ Button + sonner toast
   ├─ Thread
   ├─ EmptyState
   ├─ Composer
   │  ├─ Button
   │  └─ Kbd
   ├─ Message: PersistedMessageView / TurnView
   │  ├─ Markdown (markdown.tsx)
   │  ├─ PhaseTag
   │  ├─ ReviewCard
   │  ├─ ToolsTrace
   │  └─ ExportMenu
   ├─ AuthGate (when needed)
   └─ SettingsModal
      ├─ useSettings (state/useSettings.ts)
      └─ 11 sections
```

---

## 13. 实现细节抽样

### 13.1 SSE 解析（api.ts:askStream）

```typescript
const reader = r.body!.getReader();
const decoder = new TextDecoder("utf-8");
let buf = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf("\n\n")) >= 0) {
    const chunk = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
    if (!dataLine) continue;
    const ev = JSON.parse(dataLine.slice(5).trim());
    onEvent(ev);
    if (ev.type === "done") return;
  }
}
```

### 13.2 wipe-race 保护（state/useChatStore.ts）

```typescript
useEffect(() => {
  if (!activeId) {
    setHistory([]);
    if (lastLoadedSession.current) setTurns([]);
    lastLoadedSession.current = null;
    return;
  }
  const switched = lastLoadedSession.current !== null
                   && lastLoadedSession.current !== activeId;
  lastLoadedSession.current = activeId;
  api.getSession(activeId).then((d) => {
    setHistory(d.messages);
    if (switched) setTurns([]);  // ← 只在真切换时清
  });
}, [activeId]);
```

### 13.3 auto-title 触发（state/useChatStore.ts:submit）

```typescript
let { sid, isNew } = await ensureSession();
if (isNew) pendingAutoTitle.current.add(sid);
// ...stream...
finally {
  await refreshSessions();
  tryAutoTitle(sid);  // 内部检查 pendingAutoTitle.has(sid)，true 则调 api.autoTitle
}
```

### 13.4 切换 session abort（state/useChatStore.ts:setActiveId）

```typescript
const setActiveId = useCallback((id: string | null) => {
  _setActiveId((prev) => {
    if (prev !== id && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setRunning(false);
    }
    return id;
  });
}, []);
```

---

## 14. 截屏 / 视觉参考

> 本文档没贴图。建议重设计前手动截屏当前态：
> 1. 空状态（`!activeId`）
> 2. 单 agent 提问中（`turns[0].status === 'pending'`）
> 3. 协作模式提问中（`turn.collab && turn.phases.length > 0`）
> 4. 已完成的协作答案 + Reviewer 评分卡
> 5. Sidebar 时间分组 + 置顶 + tag chips
> 6. Settings 11 个 tab 各一张
> 7. 折叠侧栏态
> 8. AuthGate modal
> 9. 创建用户 + 显示 plain key 的 modal
> 10. 删除 session 的撤销 toast

---

## 15. 重设计建议（任意采纳）

| 方向 | 影响 |
|---|---|
| **adopt assistant-ui** | 用 `@assistant-ui/react` 的 primitives 替换自家 Message/Composer，但 SSE 协议要包成 Custom Runtime 适配器 |
| **adopt shadcn** | 改 CSS variables 用 HSL 色彩空间，加暗色主题；Button/Input/Dialog 用 shadcn 的 |
| **router 化** | 把 `/c/:sessionId` 入路由（react-router），settings 走 `/settings/:tab`，分享链接成可能 |
| **响应式** | 加 mobile sidebar drawer，composer 浮动，桌面 grid → 手机 stack |
| **timeline 协作可视化** | 把当前平铺的 phase tags 改成 vertical Stepper，更直观看到 round 进展 |
| **markdown 增强** | 加 mermaid 图表渲染 / KaTeX 公式 / 表格排序点击 |
| **首次引导** | 全新用户 onboarding 一步步教用 collab 模式 / memory / export |

---

> 维护者：本文档由 Claude 在 2026-05-04 写成，对应 commit `d9a6080` 之后的代码库。
> 重新设计前请先 `git diff d9a6080..HEAD -- web/` 看是否有新增功能。
