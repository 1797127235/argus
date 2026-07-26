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
	/** 被积压上限静默丢弃的旧条目数 */
	suppressed: number;
	/** 主地址失败、经备用地址抓到时，记录实际生效的地址 */
	viaFallback?: string;
	error?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/**
 * 单趟解码 HTML 实体。
 * 必须一趟走完：分趟 replace 会把 `&amp;lt;` 先解成 `&lt;` 再解成 `<`，
 * 即二次解码，源文里本该显示的字面量 `&lt;` 就丢了。
 */
function decodeEntities(text: string): string {
	return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity.startsWith("#")) {
			const code =
				entity[1] === "x" || entity[1] === "X"
					? Number.parseInt(entity.slice(2), 16)
					: Number.parseInt(entity.slice(1), 10);
			if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
			return String.fromCodePoint(code);
		}
		return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
	});
}

/** 粗剥 HTML 标签并压缩空白，得到给模型看的纯文本 */
function stripHtml(html: string): string {
	const stripped = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ");
	return decodeEntities(stripped).replace(/\s+/g, " ").trim();
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

export interface CollectOptions {
	timeoutMs?: number;
	/**
	 * 单个源待分析条目的积压上限，超出部分从旧到新静默丢弃；0 表示不限制。
	 * 首次抓取走基线，不受此限。
	 */
	maxPendingPerSource?: number;
}

/**
 * 采集全部启用的源。
 * 首次抓取的源只建立静默基线：条目入库但直接标记为已分析，
 * 避免把源里的存量历史内容当成"新信息"灌给 Analyst。
 * 非首次抓取则用积压上限兜底 backlog 突增（换 url、久禁重启、源回填历史）。
 */
export async function collectSources(
	storage: StoragePort,
	sources: SourceConfig[],
	options: CollectOptions = {},
): Promise<CollectResult[]> {
	const { timeoutMs = 30000, maxPendingPerSource = 0 } = options;
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
		// 主地址 + 备用地址依次尝试，全部失败才算这个源失败
		const candidates = [source.url, ...(source.fallbackUrls ?? [])];
		const errors: string[] = [];
		for (const [index, url] of candidates.entries()) {
			try {
				const feed = await parser.parseURL(url);
				const isFirstFetch = storage.sourceItemCount(source.id) === 0;
				const items = (feed.items ?? [])
					.map((entry) => normalize(source, entry))
					.filter((it): it is NewItem => it !== null);
				const inserted = storage.insertItems(items);
				let suppressed = 0;
				if (isFirstFetch) {
					storage.markSourceAnalyzed(source.id);
				} else if (maxPendingPerSource > 0) {
					suppressed = storage.capPendingForSource(source.id, maxPendingPerSource);
				}
				storage.recordFetch(source.id, true, null);
				return {
					sourceId: source.id,
					name: source.name,
					ok: true,
					newItems: inserted,
					baseline: isFirstFetch,
					suppressed,
					viaFallback: index > 0 ? url : undefined,
				};
			} catch (err) {
				errors.push(err instanceof Error ? err.message : String(err));
			}
		}
		// 报错时带上尝试过的地址数，便于区分"源本身挂了"和"镜像全挂了"
		const message =
			candidates.length > 1 ? `${candidates.length} 个地址均失败：${errors.join(" | ")}` : errors[0];
		storage.recordFetch(source.id, false, message);
		return {
			sourceId: source.id,
			name: source.name,
			ok: false,
			newItems: 0,
			baseline: false,
			suppressed: 0,
			error: message,
		};
	});

	return Promise.all(tasks);
}
