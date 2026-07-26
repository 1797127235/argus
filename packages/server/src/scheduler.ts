import type { ArgusConfig, StoragePort } from "@argus/core";
import { Cron } from "croner";
import { runAnalyze, runBrief, runCollect } from "./pipeline.js";

/**
 * 构造采集任务。
 * cron 的分钟域只有 0-59，`*​/n` 是在这个范围内按步长取值：
 * n > 59 时（如 90）一个值都匹配不到，任务永不触发；
 * n 不整除 60 时（如 25）每小时会在 :00 处错位重来，实际间隔并不是 n。
 * 所以只有整除 60 的间隔才用 cron 表达式（保留整点对齐），
 * 其余交给 croner 的 interval 选项：每分钟检查，两次执行至少隔 n 分钟。
 */
function createCollectJob(intervalMinutes: number, handler: () => Promise<void>): Cron {
	if (intervalMinutes === 60) return new Cron("0 * * * *", handler);
	if (intervalMinutes < 60 && 60 % intervalMinutes === 0) {
		return new Cron(`*/${intervalMinutes} * * * *`, handler);
	}
	return new Cron("* * * * *", { interval: intervalMinutes * 60 }, handler);
}

/** "HH:mm" → cron 表达式，非法值返回 null */
function briefCron(time: string): string | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
	if (!match) return null;
	const hh = Number(match[1]);
	const mm = Number(match[2]);
	if (hh > 23 || mm > 59) return null;
	return `${mm} ${hh} * * *`;
}

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

	const interval = Math.max(5, Math.round(config.schedule.collectIntervalMinutes));
	jobs.push(
		createCollectJob(
			interval,
			withLock("采集+分析", async () => {
				await runCollect(storage, config);
				await runAnalyze(storage, config);
			}),
		),
	);

	for (const time of config.schedule.briefTimes) {
		const pattern = briefCron(time);
		if (!pattern) {
			console.warn(`[调度] 无效的简报时刻 "${time}"，已忽略（应为 HH:mm，00:00-23:59）`);
			continue;
		}
		jobs.push(new Cron(pattern, withLock(`简报(${time})`, () => runBrief(storage))));
	}

	console.log(`[调度] 已启动：每 ${interval} 分钟采集+分析；简报时刻 ${config.schedule.briefTimes.join(", ")}`);
	return jobs;
}
