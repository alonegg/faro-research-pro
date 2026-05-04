# Roadmap — 已知 TODO + 建议下一步

> 学生交接时的"还没做完的事 + 可以做的方向"清单。每条带：估计工作量、入口文件、是否是用户明确说要做的。

---

## A. 半成品 (state 已有但 UI 没真生效)

### A1. 暗色主题
**状态**：CSS variables 在 `[data-theme="dark"]` 块完整定义，但 Settings → 外观 选 dark → `document.documentElement.dataset.theme = "dark"` **从来没被触发**。

**修法**：`web/src/components/settings/sections/Appearance.tsx` 已有 onChange handler，但只 PATCH 到 server，没本地 apply。在 `App.tsx` 加 effect 监听 settings 的 `ui.theme` 同步到 `<html data-theme>`。  
另外目前 sonner toast / framer-motion 元素 / highlight.js 主题在 dark mode 下颜色没调好。

**工作量**：1-2 小时（CSS 已经写了 80%，主要是把开关接上 + 调几处不协调的颜色）  
**文件**：`App.tsx` + `Appearance.tsx` + 少量 `styles.css` 调整  
**用户提过**：是

---

### A2. Sidebar 宽度可调
**状态**：`pro_settings.ui.sidebar_width` 默认 260，前端有 number input（在 ⚙ → 外观），但**没真应用到 grid**。

**修法**：在 `App.tsx` 加 effect 把 `ui.sidebar_width` 同步到 `:root` 的 `--sidebar-w` CSS variable。

```typescript
useEffect(() => {
  const w = settings["ui.sidebar_width"] || 260;
  document.documentElement.style.setProperty("--sidebar-w", `${w}px`);
}, [settings["ui.sidebar_width"]]);
```

**工作量**：15 min  
**文件**：`App.tsx` 一处 effect  
**用户提过**：是

---

### A3. 一键导出全部数据为 .zip
**状态**：⚙ → 审计 / 隐私 → "开始导出" 按钮存在，但 onClick 是 `toast.message("尚未实现")` 占位。

**修法**：
- 后端加 endpoint `GET /api/pro/export/all` 用 `zipfile` 把当前用户的 sessions (markdown) + memory 文件 + audit log 打包返回
- 前端复用现有 `api.download` 下载逻辑

**工作量**：2-3 小时  
**文件**：`server.py` 加 endpoint + `api.ts` 加方法 + `Audit.tsx` 替换 onClick  
**用户提过**：未明说，但 "审计/隐私" tab 设计时提到过

---

### A4. 英文 i18n
**状态**：`pro_settings.ui.language` 默认 zh-CN，⚙ → 外观 显示 "中文 / English (规划中)"，"English" 按钮 disabled。

**修法**：
- 抽 i18n keys 到 `src/i18n/zh.ts` + `en.ts`，所有 UI 字符串走 `t("key")` 调用
- 用 `react-intl` 或简单的 `useI18n()` hook

**工作量**：6-8 小时（界面字符串很多）  
**文件**：所有渲染中文的组件都要改  
**用户提过**：未明说，留作扩展

---

### A5. Memory 列表 + 单条删除
**状态**：⚙ → Memory & Skills 显示 memory 数量但不能查看具体条目。

**修法**：后端加 `GET /api/pro/memory` 返回该用户全部 memory 条目（含 fact / context / created_at），前端加列表 + per-item delete 按钮。

**工作量**：2 小时  
**文件**：`server.py` 加 endpoint + `Memory.tsx` 加 list  
**用户提过**：未明说

---

### A6. 登录历史
**状态**：⚙ → 认证 → 提到 "登录历史" 但未实现。

**修法**：从 audit log 过滤 kind=login 的最近 N 条；OSS 没有 login audit kind，需要在 auth dep 里加 `store.log_audit("login", ...)`。

**工作量**：1.5 小时  
**文件**：`server.py:_current_user_dep` + `Auth.tsx`  
**用户提过**：未明说

---

## B. 用户明确说"下一版做"的功能

### B1. 可分享的只读会话链接
> 用户原话："共享我们下个版本仔细做"

**目标**：admin 给某个 session 生成一个无需登录就能访问的只读链接，分享给同事。

**设计草稿**：
- 后端加表 `pro_session_shares (id, session_id, public_token, created_at, expires_at, view_count)`
- POST `/api/pro/sessions/{id}/share` → 返回 `{public_url: "https://faro.../s/<token>"}`
- GET `/s/<token>` → 单独的只读路由（不走 AuthGate），渲染 session 内容（无 sidebar / composer）
- DELETE `/api/pro/shares/{token}` → 撤销
- ⚙ → 隐私 加 "我的分享链接列表 + 撤销按钮"

**工作量**：1 天（含安全考虑：token 用 secrets.token_urlsafe，限速防爬）  
**用户提过**：是

---

### B2. 移动端响应式
**状态**：当前 hard-coded grid `260px 1fr`，<768px 完全不可用（侧栏挤死内容）。

**设计**：
- 加 `@media (max-width: 768px)` breakpoint
- 侧栏改成 drawer 风格（默认隐藏，hamburger 按钮打开覆盖层）
- 顶部 collab toggle / provider pill 折叠到一个 menu icon
- composer 浮动在底部，键盘弹起时浮起避开

**工作量**：1-2 天  
**文件**：`styles.css` 大量 media queries + `App.tsx` mobile drawer state  
**用户提过**：未明说但 FRONTEND-SPEC §11 已记录

---

### B3. 全文检索（搜会话内容，不只标题）
**当前**：sidebar 搜索框只 filter `session.title.includes(query)`。

**设计**：
- 后端加 endpoint `GET /api/pro/search?q=...` 用 SQLite FTS5 索引 messages.content
- 索引建好（migration）
- 前端 ⌘K 触发的搜索从客户端 filter 升级成调 API
- 返回结果带高亮预览片段

**工作量**：4-6 小时（SQLite FTS5 学习曲线 + 中文分词 jieba 适配）  
**文件**：`storage/` 新建 `search.py` + `server.py` 加 endpoint + `Sidebar.tsx` 升级  
**用户提过**：未明说，FRONTEND-SPEC §11 列了

---

## C. 技术债 / 已知坑

### C1. Backend 单 worker
**当前**：uvicorn 默认 1 worker；并发提问 = 串行（前一个流没完后一个等）。

**修法**：`docker-compose.yml` 改启动命令 `uvicorn faro_research_pro.server:app --workers 4`。

**注意**：worker > 1 的话 SQLite 写竞争更严重，B1 不变量更关键；如果出 lock 错误，考虑迁 PostgreSQL（OSS 没支持需要 PR）。

**工作量**：5 min 改命令；如果迁 PG 是 1 周。  
**用户提过**：否

---

### C2. CollabStepper 工具归属
**当前**：所有 `liveTools` 都简单归到 Researcher 阶段，不区分是哪一轮哪个阶段调的。

**根因**：SSE 协议的 `tool_call` 事件没带 `phase` / `round` 字段。

**修法**：
- 后端 yield tool_call 时加 phase + round
- 前端 `CollabStepper.tsx:buildTimeline` 按 (phase, round) 分组工具

**工作量**：2 小时  
**用户提过**：否（但 CollabStepper.tsx 注释里我标了简化）

---

### C3. PDF 渲染 cross-platform 字体差异
**当前**：用 STSong-Light（reportlab 内置 CIDFont）。在 mac / linux container 里都能渲染，**但字体很硬**（楷体感弱）。

**修法**：
- 装一个真正的中文字体（思源宋体 SourceHanSerifCN / 站酷文艺体）
- Dockerfile 加 `apt install fonts-noto-cjk` + reportlab 用 `TTFont("NotoSerifCJK", ...)`

**工作量**：1 小时（含 Docker layer 大小测试）  
**美观提升**：明显  
**用户提过**：否

---

### C4. 没有 e2e 测试
**当前**：CI 只跑 ruff lint + python smoke (build_pdf + parse JSON) + docker build。没有 frontend 测试，没有 backend integration test。

**修法**：
- backend：加 pytest，针对 SSE endpoint 用 `httpx.AsyncClient` 跑流；mock LLM provider
- frontend：加 Playwright，测 4 个核心 flow（提问、切 session、设置、删除）

**工作量**：1-2 周（写 + CI 集成 + 修发现的 bug）  
**优先级**：低（手测 + 真实使用反馈循环已经够，写测试维护成本高）

---

### C5. 没有 rate limiting
**当前**：API 没限速。Caddy 注释里有 `rate_limit` 模板但没启用。

**修法**：Caddyfile 启用 rate_limit，针对 `/api/sessions/.../ask/*` 限制每 IP 30/min。

**工作量**：30 min（取消注释 + 重启 caddy）  
**用户提过**：否，但 VPS 部署后建议开

---

### C6. SSE 流没有断点续传
**当前**：浏览器刷新中途、网络抖动 → SSE 连接断，前端的 turn 永远 stuck 在 pending。

**修法**：
- backend 把 inflight stream 状态写到 SQLite + 给每个 turn 一个 `turn_id`
- 前端断了 reconnect 时 `GET /api/turns/{turn_id}/replay` 拿剩余事件

**工作量**：1-2 天  
**优先级**：低（用户重新提问就好了，研究工作流不像聊天工作流那么连续）

---

## D. 锦上添花

### D1. 主题预设
当前主色配置在 ⚙ → 品牌 / PDF。可以加 5-6 个预设（"经典紫" / "深夜蓝" / "森林绿" / "克莱因蓝"），点选自动改 `--accent`。

**工作量**：1 小时

---

### D2. 会话导入
让用户能从 OSS 切过来 / 从 ChatGPT export / Claude export 导入历史会话。

**工作量**：4-8 小时（看格式有多怪）

---

### D3. 工具调用可视化升级
现在工具是简单的 `<details>` 折叠列表。可以做：
- 工具调用图（节点是工具名，边是调用关系）
- timing waterfall（gantt 图：哪个工具花多少时间）
- 每个工具的"输入 → 输出"详细 modal

**工作量**：1 天

---

### D4. 会话归档（不是删除，归到一个独立列表）
回收站是删除前的过渡，归档是"用完了不想看到"。两个不同语义。

**实现**：`pro_session_metadata` 加 `archived: bool` + 一个新的"已归档"sidebar group。

**工作量**：1.5 小时

---

### D5. 个人 Memory 搜索
当 memory 多了，找不到 "我之前说过的偏好" 怎么办。在 ⚙ → Memory 加搜索框 + 排序（按时间 / 按提到次数）。

**工作量**：2 小时

---

### D6. Tushare 配额监控
Tushare 5200 积分免费版有限速。可以加一个 cron 拉当前积分余额 + 当月调用次数，显示在 ⚙ → 数据源。

**工作量**：3 小时（含 Tushare 配额 API 集成）

---

## E. 优先级建议

如果学生时间有限，按这个顺序做：

1. **A1 暗色主题**（低工作量、用户明确想要、立刻有效果）
2. **A2 sidebar 宽度** + **A3 一键导出**（半天就完三个 quick win）
3. **B1 分享链接**（用户最想要的下一版功能）
4. **C1 多 worker**（生产部署后并发会成为瓶颈）
5. **B3 全文检索**（会话超过 50 个后必须）
6. **B2 移动端**（看用户群是否有手机使用需求）

---

## F. 不该做的事

- ❌ 引 Tailwind / 重写 styles.css —— 设计 token 系统已经能 cover 99% 需求
- ❌ 把 SQLite 替换 PostgreSQL —— 单节点 ~10 用户场景 SQLite 完全够，迁移工作量 > 收益
- ❌ Fork OSS —— 见 ADR-1 的代价分析
- ❌ 完整重写前端框架 (Vue / Svelte / SolidJS) —— 当前 React 已经是社区最广，问题最容易解
- ❌ 加 LangChain / LlamaIndex 等高层框架 —— OSS 的 ToolRegistry 已经够，加重依赖反而难维护

---

## G. 维护时怎么决定做 vs 不做

| 问题 | 该做 | 不该做 |
|---|---|---|
| 用户主动要求 | ✅ 做 | — |
| 用户没要求但提升用户体验 | 估工 < 2h 且无破坏风险 → 做 | 估工 > 1d 或动核心 → 先问 |
| 让代码"更整洁" | — | ❌ 不主动 refactor，除非顺路 |
| 加新依赖 | 解决具体痛点 | ❌ 因为"流行" / "看着酷" |
| 引大型框架 | 实际能省 1000+ 行 | ❌ 用 100 行就够的事 |

记住：**这是一个交给学生维护的研究工具，不是 SaaS**。复杂度的负担最终落在维护者身上，每个新功能都是技术债的种子。
