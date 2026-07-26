import type {
	AgentRunLog,
	Brief,
	FeedbackEntry,
	Item,
	NewItem,
	SourceHealth,
	Story,
	StoryPage,
	StoryQuery,
	StoryStatus,
	StoryWithItems,
} from "./types.js";

/**
 * 存储端口：所有持久化操作的唯一入口。
 * core 只定义接口，具体实现（SQLite）在 @argus/storage；
 * collector 与 agents 只依赖本接口，不认识任何数据库。
 */
export interface StoragePort {
	// ---- 条目 ----
	/** 批量插入，源内按 guid 去重，返回实际新增数 */
	insertItems(items: NewItem[]): number;
	/** 未分析条目（按发布时间升序），供 Analyst 消化 */
	listPendingItems(limit: number): Item[];
	countPendingItems(): number;
	getItems(ids: number[]): Item[];
	markItemsAnalyzed(ids: number[]): void;
	/** 把某个源的全部未分析条目直接标记为已分析（静默基线用） */
	markSourceAnalyzed(sourceId: string): void;
	/**
	 * 只保留某个源最新的 keep 条待分析条目，更旧的静默标记为已分析。
	 * 返回被丢弃的条数。用于给 backlog 突增兜底。
	 */
	capPendingForSource(sourceId: string, keep: number): number;
	sourceItemCount(sourceId: string): number;

	// ---- 事件 ----
	listActiveStories(): Story[];
	listStories(limit: number): Story[];
	/** 带搜索/筛选/分页的事件查询，供监控台使用 */
	searchStories(query: StoryQuery): StoryPage;
	getStory(id: number): Story | null;
	getStoryWithItems(id: number): StoryWithItems | null;
	createStory(input: { title: string; summary: string; status: StoryStatus; score: number }): Story;
	updateStory(
		id: number,
		patch: Partial<{ title: string; summary: string; status: StoryStatus; score: number }>,
	): void;
	attachItemsToStory(storyId: number, itemIds: number[]): void;
	listStoriesUpdatedSince(iso: string): Story[];

	// ---- 简报 ----
	saveBrief(content: string, storyIds: number[]): Brief;
	listBriefs(limit: number): Brief[];
	getBrief(id: number): Brief | null;
	lastBriefAt(): string | null;

	// ---- 反馈 ----
	/**
	 * 设置用户对某事件的反馈。单用户系统，一个事件只保留一条：
	 * 重复提交是覆盖而非追加，因此接口天然幂等。
	 */
	setFeedback(storyId: number, verdict: "up" | "down", comment: string | null): void;
	/** 取某事件的反馈，没有则为 null */
	getFeedback(storyId: number): FeedbackEntry | null;
	/** 撤销某事件的反馈 */
	clearFeedback(storyId: number): void;
	listRecentFeedback(limit: number): (FeedbackEntry & { storyTitle: string })[];

	// ---- 源健康 ----
	recordFetch(sourceId: string, ok: boolean, error: string | null): void;
	listSourceHealth(): SourceHealth[];

	// ---- agent 运行记录 ----
	addAgentRun(run: Omit<AgentRunLog, "id">): void;
	listAgentRuns(limit: number): AgentRunLog[];

	close(): void;
}

/**
 * 推送通道端口（悬置中）：通道未定，先只定义接口。
 * 将来 Telegram/Apprise/邮件等实现该接口即可接入，核心管线不改。
 */
export interface ChannelPort {
	/** 推送一期简报 */
	sendBrief(brief: Brief): Promise<void>;
	/** 推送重大事件警报 */
	sendAlert(story: Story, reason: string): Promise<void>;
}
