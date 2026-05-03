# Faro Research Pro

> **多 agent 协作 (Researcher + Risk Reviewer) + 品牌化 PDF 研报导出。**
> 在 [Faro Research](https://github.com/alonegg/faro-research) (MIT 核心) 之上扩展;
> 本项目本身 **AGPL-3.0-or-later**。

[![CI](https://github.com/alonegg/faro-research-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/alonegg/faro-research-pro/actions/workflows/ci.yml)
[![License: AGPL v3+](https://img.shields.io/badge/License-AGPL%20v3%2B-blue.svg)](LICENSE)
![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)

---

## 目录

- [一句话定位](#一句话定位)
- [v.s. OSS 核心](#vs-oss-核心)
- [架构图](#架构图)
- [快速开始](#快速开始)
- [模块逐文件说明](#模块逐文件说明)
- [多 agent 流程详解](#多-agent-流程详解)
- [品牌化导出: 自定义 logo / 颜色 / 抬头](#品牌化导出-自定义-logo--颜色--抬头)
- [部署](#部署)
- [二次开发指南](#二次开发指南)
- [License & 为什么 AGPL](#license--为什么-agpl)

---

## 一句话定位

**OSS 核心** (`faro-research`, MIT) 解决「让一个 LLM agent 能调 Tushare 工具回答 A 股问题」。

**Pro** (`faro-research-pro`, AGPL) 解决 OSS 之外的两件事:

1. **多 agent 协作** —— Researcher 出稿 → Risk Reviewer 审 (检查归因 / 风险提示 / 假设暴露) → 必要时退回让 Researcher 改 (默认最多 2 轮)。实测同一个茅台估值问题, 单 agent 漏写风险提示, Reviewer 抓出来后 Researcher 主动补充了 "2018 年 PE 20× 不可类比 / 25Q4 ROE 含一次性收益待核实" 等关键 caveat。
2. **品牌化 PDF 导出** —— 带封面页 (logo + 标题 + 摘要 + 作者 + 日期) + 每页页眉/页脚 (logo 缩略 + 页码) 的 A4 PDF, 可选 CONFIDENTIAL 水印, 中文字体内嵌 (STSong-Light)。

OSS 给你 80 分; Pro 把那剩下的 20 分补齐, 代价是 AGPL。

## v.s. OSS 核心

| | OSS Faro Research | Pro |
|---|---|---|
| Agent loop | 单轮 LLM + 工具调用 | Researcher + Risk Reviewer 多轮 |
| Markdown 导出 | 简单 cover (标题 + 时间) | + 品牌行 (logo / tagline / URL) |
| PDF 导出 | 普通正文 (CJK 已支持) | 封面页 + 页眉页脚 + logo + 摘要 + (可选) CONFIDENTIAL |
| 主色 | 蓝 #4a6cf7 | 紫蓝 #7a3cf3 (区分 demo) |
| Web 标识 | "Faro Research" | "Faro Research **PRO**" 徽章 |
| 协作开关 | – | topbar 复选框 (持久化到 localStorage) |
| 端点新增 | – | `POST /api/sessions/{id}/ask/collab/stream` , `GET /api/pro/health` |
| 端点覆盖 | – | `GET /api/sessions/{id}/export.pdf` 改为品牌化 |
| License | MIT | AGPL-3.0-or-later |

Pro **不是 fork** OSS — 它通过 `pip install faro-research>=0.4` 依赖, 直接 import OSS 的 `Agent` / `make_provider` / `ToolRegistry` / `session_to_markdown` 等公共 API。OSS 升级时 Pro 自动跟。

## 架构图

```
┌──────────────────────────────────────────────────────────────────┐
│  Pro Web UI (React, 紫蓝主题, /web)                              │
│  ┌─ topbar: [🤝 多 agent 协作 toggle] [provider] [user]         │
│  ├─ 左侧: 会话列表 (per-user)                                    │
│  └─ 主区: 阶段化 timeline                                         │
│       ├─ Researcher · 第 1 轮  [tool calls...]                    │
│       ├─ Risk Reviewer · 第 1 轮  [verdict 卡: ↺ 退回 + 3 issues]│
│       ├─ Researcher · 第 2 轮  [tool calls...]                    │
│       ├─ Risk Reviewer · 第 2 轮  [verdict 卡: ✓ 通过]            │
│       └─ Final answer + [下载 MD] [下载 PDF]                     │
└──────────────────────────────────────────────────────────────────┘
                              │  SSE
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Pro FastAPI (faro_research_pro/server.py)                       │
│  ┌─ Mounts OSS app verbatim (auth / sessions / single ask)       │
│  ├─ + POST /api/sessions/{id}/ask/collab/stream                   │
│  ├─ + GET /api/pro/health                                         │
│  └─ Overrides GET /api/sessions/{id}/export.pdf → branded        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Pro core (faro_research_pro/)                                    │
│  ┌─ agents/                                                      │
│  │   ├─ researcher.py    — system_prompt addendum                 │
│  │   ├─ reviewer.py      — JSON-output Reviewer + parser         │
│  │   └─ orchestrator.py  — stream_collab() generator             │
│  └─ exports/                                                      │
│      ├─ branded.py       — cover + header/footer + xhtml2pdf      │
│      └─ assets/logo.svg  — default Faro Pro logo                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  OSS faro-research (>=0.4.0, MIT, pip install)                   │
│  Agent · ToolRegistry · Provider · MemoryStore · SessionStore    │
│  · skills · 5 Tushare tools · auth (User + API key)              │
└──────────────────────────────────────────────────────────────────┘
```

## 快速开始

### Docker (推荐)

```bash
git clone https://github.com/alonegg/faro-research-pro.git
cd faro-research-pro
cp .env.example .env
# 填 FARO_OPENAI_API_KEY 和 TUSHARE_TOKEN

docker compose up --build
# 浏览器: http://localhost:5174     (5174 避开 OSS 的 5173)
```

UI 顶部有 `🤝 多 agent 协作` 切换, 默认关 (单 agent / 快); 打开后下一个问题走 Researcher + Reviewer 流程。

### 本地直接跑 (开发)

```bash
# 后端
python -m venv .venv && source .venv/bin/activate
pip install -e ".[server]"
uvicorn faro_research_pro.server:app --reload --port 8001

# 前端 (另开终端)
cd web && pnpm install && pnpm dev
# http://localhost:5173 (Vite 默认; 通过 proxy 转发到 8001)
```

### 纯 CLI

```bash
pip install -e .

# 多 agent 协作 (默认)
faro-pro "贵州茅台 PE_TTM 和近 4 季度 ROE"

# 单 agent (快, 与 OSS faro-research 等价)
faro-pro --plain "..."

# 设置最大复审轮数 (默认 2)
faro-pro --rounds 3 "茅台估值合不合理"

# 同时导出 markdown + 品牌 PDF
faro-pro "..." --md report.md --pdf report.pdf
```

### 作为 Python 库嵌入

```python
from faro_research_pro import run_collab, BrandConfig, branded_markdown_to_pdf
from faro_research import Agent, Message, ToolRegistry, make_provider
from faro_research.tools.builtin.tushare import tushare_default_tools

p = make_provider()
reg = ToolRegistry()
reg.register_many(tushare_default_tools(p))
researcher = Agent(provider=p, tools=reg)

trace = run_collab(
    researcher=researcher, reviewer_provider=p,
    history=[Message(role="user", content="贵州茅台研报")],
    max_rounds=2,
)
print(trace.final_answer)
print(f"协作 {trace.rounds} 轮; 评审历史: {[r.verdict for r in trace.reviews]}")

# 渲染品牌 PDF
pdf = branded_markdown_to_pdf(
    trace.final_answer, title="茅台研报",
    brand=BrandConfig(author="Quant Team", confidential=True),
)
open("mt.pdf", "wb").write(pdf)
```

---

## 模块逐文件说明

```
faro-research-pro/
├── pyproject.toml                          # AGPL, 依赖 faro-research>=0.4
├── LICENSE                                 # AGPL-3.0 全文
├── README.md                               # 本文件
├── .env.example                            # 配置模板 (含 FARO_PRO_BRAND_*)
├── docker-compose.yml                      # backend + web 双容器, 5174 端口
├── docker/
│   ├── Dockerfile.backend                  # python:3.12-slim + cairo + Pro
│   ├── Dockerfile.web                      # nginx + Vite build
│   └── nginx.conf                          # SSE-friendly 代理
│
├── faro_research_pro/
│   ├── __init__.py                         # 顶层导出 + 加载 cwd .env
│   │
│   ├── exports/                            # 品牌化导出
│   │   ├── __init__.py                     #   公共 API: BrandConfig, branded_*
│   │   ├── branded.py                      #   ~330 行:
│   │   │                                   #   - BrandConfig dataclass
│   │   │                                   #   - _ensure_cjk_fonts() 注册 STSong-Light
│   │   │                                   #   - _cover_html() 封面 HTML
│   │   │                                   #   - _build_css() 全 CSS (cover + header/footer + body)
│   │   │                                   #   - branded_markdown_to_pdf() 渲染入口
│   │   │                                   #   - branded_markdown() md 版本
│   │   └── assets/logo.svg                 #   默认 logo (xhtml2pdf 友好, 无 gradient)
│   │
│   ├── agents/                             # 多 agent 协作
│   │   ├── __init__.py                     #   公共 API
│   │   ├── researcher.py                   #   system_prompt addendum (~30 行)
│   │   │                                   #     告知 Researcher: 你的稿子会被 Reviewer 审
│   │   ├── reviewer.py                     #   ~120 行
│   │   │                                   #     - REVIEWER_SYSTEM 6 项检查清单
│   │   │                                   #     - Review / ReviewIssue dataclass
│   │   │                                   #     - review_draft() 单 LLM 调用 → JSON
│   │   │                                   #     - _parse_review() 鲁棒 JSON 提取
│   │   │                                   #     - revision_prompt_for_researcher()
│   │   └── orchestrator.py                 #   ~160 行
│   │                                       #     - stream_collab() generator yield 事件
│   │                                       #     - run_collab() blocking wrapper
│   │
│   ├── server.py                           # FastAPI 扩展 (~200 行)
│   │                                       #   - mount OSS make_app
│   │                                       #   - + /api/pro/health
│   │                                       #   - + /api/sessions/{id}/ask/collab/stream
│   │                                       #   - 覆盖 /api/sessions/{id}/export.pdf 用 branded
│   │
│   └── cli.py                              # `faro-pro` CLI 入口 (~100 行)
│                                           #   --plain / --rounds N / --pdf / --md / --quiet
│
└── web/                                    # Pro 前端 (fork OSS)
    ├── package.json                        # name=faro-research-pro-web v0.5.0
    ├── vite.config.ts                      # /api proxy → backend:8000
    └── src/
        ├── main.tsx                        # React 入口 (与 OSS 一致)
        ├── App.tsx                         # ~700 行
        │                                   #   Sidebar (PRO 徽章) +
        │                                   #   Topbar (🤝 协作开关) +
        │                                   #   Thread + 阶段化 TurnView (PhaseTag + ReviewCard)
        ├── api.ts                          # 加 mode='collab' 切换到 /ask/collab/stream
        │                                   #   ResearchStreamEvent 联合类型加 phase/verdict
        ├── markdown.tsx                    # 极简 markdown 渲染 (与 OSS 一致)
        └── styles.css                      # 紫蓝主题 + .phase-tag + .review-card 卡片
```

### 核心数据结构

```python
# faro_research_pro/agents/orchestrator.py
@dataclass
class CollabTrace:
    final_answer: str
    rounds: int                    # 实际跑了几轮 (1..max_rounds)
    researcher_drafts: list[str]   # 每轮 Researcher 的草稿
    reviews: list[Review]          # 每轮 Reviewer 的判决
    tool_calls: list[dict]         # Researcher 累计的工具调用
    latency_total_ms: float
    error: str | None

# faro_research_pro/agents/reviewer.py
@dataclass
class Review:
    verdict: str        # "approve" | "revise"
    score: int          # 1..10
    summary: str        # ≤ 40 字一句话总评
    issues: list[ReviewIssue]
    must_fix_indices: list[int]
    raw_text: str

@dataclass
class ReviewIssue:
    category: str       # 归因 | 假设 | 风险 | 过度自信 | 空话 | 未披露
    detail: str         # 具体引用 + 修改建议

# faro_research_pro/exports/branded.py
@dataclass
class BrandConfig:
    project_name: str = "Faro Research Pro"
    tagline: str = "AGPL · 多 agent A 股研究"
    project_url: str = "https://github.com/alonegg/faro-research-pro"
    accent_color: str = "#4a6cf7"
    accent_dark: str = "#7a3cf3"
    logo_svg_path: Path | None = None
    author: str = "Faro Research"
    confidential: bool = False
```

### SSE 事件协议 (collab 模式)

新事件 (在 OSS 协议之外加):

```
event: phase_start
data: {"type":"phase_start", "phase":"researcher"|"reviewer", "round": 1}

event: phase_done
data: {"type":"phase_done", "phase":"researcher", "round":1, "draft":"<text>"}

event: review_verdict
data: {"type":"review_verdict", "round":1,
       "verdict":"approve"|"revise", "score":7,
       "summary":"...", "issues":[{"category":"...","detail":"..."}]}

event: final
data: {"type":"final", "answer":"...", "rounds":2,
       "reviews":[...], "turns":..., "tool_calls":[...]}
```

OSS 的 `tool_call` / `tool_result` / `turn_start` / `error` / `done` 事件原样保留, 来自 Researcher 阶段的子流。

---

## 多 agent 流程详解

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. 用户问 "贵州茅台 PE_TTM 和近 4 季度 ROE"                      │
│      │                                                            │
│      ▼                                                            │
│ 2. Researcher 跑 OSS Agent loop:                                  │
│      → resolve_ticker → get_company_data → ...                    │
│      → 输出 draft (markdown)                                       │
│      │                                                            │
│      ▼                                                            │
│ 3. Reviewer 单 LLM 调用 (无工具):                                 │
│      input  = (用户原问题) + (Researcher draft)                    │
│      output = JSON {verdict, score, issues, summary, must_fix}    │
│                                                                   │
│      ┌─ approve (score ≥ 7) → goto 5                              │
│      └─ revise  (score < 7) → goto 4                              │
│      │                                                            │
│      ▼                                                            │
│ 4. 把 reviewer 的 must_fix issues 包成新的 user message,           │
│    追加到 history → 回到 step 2 (round++)                          │
│                                                                   │
│      max_rounds (默认 2) 到了即使没 approve 也走 5                │
│      │                                                            │
│      ▼                                                            │
│ 5. 最后一轮的 Researcher draft = final answer                     │
│    所有阶段事件流式推给前端 (含每轮 verdict 卡片)                 │
└──────────────────────────────────────────────────────────────────┘
```

### 实测对比 (单 agent vs 多 agent)

同样的问题 "贵州茅台 PE_TTM 和近 4 季度 ROE":

| | 单 agent (OSS) | 多 agent (Pro) |
|---|---|---|
| Turn 数 | 3 | 4-5 (含 reviewer) |
| 时长 | ~16s | ~60s |
| 数据归因 | 表头一次 | **每个数字内联标注 (Tushare YYYY-MM-DD)** |
| 风险提示 | 无 | **明确警示 "2018 PE 低点不可类比" + "25Q4 ROE 含一次性收益待核实"** |
| 计算口径 | 写"约 22%" | **明确"是否(26Q1+25Q4+25Q3+25Q2)/4 简单平均, 还是基于加权净资产的精确滚动值"** |

Reviewer 的 6 项检查清单 (`reviewer.py:REVIEWER_SYSTEM`):

1. **数据归因** — 每个具体数字是否有日期 + 数据源标注
2. **未披露字段** — 如实写"未披露", 不用"约""大概"硬填
3. **估值/反求假设** — 核心假设是否暴露 (DCF: WACC/g; 反求: x_max/overrides/池)
4. **关键风险** — 至少一个非显然风险 (复权/一致预期/数据滞后/池子天花板/周期性)
5. **过度自信语** — 没充分论证的"显著低估""强烈推荐"
6. **空话** — "综上所述""总而言之"

### 为什么 Reviewer 是独立 LLM 调用而非"让 Researcher 自审"

- 不同 system prompt → 注意力焦点完全不同
- 强制 JSON 输出 → 编排器按 `verdict` 字段做编程化决策
- 不引入 chain-of-thought 黑魔法

### 为什么 max_rounds=2 而非更多

- 第 1 轮 review 抓的是大问题 (缺风险 / 缺归因 / 假设没暴露)
- 第 2 轮 review 通常 approve, 偶尔再 revise → 第 3 轮就是细枝末节, 边际收益小
- 实测 2 轮够用; 想严格可以 `--rounds 3`

### Token 成本

- Researcher: 同 OSS, 几个 tool 调 + 一次 LLM 出稿
- Reviewer: 一次 LLM 调 (无工具), ~1-2K tokens
- 总额 ≈ 1.5-2× 单 agent

---

## 品牌化导出: 自定义 logo / 颜色 / 抬头

通过环境变量 (优先级低) 或代码 (优先级高) 都可以。

### 通过 env (docker compose 友好)

```bash
# .env
FARO_PRO_BRAND_NAME=My Quant Desk
FARO_PRO_BRAND_TAGLINE=量化部周报
FARO_PRO_BRAND_URL=https://my-org.com/research
FARO_PRO_BRAND_AUTHOR=量化研究部
FARO_PRO_BRAND_ACCENT=#0d6efd
FARO_PRO_BRAND_ACCENT_DARK=#0a58ca
FARO_PRO_CONFIDENTIAL=1               # 加 CONFIDENTIAL 水印
```

### 通过代码 (灵活: 不同会话不同品牌)

```python
from faro_research_pro import BrandConfig, branded_markdown_to_pdf
from pathlib import Path

brand = BrandConfig(
    project_name="高盛全球量化",
    tagline="Internal · Q4 2026",
    project_url="https://gs.example.com",
    accent_color="#003a70",
    accent_dark="#001a40",
    author="GS Quant",
    confidential=True,
    logo_svg_path=Path("/path/to/your/logo.svg"),
)
pdf = branded_markdown_to_pdf(md, title="...", brand=brand)
```

### Logo SVG 要求

- 不要用 `linearGradient` (xhtml2pdf 不支持 `fill="url(#g)"`), 用纯色填充
- viewBox 360x80 比例最佳

### 中文字体

PDF 自动注册 reportlab 内置的 `STSong-Light` (Adobe Asian Font Pack 自带, 无需系统字体), 中文字符正常显示。`_ensure_cjk_fonts()` 在 `branded_markdown_to_pdf()` 内自动调用一次。

---

## 部署

### 单机 Docker (开发 / 个人)

```bash
docker compose up -d
# http://localhost:5174
```

### 生产部署关键 env

```bash
FARO_AUTH_REQUIRED=1
FARO_ADMIN_KEY=fr-$(openssl rand -hex 32)   # 仅在第一次 cold start 用
FARO_AUTH_SECRET=$(openssl rand -hex 32)     # API key hash 用
FARO_CORS_ORIGINS=https://research.your-org.com
```

**与 OSS 共存**: Pro 默认占 5174, OSS 占 5173, 互不干扰。两个数据库也分开 (`./data/faro.db` 各自一份)。

### 反向代理 (nginx 例)

```nginx
location /api/ {
    proxy_pass http://localhost:8001/api/;   # 或 docker compose 的 backend
    proxy_buffering off;                      # SSE 必须
    proxy_read_timeout 600s;
}
location / {
    proxy_pass http://localhost:5174/;
}
```

---

## 二次开发指南

### 加一个新 agent role (例: ESG Reviewer)

1. 复制 `faro_research_pro/agents/reviewer.py` → `esg_reviewer.py`
2. 改 `REVIEWER_SYSTEM` 为 ESG 关注点 (碳排 / 治理 / ...)
3. 在 `orchestrator.py` 的 stream_collab 里加一个 ESG 阶段, e.g.:

```python
# 通过 risk reviewer 后再过 esg
if review.is_approved:
    esg_review = review_esg(provider, draft=draft)
    yield {"type": "review_verdict", "round": ..., "phase": "esg", ...}
    if not esg_review.is_approved:
        # 拼合两个 review 的 must_fix 一起送回
        ...
```

### 改 Reviewer 的检查清单

`faro_research_pro/agents/reviewer.py:REVIEWER_SYSTEM` 里直接改文字。JSON schema 不变就行 (parser 兼容)。

### 给 PDF 加新元素 (eg. 二维码 / 分析师签名)

`faro_research_pro/exports/branded.py:_cover_html()` 直接改 HTML, `_build_css()` 改样式。xhtml2pdf 支持的 HTML 子集见 [xhtml2pdf docs](https://xhtml2pdf.readthedocs.io/en/latest/usage.html#supported-html-attributes-and-css-properties)。

### 单测

```bash
pip install -e ".[dev]"
ruff check faro_research_pro
pytest -q                         # 没有 LLM-依赖的测试都能跑
```

CI 也跑这俩 + Docker 镜像构建 + boot probe。

---

## License & 为什么 AGPL

**Pro 是 AGPL-3.0-or-later**, **OSS 核心 (`faro-research`) 是 MIT**。两者完全分离。

### 为什么 Pro 选 AGPL

- 多 agent 编排 + 品牌化导出是真正能省研究员时间的功能, 不希望被 SaaS 竞品直接 fork 重新包装
- AGPL 要求: 你**通过网络服务**提供 Pro 功能时 (即开 SaaS), 必须公开你的修改源码。这阻止了"白嫖 + 私有部署"的玩法
- 个人 / 内部研究使用完全不受影响 (只要不把改动版本作为公网服务对第三方用户暴露)

**MIT 核心 + AGPL 增强** 是开源界主流的"open core"模型 (e.g. Sentry, Mattermost 早期, GitLab CE/EE)。

如果你需要不受 AGPL 约束的商业授权, 联系 <https://github.com/alonegg> 讨论。

---

## 路线图

- [x] **v0.5** — Multi-agent (Researcher + Risk Reviewer) + branded PDF + CJK 中文 PDF
- [ ] **v0.6** — ESG Reviewer / Compliance Reviewer 可插拔 reviewer 池
- [ ] **v0.7** — PDF 模板系统 (用户传 HTML/CSS 模板覆盖默认)
- [ ] **v0.8** — Audit-grade 报告 (含每条数字到工具调用的 traceability 链)
- [ ] **v0.9** — Reviewer 内联评注 (PDF 边栏标注 issue, 不只是过/不过)

---

## 致谢

- [virattt/dexter](https://github.com/virattt/dexter) — 设计灵感 (skill / formatter / meta-tool 模式从那借鉴)
- [Faro Research](https://github.com/alonegg/faro-research) — MIT 核心
- Tushare — A 股数据来源
- DeepSeek / MiniMax / Anthropic / OpenAI / Moonshot — 兼容的 LLM provider

PR / issue 欢迎。AGPL 意味着对任何修改的贡献会自动回流到这里, 所以放心提。
