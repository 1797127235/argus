import type { Brief, StoragePort } from "@argus/core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { runOneShotAgent } from "./run-agent.js";
import type { AgentRuntime } from "./runtime.js";

const EDITOR_SYSTEM_PROMPT = `你是 Argus 的主编。Argus 是一个个人信息监控系统，你的职责是把一段时间内的事件动态合成一期高信息密度的中文简报。

写作要求：
1. 简报是"合成后的叙事"，不是链接列表。要说清每个事件发生了什么、最新进展、为什么值得主人关注。
2. 结构（Markdown）：
   - 一级标题：「Argus 简报 · <日期>」
   - 「今日要点」：3-6 条一句话速览
   - 「重点事件」：按重要度排序。每个事件用二级标题（标题后标注评分，如「（8/10）」），正文两三段内讲清进展与意义，段末列出来源链接（Markdown 链接格式，用条目原始 url）
   - 「其他动态」：低分事件一句话带过，附链接
3. 每条结论都必须能对应到给定材料里的来源链接，不得编造材料之外的信息或链接。
4. 语言干净利落，不堆砌形容词，不写空话。
5. 写完后调用 save_brief 保存，markdown 参数就是完整简报正文。只调用一次。`;

export interface EditorRunResult {
	brief: Brief | null;
	storiesCovered: number;
	usage: { input: number; output: number } | null;
	error: string | null;
}

/**
 * 跑一轮 Editor：取上次简报以来有更新的事件，合成一期中文简报入库。
 * 没有可写的事件时返回 null。
 */
export async function runEditor(options: {
	storage: StoragePort;
	runtime: AgentRuntime;
	interests: string;
}): Promise<EditorRunResult | null> {
	const { storage, runtime, interests } = options;

	// 上次简报之后有动静的事件才进入本期；从未出过简报则取最近全部
	const since = storage.lastBriefAt() ?? "1970-01-01T00:00:00.000Z";
	const stories = storage.listStoriesUpdatedSince(since);
	if (stories.length === 0) return null;

	let savedBrief: Brief | null = null;
	const storyIds = stories.map((s) => s.id);

	const saveBriefTool: AgentTool = {
		name: "save_brief",
		label: "保存简报",
		description: "保存写好的简报。markdown 参数为完整的简报正文（Markdown 格式，中文）。",
		parameters: Type.Object({
			markdown: Type.String({ description: "完整简报正文" }),
		}),
		execute: async (_toolCallId, params) => {
			const p = params as { markdown: string };
			savedBrief = storage.saveBrief(p.markdown.trim(), storyIds);
			return {
				content: [{ type: "text" as const, text: `简报 #${savedBrief.id} 已保存。` }],
				details: { briefId: savedBrief.id },
				terminate: true,
			};
		},
	};

	const material = stories.map((s) => {
		const full = storage.getStoryWithItems(s.id);
		return {
			id: s.id,
			title: s.title,
			status: s.status,
			score: s.score,
			summary: s.summary,
			条目: (full?.items ?? []).map((it) => ({
				title: it.title,
				source: it.sourceId,
				published: it.publishedAt,
				url: it.url,
			})),
		};
	});

	const today = new Date().toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	const userMessage = [
		"# 主人的关注画像",
		interests.trim(),
		"",
		`# 本期材料（${stories.length} 个事件，日期：${today}）`,
		JSON.stringify(material, null, 1),
		"",
		"请撰写本期简报并调用 save_brief 保存。",
	].join("\n");

	const outcome = await runOneShotAgent(runtime, {
		systemPrompt: EDITOR_SYSTEM_PROMPT,
		userMessage,
		tools: [saveBriefTool],
	});

	// 模型没调用工具但产出了正文时，兜底保存，避免整轮 token 白花
	if (!savedBrief && outcome.finalText.length > 200 && !outcome.error) {
		savedBrief = storage.saveBrief(outcome.finalText, storyIds);
	}

	return {
		brief: savedBrief,
		storiesCovered: stories.length,
		usage: outcome.usage,
		error: outcome.error,
	};
}
