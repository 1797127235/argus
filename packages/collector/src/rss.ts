import type { NewItem, SourceConfig, StoragePort } from "@argus/core";
import Parser from "rss-parser";

/** 单个源一次采集的结果 */
export interface CollectResult {
	sourceId: string;
	name: string;
	ok: boolean;
	/** 本次新增条目数 */
	newItems: number;
	/** 是否为首次抓取（静默基线：历史条目不进入分析） */
	baseline: boolean;
	error?: string;
}

/** 粗剥 HTML 标签并压缩空白，得到给模型看的纯文本 */
function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

const MAX_CONTENT_LENGTH = 4000;

function normalize(source: SourceConfig, entry: Parser.Item): NewItem | null {
	const title = entry.title?.trim();
	if (!title) return null;
	const url = entry.link ?? "";
	const guid = entry.guid ?? url ?? title;
	const rawContent = entry.contentSnippet || entry.content || entry.summary || "";
	let publishedAt: string | null = null;
	if (entry.isoDate) publishedAt = entry.isoDate;
	else if (entry.pubDate) {
		const d = new Date(entry.pubDate);
		if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
	}
	return {
		sourceId: source.id,
		guid,
		url,
		title,
		content: stripHtml(String(rawContent)).slice(0, MAX_CONTENT_LENGTH),
		publishedAt,
	};
}

/**
 * 采集全部启用的源。
 * 首次抓取的源只建立静默基线：条目入库但直接标记为已分析，
 * 避免把源里的存量历史内容当成"新信息"灌给 Analyst。
 */
export async function collectSources(
	storage: StoragePort,
	sources: SourceConfig[],
	timeoutMs = 20000,
): Promise<CollectResult[]> {
	const parser = new Parser({
		timeout: timeoutMs,
		// 部分站点（如 36氪）对无 UA 的请求不响应
		headers: {
			"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Argus/0.1",
			Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
		},
	});
	const enabled = sources.filter((s) => s.enabled);

	const tasks = enabled.map(async (source): Promise<CollectResult> => {
		try {
			const feed = await parser.parseURL(source.url);
			const isFirstFetch = storage.sourceItemCount(source.id) === 0;
			const items = (feed.items ?? [])
				.map((entry) => normalize(source, entry))
				.filter((it): it is NewItem => it !== null);
			const inserted = storage.insertItems(items);
			if (isFirstFetch) storage.markSourceAnalyzed(source.id);
			storage.recordFetch(source.id, true, null);
			return { sourceId: source.id, name: source.name, ok: true, newItems: inserted, baseline: isFirstFetch };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			storage.recordFetch(source.id, false, message);
			return { sourceId: source.id, name: source.name, ok: false, newItems: 0, baseline: false, error: message };
		}
	});

	return Promise.all(tasks);
}
