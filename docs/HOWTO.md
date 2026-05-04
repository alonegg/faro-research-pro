# 常见维护任务 — Cookbook

> 8 个食谱，覆盖 90% 学生会遇到的修改类型。每个食谱列了**改哪些文件**和**怎么验证**。

---

## 1. 加一个新的 LLM 工具 (给 Agent 多一种能力)

**场景**：例如让 agent 能拉指数成分股、能查 ETF 净值、能查股东人数变化。

### 步骤

**1.1** 在 `faro_research_pro/tools/` 下新建一个 `.py`，参考 `us_stocks.py` 的结构：

```python
# faro_research_pro/tools/indexes.py
from faro_research.tools.types import ToolSpec
from faro_research.tools.builtin.tushare import client as ts

def _tool_get_index_constituents(ts_code: str, top_n: int = 10) -> dict:
    try:
        rows = ts.tushare_call("index_weight", index_code=ts_code, ...)
        return {"index": ts_code, "constituents": rows[:top_n]}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}

def fmt_index_constituents(out: dict, args: dict) -> str:
    if "error" in out: return f"❌ {out['error']}"
    lines = ["| 代码 | 名称 | 权重 |", "|---|---|---|"]
    for c in out["constituents"]:
        lines.append(f"| {c['ts_code']} | {c['name']} | {c['weight']:.2%} |")
    return "\n".join(lines)

_GET_INDEX_CONSTITUENTS = ToolSpec(
    name="get_index_constituents",
    description=(
        "拉取指数前 N 只成分股 + 权重。\n\n"
        "## When to use\n问'沪深300前10大权重股是什么'这类问题。\n\n"
        "## Returns\n按权重降序的 ts_code/name/weight 列表。"
    ),
    compact_description="拉指数 (沪深300/中证500等) 前N只成分股+权重。",
    parameters={
        "type": "object",
        "properties": {
            "ts_code": {"type": "string", "description": "指数 ts_code, 如 '000300.SH'"},
            "top_n": {"type": "integer", "default": 10, "description": "返回前N只 (max 50)"},
        },
        "required": ["ts_code"],
    },
    fn=_tool_get_index_constituents,
    formatter=fmt_index_constituents,
    cache_ttl_sec=86400,  # 成分股变化慢
    timeout_sec=10,
)

INDEX_TOOLS: list[ToolSpec] = [_GET_INDEX_CONSTITUENTS]
```

**1.2** 在 `faro_research_pro/server.py` 的 `ask_collab_stream` 端点里注册：

```python
# 找到这块 (大约 line 200)
try:
    from faro_research_pro.tools.us_stocks import US_TOOLS
    reg.register_many(US_TOOLS)
except Exception as e:
    log.warning("us_stocks tools failed to load: %s", e)

# 加在后面
try:
    from faro_research_pro.tools.indexes import INDEX_TOOLS
    reg.register_many(INDEX_TOOLS)
except Exception as e:
    log.warning("indexes tools failed to load: %s", e)
```

**1.3** Build + 测：

```bash
docker compose up -d --build backend
# 容器内单测一下 (不打 LLM)
docker compose exec -T backend python -c "
from faro_research_pro.tools.indexes import INDEX_TOOLS
print(INDEX_TOOLS[0].fn(ts_code='000300.SH', top_n=5))
"
```

**1.4** 浏览器开协作模式问 "沪深300 当前权重最大的 5 只" → CollabStepper 应该显示 `get_index_constituents` 工具被调用。

### 注意事项

- **必须用 `try/except`** 在 fn 里把异常包成 `{"error": "..."}`，不要 raise，否则 agent 整个循环挂掉
- **formatter** 用 markdown 表格，省 token
- **cache_ttl_sec** 选合理：snapshot 数据 60s / 季报数据 86400s / 静态元数据 86400s
- 注册的 try/except 包住 import 是为了**单个工具坏了不影响其他工具**

---

## 2. 加一个新的 Settings 字段

**场景**：例如让用户能配 "默认每次最多检索几条新闻"。

### 步骤

**2.1** 注册默认值：`faro_research_pro/storage/settings.py:DEFAULTS`

```python
DEFAULTS = {
    # ... 已有的
    "agent.news_max_items": 5,  # ← 新加
}
```

**2.2** 在合适的 settings section 加输入控件：`web/src/components/settings/sections/Agent.tsx`

```tsx
<Field label="新闻每次最多" hint="agent 每次拉新闻的条数上限">
  <input
    type="number" min={1} max={50}
    className="settings-input settings-input--num"
    value={settings["agent.news_max_items"] ?? 5}
    onChange={(e) => onUpdate("agent.news_max_items", parseInt(e.target.value) || 5)}
  />
</Field>
```

**2.3** 在后端用到的地方读：

```python
from faro_research_pro.storage import settings_store
# ...
psettings = settings_store()
max_items = int(psettings.get("agent.news_max_items", 5))
```

**2.4** Build + 测：⚙ → Agent 行为 → 应该出现新字段 → 改值 → 刷新页面 → 值还在（已持久化到 SQLite）

### 注意事项

- DEFAULTS 里的 key 名约定 `<group>.<field>`（如 `agent.xxx` / `brand.xxx`）
- PATCH endpoint 用**白名单**（`server.py:patch_settings`）只接受 DEFAULTS 里的 key
- 数字字段记得 `parseInt()` / `parseFloat()` 转换，否则 React 传字符串

---

## 3. 加一个新的 SSE 事件类型

**场景**：例如让 agent 在调长工具时主动 yield 一个 `tool_progress` 事件，前端显示进度条。

### 步骤

**3.1** 后端 yield 新事件，例如在 `agents/orchestrator.py`：

```python
yield {"type": "tool_progress", "tool_call_id": "xyz", "percent": 45}
```

**3.2** 在 `web/src/api.ts` 的 `ResearchStreamEvent` 联合类型里加：

```typescript
export type ResearchStreamEvent =
  | // ... 已有的
  | { type: "tool_progress"; tool_call_id: string; percent: number };
```

**3.3** 在 `useChatStore.ts:onEvent` 加 handler：

```typescript
if (ev.type === "tool_progress") {
  return {
    ...t,
    liveTools: t.liveTools.map((lt) =>
      lt.tool_call_id === ev.tool_call_id
        ? { ...lt, progress: ev.percent } : lt,
    ),
  };
}
```

**3.4** 在 UI 渲染（`CollabStepper.tsx` 或 `ToolsTrace.tsx`）展示。

### 注意事项

- ⚠️ **F5 不变量**：如果新事件叫 `final` 之类前端会判完结的名字，记得只在最外层 yield，inner-loop 必须 swallow
- 事件名用 snake_case，跟现有的统一
- `data:` JSON 里有换行字符的话**必须**靠 `json.dumps(ev, ensure_ascii=False)` 自动转义，不要手拼字符串

---

## 4. 加一个新的 admin endpoint

**场景**：例如 admin 想能看所有用户的 audit log。

### 步骤

**4.1** 在 `server.py:make_app()` 里加（位置：靠近 `list_users_admin`）：

```python
@app.get("/api/pro/audit/all")
def all_audit_admin(
    limit: int = Query(100),
    admin: User = Depends(_admin_required),  # ← 必须用这个 dep
) -> list[dict]:
    rows = store.list_audit(limit=limit, user_id=None)  # None = all users
    return [{"id": r.id, "user_id": r.user_id, "kind": r.kind, ...} for r in rows]
```

**4.2** 前端 `api.ts` 加方法：

```typescript
listAllAudit: (limit = 100) => jget<AuditRow[]>(`/pro/audit/all?limit=${limit}`),
```

**4.3** 在 admin tab（推荐 "审计/隐私" tab）渲染。

### 注意事项

- ⚠️ **B5 不变量**：必须 `Depends(_admin_required)`。前端隐藏 UI 不算数 — 任何人都能 curl
- 前端 `useSettings`/`useChatStore` 拿当前用户 role：`status?.auth.current_user.role === "admin"`
- admin 自己不能删自己 / 不能删 default 用户（已在 `delete_user_admin` 实现，新 endpoint 也注意类似边界）

---

## 5. 切换主 LLM provider

**场景**：从 MiniMax 换 DeepSeek，或加新的 Azure OpenAI 端点。

### 步骤

**5.1** 改 `.env`：

```bash
# DeepSeek 例
FARO_PROVIDER=openai_compat
FARO_OPENAI_BASE_URL=https://api.deepseek.com
FARO_OPENAI_API_KEY=sk-xxx...
FARO_OPENAI_MODEL=deepseek-chat
```

**5.2** **必须** force recreate（restart 不重读 env）：

```bash
docker compose up -d --force-recreate backend
```

**5.3** 测：⚙ → LLM 模型 → 主模型 → 点 "发个 ping"

### 注意事项

- ⚠️ **base_url 必须带 `/v1`** 如果 provider 用 OpenAI 标准路径。OSS provider 拼 `{base_url}/chat/completions`
- DeepSeek-R1 / MiniMax-M2.7 / o1 这种 reasoning 模型给 auto-title 烧 5K tokens 很贵 → 强烈推荐配小模型
- 切完后**所有现有 session 的下一个 turn** 都用新 provider；旧 session 历史用旧 provider 写的，不影响
- 如果换的 provider 不返回 `tool_calls`（不支持函数调用），所有工具都失效；改回 OpenAI 兼容的

---

## 6. 调试"输入了没反应"类问题

参见 `docs/TROUBLESHOOTING.md` 但这里给个**决策树**：

```
1. backend log 有请求 (POST /api/sessions/.../ask/...) 吗？
   ├─ 没有 → 前端没发出去，看 DevTools Network
   └─ 有 → 进入 2

2. 请求返回 200 还是错？
   ├─ 4xx/5xx → 看 backend log 异常栈
   └─ 200 → 进入 3

3. SSE 流的事件正常吗？
   curl -sN -X POST "..." | grep "^event:"
   ├─ 没有 final/done → 后端流卡住，看 log
   └─ 有 final/done → 进入 4

4. 检查前端 useChatStore 是否触发 onEvent (DevTools React Profiler)
   ├─ onEvent 没触发 → askStream 解析失败，看 console.error
   └─ 触发了 → state 没更新到 UI，多半是 F1 (wipe-race) 或 F2 (sessionId) bug
```

---

## 7. 加一个新的 sidebar 操作

**场景**：例如想给会话加一个"导出当前 session 为 JSON"的按钮。

### 步骤

在 `web/src/components/chat/Sidebar.tsx` 的 `SessionItem` 组件里 `session-actions` div 加按钮：

```tsx
<button
  className="session-action-btn"
  title="导出 JSON"
  onClick={(e) => {
    e.stopPropagation();
    api.download(s.id, "json").catch((err) => toast.error(`${err}`));
  }}
>
  <I.Download size={12} />
</button>
```

后端如果没有这个 endpoint 就要先加（参考 OSS 的 `export.md` / `export.pdf` 写法）。

### 注意事项

- ⚠️ 用 `e.stopPropagation()` 防止触发 row 的 onClick (会切换 session)
- 图标用 `Icon.tsx` 里有的，没有就在 Icon.tsx 里加
- 危险操作（删除）加 `danger` class 让 hover 变红

---

## 8. 加一个新的 Settings tab

**场景**：例如加一个 "📡 Cron 任务" tab 让 admin 看定时任务状态。

### 步骤

**8.1** 创建 `web/src/components/settings/sections/Cron.tsx`，参考 `Users.tsx` 的结构。

**8.2** 在 `SettingsModal.tsx` 的 `ALL_TABS` 数组加：

```typescript
{ id: "cron", label: "Cron 任务", icon: "📡", adminOnly: true },
```

**8.3** 在 `SettingsModal.tsx` 的 tab body 加渲染分支：

```typescript
{tab === "cron" && isAdmin && <CronSection />}
```

**8.4** 后端如果需要新 endpoint，参考食谱 4 的 admin endpoint 写法。

### 注意事项

- `adminOnly: true` 的 tab 自动从非 admin 用户的 nav 隐藏
- icon 用 emoji 简单，要图标 SVG 就在 `Icon.tsx` 里加
- 注意类名遵循 `settings-section` / `field-row` / `field-label` / `field-control` 这套既有规范

---

## 通用原则

| 改动类型 | 必看的不变量 |
|---|---|
| 改 `useChatStore.ts` 的 effect / setActiveId / submit | F1, F2, F3, F4 |
| 改 `agents/orchestrator.py` 或 yield 新 SSE 事件 | F5 |
| 加新 SQLAlchemy engine | B1 |
| 加新 endpoint 涉及用户数据 | B2 |
| 改 auto-title 流程 | B3, B4 |
| 加 admin 功能 | B5 |

详见 `CLAUDE.md` §"⚠️ 10 个不变量"。
