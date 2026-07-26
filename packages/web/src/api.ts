import type { AgentRunLog, Brief, SourceConfig, SourceHealth, Story, StoryWithItems } from "@argus/core";

/** 与 core 共享类型，运行时只通过 HTTP API 与后端交互 */

export interface Overview {
	pendingItems: number;
	activeStories: number;
	briefs: number;
	lastBriefAt: string | null;
	sources: number;
}

export type SourceWithHealth = SourceConfig & { health: SourceHealth | null };

async function get<T>(path: string): Promise<T> {
	const res = await fetch(path);
	if (!res.ok) throw new Error(`${path} 请求失败: ${res.status}`);
	return (await res.json()) as T;
}

export const api = {
	overview: () => get<Overview>("/api/overview"),
	briefs: () => get<Brief[]>("/api/briefs"),
	stories: () => get<Story[]>("/api/stories?limit=100"),
	story: (id: number) => get<StoryWithItems>(`/api/stories/${id}`),
	sources: () => get<SourceWithHealth[]>("/api/sources"),
	runs: () => get<AgentRunLog[]>("/api/runs"),
	feedback: async (storyId: number, verdict: "up" | "down", comment?: string) => {
		const res = await fetch(`/api/stories/${storyId}/feedback`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ verdict, comment }),
		});
		if (!res.ok) throw new Error("反馈提交失败");
	},
};

/** 相对时间的简易中文格式化 */
export function timeAgo(iso: string | null): string {
	if (!iso) return "—";
	const diff = Date.now() - new Date(iso).getTime();
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	return `${Math.floor(hours / 24)} 天前`;
}

export const STATUS_LABEL: Record<Story["status"], string> = {
	emerging: "新出现",
	developing: "发展中",
	resolved: "已平息",
};
