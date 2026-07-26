import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ArgusConfig, StoragePort } from "@argus/core";
import { Hono } from "hono";
import { ROOT } from "./config.js";

/** 监控层 HTTP API + 静态托管前端。只读为主，唯一的写操作是反馈 */
export function createApi(storage: StoragePort, config: ArgusConfig): Hono {
	const app = new Hono();

	app.get("/api/overview", (c) =>
		c.json({
			pendingItems: storage.countPendingItems(),
			activeStories: storage.listActiveStories().length,
			briefs: storage.listBriefs(1).length > 0 ? storage.listBriefs(1)[0].id : 0,
			lastBriefAt: storage.lastBriefAt(),
			sources: config.sources.filter((s) => s.enabled).length,
		}),
	);

	app.get("/api/briefs", (c) => {
		const limit = Number(c.req.query("limit") ?? 20);
		return c.json(storage.listBriefs(limit));
	});

	app.get("/api/briefs/:id", (c) => {
		const brief = storage.getBrief(Number(c.req.param("id")));
		return brief ? c.json(brief) : c.json({ error: "不存在" }, 404);
	});

	app.get("/api/stories", (c) => {
		const limit = Number(c.req.query("limit") ?? 50);
		return c.json(storage.listStories(limit));
	});

	app.get("/api/stories/:id", (c) => {
		const story = storage.getStoryWithItems(Number(c.req.param("id")));
		return story ? c.json(story) : c.json({ error: "不存在" }, 404);
	});

	app.post("/api/stories/:id/feedback", async (c) => {
		const id = Number(c.req.param("id"));
		if (!storage.getStory(id)) return c.json({ error: "不存在" }, 404);
		const body = (await c.req.json()) as { verdict?: string; comment?: string };
		if (body.verdict !== "up" && body.verdict !== "down") {
			return c.json({ error: "verdict 必须是 up 或 down" }, 400);
		}
		storage.addFeedback(id, body.verdict, body.comment?.trim() || null);
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
