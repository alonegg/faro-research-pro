# 学生 Onboarding — 第一周路线图

> 跟着这份清单走，第 1 天能跑起来，第 1 周能自己改东西。卡住先看 `docs/TROUBLESHOOTING.md`。

---

## 第 1 天 (~3 小时)：跑起来

### 1.1 装 Docker (~10 min)
- macOS / Windows：装 Docker Desktop
- Linux：`curl -fsSL https://get.docker.com | sh`
- 验：`docker --version && docker compose version` 都有输出

### 1.2 拿代码 + 配 .env (~10 min)
```bash
git clone <repo-url> faro-research-pro
cd faro-research-pro
cp .env.production.example .env
nano .env
```

**至少要填**：
- `FARO_OPENAI_API_KEY` — 主 LLM (DeepSeek / MiniMax / Qwen 任意 OpenAI 兼容的) 
- `FARO_OPENAI_BASE_URL` + `FARO_OPENAI_MODEL`
- `TUSHARE_TOKEN` — A 股数据 (从 tushare.pro 注册免费拿 5200 积分)
- `FARO_DOMAIN` 本地填 `localhost:5174` 即可
- `FARO_AUTH_REQUIRED=0` (本地开发不要鉴权)

可以暂时不填的：
- `FARO_PRO_SMALL_LLM_*`（标题会回退到主模型）
- `FINANCIAL_DATASETS_API_KEY`（美股工具就用不了，A 股能用）

### 1.3 启动 (~10 min 第一次 build)
```bash
docker compose up -d --build
docker compose logs -f backend  # 等到 "Application startup complete"
```

打开 http://localhost:5174 应该看到紫色渐变 F 图标 + "想研究点 _什么_ ?"

### 1.4 验功能 (~30 min)

按这个顺序点一遍：
- [ ] 点空状态的 "财报解读" suggestion → 应该开始流式回答
- [ ] 等回答完成 → 看 sidebar 标题是不是 6-12 字（自动起的）
- [ ] 顶部右上角点 ⚙ → 进设置 → 数据源 → 点"拉一次 stock_basic" → 应该绿 toast "通了"
- [ ] 设置 → LLM 模型 → 点"发个 ping" → 主模型应该返回
- [ ] 设置 → 用户管理 → 点 "+ 创建新用户" → 弹出模态 → 创建 alice/user → 看到一次性 key
- [ ] sidebar 双击会话标题 → 改名 → Enter 保存
- [ ] sidebar 点会话的 📌 → 移到 "置顶" 区
- [ ] 删除一个会话 → 8 秒内点"撤销" → 应该回来
- [ ] sidebar 顶部搜索框输几个字 → 应该过滤
- [ ] `⌘+\` 折叠侧栏，再按一次展开
- [ ] 顶部协作 toggle 开 → 提个新问题 → 看 CollabStepper 出现 (Researcher → Reviewer 阶段)

跑完=今天的目标完成。

### 1.5 看一眼 docs/

把 docs/ 下所有文件都开一遍（不用细看），知道每份大概讲什么。

---

## 第 2-3 天：通读 5 个核心文件

按这个顺序读，每个文件**写一句话总结**记在你自己的笔记里：

### 后端 (Python)

1. **`faro_research_pro/server.py`** (~700 行)  
   主 FastAPI app，挂 OSS 路由 + 加 Pro endpoints。读完应该能回答："/api/sessions/{id}/ask/collab/stream 这条 endpoint 收到请求后做了什么？"
   
2. **`faro_research_pro/agents/orchestrator.py`** (~250 行)  
   Researcher ↔ Reviewer 多 agent 循环。读完应该能回答："Reviewer 给出 'revise' 后 Researcher 怎么知道要改哪里？"

3. **`faro_research_pro/storage/metadata.py`** (~200 行)  
   Pro 侧 SQLite 表。读完应该能回答："为什么不直接改 OSS 的 session 表？"（提示：MIT vs AGPL）

### 前端 (TypeScript)

4. **`web/src/state/useChatStore.ts`** (~470 行)  
   全部 state + actions。**关键文件**。读完应该能回答："切换 session 时为什么不能直接 `setTurns([])`？" (这是 F1 不变量)

5. **`web/src/api.ts`** (~250 行)  
   HTTP 客户端 + SSE 解析。读完应该能回答："SSE 流是怎么解出 `event: phase_start` 这种事件的？"

读完 5 个文件后，跟 `docs/FRONTEND-SPEC.md` 比对：你的理解跟文档一致吗？

---

## 第 4-5 天：改一个小东西

挑一个**真实的**小改动，端到端做完（改代码 → build → 验证 → commit）。

### 推荐入门任务（按难度）

#### 任务 A — 加一个新的预设 suggestion (15 min)
在空状态加一个新的建议按钮，比如 "查看我的 watchlist 涨跌"。

文件：`web/src/App.tsx` 顶部 `SUGGESTIONS` 数组。  
照着已有的格式加一行 `{ label: "...", text: "..." }` 即可。  
build + 重启 + 验证按钮出现 + 点击会发送提问。

#### 任务 B — 改协作模式默认值 (30 min)
现在协作模式默认开关存在 localStorage `faro_pro_collab`。改成：**新用户默认开协作**（用 `pro_settings.agent.default_collab` 控制）。

涉及文件：
- `faro_research_pro/storage/settings.py` — `DEFAULTS["agent.default_collab"]` 改成 `True`
- `web/src/state/useChatStore.ts` — `useState<boolean>(() => ...)` 初值改为读 settings 而非 localStorage
- 写一个 useEffect 在 settings 加载完后同步本地状态

测：清掉 localStorage（DevTools → Application → Local Storage → 全删）→ 刷新 → 协作 switch 应该是开的。

#### 任务 C — 加一个新的 LLM 工具 (1-2 小时)
看 `docs/HOWTO.md` 第 1 节，给 agent 加一个新工具。例如 "get_index_constituents"（拉某个指数的成分股，从 Tushare 的 `index_weight` 接口）。

涉及文件：
- 新建 `faro_research_pro/tools/indexes.py`
- `server.py` 注册 `reg.register_many(INDEX_TOOLS)`

测：开协作模式问 "沪深300 当前权重最大的 5 只" → 看 CollabStepper 里 Researcher 应该调你的新工具。

---

## 第一周结束 = 你应该能回答这些问题

| 问题 | 该看哪 |
|---|---|
| 提问按下"发送"后，从前端到拿到答案的完整数据流是什么？ | `useChatStore.ts:submit` → `api.ts:askStream` → `server.py:ask_collab_stream` → `agents/orchestrator.py:stream_collab` |
| 为什么需要 Pro 侧的 SQLite 表 (`pro_session_metadata`)？为什么不改 OSS 的？ | `docs/ARCHITECTURE.md` ADR-2 |
| 协作模式下，Reviewer 给出 "revise" verdict 后，Researcher 怎么知道改什么？ | `agents/reviewer.py:revision_prompt_for_researcher` |
| 为什么 `docker compose restart` 改了 .env 不生效？ | restart 不重读 env，需要 `--force-recreate`。`CLAUDE.md` 有详解 |
| 一个 LLM 标题为什么有时返回 "The user wants:" 这种东西？怎么修？ | reasoning 模型 budget 不足 → 加 max_tokens；最佳是用小模型 |

如果以上 5 个都能流利回答 → 你已经能维护这个仓了。

---

## 常用资源

- 项目宪法：`CLAUDE.md` (Claude Code 自动加载)
- 系统全貌：`docs/ARCHITECTURE.md`
- 食谱：`docs/HOWTO.md`
- 排坑：`docs/TROUBLESHOOTING.md`
- 前端规格：`docs/FRONTEND-SPEC.md`
- 部署：`docs/DEPLOY-VPS.md`
- 待办：`docs/ROADMAP.md`

OSS 侧 (`faro-research`)：https://github.com/alonegg/faro-research  
本仓：https://github.com/alonegg/faro-research-pro

---

## 卡住了找谁

- 优先：`docs/TROUBLESHOOTING.md` 列了 10 个真实 bug 跟排查路径
- 次之：直接问 Claude Code，会自动加载 `CLAUDE.md` 上下文
- 再次之：原作者（看 commit history 的 author）

不要在没读 `CLAUDE.md` 和 `docs/TROUBLESHOOTING.md` 之前就直接问人。这两份文档已经覆盖了 90% 的常见问题。
