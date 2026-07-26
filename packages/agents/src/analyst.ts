import type { StoragePort, Story } from "@argus/core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { runOneShotAgent } from "./run-agent.js";
import type { AgentRuntime } from "./runtime.js";

const ANALYST_SYSTEM_PROMPT = `你是 Argus 的情报分析师。Argus 是一个个人信息监控系统，你的职责是把新抓取的原始条目消化成有价值的"事件"（Story）。

工作规则：
1. 逐条阅读新条目，对照"关注画像"判断是否值得主人关注。与画像无关的条目直接忽略，不要为它调用任何工具。
2. 值得关注的条目：优先归入语义上属于同一事件的现有活跃事件（调用 upsert_story 时传 story_id）；确实是新话题才新建事件。多条报道同一件事必须归入同一个事件，绝不为同一件事建两个事件。
3. 每次调用 upsert_story 都要给出事件当前的最新标题、摘要（两三句中文，说清发生了什么、最新进展是什么）、状态和重要度。
4. 重要度 1-10：1-3 例行动态；4-6 值得留意；7-8 重要进展；9-10 重大事件（重量级模型发布、行业格局变化级别）。给分要克制，9 分以上极少出现。
5. 状态：emerging（刚出现）/ developing（持续发展中）/ resolved（已尘埃落定）。
6. 如果有用户反馈记录，认真参考：用户点过 👎 的同类内容以后倾向忽略或降分，点过 👍 的同类内容倾向关注。
7. 全部处理完后不要再调用工具，用一两句中文总结本轮：处理了多少条、归入/新建了哪些事件、忽略了大约多少条及原因。`;

export interface AnalystRunResult {
	/** 本轮消化的条目数 */
	processed: number;
	toolCalls: number;
	/** 触碰过的事件 id */
	storiesTouched: number[];
	/** agent 的总结文本 */
	summary: string;
	usage: { input: number; output: number } | null;
	error: string | null;
}

/**
 * 跑一轮 Analyst：读取未分析条目 → agent 聚类归档 → 批次全部标记已分析。
 * 无待处理条目时返回 null。
 */
export async function runAnalyst(options: {
	storage: StoragePort;
	runtime: AgentRuntime;
	/** 关注画像全文（memory/interests.md） */
	interests: string;
	/** 格式化好的近期用户反馈，可为空字符串 */
	feedbackContext: string;
	batchSize: number;
	excerptLength: number;
}): Promise<AnalystRunResult | null> {
	const { storage, runtime, interests, feedbackContext, batchSize, excerptLength } = options;

	const pending = storage.listPendingItems(batchSize);
	if (pending.length === 0) return null;

	const activeStories = storage.listActiveStories();
	const allowedItemIds = new Set(pending.map((it) => it.id));
	const storiesTouched = new Set<number>();
	let toolCalls = 0;

	// 唯一的副作用出口：agent 通过该工具写入事件库，参数在这里校验
	const upsertStoryTool: AgentTool = {
		name: "upsert_story",
		label: "归档事件",
		description:
			"创建新事件或更新现有事件，并把相关的新条目归入该事件。更新现有事件时传 story_id；新建时省略。",
		parameters: Type.Object({
			story_id: Type.Optional(Type.Number({ description: "要更新的现有事件 id；新建事件时省略" })),
			title: Type.String({ description: "事件标题，中文，简洁有信息量" }),
			summary: Type.String({ description: "事件最新摘要，两三句中文" }),
			status: Type.Union(
				[Type.Literal("emerging"), Type.Literal("developing"), Type.Literal("resolved")],
				{ description: "事件状态" },
			),
			score: Type.Number({ minimum: 1, maximum: 10, description: "重要度 1-10" }),
			item_ids: Type.Array(Type.Number(), { description: "归入该事件的新条目 id 列表" }),
		}),
		execute: async (_toolCallId, params) => {
			toolCalls += 1;
			const p = params as {
				story_id?: number;
				title: string;
				summary: string;
				status: Story["status"];
				score: number;
				item_ids: number[];
			};
			const validItemIds = p.item_ids.filter((id) => allowedItemIds.has(id));
			const droppedCount = p.item_ids.length - validItemIds.length;

			let story: Story;
			if (p.story_id !== undefined) {
				const existing = storage.getStory(p.story_id);
				if (!existing) {
					throw new Error(`事件 #${p.story_id} 不存在。更新前请确认活跃事件列表里的 id，或省略 story_id 新建事件。`);
				}
				storage.updateStory(p.story_id, {
					title: p.title,
					summary: p.summary,
					status: p.status,
					score: p.score,
				});
				story = storage.getStory(p.story_id) as Story;
			} else {
				story = storage.createStory({
					title: p.title,
					summary: p.summary,
					status: p.status,
					score: p.score,
				});
			}
			if (validItemIds.length > 0) storage.attachItemsToStory(story.id, validItemIds);
			storiesTouched.add(story.id);

			let note = `事件 #${story.id}「${story.title}」已${p.story_id !== undefined ? "更新" : "创建"}，归入 ${validItemIds.length} 条。`;
			if (droppedCount > 0) note += ` 注意：${droppedCount} 个条目 id 不在本批次内，已忽略。`;
			return {
				content: [{ type: "text" as const, text: note }],
				details: { storyId: story.id, itemIds: validItemIds },
			};
		},
	};

	const userMessage = [
		"# 关注画像",
		interests.trim(),
		"",
		feedbackContext.trim() ? `# 近期用户反馈\n${feedbackContext.trim()}\n` : "",
		"# 当前活跃事件",
		activeStories.length > 0
			? JSON.stringify(
					activeStories.map((s) => ({
						id: s.id,
						title: s.title,
						status: s.status,
						score: s.score,
						summary: s.summary,
					})),
					null,
					1,
				)
			: "（暂无活跃事件）",
		"",
		`# 新条目（共 ${pending.length} 条）`,
		JSON.stringify(
			pending.map((it) => ({
				id: it.id,
				source: it.sourceId,
				title: it.title,
				published: it.publishedAt,
				excerpt: it.content.slice(0, excerptLength),
				url: it.url,
			})),
			null,
			1,
		),
		"",
		"请开始分析。",
	].join("\n");

	const outcome = await runOneShotAgent(runtime, {
		systemPrompt: ANALYST_SYSTEM_PROMPT,
		userMessage,
		tools: [upsertStoryTool],
	});

	// 无论 agent 是否归档，本批条目都视为已消化，避免死循环重复分析；
	// 但如果整轮直接失败（一次工具都没调、又有错误），保留待分析状态供下轮重试
	if (!(outcome.error && toolCalls === 0)) {
		storage.markItemsAnalyzed(pending.map((it) => it.id));
	}

	return {
		processed: pending.length,
		toolCalls,
		storiesTouched: [...storiesTouched],
		summary: outcome.finalText || "（agent 未给出总结）",
		usage: outcome.usage,
		error: outcome.error,
	};
}
