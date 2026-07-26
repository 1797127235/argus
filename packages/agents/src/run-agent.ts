import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentRuntime } from "./runtime.js";

/** 一次 agent 运行的原始结果 */
export interface AgentRunOutcome {
	/** 最后一条助手文本（agent 的总结/回答） */
	finalText: string;
	/** 累计 token 用量（端点未上报时为 null） */
	usage: { input: number; output: number } | null;
	/** 是否出现流错误 */
	error: string | null;
}

/**
 * 跑一轮"单次任务"型 agent：给定系统提示、用户消息和工具，
 * 让模型自主调用工具直到完成，返回最终文本与用量。
 * Argus 的 agent 全部无状态冷启动，上下文来自数据库而非会话历史。
 */
export async function runOneShotAgent(
	runtime: AgentRuntime,
	options: {
		systemPrompt: string;
		userMessage: string;
		tools: AgentTool[];
	},
): Promise<AgentRunOutcome> {
	const agent = new Agent({
		initialState: {
			systemPrompt: options.systemPrompt,
			model: runtime.model,
			thinkingLevel: "off",
			tools: options.tools,
		},
		streamFn: runtime.models.streamSimple.bind(runtime.models),
	});

	let finalText = "";
	let error: string | null = null;
	let inputTokens = 0;
	let outputTokens = 0;
	let sawUsage = false;

	agent.subscribe((event) => {
		if (event.type !== "message_end") return;
		const message = event.message as {
			role?: string;
			content?: unknown;
			stopReason?: string;
			errorMessage?: string;
			usage?: Usage;
		};
		if (message.role !== "assistant") return;
		if (message.usage) {
			sawUsage = true;
			inputTokens += message.usage.input;
			outputTokens += message.usage.output;
		}
		if (message.stopReason === "error" || message.stopReason === "aborted") {
			error = message.errorMessage ?? `流终止: ${message.stopReason}`;
			return;
		}
		if (Array.isArray(message.content)) {
			const text = message.content
				.filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			if (text) finalText = text;
		}
	});

	try {
		await agent.prompt(options.userMessage);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}

	return {
		finalText,
		usage: sawUsage ? { input: inputTokens, output: outputTokens } : null,
		error,
	};
}
