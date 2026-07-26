import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ArgusConfig, StoryStatus, StoragePort } from "@argus/core";
import { Hono } from "hono";
import { ROOT } from "./config.js";
import type { SchedulerHandle } from "./scheduler.js";

/** 把查询参数解析成正整数，非法或缺省时返回 fallback */
function intParam(raw: string | undefined, fallback: number, max: number): number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return fallback;
	return Math.min(Math.floor(n), max);
}

const STATUSES: StoryStatus[] = ["emerging", "developing", "resolved"];

/**
 * 监控层 HTTP API + 静态托管前端。只读为主，唯一的写操作是反馈。
 * scheduler 只在 serve 模式下存在，CLI 模式传 undefined。
 */
export function createApi(storage: StoragePort, config: ArgusConfig, scheduler?: SchedulerHandle): Hono {
	const app = new Hono();

	app.get("/api/overview", (c) => {
		const latest = storage.listBriefs(1);
		return c.json({
			pendingItems: storage.countPendingItems(),
			activeStories: storage.listActiveStories().length,
			latestBriefId: latest.length > 0 ? latest[0].id : null,
			lastBriefAt: storage.lastBriefAt(),
			sources: config.sources.filter((s) => s.enabled).length,
			// 源健康度：让"有几个源在报错"一眼可见，不用翻到信息源页
			failingSources: storage.listSourceHealth().filter((h) => h.failCount > 0).length,
			nextCollectAt: scheduler?.nextCollectAt() ?? null,
			nextBriefAt: scheduler?.nextBriefAt() ?? null,
			busy: scheduler?.isBusy() ?? false,
		});
	});

	app.get("/api/briefs", (c) => {
		const limit = Number(c.req.query("limit") ?? 20);
		return c.json(storage.listBriefs(limit));
	});

	app.get("/api/briefs/:id", (c) => {
		const brief = storage.getBrief(Number(c.req.param("id")));
		return brief ? c.json(brief) : c.json({ error: "不存在" }, 404);
	});

	app.get("/api/stories", (c) => {
		const statusRaw = c.req.query("status");
		const minScoreRaw = c.req.query("minScore");
		return c.json(
			storage.searchStories({
				query: c.req.query("q") || undefined,
				status: STATUSES.includes(statusRaw as StoryStatus) ? (statusRaw as StoryStatus) : undefined,
				minScore: minScoreRaw !== undefined && Number.isFinite(Number(minScoreRaw)) ? Number(minScoreRaw) : undefined,
				limit: intParam(c.req.query("limit"), 50, 200),
				offset: intParam(c.req.query("offset"), 0, 100000),
			}),
		);
	});

	app.get("/api/stories/:id", (c) => {
		const story = storage.getStoryWithItems(Number(c.req.param("id")));
		return story ? c.json(story) : c.json({ error: "不存在" }, 404);
	});

	// 幂等：同一事件重复提交是覆盖，不会堆出多条反馈
	app.post("/api/stories/:id/feedback", async (c) => {
		const id = Number(c.req.param("id"));
		if (!storage.getStory(id)) return c.json({ error: "不存在" }, 404);
		let body: { verdict?: string; comment?: string };
		try {
			body = (await c.req.json()) as typeof body;
		} catch {
			return c.json({ error: "请求体不是合法 JSON" }, 400);
		}
		if (body.verdict !== "up" && body.verdict !== "down") {
			return c.json({ error: "verdict 必须是 up 或 down" }, 400);
		}
		storage.setFeedback(id, body.verdict, body.comment?.trim() || null);
		return c.json({ ok: true, feedback: storage.getFeedback(id) });
	});

	// 撤销反馈：让用户能取消误点
	app.delete("/api/stories/:id/feedback", (c) => {
		const id = Number(c.req.param("id"));
		if (!storage.getStory(id)) return c.json({ error: "不存在" }, 404);
		storage.clearFeedback(id);
		return c.json({ ok: true });
	});

	app.get("/api/sources", (c) => {
		const health = new Map(storage.listSourceHealth().map((h) => [h.sourceId, h]));
		return c.json(
			config.sources.map((s) => ({
				...s,
				health: health.get(s.id) ?? null,
			})),
		);
	});

	app.get("/api/runs", (c) => {
		const limit = Number(c.req.query("limit") ?? 30);
		return c.json(storage.listAgentRuns(limit));
	});

	// 生产模式：托管构建好的前端；未构建时给出提示
	const webDist = join(ROOT, "packages", "web", "dist");
	if (existsSync(webDist)) {
		app.use("/*", serveStatic({ root: "packages/web/dist" }));
		app.get("*", serveStatic({ root: "packages/web/dist", path: "index.html" }));
	} else {
		app.get("/", (c) =>
			c.text("Argus 前端尚未构建：先运行 npm run build:web，或开发模式下使用 npm run dev:web"),
		);
	}

	return app;
}
