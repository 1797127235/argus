/** 信息源类型。目前只有 RSS/Atom，后续可扩展网页快照、搜索查询等 */
export type SourceType = "rss";

/** 一个信息源的配置（来自 config/argus.yaml） */
export interface SourceConfig {
	/** 唯一标识，入库时作为条目的归属键 */
	id: string;
	/** 展示名称 */
	name: string;
	type: SourceType;
	url: string;
	enabled: boolean;
}

/** 调度配置：时间段与频率全部由用户配置 */
export interface ScheduleConfig {
	/** 采集 + 分析的轮询间隔（分钟） */
	collectIntervalMinutes: number;
	/** 每天生成简报的时刻，"HH:mm" 格式，可配多个 */
	briefTimes: string[];
	/** 免打扰时段（预留给未来的即时警报通道） */
	quietHours?: { start: string; end: string };
}

/** 分析行为配置 */
export interface AnalysisConfig {
	/** Analyst 单批处理的条目上限 */
	batchSize: number;
	/** 传给模型的条目摘要截断长度（字符） */
	excerptLength: number;
	/** 达到该评分视为重大事件（预留给即时警报） */
	alertThreshold: number;
}

/** Web 服务配置 */
export interface ServerConfig {
	host: string;
	port: number;
}

/** 主配置文件的完整结构 */
export interface ArgusConfig {
	sources: SourceConfig[];
	schedule: ScheduleConfig;
	analysis: AnalysisConfig;
	server: ServerConfig;
}

/** 采集层产出的新条目（尚未入库，无 id） */
export interface NewItem {
	sourceId: string;
	/** 源内唯一标识（guid/链接），与 sourceId 联合去重 */
	guid: string;
	url: string;
	title: string;
	/** 已剥离 HTML 的正文/摘要 */
	content: string;
	/** ISO 时间，源未提供时为 null */
	publishedAt: string | null;
}

/** 入库后的条目 */
export interface Item extends NewItem {
	id: number;
	fetchedAt: string;
	/** 非 null 表示已被 Analyst 处理过（或属于静默基线） */
	analyzedAt: string | null;
}

/** 事件生命周期状态 */
export type StoryStatus = "emerging" | "developing" | "resolved";

/** 事件（故事线）：跨源聚合的信息单元，Argus 的核心概念 */
export interface Story {
	id: number;
	title: string;
	/** 两三句话的中文摘要，随事件发展被 Analyst 更新 */
	summary: string;
	status: StoryStatus;
	/** 重要度 1-10 */
	score: number;
	createdAt: string;
	updatedAt: string;
}

export interface StoryWithItems {
	story: Story;
	items: Item[];
	feedback: FeedbackEntry[];
}

/** 一期简报 */
export interface Brief {
	id: number;
	/** Markdown 正文（中文） */
	content: string;
	/** 本期覆盖的事件 id 列表 */
	storyIds: number[];
	createdAt: string;
}

/** 用户对事件的反馈，供 Analyst 后续运行时参考 */
export interface FeedbackEntry {
	id: number;
	storyId: number;
	verdict: "up" | "down";
	comment: string | null;
	createdAt: string;
}

/** 一次 agent 运行的记录（监控层展示用） */
export interface AgentRunLog {
	id: number;
	role: "analyst" | "editor";
	/** agent 自己的一句话总结或系统生成的说明 */
	summary: string;
	/** 本轮输入的条目/事件数量 */
	inputCount: number;
	toolCalls: number;
	usageInput: number | null;
	usageOutput: number | null;
	startedAt: string;
	finishedAt: string;
}

/** 信息源健康状态 */
export interface SourceHealth {
	sourceId: string;
	lastFetchAt: string | null;
	lastOkAt: string | null;
	lastError: string | null;
	/** 连续失败次数 */
	failCount: number;
	itemCount: number;
}
