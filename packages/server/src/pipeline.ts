import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentRuntime, runAnalyst, runEditor } from "@argus/agents";
import { collectSources, type CollectResult } from "@argus/collector";
import type { ArgusConfig, StoragePort } from "@argus/core";
import { loadInterests, loadModelSettings, ROOT } from "./config.js";

/**
 * 管线编排：把 collector / agents 粘起来。
 * 这里是确定性代码与 agent 判断的分界线——调度、批次、落盘在这边，
 * 相关性、聚类、写作在 agent 那边。
 */

export async function runCollect(storage: StoragePort, config: ArgusConfig): Promise<CollectResult[]> {
	const results = await collectSources(storage, config.sources);
	for (const r of results) {
		if (!r.ok) {
			console.log(`  ✗ ${r.name}: ${r.error}`);
		} else if (r.baseline) {
			console.log(`  ○ ${r.name}: 首次抓取，建立静默基线（${r.newItems} 条历史不进入分析）`);
		} else {
			console.log(`  ✓ ${r.name}: 新增 ${r.newItems} 条`);
		}
	}
	return results;
}

export async function runAnalyze(storage: StoragePort, config: ArgusConfig): Promise<void> {
	const pendingTotal = storage.countPendingItems();
	if (pendingTotal === 0) {
		console.log("  没有待分析条目");
		return;
	}
	const runtime = createAgentRuntime(loadModelSettings("analyst"));
	const interests = loadInterests();
	const feedbackContext = storage
		.listRecentFeedback(20)
		.map((f) => `- 用户对「${f.storyTitle}」点了 ${f.verdict === "up" ? "👍" : "👎"}${f.comment ? `，备注：${f.comment}` : ""}`)
		.join("\n");

	// 分批消化，设批次上限防失控
	const MAX_BATCHES = 10;
	for (let batch = 0; batch < MAX_BATCHES; batch++) {
		const startedAt = new Date().toISOString();
		const result = await runAnalyst({
			storage,
			runtime,
			interests,
			feedbackContext,
			batchSize: config.analysis.batchSize,
			excerptLength: config.analysis.excerptLength,
		});
		if (!result) break;
		storage.addAgentRun({
			role: "analyst",
			summary: result.error ? `出错：${result.error}` : result.summary,
			inputCount: result.processed,
			toolCalls: result.toolCalls,
			usageInput: result.usage?.input ?? null,
			usageOutput: result.usage?.output ?? null,
			startedAt,
			finishedAt: new Date().toISOString(),
		});
		if (result.error) {
			console.log(`  ✗ Analyst 出错：${result.error}`);
			break;
		}
		console.log(`  ✓ 消化 ${result.processed} 条 → 触碰事件 ${result.storiesTouched.map((id) => `#${id}`).join(", ") || "无"}`);
		console.log(`    ${result.summary}`);
	}
}

export async function runBrief(storage: StoragePort): Promise<void> {
	const runtime = createAgentRuntime(loadModelSettings("editor"));
	const interests = loadInterests();
	const startedAt = new Date().toISOString();
	const result = await runEditor({ storage, runtime, interests });
	if (!result) {
		console.log("  上期简报以来没有事件更新，跳过");
		return;
	}
	storage.addAgentRun({
		role: "editor",
		summary: result.error
			? `出错：${result.error}`
			: result.brief
				? `生成简报 #${result.brief.id}，覆盖 ${result.storiesCovered} 个事件`
				: "未产出简报",
		inputCount: result.storiesCovered,
		toolCalls: result.brief ? 1 : 0,
		usageInput: result.usage?.input ?? null,
		usageOutput: result.usage?.output ?? null,
		startedAt,
		finishedAt: new Date().toISOString(),
	});
	if (result.error) {
		console.log(`  ✗ Editor 出错：${result.error}`);
		return;
	}
	if (result.brief) {
		// 简报除入库外同时落一份 Markdown 文件，方便直接阅读
		const dir = join(ROOT, "data", "reports");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `brief-${result.brief.id}-${result.brief.createdAt.slice(0, 10)}.md`);
		writeFileSync(file, result.brief.content);
		console.log(`  ✓ 简报 #${result.brief.id} 已生成（${result.storiesCovered} 个事件）→ ${file}`);
	}
}

/** 完整跑一轮：采集 → 分析 → 简报 */
export async function runAll(storage: StoragePort, config: ArgusConfig): Promise<void> {
	console.log("▶ 采集");
	await runCollect(storage, config);
	console.log("▶ 分析");
	await runAnalyze(storage, config);
	console.log("▶ 简报");
	await runBrief(storage);
}
