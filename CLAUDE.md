# CLAUDE.md

> Claude Code 自动加载这个文件作为本仓"项目宪法"。
> 学生维护时，所有的 Claude Code 会话都会带这份上下文。

## 项目一句话

**`faro-research-pro` = 在 OSS `faro-research` (MIT) 之上加 (a) 多 agent 协作 (b) 品牌化 PDF 导出 (c) 多用户管理 (d) 配置后台 + Pro session 元数据 (pin/tags/软删) + 跨市场对标 (NVDA → A 股) 的 AGPL 应用。**

## 立刻该读什么

按重要性排序：

1. **`docs/ONBOARDING.md`** — 第一周路线图（先跑起来 → 通读 5 个核心文件 → 改一个小东西）
2. **`docs/ARCHITECTURE.md`** — 系统全貌 + 关键架构决策记录 (ADR)
3. **`docs/HOWTO.md`** — 常见维护任务的 cookbook（加工具 / 加 settings 字段 / ...）
4. **`docs/TROUBLESHOOTING.md`** — 我们踩过的 10 个真实 bug + 排查路径
5. **`docs/FRONTEND-SPEC.md`** — 前端完整功能规格 (state model / API 契约 / 不变量)
6. **`docs/DEPLOY-VPS.md`** — 部署到 VPS 的 15 分钟清单
7. **`docs/ROADMAP.md`** — 已知的待办 + 半成品 + 下一步建议方向

如果学生只读一份，读 ONBOARDING.md。

---

## ⚠️ 10 个不变量 (重设计可改样子，行为不能破坏)

### 前端 (5 个，详见 FRONTEND-SPEC §3.4)

| ID | 不变量 | 文件 |
|---|---|---|
| F1 | useChatStore 的 `lastLoadedSession` ref：只在**真正切换** session 时清 turns，**不**在初次 set activeId 时清 | `web/src/state/useChatStore.ts` |
| F2 | 每个 UITurn 带 `sessionId` —— 切换会话后旧流的事件不应染到新会话 | `web/src/state/types.ts` + `useChatStore.ts:onEvent` |
| F3 | 切换 session 时 `abortRef.current?.abort()` —— 否则旧流跑完前新会话的输入框被锁 | `useChatStore.ts:setActiveId` wrapper |
| F4 | auto-title 触发：每次成功的 turn 都调 `api.autoTitle(sid)`；后端有 idempotent guard 不会重复打 LLM | `useChatStore.ts:tryAutoTitle` + `server.py:auto_title_pro` |
| F5 | Researcher inner-loop 的 `final` 事件**不应**透传给前端 —— 前端会把它当 turn 完结，提前结束并隐藏 Reviewer phase | `faro_research_pro/agents/orchestrator.py` |

### 后端 (5 个)

| ID | 不变量 | 文件 |
|---|---|---|
| B1 | **SQLite WAL + busy_timeout=5000** 在每个新连接上设 —— 否则 OSS SessionStore 和 Pro 的两个 engine 同时写会死锁 | `faro_research_pro/server.py:_enable_sqlite_wal` |
| B2 | **每用户数据物理隔离**：sessions 用 `user_id=user.id` 过滤、memory 在 `data/memory/{user_id}/` 独立目录、audit log 带 user_id | 全局 (`server.py` 多处) |
| B3 | **per-session 自动标题幂等**：服务端检查 `pro_session_metadata.auto_titled` flag，true 就返 `{skipped: "already-titled"}`，不打 LLM | `server.py:auto_title_pro` |
| B4 | **小模型用于标题**：MiniMax-M2.7 这种 reasoning 模型给 8 字标题烧 5K tokens；用 `FARO_PRO_SMALL_LLM_*` 配 Qwen 这类小模型；fallback 到主模型 | `server.py:_make_small_provider` |
| B5 | **admin guard 必须服务端 enforce**：前端隐藏 admin tab 不够，所有 admin endpoint 都要走 `_admin_required` dep | `server.py:list_users_admin` 等 4 个 endpoint |

破坏其中任何一条都会让我们已经修过的 bug 复活。

---

## 文件地图

```
faro_research_pro/                          # Python 包 (Pro 后端)
  server.py                                 # FastAPI 主入口 (~700 行)
                                            #   挂载 OSS make_app + 加 Pro endpoints
                                            #   含 Pro session 管理 / settings / users / 工具注册
  agents/
    orchestrator.py                         # Researcher ↔ Reviewer 多 agent 循环 (⚠️ F5)
    researcher.py                           # Researcher system prompt
    reviewer.py                             # Reviewer system prompt + JSON 评分契约
  tools/                                    # Pro-only LLM 工具 (OSS 工具自动加载)
    us_stocks.py                            # FD.ai 美股 4 个 tools
    cross_market.py                         # NVDA → A 股对标查询
  storage/
    metadata.py                             # pro_session_metadata 表 (pin/tags/软删/auto_titled)
    settings.py                             # pro_settings 表 (key/value JSON)
  exports/
    branded.py                              # 品牌 PDF (封面 + 页眉/页脚 + STSong-Light CJK)
  cli.py                                    # `faro-pro` 终端入口
  __init__.py                               # __version__
  
web/                                        # React + TypeScript + Vite (Pro 前端)
  src/
    App.tsx                                 # 顶层 shell ~180 行
    main.tsx                                # ReactDOM root + Toaster
    api.ts                                  # HTTP 客户端 + askStream SSE 解析
    markdown.tsx                            # react-markdown + [N] 引用插件
    styles.css                              # 单文件 ~2400 行设计 tokens + 所有组件样式
    state/
      useChatStore.ts                       # 全部 state + actions (sessions/turns/auth/evidence/...)
      useSettings.ts                        # Settings 页面专用 hook
      types.ts
    components/
      ui/  Button / Spinner / Kbd / AuthGate / Icon (24 个 SVG)
      chat/  Sidebar / TopBar / Composer / EmptyState / Message
            PhaseTag / ReviewCard / ToolsTrace / ExportMenu
            CollabStepper (vertical timeline)        ← 设计稿核心创新
            EvidenceRail (right slide-in panel)      ← 设计稿核心创新
      settings/  SettingsModal + 11 sections (LLM/Data/Agent/...)
    lib/
      cn.ts                                 # classnames helper
      groupSessions.ts                      # 时间分组 (今天/昨天/本周/...)

docs/                                       # 必读
  ONBOARDING.md                             # 学生第一周路线图
  ARCHITECTURE.md                           # 系统全貌 + ADR
  HOWTO.md                                  # 常见任务 cookbook
  TROUBLESHOOTING.md                        # 已知 bug + 排查
  FRONTEND-SPEC.md                          # 前端完整规格
  DEPLOY-VPS.md                             # VPS 部署清单
  ROADMAP.md                                # backlog + 下一步

docker/                                     # Dockerfile + nginx 配置
docker-compose.yml                          # 本地开发
docker-compose.prod.yml                     # VPS 生产 overlay (Caddy + HTTPS)
Caddyfile                                   # 反代 + auto HTTPS
.env / .env.production.example              # 环境变量
```

---

## 常用命令

```bash
# 启 / 停 / 重建
cd /Users/alone/Desktop/openai/faro-research-pro
docker compose up -d --build              # 全部重建
docker compose up -d --build backend      # 只重建后端
docker compose up -d --build web          # 只重建前端
docker compose down                       # 停服 (数据保留)
docker compose logs -f backend            # 实时日志

# 改 .env 后必须 force recreate (restart 不重读 env)
docker compose up -d --force-recreate backend

# 容器内 python (含全部依赖 + env)
docker compose exec -T backend python -c "..."

# 健康
curl http://localhost:5174/api/health
curl http://localhost:5174/api/pro/health

# Smoke 一个完整提问 (单 agent 模式)
SID=$(curl -s -X POST http://localhost:5174/api/sessions -H 'content-type: application/json' -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -sN -X POST "http://localhost:5174/api/sessions/$SID/ask/stream" -H 'content-type: application/json' -d '{"query":"贵州茅台 PE_TTM"}' --max-time 60 | head -30
curl -s -X DELETE "http://localhost:5174/api/pro/sessions/$SID/purge" > /dev/null
```

---

## 修改本仓时该 / 不该做的事

### ✅ 该做

- **改 backend Python 后**：`docker compose up -d --build backend` (重建)，不是 restart
- **改 frontend TS 后**：`docker compose build web && docker compose up -d web` (单独重建 web 比较快)
- **加新 LLM 工具**：放在 `faro_research_pro/tools/` 下，参考 `us_stocks.py` 的 ToolSpec 模式
- **加新 settings 字段**：先在 `storage/settings.py:DEFAULTS` 注册 default 值；再去对应 settings section 加输入控件；前端 `useSettings.update(key, value)` 自动持久化
- **加新 endpoint**：写在 `server.py:make_app()` 里（注意作用域闭包能访问 `provider` / `store` / `meta` 等），用 `Depends(_current_user_dep)` 鉴权，admin-only 用 `_admin_required`
- **改前端样式**：单文件 `web/src/styles.css`，设计 tokens 在 `:root` 和 `[data-theme="dark"]`，类名都是 BEM-ish (`.session-item__title`)
- **commit message** 写清"为什么"而不是"什么"，参考 git log 历史

### ❌ 不该做

- ❌ 用 `docker compose restart backend` 期望 .env 改动生效 —— restart 不重读 env，必须 `--force-recreate`
- ❌ 用 `cd backend && python xxx` 跑代码 —— 没有 venv，依赖在容器里
- ❌ 在 useChatStore 里加可能抹掉 turns 的 useEffect —— 看 F1 不变量
- ❌ 给 reasoning 模型 (MiniMax-M2.7 / DeepSeek-R1) 设 `max_tokens<512` 期望短回答 —— 它会在 reasoning 阶段就被砍断
- ❌ 加新的 admin endpoint 时只在前端隐藏 UI —— 必须 `Depends(_admin_required)` 服务端 enforce
- ❌ 在 SQLite engine 创建后忘了挂 `_set_pragma` listener —— B1 不变量
- ❌ Fork 或修改 `faro_research` (OSS) —— Pro 通过 git+pip 依赖 OSS，OSS 升级时 Pro 自动跟；要改的话给 OSS 提 PR

---

## LLM 编程的常见陷阱 (在本仓特别容易踩)

| 陷阱 | 长什么样 | 怎么躲 |
|---|---|---|
| **Reasoning model prompt 泄漏** | 标题/总结返回 "The user wants:" 这种 prompt 自身的话 | `max_tokens >= 1024`，让它思考完；对小模型用 Qwen-A3B 这种非 reasoning |
| **SSE 内层事件透传** | UI 走到一半就卡死 | `final` 等关键事件只能由最外层 yield；inner-loop 的 `final` 必须 swallow (F5) |
| **SQLite 多 engine 写锁** | "database is locked" 间歇出现 | 每个新连接都挂 `PRAGMA busy_timeout=5000` (B1) |
| **prompt 里的换行进入 SSE data:** | 前端解析失败、没输出 | `json.dumps(ev, ensure_ascii=False)` 自动转义；不要手拼字符串 |
| **autoTitle 不触发** | 标题永远是 "新会话" | 不要靠 `isNew` 门槛，每次成功 turn 都调，让后端 idempotent guard 决定 |
| **小模型 base_url 漏 `/v1`** | 静默 404 / JSON 解析失败 | OSS provider 拼 `{base_url}/chat/completions`，base_url 要带 `/v1` |
| **docker compose .env 改了不生效** | 行为还是旧的 | `--force-recreate` 不是 restart |

每个都对应一个真实修过的 commit，详见 TROUBLESHOOTING.md。

---

## 跟用户协作的语气习惯

- **简洁**：不重复用户说的话，不写"我将……"开场白
- **不用 emoji**（除非用户明确要求或上下文确实需要 — 如 sidebar 的 📌 / 🗑）
- **代码改动只做被要求的部分**，不顺手 refactor 周边代码
- **不确定先问**：复杂任务先一句话方案 + 等用户确认再动手
- **commit message** 写"为什么"，例如：
  - ✅ "fix(orchestrator): swallow Researcher inner-loop 'final' event so frontend doesn't prematurely mark turn done"
  - ❌ "update orchestrator.py"
- 改完代码必须本机跑通验证，不能"build 通过 = 完成"

---

## 当前架构上的关键决策

| 决策 | 为什么 | 体现在哪 |
|---|---|---|
| Pro 不 fork OSS，pip 依赖 | OSS 升级时 Pro 自动跟；License 边界清晰 (MIT/AGPL) | `pyproject.toml` |
| Pro session 元数据用 side-table 而非改 OSS schema | 不 fork OSS 的代价 | `storage/metadata.py:pro_session_metadata` |
| 用小模型做 auto-title | reasoning 模型对 8 字标题不划算 (5K tokens / 30s) | `server.py:_make_small_provider` |
| 单页应用、无 router | 设置是 modal、会话切换是 state；规模够了 | `App.tsx` (没有 react-router) |
| CSS 单文件 + variables | 没用 Tailwind / CSS-in-JS；设计 tokens 集中 | `styles.css :root` |
| 软删 + 撤销 toast 而非弹框 | 研究内容值钱，不能用 confirm() 闪一下就没 | `useChatStore.ts:deleteSession` + sonner |
| Caddy 而非 nginx 做 VPS HTTPS | 自动 Let's Encrypt，零配置 | `docker-compose.prod.yml` |

完整 ADR 见 `docs/ARCHITECTURE.md`。

---

## 沟通时引用本文档的方式

学生跟你说："我想加一个新的工具"  
→ 你说："看 `docs/HOWTO.md` 第 X 节，然后照着 `faro_research_pro/tools/us_stocks.py` 的模板写。"

学生跟你说："切了 session 后输入框卡住了"  
→ 你说："这是 F3 不变量被破坏了，看 `useChatStore.ts:setActiveId` 是不是没 abort。"

学生跟你说："新会话不自动起标题"  
→ 你说："看 `docs/TROUBLESHOOTING.md` 第 5 条，大概率是 F4 + B3 的某一个。"

不要让 Claude 自己重新发明轮子去解释 —— 引用 docs 里既有的内容。
