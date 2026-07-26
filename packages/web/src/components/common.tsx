import DOMPurify from "dompurify";
import { marked } from "marked";

/** 骨架屏：首次加载时占位，避免页面从空白突然跳成内容 */
export function Skeleton({ rows = 3 }: { rows?: number }) {
	return (
		<div className="skeleton" aria-busy="true" aria-label="加载中">
			{Array.from({ length: rows }, (_, i) => (
				<div key={i} className="skeleton-row" />
			))}
		</div>
	);
}

/** 错误态：说清出了什么事，并给一个重试入口 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<div className="state state-error" role="alert">
			<div className="state-icon">⚠</div>
			<div className="state-body">
				<p className="state-title">加载失败</p>
				<p className="state-desc">{message}</p>
			</div>
			{onRetry && (
				<button type="button" className="btn" onClick={onRetry}>
					重试
				</button>
			)}
		</div>
	);
}

/** 空态：区分"还没有数据"和"筛选后没结果"，并告诉用户下一步做什么 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
	return (
		<div className="state state-empty">
			<div className="state-icon">◎</div>
			<div className="state-body">
				<p className="state-title">{title}</p>
				{hint && <p className="state-desc">{hint}</p>}
			</div>
		</div>
	);
}

/**
 * 简报正文渲染。
 * 简报由 Editor 生成，而 Editor 的输入是 RSS 抓来的标题与链接——
 * 即"不可信输入 → 模型 → HTML"这条链路是通的，所以必须过一遍消毒，
 * 不能因为"只在本机看"就直接 innerHTML。
 */
export function Markdown({ content }: { content: string }) {
	const raw = marked.parse(content, { async: false }) as string;
	const clean = DOMPurify.sanitize(raw, {
		USE_PROFILES: { html: true },
		ADD_ATTR: ["target", "rel"],
		// javascript:/data: 等协议由 DOMPurify 默认策略拦截
	});
	return (
		<div
			className="markdown"
			// 已经过 DOMPurify 消毒
			dangerouslySetInnerHTML={{ __html: clean }}
		/>
	);
}

// 外链一律新开标签页，并断开 opener 引用
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A" && node.getAttribute("href")) {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noreferrer noopener");
	}
});
