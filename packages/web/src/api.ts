import type {
	AgentRunLog,
	Brief,
	FeedbackEntry,
	SourceConfig,
	SourceHealth,
	Story,
	StoryPage,
	StoryStatus,
	StoryWithItems,
} from "@argus/core";

/** 与 core 共享类型，运行时只通过 HTTP API 与后端交互 */

export interface Overview {
	pendingItems: number;
	activeStories: number;
	latestBriefId: number | null;
	lastBriefAt: string | null;
	sources: number;
	/** 当前有几个源处于失败状态 */
	failingSources: number;
	/** 下次采集+分析时刻，CLI 模式下为 null */
	nextCollectAt: string | null;
	nextBriefAt: string | null;
	/** 调度器是否正在跑任务 */
	busy: boolean;
}

export type SourceWithHealth = SourceConfig & { health: SourceHealth | null };

export interface StoryFilters {
	q?: string;
	status?: StoryStatus | "";
	minScore?: number;
}

/** 后端返回的错误体，用于把 message 透出给用户而不是只显示状态码 */
interface ApiError {
	error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, init);
	} catch {
		// fetch 只有网络层失败才 reject，这里通常意味着后端没在跑
		throw new Error("连接不上后端，确认 npm run serve 正在运行");
	}
	if (!res.ok) {
		let detail = "";
		try {
			detail = ((await res.json()) as ApiError).error ?? "";
		} catch {
			/* 响应体不是 JSON，忽略 */
		}
		throw new Error(detail || `请求失败（HTTP ${res.status}）`);
	}
	return (await res.json()) as T;
}

function buildQuery(filters: StoryFilters, limit: number, offset: number): string {
	const params = new URLSearchParams();
	if (filters.q?.trim()) params.set("q", filters.q.trim());
	if (filters.status) params.set("status", filters.status);
	if (filters.minScore) params.set("minScore", String(filters.minScore));
	params.set("limit", String(limit));
	params.set("offset", String(offset));
	return params.toString();
}

export const api = {
	overview: () => request<Overview>("/api/overview"),
	briefs: () => request<Brief[]>("/api/briefs"),
	stories: (filters: StoryFilters = {}, limit = 50, offset = 0) =>
		request<StoryPage>(`/api/stories?${buildQuery(filters, limit, offset)}`),
	story: (id: number) => request<StoryWithItems>(`/api/stories/${id}`),
	sources: () => request<SourceWithHealth[]>("/api/sources"),
	runs: () => request<AgentRunLog[]>("/api/runs"),
	setFeedback: (storyId: number, verdict: "up" | "down", comment?: string) =>
		request<{ ok: true; feedback: FeedbackEntry }>(`/api/stories/${storyId}/feedback`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ verdict, comment }),
		}),
	clearFeedback: (storyId: number) =>
		request<{ ok: true }>(`/api/stories/${storyId}/feedback`, { method: "DELETE" }),
};

/** 相对时间的简易中文格式化，支持未来时间（用于"下次采集"） */
export function timeAgo(iso: string | null): string {
	if (!iso) return "—";
	const diff = Date.now() - new Date(iso).getTime();
	const future = diff < 0;
	const minutes = Math.floor(Math.abs(diff) / 60000);
	if (minutes < 1) return future ? "即将" : "刚刚";
	const suffix = future ? "后" : "前";
	if (minutes < 60) return `${minutes} 分钟${suffix}`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时${suffix}`;
	return `${Math.floor(hours / 24)} 天${suffix}`;
}

/** 绝对时刻，用于 title 属性上的精确值 */
export function absTime(iso: string | null): string {
	return iso ? new Date(iso).toLocaleString("zh-CN") : "—";
}

/** 毫秒时长 → "1分23秒" / "820毫秒" */
export function duration(startedAt: string, finishedAt: string): string {
	const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
	if (!Number.isFinite(ms) || ms < 0) return "—";
	if (ms < 1000) return `${ms} 毫秒`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds} 秒`;
	return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export const STATUS_LABEL: Record<StoryStatus, string> = {
	emerging: "新出现",
	developing: "发展中",
	resolved: "已平息",
};
