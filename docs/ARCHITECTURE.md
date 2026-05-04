# 架构 — 系统全貌 + 关键决策记录

> 学生维护时回答"为什么这么设计"的依据。配合 `CLAUDE.md` (项目宪法) + `docs/FRONTEND-SPEC.md` (前端规格) 看。

---

## 1. 30 秒系统全貌

```
                       VPS
       ┌────────────────────────────────────────┐
浏览器  │   Caddy :443 (auto HTTPS, Let's Encrypt) │
 ──────▶│            │                            │
       │            ▼                            │
       │   nginx :80 (静态 React 单页 + /api 反代)│
       │            │                            │
       │            ▼                            │
       │   FastAPI :8000 (uvicorn)               │
       │     │                                   │
       │     ├─▶ SQLite (data/faro.db, WAL 模式)  │
       │     │                                   │
       │     ├─▶ LLM (主) — DeepSeek/MiniMax/...  │
       │     ├─▶ LLM (小) — Qwen-A3B (titles)     │
       │     ├─▶ Tushare API — A 股数据           │
       │     └─▶ Financial Datasets AI — 美股     │
       │                                         │
       └─────────────────────────────────────────┘
```

**4 个进程**：caddy / nginx (web 容器) / uvicorn (backend 容器) / sqlite (无独立进程，在 backend 容器里)。

**1 个数据库**：SQLite WAL，所有数据都在 `data/faro.db`（per-user 的 memory 文件在 `data/memory/{user_id}/`）。

**1 个静态前端**：Vite build 后的 React SPA，全部 ~700KB 一次性下载，之后纯前端路由 + SSE 流。

---

## 2. 数据流：一个完整的提问

用户在浏览器输入 "贵州茅台 PE_TTM" 然后 ⌘+Enter，到看到答案的全过程：

```
1. App.tsx Composer onSubmit ─────────▶ useChatStore.submit()
                                                │
2. ensureSession()                              │
   - 没 activeId → POST /api/sessions 创建 ──▶ OSS createSession
   - lastLoadedSession.current = sid (防 wipe race ⚠️ F1)
   - _setActiveId(sid)
                                                │
3. setTurns([..., {pending, sessionId: sid}])  │
                                                │
4. abortController = new AbortController()      │
                                                │
5. askStream(sid, query, onEvent, signal, mode) │
   ─ POST /api/sessions/{sid}/ask/collab/stream ────▶ FastAPI ask_collab_stream
                                                │     │
                                                │     ├─ 校验 user (auth dep)
                                                │     ├─ 校验 session 属当前 user (⚠️ B2)
                                                │     ├─ 拼 ToolRegistry (Tushare + US + cross_market + memory + skills)
                                                │     ├─ 拼 system prompt (含 user soul/rules)
                                                │     ├─ append user message 到 SQLite
                                                │     ├─ 创建 Researcher Agent
                                                │     ├─ 调 stream_collab(researcher, reviewer_provider, history, ...)
                                                │     │   │
                                                │     │   ├─ Round 1 Researcher.stream():
                                                │     │   │  ├─ yield phase_start (researcher, 1)
                                                │     │   │  ├─ yield turn_start, tool_call, tool_result (透传)
                                                │     │   │  ├─ Researcher 输出 final answer (内层) ── ⚠️ F5: 不透传 final
                                                │     │   │  └─ yield phase_done (researcher, 1)
                                                │     │   ├─ Round 1 Reviewer:
                                                │     │   │  ├─ yield phase_start (reviewer, 1)
                                                │     │   │  ├─ provider.chat(prompt: "评 draft")  ──▶ Small LLM call
                                                │     │   │  ├─ 解析 JSON {verdict, score, summary, issues, must_fix}
                                                │     │   │  ├─ yield review_verdict
                                                │     │   │  └─ yield phase_done
                                                │     │   ├─ 若 revise + 还有 round → Round 2 ...
                                                │     │   └─ yield final {answer, tool_calls, latency_total_ms, rounds, reviews}
                                                │     │
                                                │     ├─ finally:
                                                │     │   ├─ append assistant message to SQLite (含 meta)
                                                │     │   └─ log_audit (research_collab kind, user_id)
                                                │     │
                                                │     └─ yield done {}
                                                │
6. 每个 SSE 事件 → useChatStore.onEvent(turnId, ev)
   ├─ phase_start  → turns[i].phases.push(...)
   ├─ tool_call    → turns[i].liveTools.push(...)
   ├─ tool_result  → turns[i].liveTools[j].status = "done"
   ├─ review_verdict → turns[i].reviews.push(...)
   └─ final        → turns[i].status = "done", finalAnswer = ev.answer
                                                │
7. UI 实时渲染:
   - CollabStepper 看 turn.phases / turn.reviews / turn.liveTools
   - AssistantBody 看 turn.finalAnswer (markdown 渲染含 [N] 引用)
   - MetaBar 看 turn.finalToolCalls / latencyTotalMs
   - EvidenceRail (按需) 看 deriveEvidence(turn.finalToolCalls)
                                                │
8. submit finally:
   ├─ refreshSessions() — 拉一次 /api/pro/sessions (bumps updated_at)
   └─ tryAutoTitle(sid) — 调 /api/pro/sessions/{sid}/auto-title
                          │
                          ├─ 后端检查 pro_session_metadata.auto_titled (⚠️ B3 idempotent)
                          │  ├─ true → return {skipped: "already-titled"}
                          │  └─ false → 调小模型 generate title → store.rename_session
                          │
                          └─ 返回 {...session, plain title}
                          
9. setSessions 用新标题更新 sidebar
```

---

## 3. 进程边界 / 依赖关系

```
   web 容器 (nginx)            backend 容器 (uvicorn + python)
   ┌──────────────┐            ┌────────────────────────────────┐
   │ Static React │            │ faro_research_pro/             │
   │ SPA bundle   │            │   server.py (FastAPI app)      │
   │ /usr/share/  │ /api proxy │   ├─ make_app() — 挂 OSS 路由   │
   │  nginx/html/ ├───────────▶│   │   + Pro 端点                │
   │              │            │   │                            │
   │ nginx :80    │            │   ├─ 6 个 endpoint 类:         │
   └──────────────┘            │   │   sessions / settings /     │
                               │   │   collab stream / users /   │
                               │   │   export / health           │
                               │   └─ 路由组 + dependency        │
                               │                                 │
                               │ faro_research/ (OSS, pip 装)    │
                               │   ├─ Agent (loop)               │
                               │   ├─ ToolRegistry               │
                               │   ├─ providers (LLM 抽象)       │
                               │   └─ SessionStore (SQLite)      │
                               │                                 │
                               │ shared volume:                  │
                               │   /app/data → host ./data       │
                               └─────────────────────────────────┘
```

**关键约束**：
- web 容器是**纯静态**，所有 API 必须经 nginx 反代到 backend
- backend 容器是**单进程**，没有 worker pool（开发够用，生产 ~10 用户也够）
- 数据库在 host volume，容器重启数据不丢

---

## 4. ADR — 关键架构决策记录

> ADR (Architecture Decision Record) = 写下"为什么选 A 不选 B"，避免后人来回纠结。

### ADR-1: Pro 不 fork OSS，用 pip 依赖

**问题**：Pro 要扩 OSS 的功能，怎么集成？

**选项**：
- A. Fork `faro-research`，在 fork 上加 Pro 功能
- B. 把 OSS 依赖进来，import OSS 的 public API，新功能写在 Pro 包里

**决定**：B。

**原因**：
- OSS 升级时 Pro 自动跟，不用 manually rebase
- License 边界清晰：Pro 是 AGPL，OSS 是 MIT，两个独立仓
- Pro 暴露的 endpoint / 类 / 工具可以 import 给其他人用，OSS 保持纯净

**代价**：
- OSS 改公共 API 可能 break Pro（已观察到一次：`SessionStore.rename` 改名 `rename_session`）
- 不能改 OSS 内部细节（要走 PR 流程）

**体现**：`pyproject.toml` 里 `dependencies = ["faro-research[server,export] @ git+https://..."]`

---

### ADR-2: Pro 元数据用 side-table 而非改 OSS schema

**问题**：要给 session 加 pinned / tags / 软删除字段，但 OSS 的 `session` 表没这些字段。

**选项**：
- A. Fork OSS，加 column 进 OSS 的 session 表
- B. Pro 建一张新表 `pro_session_metadata`，session_id 当外键 join

**决定**：B（与 ADR-1 一致）。

**原因**：
- 不破 ADR-1（不 fork OSS）
- session 表的迁移由 OSS 控制，Pro 自己的表自己控制
- 新加字段（如 priority/color/notes）只动 Pro 表

**代价**：
- 每次列表查询都要 JOIN（实际是先 OSS list 再 batch get metadata，2 次 query）
- 数据一致性靠 Pro 自己维护：删 OSS session 时记得 purge metadata

**体现**：`storage/metadata.py:SessionMetadata` 表 + `server.py:list_sessions_pro` 的 JOIN 逻辑

---

### ADR-3: 用小模型做 auto-title / summary，配 fallback

**问题**：自动给会话起 6-12 字标题，主模型（MiniMax-M2.7 / DeepSeek-R1）是 reasoning model，给 8 字标题烧 5K tokens 30 秒，又贵又慢。

**选项**：
- A. 一律用主模型
- B. 配第二个 small/fast LLM（Qwen-A3B 这种），fallback 到主模型

**决定**：B。

**原因**：
- Qwen-A3B 这种 8B-30B 级的 chat model 1 秒就回 6-12 字干净标题
- 主模型用于研究 (worth tokens)；元任务 (titles, tag suggestions, summary) 用小模型
- fallback 设计避免 small LLM 没配时 silent fail

**代价**：
- 多一份 LLM provider 配置 (`FARO_PRO_SMALL_LLM_*` env)
- 前端 ⚙ → LLM 多一个 section

**体现**：`server.py:_make_small_provider()` + `auto_title_pro` 端点 `title_provider = small_provider or provider`

---

### ADR-4: 前端不用 Router，settings 走 modal

**问题**：要不要引 react-router 让 `/settings`、`/c/:sessionId` 成为可分享 URL？

**选项**：
- A. 引 router，每个 view 一个路径
- B. 用 state 切换：activeId 在 useChatStore，settings 是 modal

**决定**：B（当前阶段）。

**原因**：
- 单页 + modal 够用，规模没到要 deep link 的级别
- 节省一个依赖、一份心智负担
- AuthGate 是覆盖层，跟 modal 一类，不需要路由

**未来转换**：当用户提 "想发链接给同事看某个 session" 这种需求时，再引 router。改造路径：把 activeId 换成 `useParams().sessionId`，把 SettingsModal 换成 `<Route path="/settings/:tab">`。详见 ROADMAP.md。

---

### ADR-5: CSS 单文件 + variables，不用 Tailwind / CSS-in-JS

**问题**：怎么管前端样式？

**选项**：
- A. Tailwind utility class
- B. CSS Modules / styled-components / emotion
- C. 单文件 `styles.css` + CSS variables + BEM-ish class 名

**决定**：C。

**原因**：
- 设计 tokens（color / radius / shadow）在 `:root` 集中改，dark mode 用 `[data-theme="dark"]` 一键切
- 没引 Tailwind 的 build 复杂度（PostCSS / config / purge）
- BEM 风（`.session-item__title--active`）比 utility 长字符串可读
- claude.ai/design 的设计稿就是这个风格，迁移直接抄

**代价**：
- 单文件 ~2400 行（用 section 分隔注释，搜索靠 grep）
- 改某个类名要全局 grep 看哪里用了

**体现**：`web/src/styles.css` + `:root` / `[data-theme="dark"]` token 块

---

### ADR-6: 软删 + 撤销 toast 而非弹框

**问题**：删除会话怎么 confirm？

**选项**：
- A. `window.confirm("确定删除?")` — 浏览器原生
- B. 自定义 modal "你确定吗？" + 是/否按钮
- C. 直接软删，给 6-8 秒 toast 带"撤销"按钮

**决定**：C。

**原因**：
- 研究内容值钱，硬删恢复成本高
- confirm() 闪一下用户根本没看清就点了；自定义 modal 太重
- 软删 + 回收站是更稳的安全网，"撤销"toast 是 happy path 不打断
- 后端已支持软删 (`pro_session_metadata.deleted_at`) + restore endpoint

**代价**：
- 用户连点两次 → 第一次 toast 自动消失了 → "撤销" 没人点 → 30 天后 cron 才真删
- 需要一个回收站抽屉让用户能找到误删的

**体现**：`useChatStore.ts:deleteSession` + `server.py:soft_delete_pro` + sidebar trash drawer

---

### ADR-7: VPS HTTPS 用 Caddy 不用 nginx + certbot

**问题**：VPS 上反代 + HTTPS 选什么？

**选项**：
- A. nginx + certbot（手动 cron 续签）
- B. Caddy（内置 ACME，零配置）
- C. Traefik + cloud-native ingress

**决定**：B。

**原因**：
- 一份 Caddyfile 10 行搞定 reverse proxy + auto HTTPS + HSTS + 安全头
- ACME / Let's Encrypt 完全自动，证书过期自动续
- 学生维护门槛低，不需要懂 nginx config + certbot crontab + dhparam 这堆细节

**代价**：
- Caddy 比 nginx 性能略差（对我们 ~10 用户级别完全不重要）
- Caddyfile 语法没 nginx 流行（但更短）

**体现**：`Caddyfile` + `docker-compose.prod.yml`

---

### ADR-8: 用 sonner 做 toast 不用 react-hot-toast / 自家 modal

**问题**：删除/导出/操作反馈怎么 UI？

**选择**：sonner — 因为 (a) 支持 promise + action 按钮 (b) 性能好 (c) 可受 toast.promise 包装异步操作直接展示 loading→success/error 三态。

**体现**：`main.tsx` `<Toaster />` + 各处 `toast.promise()` / `toast.error()` / `toast.success()` 调用

---

## 5. 关键依赖

### 后端 (pyproject.toml)

| 依赖 | 用途 | 锁定原因 |
|---|---|---|
| `faro-research` | OSS 核心 | git+https 而非 PyPI（OSS 还没发 PyPI） |
| `fastapi` | HTTP framework | OSS 依赖 |
| `sqlmodel` | ORM | 跟 OSS 一致 |
| `xhtml2pdf` | PDF 渲染 | 唯一一个能在 docker 里稳定跑的纯 Python PDF lib |
| `reportlab` | xhtml2pdf 的底层 + CIDFont | 内置 STSong-Light 解决 CJK |
| `httpx` | LLM / FD.ai HTTP 客户端 | 异步 + sync 双支持 |

### 前端 (web/package.json)

| 依赖 | 用途 |
|---|---|
| `react` 18.3 | 不上 19 因为 react-markdown 9 和某些 dep 还没适配 |
| `react-markdown` 9 | + remark-gfm + rehype-highlight |
| `unist-util-visit` 5 | 给 [N] 引用做 remark 插件用 |
| `framer-motion` 11 | 仅做入场退场动画，没用其他高级特性 |
| `sonner` | toast |
| `highlight.js` | 代码块高亮 (rehype-highlight 的底层) |

**没用的**：tailwind / CSS-in-JS / state lib (Zustand/Redux) / router / UI kit

---

## 6. 关键文件 line count（理解规模感）

```
faro_research_pro/server.py             ~700 行
faro_research_pro/agents/orchestrator.py ~250 行
faro_research_pro/storage/metadata.py    ~200 行
faro_research_pro/storage/settings.py    ~140 行
faro_research_pro/exports/branded.py     ~250 行
faro_research_pro/tools/us_stocks.py     ~640 行
faro_research_pro/tools/cross_market.py  ~490 行

web/src/App.tsx                          ~180 行
web/src/state/useChatStore.ts            ~470 行
web/src/api.ts                           ~270 行
web/src/components/chat/Sidebar.tsx      ~330 行
web/src/components/chat/Message.tsx      ~230 行
web/src/components/settings/SettingsModal.tsx + 11 sections  ~1200 行 总
web/src/styles.css                       ~2400 行
```

**总规模**：~10K 行 Python + ~6K 行 TypeScript + ~2.4K CSS。学生一周读完核心 5 个文件能掌握 80%。

---

## 7. 可能让人困惑的设计

### 7.1 `submit()` 的 `succeeded` flag

```typescript
let succeeded = false;
try {
  await askStream(...);
  succeeded = true;
} catch (e) { ... }
finally {
  if (succeeded) tryAutoTitle(sid);
}
```

为什么要这个 flag？因为 catch 块里可能是 AbortError（用户切 session 中止流），这种情况**不应该**给被离开的 session 起标题（用户不在那里）。

### 7.2 `lastLoadedSession` ref vs activeId state

useEffect 监听 `activeId`，但同时维护一个 `lastLoadedSession` ref 记录"上一次真实加载过的"。两个不一样时才算"切换"，才清 turns。

这是为了对抗 React 的批处理：submit 时同一帧内 setActiveId + setTurns([pending])，useEffect 会跑（activeId 变了），但我们不想清 turns。所以 effect 里手动检查"我以前确实用过另一个 id 吗"。

### 7.3 `ensureSession` 和 `newSession` 的区别

- `newSession()`：用户主动点 "+ 新会话" 按钮，立刻 setActiveId 到新 id，进空状态
- `ensureSession()`：submit 时调，"如果没 active 就帮我创建一个并切过去"

两个都返回新 session，但 ensureSession 的副作用包了 `lastLoadedSession.current = sid` 来防 wipe race。

### 7.4 evidence 是 derive 出来的，不存

`EvidenceItem[]` 不存在 SQLite 也不在 SSE 事件里，是前端从 `tool_calls` 数组**派生**出来的（tool name + args + latency 拼成）。`deriveEvidence(toolCalls)` 函数。

未来如果 LLM 输出真的带 citation 编号 → tool_call 之间的关联，需要后端在 SSE 里加新事件 `cite_link` 或在 `final` 里加 `citations` 字段，前端再用真数据替换 derive。

---

## 8. 可观测性

目前**没有**正式的 metrics / tracing。诊断手段：

- `docker compose logs -f backend` — 看 uvicorn access log + Python exception
- `docker compose logs -f web` — 看 nginx access log
- `docker compose logs -f caddy` — 看 HTTPS 证书状态
- SQLite 直接 `sqlite3 data/faro.db` 查表
- DevTools Network → `ask/collab/stream` 看 SSE 原始流
- DevTools React Profiler 看 state 更新

**未来方向**：加 Prometheus / OpenTelemetry，但当前规模不需要。

---

## 9. 备份恢复

数据全在 host 的 `./data/`：
- `data/faro.db` (主 SQLite + WAL 文件 `-wal` `-shm`)
- `data/memory/{user_id}/` (per-user memory 文件)

备份策略 (`docs/DEPLOY-VPS.md` 第 6 节有 cron 模板)：每天 tar 整个 `data/` 目录到 `~/backups/faro-YYYYMMDD.tar.gz`，保留 14 天。

恢复：停服 → 替换 `data/` → 启服。zero work。

---

## 10. 参考

- OSS 仓：https://github.com/alonegg/faro-research（核心 Agent / 工具框架 / SessionStore）
- 部署：`docs/DEPLOY-VPS.md`
- 前端规格：`docs/FRONTEND-SPEC.md`
- 食谱：`docs/HOWTO.md`
- Bug 库：`docs/TROUBLESHOOTING.md`
