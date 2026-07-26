# Argus 架构与开发指南

面向要改这份代码的人（也包括接手的 AI）。
产品定位与设计取舍见 [DESIGN.md](../DESIGN.md)，上手运行见 [README](../README.md)。

---

## 1. 包结构与依赖规则

六个 npm workspace 包，依赖**单向**流动：

```
        ┌────────► core ◄────────┐
        │      类型 + 端口接口     │
   collector    storage      agents ──► pi-agent-core / pi-ai
        ▲          ▲             ▲
        └──────── server ────────┘
              （唯一的组装根）
                    │ HTTP
                   web
```

| 包 | 职责 | 允许依赖 |
|---|---|---|
| `core` | 领域类型 + 端口接口 | **无**（零依赖，这是硬约束） |
| `storage` | `StoragePort` 的 SQLite 实现 | `core` + `node:sqlite` |
| `collector` | RSS 抓取 → 规范化 → 入库 | `core` + `rss-parser` |
| `agents` | Analyst / Editor | `core` + pi |
| `server` | CLI、调度、API、配置、组装 | 以上全部 + hono/croner/yaml |
| `web` | React 监控台 | 只有 `core` 的**类型**，运行时只走 HTTP |

### 三条不能破的规则

1. **`core` 保持零运行时依赖。** 它只有 `interface` 和 `type`。一旦
   `core` 引入了 SQLite 或 HTTP，依赖倒置就塌了。
2. **`collector` 和 `agents` 不认识具体实现。** 它们面向 `StoragePort`
   编程。这不是理论洁癖——正因如此，测试时可以直接
   `new SqliteStorage(":memory:")` 注进去跑真实采集，一行生产代码不用改。
3. **`server` 是唯一知道所有实现的地方。** 配置加载、依赖注入、路由、
   调度全在这里。想加一种存储后端？只改 `server` 的组装处。

---

## 2. 数据流

```
RSS/Atom ──parseURL（主地址失败则依次试备用地址）
   │
   ├─ normalize：取 title/link/guid/content/pubDate
   ├─ stripHtml：剥标签 → 单趟解码实体 → 压空白 → 截断 4000 字
   ▼
INSERT OR IGNORE items          UNIQUE(source_id, guid) 天然幂等
   │
   ├─ 首次抓取？ ──是──► markSourceAnalyzed（静默基线，存量不进分析）
   └─ 否 ──► capPendingForSource(maxPendingPerSource)（旧的静默丢弃）
   ▼
analyzed_at IS NULL  ← 部分索引 idx_items_pending 只索引这部分
   │
   ▼
Analyst（冷启动）
   上下文 = 关注画像 + 活跃事件 + 本批条目 + 近期反馈（代码组装）
   工具 = upsert_story（唯一写口）
   ▼
stories + story_items
   │  updated_at > 上期简报时间
   ▼
Editor（冷启动）→ save_brief → briefs 表 + data/reports/*.md
   │
   ▼
Hono API → React 监控台 → 👍👎 → feedback 表 → 回流进 Analyst 下一轮
```

---

## 3. 数据模型

`packages/storage/src/schema.ts`，启动时幂等执行。

| 表 | 用途 | 关键约束 |
|---|---|---|
| `items` | 采集到的最小材料单元 | `UNIQUE(source_id, guid)` 源内去重；`idx_items_pending` 是 `WHERE analyzed_at IS NULL` 的**部分索引** |
| `stories` | 跨源聚合的事件 | `status` ∈ emerging/developing/resolved，`score` 1-10 |
| `story_items` | 事件 ↔ 条目多对多 | 复合主键，`INSERT OR IGNORE` 幂等 |
| `briefs` | 简报 | `story_ids` 存 JSON 数组 |
| `feedback` | 用户反馈 | **一个事件最多一行**，`setFeedback` 先删后插 |
| `source_health` | 源健康度 | 成功清零 `fail_count`，失败累加 |
| `agent_runs` | 每轮运行记录 | 含 token 用量与起止时间 |

### 时间字段一律用 ISO 字符串

SQLite 无原生日期类型。全库统一存 `new Date().toISOString()`，
字典序即时间序，可以直接用 `>` / `ORDER BY` 比较。

---

## 4. StoragePort 契约

`packages/core/src/ports.ts`。几个**语义上容易踩错**的方法：

| 方法 | 语义 | 注意 |
|---|---|---|
| `insertItems` | 批量插入，返回**实际新增数** | 重复 guid 被忽略，不报错 |
| `markSourceAnalyzed` | 把某源全部未分析条目标记已分析 | 只在**首次抓取**调用，否则会吞掉真实新条目 |
| `capPendingForSource(id, keep)` | 只保留最新 keep 条待分析，返回丢弃数 | 按 `COALESCE(published_at, fetched_at)` 排序 |
| `setFeedback` | 设置反馈，**覆盖**而非追加 | 幂等，重复提交不堆积 |
| `searchStories` | 带搜索/筛选/分页 | LIKE 通配符已转义，搜 `%` 不会匹配一切 |
| `listStoriesUpdatedSince` | 取某时刻后有更新的事件 | Editor 用它决定本期简报范围 |

---

## 5. Agent 运行机制

### 冷启动，状态在库不在会话

`packages/agents/src/run-agent.ts` 的 `runOneShotAgent`：每轮都
`new Agent({...})`，没有会话历史。上下文由代码从 SQLite 现场组装。

好处：token 可控、行为可复现、崩了重跑结果一致，不会"聊久了跑偏"。

### 工具是唯一副作用出口

| 角色 | 工具 | 参数校验 |
|---|---|---|
| Analyst | `upsert_story` | `score` 由 schema 卡 1-10；`story_id` 不存在时抛错回告模型；`item_ids` **硬过滤**，不在本批次的直接丢弃 |
| Editor | `save_brief` | 带 `terminate: true`，调用即结束本轮 |

**校验写在工具实现里，不写在提示词里。** 提示词能被绕过，
`analyst.ts` 里那行 `item_ids.filter(id => allowedItemIds.has(id))` 不能。

### 两个必须知道的兜底

1. **防死循环**（`analyst.ts`）：
   ```ts
   if (!(outcome.error && toolCalls === 0)) storage.markItemsAnalyzed(...)
   ```
   正常跑完就标记消化，哪怕一个事件都没归档——否则无关条目会被反复分析、
   无限烧钱。只有**整轮失败且一次工具都没调**才保留待重试。
   配合 `MAX_BATCHES = 10` 的批次上限，成本有硬顶。

2. **Editor 兜底存盘**（`editor.ts`）：模型没调工具但吐了 200 字以上正文时
   直接入库。防 token 白花，但**等于绕过了工具这道闸**——务实的妥协，
   改动这块时要知道它在。

### 模型接入

`runtime.ts` 用 pi-ai 的 `createProvider()` 接任意 OpenAI 兼容端点，
`compat` 关掉 developer role 与 reasoning_effort 以兼容中转/本地服务。

> **思维链默认关闭，但对原生推理模型是"关不掉"的。**
> `runtime.ts` 里 `reasoning: false` 会让 `getSupportedThinkingLevels()`
> 只返回 `["off"]`，把任何 `thinkingLevel` clamp 回 off——所以**只改
> `run-agent.ts` 的 `thinkingLevel` 不会生效**。要真正启用需同时改三处：
> `runtime.ts` 的 `reasoning`、`compat.supportsReasoningEffort`，
> 以及 `run-agent.ts` 的 `thinkingLevel`。

---

## 6. HTTP API

`packages/server/src/api.ts`。只读为主，写操作只有反馈。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/overview` | 概览 + 调度信息（`nextCollectAt` / `nextBriefAt` / `busy`），CLI 模式下调度字段为 `null` |
| GET | `/api/briefs?limit=` | 简报列表 |
| GET | `/api/briefs/:id` | 单期简报 |
| GET | `/api/stories?q=&status=&minScore=&limit=&offset=` | 事件分页查询，返回 `{stories, total}` |
| GET | `/api/stories/:id` | 事件详情（含条目时间线与反馈） |
| POST | `/api/stories/:id/feedback` | 提交反馈，**幂等**；body `{verdict:"up"\|"down", comment?}` |
| DELETE | `/api/stories/:id/feedback` | 撤销反馈 |
| GET | `/api/sources` | 信息源 + 健康度 |
| GET | `/api/runs?limit=` | agent 运行记录 |

错误一律返回 `{error: "中文说明"}`，前端会把它透出给用户。

---

## 7. 前端约定

`packages/web`，React + Vite，只与 HTTP API 交互。

- **`hooks.ts` 的 `useAsync`** 是所有数据加载的统一入口：首次加载态 /
  后台刷新态 / 错误态 / 定时轮询 / 竞态丢弃。刷新失败时**保留上次数据**，
  页面退化成"数据略旧"而不是"整片空白"。
- **`refreshToken`**：App 持有一个计数器，点"刷新"时 +1 并传给各视图，
  视图把它放进 `useAsync` 依赖里。否则"刷新"只会更新侧栏。
- **标签放在 URL hash**（`#/stories`）：可收藏、可分享、浏览器前进后退可用。
- **简报正文必须过 `Markdown` 组件**（`components/common.tsx`）。
  链路是 RSS 不可信输入 → 模型 → HTML，DOMPurify 那一层不能省。
- 主题跟随系统：CSS 变量默认深色，`prefers-color-scheme: light` 覆盖成浅色。

---

## 8. 怎么扩展

### 加一个新信息源

改 `config/argus.yaml` 即可，不用动代码。走自建实例的话用镜像组：

```yaml
mirrors:
  rsshub: ["https://主地址", "https://备用地址"]
sources:
  - id: x-someone
    name: X @someone
    type: rss
    url: "{rsshub}/twitter/user/someone"
    enabled: true
```

### 加一种新的 source type（如网页快照）

1. `core/types.ts`：扩展 `SourceType` 联合类型
2. `collector/`：加对应抓取实现，产出同样的 `NewItem[]`
3. `collector/index.ts`：按 `source.type` 分派

入库、去重、基线、积压上限全部复用，不用改。

### 实现推送通道（M2）

`core/ports.ts` 里 `ChannelPort` 已定义好（`sendBrief` / `sendAlert`）：

1. 新建 `packages/channels/`，实现该接口（Telegram / Apprise / 邮件）
2. `server/src/pipeline.ts`：`runBrief` 产出简报后调用
3. `server/src/config.ts`：加通道配置与密钥读取
4. 即时警报：在 `runAnalyze` 后检查 `score >= alertThreshold` 的新事件，
   注意避开 `schedule.quietHours`

核心管线一行不用改——这正是端口接口预留的意义。

### 加一个新 agent（如 M3 的 Researcher）

1. `agents/` 下新建文件，仿 `analyst.ts` 的结构
2. 定义它的工具集。**如果需要读能力**（搜索、抓正文、查历史事件），
   这会是项目里第一次给模型读工具——参见 DESIGN.md §0.5，
   `StoragePort` 的读接口已就位
3. `core/types.ts`：`AgentRunLog["role"]` 加上新角色
4. `web/components/RunsView.tsx`：`ROLE_LABEL` 补中文名
5. `server/src/pipeline.ts`：接进管线；`scheduler.ts`：决定触发时机

---

## 9. 本地开发

```bash
npm run check          # 全量类型检查（node 侧 + web 侧）
npm run argus -- run   # 跑一轮完整管线
npm run serve          # 常驻：调度器 + API + 静态前端
npm run dev:web        # 前端热更新（需另开 npm run serve）
```

### 验证改动的实用手法

- **不碰生产库跑真实采集**：`new SqliteStorage(":memory:")` 注进
  `collectSources`，走真实网络但不写 `data/argus.db`
- **无头验证前端**：本机装了 Chrome 的话
  ```bash
  google-chrome --headless --disable-gpu --virtual-time-budget=6000 \
    --window-size=1440,900 --screenshot=out.png "http://127.0.0.1:8787/#/stories"
  ```
  加 `--dump-dom` 可以直接 grep 渲染结果；
  `--blink-settings=preferredColorScheme=0` 可强制深色

### 单实例约束

SQLite + 内存里的 `busy` 锁做互斥，**同时跑两个 `serve` 会打架**——
第二个会以 `EADDRINUSE` 退出，这是保护而不是 bug。
