# 故障排查 — 真实踩过的 10 个坑

> 每条都是这个仓里**真实修过**的 bug。学生再撞上同样的症状时一查就知道根因。

---

## 1. UI 卡在"等待中"，没有任何 SSE 事件渲染

**症状**：点击预设题或发送提问后，textarea 显示"等待中..."占位符，但 thread 区域空白。

**最常见的两个根因**：

### 1A. SQLite 死锁（commit dc48e09）
- backend log 出现 `sqlalchemy.exc.OperationalError: database is locked`
- 原因：OSS 的 SessionStore 和 Pro 的两个 engine 同时写同一个 SQLite 文件
- **修法**：每个新 sqlite 连接挂 `PRAGMA busy_timeout=5000` listener
- **不变量**：B1。看 `server.py:_enable_sqlite_wal`

### 1B. React state wipe race（commit 7d4dbf1）
- backend log 显示请求 200 OK 完成，DB 里有 assistant 答复，但前端没显示
- 原因：`submit()` 调 `ensureSession()` 创建新 session → `setActiveId` 触发 useEffect → fetch 历史后 `setTurns([])` 抹掉刚插入的 pending turn
- **修法**：用 `lastLoadedSession` ref 区分"真切换"vs"首次设置"
- **不变量**：F1。看 `useChatStore.ts:useEffect (activeId)`

**排查**：先 `docker compose logs backend | grep "OperationalError"` 排除 1A。再看 React DevTools 的 `turns` state 是否被瞬间清空（1B 的特征）。

---

## 2. 切换 session 后输入框被锁住

**症状**：sessionA 提问中点 sessionB → sessionB 的输入框 disabled，要等 sessionA 流跑完才能用。

**根因**：`running` state 全局共享，旧流的 finally 块没执行就不会把 `setRunning(false)`。

**修法**：`setActiveId` wrapper 里 abort inflight 流（commit 385ff55）：

```typescript
const setActiveId = useCallback((id) => {
  _setActiveId((prev) => {
    if (prev !== id && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setRunning(false);  // ← 关键
    }
    return id;
  });
}, []);
```

**不变量**：F3。看 `useChatStore.ts:setActiveId`。

---

## 3. 协作模式下 Reviewer 阶段不显示

**症状**：协作 toggle 开了，但 UI 只显示一个 Researcher 阶段就完结了，看不到 Reviewer 评分卡。

**根因**：Researcher inner-loop 的 `final` 事件被透传到前端 → 前端把 `ev.type === "final"` 当 turn 完结，提前 setTurns({status: "done"}) → 隐藏后续 Reviewer 阶段事件（commit 502f9c2）。

**修法**：orchestrator 在 inner stream 看到 `final` 时只**捕获 draft**，不 yield：

```python
for ev in researcher.stream(current_history):
    if ev["type"] == "final":
        draft = ev["answer"]  # ← 只捕获，不 yield
        tool_calls.extend(ev.get("tool_calls") or [])
        break
    # 其他事件正常透传
    yield ev
```

**不变量**：F5。看 `agents/orchestrator.py:stream_collab`。

---

## 4. 自动标题不触发，会话永远叫"新会话"

**症状**：第一条提问完成后，sidebar 里的会话标题没自动改。

**两个可能的根因**：

### 4A. 前端 trigger 太严格（commit b7fb914）
- 原因：旧实现用 `pendingAutoTitle` ref，只在 `ensureSession` **lazy 创建** session 时加入。但用户先点 "+ 新会话" 再提问的话，activeId 已设，`isNew=false`，永远不触发
- **修法**：去掉 ref，每次成功 turn 都调 `api.autoTitle(sid)`，靠后端 idempotent 守护

### 4B. Reasoning model prompt 泄漏（commit 1b3c64a 之前的版本）
- 症状：标题变成 "The user wants:" 这种 LLM 思考过程的 leak
- 原因：MiniMax-M2.7 / DeepSeek-R1 是 reasoning model，给 8 字标题 budget 不够（只够输出思考的开头）
- **修法**：(a) max_tokens 给到 1024 让它思考完；(b) 配小模型 `FARO_PRO_SMALL_LLM_*` 用 Qwen-A3B 这类非 reasoning 模型

**不变量**：F4 + B3 + B4。看 `useChatStore.ts:tryAutoTitle` + `server.py:auto_title_pro`。

---

## 5. 改了 .env 但行为没变化

**症状**：明明 .env 改了 `FARO_OPENAI_MODEL`，调用还是用的旧模型。

**根因**：`docker compose restart` **不重读** .env。env 在 `docker compose up` 时一次性注入，restart 只是重启进程不重读环境。

**修法**：

```bash
docker compose up -d --force-recreate backend
```

**确认改对了**：

```bash
docker compose exec -T backend env | grep FARO_OPENAI_MODEL
```

---

## 6. 小模型连不上 / auto-title 一直返回错误

**症状**：⚙ → LLM → 测试 "小模型 ping" 返回 fail，标题不更新。

**根因**：`FARO_PRO_SMALL_LLM_BASE_URL` 漏了 `/v1` 前缀（commit 7e0aa2a 修过）。OSS provider 拼 `{base_url}/chat/completions`，base_url 是 `http://10.9.254.83/` 就拼成 `http://10.9.254.83//chat/completions` → 404。

**修法**：base_url 必须带 `/v1`：

```bash
# ❌ FARO_PRO_SMALL_LLM_BASE_URL=http://10.9.254.83/
# ✅
FARO_PRO_SMALL_LLM_BASE_URL=http://10.9.254.83/v1
```

OpenAI 官方也是 `https://api.openai.com/v1`，DeepSeek 是 `https://api.deepseek.com`（这个不带 /v1，因为 server 自己处理）。**没把握就 curl 验证**：

```bash
curl -X POST "http://10.9.254.83/v1/chat/completions" \
  -H "Authorization: Bearer sk-xxx" \
  -H "content-type: application/json" \
  -d '{"model":"...","messages":[{"role":"user","content":"hi"}],"max_tokens":8}'
```

返回 JSON `{...content: "Hello"...}` = 通；HTML / 404 / connection refused = 不通。

---

## 7. PDF 导出中文乱码

**症状**：导出的 PDF 中文显示成方块或问号。

**根因**：xhtml2pdf 默认不带 CJK 字体，需要手动注册 STSong-Light（commit ac1c58d 修过）。

**修法**：`exports/branded.py` 顶部：

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

_CJK_FONTS_REGISTERED = False
def _ensure_cjk_fonts():
    global _CJK_FONTS_REGISTERED
    if _CJK_FONTS_REGISTERED: return
    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        _CJK_FONTS_REGISTERED = True
    except Exception as e:
        log.warning("CJK font registration failed: %s", e)
```

然后在 PDF 生成函数开头调一次。STSong-Light 是 reportlab **内置** CIDFont，不需要外部字体文件。

---

## 8. Docker build cache 让代码改动看不见

**症状**：改了 Python 代码 → `docker compose restart backend` → 行为还是旧的。

**根因**：本仓 backend 是**镜像构建时 COPY** 代码，不是 bind mount。restart 不会重 build。

**修法**：

```bash
# 改 Python 代码后必须 build
docker compose up -d --build backend

# 改前端 TS 后
docker compose build web && docker compose up -d web
# 或者一步
docker compose up -d --build web
```

**验证容器里跑的是新代码**：

```bash
docker compose exec -T backend python -c "
import inspect
from faro_research_pro.server import make_app
print('first 200 chars of make_app:', inspect.getsource(make_app)[:200])
"
```

> 学生提示：开发频繁改前端时可以加 bind mount + Vite HMR。本仓没默认配，因为生产用 build。

---

## 9. 会话列表里看到别人的 session

**症状**：登录用户 A 看到了用户 B 的会话。

**根因**：某个新加的 endpoint 没带 `user_id=user.id` 过滤，OSS SessionStore 的 `list_sessions` 默认是 `user_id="default"` 单租户模式。

**修法**：所有 sessions 相关查询必须带 user.id：

```python
rows = store.list_sessions(limit=500, user_id=user.id)  # ✅
# 不是
rows = store.list_sessions(limit=500)  # ❌ 默认查 "default" 用户的
```

同样 `store.get_session(id)` 要带 `user_id=user.id`。

**不变量**：B2。这是隐私事故级别的 bug，新 endpoint 必查。

**审计**：`grep -n "list_sessions\|get_session" faro_research_pro/server.py` 看每一处是不是都带 user_id。

---

## 10. CollabStepper 不显示工具 pill 或评分卡

**症状**：协作模式 turn 完结后，CollabStepper 显示 "Researcher · 第 1 轮"  但下面空空，没有工具列表也没有 Reviewer 评分卡。

**两种可能**：

### 10A. 前端没收到 review_verdict 事件
- `curl -sN` 流看是不是有 `event: review_verdict`
- 没有的话 → 后端 `agents/reviewer.py` 的 JSON 解析失败（reviewer 输出不是合法 JSON）。检查 reviewer 的 prompt + raw_text fallback

### 10B. 工具被分配错阶段
- 当前 `CollabStepper` 用的是简化逻辑：所有 `liveTools` 都归给 Researcher 阶段
- 如果想精确归属（哪个工具属于第 N 轮 Researcher），需要加新的 SSE 事件携带 round / phase 信息
- 这是**已知简化**，不是 bug，详见 `CollabStepper.tsx:buildTimeline` 注释

---

## 通用诊断流程

| 症状 | 第一步看 | 第二步看 |
|---|---|---|
| 完全没反应 | DevTools Network 看请求是否发出 | backend log 看异常 |
| 请求 200 但无 UI | grep `OperationalError` (B1) | React DevTools 看 turns state |
| 部分功能错 | 对照 5 个不变量 (F1-F5) | 看 commit history 找类似场景 |
| 整个挂掉 | `docker compose logs backend --tail=100` | `docker compose ps` 看 healthy |
| 行为跟代码对不上 | 是不是 restart 没 build | 是不是 force-recreate 没读 env |

---

## 当你的 bug 不在上面时

1. 先看 `docs/FRONTEND-SPEC.md §3.4` (5 个前端不变量) + `CLAUDE.md` (5 个后端不变量)，对照症状判断
2. `git log --grep="fix"` 看历史修过的 fix commit，找类似的
3. 写最小复现 (curl 一个 endpoint / DevTools 截图) 再问 Claude Code，它会自动加载 CLAUDE.md
4. 修完 → **加到这份文档**让下个学生不再撞同样的坑
