import type { ArgusConfig, StoragePort } from "@argus/core";
import { Cron } from "croner";
import { runAnalyze, runBrief, runCollect } from "./pipeline.js";

/**
 * 配置驱动的调度器：
 * - 每 collectIntervalMinutes 分钟采集 + 分析一轮
 * - briefTimes 里的每个时刻生成一期简报
 * 任务互斥：上一轮没跑完时跳过本轮，避免并发写库与重复分析。
 */
export function startScheduler(storage: StoragePort, config: ArgusConfig): Cron[] {
	let busy = false;

	const withLock = (label: string, fn: () => Promise<void>) => async () => {
		if (busy) {
			console.log(`[调度] 上一轮尚未结束，跳过本次${label}`);
			return;
		}
		busy = true;
		console.log(`[调度] ${new Date().toLocaleString("zh-CN")} 开始${label}`);
		try {
			await fn();
		} catch (err) {
			console.error(`[调度] ${label}失败:`, err instanceof Error ? err.message : err);
		} finally {
			busy = false;
		}
	};

	const jobs: Cron[] = [];

	const interval = Math.max(5, config.schedule.collectIntervalMinutes);
	jobs.push(
		new Cron(
			`*/${interval} * * * *`,
			withLock("采集+分析", async () => {
				await runCollect(storage, config);
				await runAnalyze(storage, config);
			}),
		),
	);

	for (const time of config.schedule.briefTimes) {
		const [hh, mm] = time.split(":").map(Number);
		if (Number.isNaN(hh) || Number.isNaN(mm)) {
			console.warn(`[调度] 无效的简报时刻 "${time}"，已忽略（应为 HH:mm）`);
			continue;
		}
		jobs.push(new Cron(`${mm} ${hh} * * *`, withLock(`简报(${time})`, () => runBrief(storage))));
	}

	console.log(`[调度] 已启动：每 ${interval} 分钟采集+分析；简报时刻 ${config.schedule.briefTimes.join(", ")}`);
	return jobs;
}
