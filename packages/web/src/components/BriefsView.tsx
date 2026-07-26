import { useEffect, useState } from "react";
import { absTime, api, timeAgo } from "../api.js";
import { useAsync } from "../hooks.js";
import { EmptyState, ErrorState, Markdown, Skeleton } from "./common.js";

/** 简报列表 + 阅读视图。每 2 分钟自动刷新一次列表 */
export function BriefsView({ refreshToken }: { refreshToken: number }) {
	const { data, loading, error, refresh } = useAsync(() => api.briefs(), [refreshToken], 120_000);
	const [selectedId, setSelectedId] = useState<number | null>(null);

	const briefs = data ?? [];
	// 默认选中最新一期；已选中的那期若还在列表里就保持不动，避免刷新时跳走
	useEffect(() => {
		if (briefs.length === 0) return;
		if (selectedId === null || !briefs.some((b) => b.id === selectedId)) {
			setSelectedId(briefs[0].id);
		}
	}, [briefs, selectedId]);

	if (loading) return <Skeleton rows={4} />;
	if (error && briefs.length === 0) return <ErrorState message={error} onRetry={refresh} />;
	if (briefs.length === 0) {
		return (
			<EmptyState
				title="还没有简报"
				hint="Editor 会在配置的简报时刻生成；也可以手动运行 npm run argus -- brief"
			/>
		);
	}

	const selected = briefs.find((b) => b.id === selectedId) ?? briefs[0];

	return (
		<div className="split">
			<nav className="split-list" aria-label="简报列表">
				{briefs.map((b) => (
					<button
						type="button"
						key={b.id}
						className={selected.id === b.id ? "card card-pick is-active" : "card card-pick"}
						onClick={() => setSelectedId(b.id)}
						aria-current={selected.id === b.id}
					>
						<span className="card-title">简报 #{b.id}</span>
						<span className="card-meta" title={absTime(b.createdAt)}>
							{timeAgo(b.createdAt)} · {b.storyIds.length} 个事件
						</span>
					</button>
				))}
			</nav>
			<article className="split-detail panel">
				<Markdown content={selected.content} />
			</article>
		</div>
	);
}
