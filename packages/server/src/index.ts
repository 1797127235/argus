import { serve } from "@hono/node-server";
import { SqliteStorage } from "@argus/storage";
import { createApi } from "./api.js";
import { dbPath, loadConfig, loadEnv } from "./config.js";
import { runAll, runAnalyze, runBrief, runCollect } from "./pipeline.js";
import { startScheduler } from "./scheduler.js";

const USAGE = `Argus —— 个人信息监控智能体

用法: npm run argus -- <命令>

命令:
  collect   采集一轮全部信息源
  analyze   Analyst 消化未分析条目，聚类成事件
  brief     Editor 生成一期简报
  run       完整跑一轮（collect → analyze → brief）
  serve     常驻运行：调度器 + Web 监控仪表盘
  status    查看当前状态
`;

async function main(): Promise<void> {
	loadEnv();
	const command = process.argv[2] ?? "help";
	if (command === "help" || command === "--help") {
		console.log(USAGE);
		return;
	}

	const config = loadConfig();
	const storage = new SqliteStorage(dbPath());

	try {
		switch (command) {
			case "collect":
				await runCollect(storage, config);
				break;
			case "analyze":
				await runAnalyze(storage, config);
				break;
			case "brief":
				await runBrief(storage);
				break;
			case "run":
				await runAll(storage, config);
				break;
			case "status": {
				const health = new Map(storage.listSourceHealth().map((h) => [h.sourceId, h]));
				console.log(`信息源 ${config.sources.filter((s) => s.enabled).length} 个启用：`);
				for (const s of config.sources.filter((s) => s.enabled)) {
					const h = health.get(s.id);
					const state = !h ? "未抓取" : h.lastError ? `失败×${h.failCount}（${h.lastError}）` : "正常";
					console.log(`  - ${s.name}: ${h?.itemCount ?? 0} 条, ${state}`);
				}
				console.log(`待分析条目: ${storage.countPendingItems()}`);
				console.log(`活跃事件: ${storage.listActiveStories().length} 个`);
				const briefs = storage.listBriefs(1);
				console.log(`最新简报: ${briefs.length > 0 ? `#${briefs[0].id} @ ${briefs[0].createdAt}` : "尚无"}`);
				break;
			}
			case "serve": {
				// 调度器先起，API 才能报下次运行时刻
				const scheduler = startScheduler(storage, config);
				const app = createApi(storage, config, scheduler);
				const server = serve(
					{ fetch: app.fetch, hostname: config.server.host, port: config.server.port },
					(info) => {
						console.log(`[web] 监控仪表盘: http://${config.server.host}:${info.port}`);
					},
				);
				const shutdown = () => {
					console.log("\n正在退出…");
					scheduler.stop();
					server.close();
					storage.close();
					process.exit(0);
				};
				process.on("SIGINT", shutdown);
				process.on("SIGTERM", shutdown);
				// serve 模式常驻，不走下面的统一 close
				return;
			}
			default:
				console.log(USAGE);
				process.exitCode = 1;
		}
	} finally {
		if (command !== "serve") storage.close();
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
