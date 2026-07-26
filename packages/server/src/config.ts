import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArgusConfig, SourceConfig } from "@argus/core";
import type { ModelSettings } from "@argus/agents";
import { parse } from "yaml";

/** 项目根目录：所有命令都要求在仓库根目录下执行 */
export const ROOT = process.cwd();

/** 加载 .env（存在时），密钥只进程内可见 */
export function loadEnv(): void {
	const envPath = join(ROOT, ".env");
	if (existsSync(envPath)) {
		process.loadEnvFile(envPath);
	}
}

const DEFAULTS: Omit<ArgusConfig, "sources" | "mirrors"> = {
	schedule: {
		collectIntervalMinutes: 60,
		briefTimes: ["09:00", "21:00"],
	},
	analysis: {
		batchSize: 60,
		excerptLength: 400,
		alertThreshold: 9,
		maxPendingPerSource: 50,
	},
	server: {
		host: "127.0.0.1",
		port: 8787,
	},
};

/**
 * 展开 url 里的 {镜像组} 前缀：组内第一个地址作主地址，其余进 fallbackUrls。
 * 多个源共用一个自建实例时（如 13 个 X 源都走同一台 RSSHub），
 * 换实例或加备用只改 mirrors 一处，实例挂掉也不会整片哑掉。
 */
function expandMirrors(sources: SourceConfig[], mirrors: Record<string, string[]>): SourceConfig[] {
	return sources.map((source) => {
		const match = /^\{([^}]+)\}/.exec(source.url ?? "");
		if (!match) return source;
		const hosts = mirrors[match[1]];
		if (!hosts || hosts.length === 0) {
			throw new Error(
				`信息源 ${source.id} 引用了镜像组 {${match[1]}}，但 config/argus.yaml 的 mirrors 里没有定义它`,
			);
		}
		const path = source.url.slice(match[0].length);
		const urls = hosts.map((host) => host.replace(/\/+$/, "") + path);
		return {
			...source,
			url: urls[0],
			fallbackUrls: [...urls.slice(1), ...(source.fallbackUrls ?? [])],
		};
	});
}

/** 加载主配置（config/argus.yaml），缺省字段用默认值补齐 */
export function loadConfig(): ArgusConfig {
	const path = join(ROOT, "config", "argus.yaml");
	if (!existsSync(path)) {
		throw new Error(`找不到配置文件 ${path}，请先复制 config/argus.example.yaml`);
	}
	const raw = parse(readFileSync(path, "utf-8")) as Partial<ArgusConfig>;
	const mirrors = raw.mirrors ?? {};
	return {
		sources: expandMirrors(raw.sources ?? [], mirrors),
		mirrors,
		schedule: { ...DEFAULTS.schedule, ...raw.schedule },
		analysis: { ...DEFAULTS.analysis, ...raw.analysis },
		server: { ...DEFAULTS.server, ...raw.server },
	};
}

/** 读取关注画像全文 */
export function loadInterests(): string {
	const path = join(ROOT, "memory", "interests.md");
	if (!existsSync(path)) {
		throw new Error(`找不到关注画像 ${path}，它是 Analyst 判断相关性的依据`);
	}
	return readFileSync(path, "utf-8");
}

/**
 * 从环境变量读模型配置。
 * role 传 "analyst"/"editor" 时优先取对应的覆盖变量（模型分层预留）。
 */
export function loadModelSettings(role?: "analyst" | "editor"): ModelSettings {
	const baseUrl = process.env.ARGUS_AI_BASE_URL;
	const apiKey = process.env.ARGUS_AI_API_KEY;
	if (!baseUrl || !apiKey) {
		throw new Error("缺少模型配置：请复制 .env.example 为 .env 并填入 ARGUS_AI_BASE_URL / ARGUS_AI_API_KEY / ARGUS_AI_MODEL");
	}
	const roleOverride =
		role === "analyst" ? process.env.ARGUS_ANALYST_MODEL : role === "editor" ? process.env.ARGUS_EDITOR_MODEL : undefined;
	const modelId = roleOverride || process.env.ARGUS_AI_MODEL;
	if (!modelId) {
		throw new Error("缺少模型配置：请在 .env 中填入 ARGUS_AI_MODEL");
	}
	return {
		baseUrl,
		apiKey,
		modelId,
		contextWindow: process.env.ARGUS_AI_CONTEXT_WINDOW ? Number(process.env.ARGUS_AI_CONTEXT_WINDOW) : undefined,
		maxTokens: process.env.ARGUS_AI_MAX_TOKENS ? Number(process.env.ARGUS_AI_MAX_TOKENS) : undefined,
	};
}

/** 数据库文件位置 */
export function dbPath(): string {
	return join(ROOT, "data", "argus.db");
}
