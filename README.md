# Argus

<p align="center"><strong>◉ 基于 <a href="https://pi.dev">pi</a> 的个人信息监控智能体</strong></p>

Argus 不是 RSS 过滤器，而是一个持续运转的**个人情报分析员**：

- **以事件为中心**：跨源的碎片条目被 Analyst 聚合成有生命周期的事件（Story），推给你的是合成后的叙事，不是零散链接
- **代码做确定性的事，agent 做判断性的事**：轮询、抓取、去重、入库是纯代码；相关性、聚类、重要度、写作交给 agent
- **记忆与反馈**：关注画像持久化，👍👎 反馈会进入 Analyst 下一轮的判断依据
- **监控仪表盘**：Web 界面查看简报、事件时间线、信息源健康、agent 运行记录

## 工作方式

```
RSS/Atom 信息源 ──采集层（纯代码，定时）──► SQLite
                                            │ 新条目批次
                 Analyst（pi agent）────────┤ 聚类归档 → 事件（Story）
                 Editor （pi agent）────────┤ 合成中文简报
                                            ▼
                 Web 监控台 ◄── Hono API ── 简报 / 事件线 / 源健康 / 运行记录
```

分析层基于 [@earendil-works/pi-agent-core](https://github.com/badlogic/pi-mono) 构建：每个 agent 冷启动、上下文来自数据库、注册的工具是唯一副作用出口，行为可复现。

## 快速开始

要求 Node ≥ 22（使用内置 node:sqlite，无原生编译依赖）。

```bash
git clone https://github.com/1797127235/argus.git
cd argus
npm install

# 配置模型（OpenAI 兼容端点）
cp .env.example .env   # 填入 ARGUS_AI_BASE_URL / ARGUS_AI_API_KEY / ARGUS_AI_MODEL

# 首轮采集（首次抓取只建立静默基线，不分析历史存量）
npm run argus -- collect

# 完整跑一轮：采集 → 分析 → 简报
npm run argus -- run

# 常驻运行：调度器 + Web 监控台（http://127.0.0.1:8787）
npm run build:web
npm run serve
```

## 命令

| 命令 | 作用 |
|---|---|
| `npm run argus -- collect` | 采集一轮全部信息源 |
| `npm run argus -- analyze` | Analyst 消化未分析条目，聚类成事件 |
| `npm run argus -- brief` | Editor 生成一期简报（同时落盘到 `data/reports/`） |
| `npm run argus -- run` | 完整跑一轮 |
| `npm run argus -- status` | 查看状态 |
| `npm run serve` | 常驻：调度器 + Web 监控台 |
| `npm run dev:web` | 前端开发模式（需另开 `npm run serve`） |

## 配置

- **`config/argus.yaml`** —— 信息源、调度（简报时刻、轮询间隔）、分析参数、Web 端口
- **`memory/interests.md`** —— 关注画像，Analyst 判断相关性的唯一依据，随时可改
- **`.env`** —— 模型端点与密钥（不入库）；`ARGUS_ANALYST_MODEL` / `ARGUS_EDITOR_MODEL` 可按角色分层配模型

## 架构

六个解耦的 workspace 包，依赖单向流动：

```
core       纯领域类型 + 端口接口（零依赖）
storage    StoragePort 的 SQLite 实现（node:sqlite）
collector  RSS 采集 → 规范化 → 去重入库（只依赖 core）
agents     Analyst / Editor（只依赖 core + pi）
server     组装根：CLI、调度器、Hono API、静态托管
web        React 监控台（只与 HTTP API 交互）
```

推送通道（Telegram/Apprise 等）当前悬置，`core` 中已定义 `ChannelPort` 接口，实现后即可接入而不改核心管线。

详细设计见 [DESIGN.md](DESIGN.md)。

## License

MIT
