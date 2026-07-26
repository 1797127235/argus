import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
	AgentRunLog,
	Brief,
	FeedbackEntry,
	Item,
	NewItem,
	SourceHealth,
	StoragePort,
	Story,
	StoryStatus,
	StoryWithItems,
} from "@argus/core";
import { SCHEMA } from "./schema.js";

function now(): string {
	return new Date().toISOString();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToItem(r: any): Item {
	return {
		id: Number(r.id),
		sourceId: String(r.source_id),
		guid: String(r.guid),
		url: String(r.url),
		title: String(r.title),
		content: String(r.content),
		publishedAt: r.published_at === null ? null : String(r.published_at),
		fetchedAt: String(r.fetched_at),
		analyzedAt: r.analyzed_at === null ? null : String(r.analyzed_at),
	};
}

function rowToStory(r: any): Story {
	return {
		id: Number(r.id),
		title: String(r.title),
		summary: String(r.summary),
		status: String(r.status) as Story["status"],
		score: Number(r.score),
		createdAt: String(r.created_at),
		updatedAt: String(r.updated_at),
	};
}

function rowToBrief(r: any): Brief {
	return {
		id: Number(r.id),
		content: String(r.content),
		storyIds: JSON.parse(String(r.story_ids)) as number[],
		createdAt: String(r.created_at),
	};
}

/** StoragePort 的 SQLite 实现，基于 Node 内置 node:sqlite，无原生编译依赖 */
export class SqliteStorage implements StoragePort {
	private db: DatabaseSync;

	constructor(dbPath: string) {
		if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
		this.db = new DatabaseSync(dbPath);
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec(SCHEMA);
	}

	// ---- 条目 ----

	insertItems(items: NewItem[]): number {
		const stmt = this.db.prepare(
			`INSERT OR IGNORE INTO items (source_id, guid, url, title, content, published_at, fetched_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);
		let inserted = 0;
		const ts = now();
		for (const it of items) {
			const res = stmt.run(it.sourceId, it.guid, it.url, it.title, it.content, it.publishedAt, ts);
			inserted += Number(res.changes);
		}
		return inserted;
	}

	listPendingItems(limit: number): Item[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM items WHERE analyzed_at IS NULL
				 ORDER BY COALESCE(published_at, fetched_at) ASC LIMIT ?`,
			)
			.all(limit);
		return rows.map(rowToItem);
	}

	countPendingItems(): number {
		const r = this.db.prepare("SELECT COUNT(*) AS n FROM items WHERE analyzed_at IS NULL").get() as any;
		return Number(r.n);
	}

	getItems(ids: number[]): Item[] {
		if (ids.length === 0) return [];
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.db.prepare(`SELECT * FROM items WHERE id IN (${placeholders})`).all(...ids);
		return rows.map(rowToItem);
	}

	markItemsAnalyzed(ids: number[]): void {
		if (ids.length === 0) return;
		const placeholders = ids.map(() => "?").join(",");
		this.db.prepare(`UPDATE items SET analyzed_at = ? WHERE id IN (${placeholders})`).run(now(), ...ids);
	}

	markSourceAnalyzed(sourceId: string): void {
		this.db
			.prepare("UPDATE items SET analyzed_at = ? WHERE source_id = ? AND analyzed_at IS NULL")
			.run(now(), sourceId);
	}

	sourceItemCount(sourceId: string): number {
		const r = this.db.prepare("SELECT COUNT(*) AS n FROM items WHERE source_id = ?").get(sourceId) as any;
		return Number(r.n);
	}

	// ---- 事件 ----

	listActiveStories(): Story[] {
		const rows = this.db
			.prepare("SELECT * FROM stories WHERE status != 'resolved' ORDER BY updated_at DESC")
			.all();
		return rows.map(rowToStory);
	}

	listStories(limit: number): Story[] {
		const rows = this.db.prepare("SELECT * FROM stories ORDER BY updated_at DESC LIMIT ?").all(limit);
		return rows.map(rowToStory);
	}

	getStory(id: number): Story | null {
		const r = this.db.prepare("SELECT * FROM stories WHERE id = ?").get(id);
		return r ? rowToStory(r) : null;
	}

	getStoryWithItems(id: number): StoryWithItems | null {
		const story = this.getStory(id);
		if (!story) return null;
		const items = this.db
			.prepare(
				`SELECT i.* FROM items i JOIN story_items si ON si.item_id = i.id
				 WHERE si.story_id = ? ORDER BY COALESCE(i.published_at, i.fetched_at) ASC`,
			)
			.all(id)
			.map(rowToItem);
		const feedback = this.db
			.prepare("SELECT * FROM feedback WHERE story_id = ? ORDER BY created_at DESC")
			.all(id)
			.map(
				(r: any): FeedbackEntry => ({
					id: Number(r.id),
					storyId: Number(r.story_id),
					verdict: String(r.verdict) as "up" | "down",
					comment: r.comment === null ? null : String(r.comment),
					createdAt: String(r.created_at),
				}),
			);
		return { story, items, feedback };
	}

	createStory(input: { title: string; summary: string; status: StoryStatus; score: number }): Story {
		const ts = now();
		const res = this.db
			.prepare("INSERT INTO stories (title, summary, status, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run(input.title, input.summary, input.status, input.score, ts, ts);
		return this.getStory(Number(res.lastInsertRowid)) as Story;
	}

	updateStory(
		id: number,
		patch: Partial<{ title: string; summary: string; status: StoryStatus; score: number }>,
	): void {
		const current = this.getStory(id);
		if (!current) throw new Error(`事件不存在: #${id}`);
		this.db
			.prepare("UPDATE stories SET title = ?, summary = ?, status = ?, score = ?, updated_at = ? WHERE id = ?")
			.run(
				patch.title ?? current.title,
				patch.summary ?? current.summary,
				patch.status ?? current.status,
				patch.score ?? current.score,
				now(),
				id,
			);
	}

	attachItemsToStory(storyId: number, itemIds: number[]): void {
		const stmt = this.db.prepare("INSERT OR IGNORE INTO story_items (story_id, item_id) VALUES (?, ?)");
		for (const itemId of itemIds) stmt.run(storyId, itemId);
		this.db.prepare("UPDATE stories SET updated_at = ? WHERE id = ?").run(now(), storyId);
	}

	listStoriesUpdatedSince(iso: string): Story[] {
		const rows = this.db
			.prepare("SELECT * FROM stories WHERE updated_at >= ? ORDER BY score DESC, updated_at DESC")
			.all(iso);
		return rows.map(rowToStory);
	}

	// ---- 简报 ----

	saveBrief(content: string, storyIds: number[]): Brief {
		const res = this.db
			.prepare("INSERT INTO briefs (content, story_ids, created_at) VALUES (?, ?, ?)")
			.run(content, JSON.stringify(storyIds), now());
		return this.getBrief(Number(res.lastInsertRowid)) as Brief;
	}

	listBriefs(limit: number): Brief[] {
		const rows = this.db.prepare("SELECT * FROM briefs ORDER BY id DESC LIMIT ?").all(limit);
		return rows.map(rowToBrief);
	}

	getBrief(id: number): Brief | null {
		const r = this.db.prepare("SELECT * FROM briefs WHERE id = ?").get(id);
		return r ? rowToBrief(r) : null;
	}

	lastBriefAt(): string | null {
		const r = this.db.prepare("SELECT created_at FROM briefs ORDER BY id DESC LIMIT 1").get() as any;
		return r ? String(r.created_at) : null;
	}

	// ---- 反馈 ----

	addFeedback(storyId: number, verdict: "up" | "down", comment: string | null): void {
		this.db
			.prepare("INSERT INTO feedback (story_id, verdict, comment, created_at) VALUES (?, ?, ?, ?)")
			.run(storyId, verdict, comment, now());
	}

	listRecentFeedback(limit: number): (FeedbackEntry & { storyTitle: string })[] {
		const rows = this.db
			.prepare(
				`SELECT f.*, s.title AS story_title FROM feedback f
				 JOIN stories s ON s.id = f.story_id ORDER BY f.id DESC LIMIT ?`,
			)
			.all(limit);
		return rows.map((r: any) => ({
			id: Number(r.id),
			storyId: Number(r.story_id),
			verdict: String(r.verdict) as "up" | "down",
			comment: r.comment === null ? null : String(r.comment),
			createdAt: String(r.created_at),
			storyTitle: String(r.story_title),
		}));
	}

	// ---- 源健康 ----

	recordFetch(sourceId: string, ok: boolean, error: string | null): void {
		const ts = now();
		if (ok) {
			this.db
				.prepare(
					`INSERT INTO source_health (source_id, last_fetch_at, last_ok_at, last_error, fail_count)
					 VALUES (?, ?, ?, NULL, 0)
					 ON CONFLICT(source_id) DO UPDATE SET last_fetch_at = ?, last_ok_at = ?, last_error = NULL, fail_count = 0`,
				)
				.run(sourceId, ts, ts, ts, ts);
		} else {
			this.db
				.prepare(
					`INSERT INTO source_health (source_id, last_fetch_at, last_ok_at, last_error, fail_count)
					 VALUES (?, ?, NULL, ?, 1)
					 ON CONFLICT(source_id) DO UPDATE SET last_fetch_at = ?, last_error = ?, fail_count = fail_count + 1`,
				)
				.run(sourceId, ts, error, ts, error);
		}
	}

	listSourceHealth(): SourceHealth[] {
		const rows = this.db.prepare("SELECT * FROM source_health").all();
		return rows.map((r: any) => ({
			sourceId: String(r.source_id),
			lastFetchAt: r.last_fetch_at === null ? null : String(r.last_fetch_at),
			lastOkAt: r.last_ok_at === null ? null : String(r.last_ok_at),
			lastError: r.last_error === null ? null : String(r.last_error),
			failCount: Number(r.fail_count),
			itemCount: this.sourceItemCount(String(r.source_id)),
		}));
	}

	// ---- agent 运行记录 ----

	addAgentRun(run: Omit<AgentRunLog, "id">): void {
		this.db
			.prepare(
				`INSERT INTO agent_runs (role, summary, input_count, tool_calls, usage_input, usage_output, started_at, finished_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				run.role,
				run.summary,
				run.inputCount,
				run.toolCalls,
				run.usageInput,
				run.usageOutput,
				run.startedAt,
				run.finishedAt,
			);
	}

	listAgentRuns(limit: number): AgentRunLog[] {
		const rows = this.db.prepare("SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?").all(limit);
		return rows.map((r: any) => ({
			id: Number(r.id),
			role: String(r.role) as AgentRunLog["role"],
			summary: String(r.summary),
			inputCount: Number(r.input_count),
			toolCalls: Number(r.tool_calls),
			usageInput: r.usage_input === null ? null : Number(r.usage_input),
			usageOutput: r.usage_output === null ? null : Number(r.usage_output),
			startedAt: String(r.started_at),
			finishedAt: String(r.finished_at),
		}));
	}

	close(): void {
		this.db.close();
	}
}
