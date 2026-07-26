import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

/** 模型接入配置（来自 .env，由组装根传入） */
export interface ModelSettings {
	/** OpenAI 兼容端点，以 /v1 结尾 */
	baseUrl: string;
	apiKey: string;
	modelId: string;
	contextWindow?: number;
	maxTokens?: number;
}

/** agent 运行所需的模型运行时：pi-ai 的 Models 集合 + 选定模型 */
export interface AgentRuntime {
	models: ReturnType<typeof createModels>;
	model: Model<"openai-completions">;
}

/**
 * 用任意 OpenAI 兼容端点构建 pi-ai 运行时。
 * compat 关闭 developer role 与 reasoning_effort，以兼容各类中转/本地服务。
 */
export function createAgentRuntime(settings: ModelSettings): AgentRuntime {
	const model: Model<"openai-completions"> = {
		id: settings.modelId,
		name: settings.modelId,
		api: "openai-completions",
		provider: "argus",
		baseUrl: settings.baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: settings.contextWindow ?? 128000,
		maxTokens: settings.maxTokens ?? 8192,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
		},
	};

	const provider = createProvider({
		id: "argus",
		name: "Argus 模型端点",
		baseUrl: settings.baseUrl,
		auth: {
			apiKey: {
				name: "Argus API key",
				resolve: async () => ({ auth: { apiKey: settings.apiKey } }),
			},
		},
		models: [model],
		api: openAICompletionsApi(),
	});

	const models = createModels();
	models.setProvider(provider);
	return { models, model };
}
