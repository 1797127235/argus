import type { StoryStatus } from "@argus/core";
import { useCallback, useState } from "react";
import { absTime, api, STATUS_LABEL, timeAgo, type StoryFilters } from "../api.js";
import { useAsync, useDebounced } from "../hooks.js";
import { EmptyState, ErrorState, Skeleton } from "./common.js";

const PAGE_SIZE = 50;

function scoreClass(score: number): string {
	if (score >= 8) return "score score-high";
	if (score >= 5) return "score score-mid";
	return "score score-low";
}

const STATUS_OPTIONS: { value: StoryStatus | ""; label: string }[] = [
	{ value: "", label: "全部状态" },
	{ value: "emerging", label: "新出现" },
	{ value: "developing", label: "发展中" },
	{ value: "resolved", label: "已平息" },
];

const SCORE_OPTIONS = [
	{ value: 0, label: "全部分数" },
	{ value: 5, label: "≥ 5 值得留意" },
	{ value: 7, label: "≥ 7 重要进展" },
	{ value: 9, label: "≥ 9 重大事件" },
];

/** 事件列表 + 时间线详情 + 反馈。反馈状态来自后端，刷新不丢 */
export function StoriesView({ refreshToken }: { refreshToken: number }) {
	const [q, setQ] = useState("");
	const [status, setStatus] = useState<StoryStatus | "">("");
	const [minScore, setMinScore] = useState(0);
	const [page, setPage] = useState(0);
	const [openId, setOpenId] = useState<number | null>(null);

	const debouncedQ = useDebounced(q, 300);
	const filters: StoryFilters = { q: debouncedQ, status, minScore };

	const list = useAsync(
		() => api.stories(filters, PAGE_SIZE, page * PAGE_SIZE),
		[debouncedQ, status, minScore, page, refreshToken],
		60_000,
	);

	const stories = list.data?.stories ?? [];
	const total = list.data?.total ?? 0;
	const hasFilter = debouncedQ.trim() !== "" || status !== "" || minScore > 0;

	const resetFilters = () => {
		setQ("");
		setStatus("");
		setMinScore(0);
		setPage(0);
	};

	// 筛选条件变化时回到第一页，否则会停在一个空页上
	const onFilterChange = <T,>(setter: (v: T) => void) => (value: T) => {
		setter(value);
		setPage(0);
	};

	return (
		<div className="split">
			<div className="split-list">
				<div className="filters">
					<input
						type="search"
						className="input"
						placeholder="搜索标题与摘要…"
						value={q}
						onChange={(e) => onFilterChange(setQ)(e.target.value)}
						aria-label="搜索事件"
					/>
					<div className="filter-row">
						<select
							className="select"
							value={status}
							onChange={(e) => onFilterChange(setStatus)(e.target.value as StoryStatus | "")}
							aria-label="按状态筛选"
						>
							{STATUS_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
						<select
							className="select"
							value={minScore}
							onChange={(e) => onFilterChange(setMinScore)(Number(e.target.value))}
							aria-label="按重要度筛选"
						>
							{SCORE_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
					</div>
					{hasFilter && (
						<button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
							清除筛选（{total} 条命中）
						</button>
					)}
				</div>

				{list.loading ? (
					<Skeleton rows={5} />
				) : list.error && stories.length === 0 ? (
					<ErrorState message={list.error} onRetry={list.refresh} />
				) : stories.length === 0 ? (
					<EmptyState
						title={hasFilter ? "没有符合条件的事件" : "还没有事件"}
						hint={hasFilter ? "试试放宽筛选条件" : "Analyst 分析出内容后会出现在这里"}
					/>
				) : (
					<>
						{stories.map((s) => (
							<button
								type="button"
								key={s.id}
								className={openId === s.id ? "card card-pick is-active" : "card card-pick"}
								onClick={() => setOpenId(s.id)}
								aria-current={openId === s.id}
							>
								<span className="card-head">
									<span className={scoreClass(s.score)}>{s.score}</span>
									<span className={`status status-${s.status}`}>{STATUS_LABEL[s.status]}</span>
									<span className="card-meta" title={absTime(s.updatedAt)}>
										{timeAgo(s.updatedAt)}
									</span>
								</span>
								<span className="card-title">{s.title}</span>
							</button>
						))}
						{total > PAGE_SIZE && (
							<div className="pager">
								<button
									type="button"
									className="btn btn-ghost btn-sm"
									disabled={page === 0}
									onClick={() => setPage((p) => Math.max(0, p - 1))}
								>
									上一页
								</button>
								<span className="text-dim">
									{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
								</span>
								<button
									type="button"
									className="btn btn-ghost btn-sm"
									disabled={(page + 1) * PAGE_SIZE >= total}
									onClick={() => setPage((p) => p + 1)}
								>
									下一页
								</button>
							</div>
						)}
					</>
				)}
			</div>

			{openId !== null && <StoryDetail storyId={openId} onFeedbackChange={list.refresh} />}
		</div>
	);
}

/** 事件详情：摘要、反馈、来源时间线 */
function StoryDetail({ storyId, onFeedbackChange }: { storyId: number; onFeedbackChange: () => void }) {
	const detail = useAsync(() => api.story(storyId), [storyId]);
	const [comment, setComment] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const { refresh } = detail;
	// 反馈落库后重新拉详情，展示的就是后端的真实状态，刷新页面也不会丢
	const submit = useCallback(
		async (verdict: "up" | "down") => {
			setSaving(true);
			setSaveError(null);
			try {
				await api.setFeedback(storyId, verdict, comment.trim() || undefined);
				setComment("");
				refresh();
				onFeedbackChange();
			} catch (err) {
				setSaveError(err instanceof Error ? err.message : String(err));
			} finally {
				setSaving(false);
			}
		},
		[storyId, comment, refresh, onFeedbackChange],
	);

	const revoke = useCallback(async () => {
		setSaving(true);
		setSaveError(null);
		try {
			await api.clearFeedback(storyId);
			refresh();
			onFeedbackChange();
		} catch (err) {
			setSaveError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}, [storyId, refresh, onFeedbackChange]);

	if (detail.loading) {
		return (
			<div className="split-detail panel">
				<Skeleton rows={4} />
			</div>
		);
	}
	if (detail.error || !detail.data) {
		return (
			<div className="split-detail panel">
				<ErrorState message={detail.error ?? "事件不存在"} onRetry={detail.refresh} />
			</div>
		);
	}

	const { story, items, feedback } = detail.data;
	const current = feedback[0] ?? null;

	return (
		<article className="split-detail panel">
			<header className="detail-head">
				<h2>{story.title}</h2>
				<div className="card-head">
					<span className={scoreClass(story.score)}>重要度 {story.score}/10</span>
					<span className={`status status-${story.status}`}>{STATUS_LABEL[story.status]}</span>
					<span className="card-meta" title={absTime(story.updatedAt)}>
						更新于 {timeAgo(story.updatedAt)}
					</span>
				</div>
			</header>

			<p className="detail-summary">{story.summary}</p>

			<section className="feedback" aria-label="反馈">
				{current ? (
					<div className="feedback-current">
						<span className="feedback-verdict">
							{current.verdict === "up" ? "👍 已标记有价值" : "👎 已标记不关心"}
						</span>
						{current.comment && <p className="feedback-comment">「{current.comment}」</p>}
						<p className="text-dim feedback-note">Analyst 下轮会参考这条反馈</p>
						<button type="button" className="btn btn-ghost btn-sm" onClick={revoke} disabled={saving}>
							撤销
						</button>
					</div>
				) : (
					<>
						<input
							type="text"
							className="input"
							placeholder="可选：说明理由，会一并给 Analyst 参考"
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							aria-label="反馈备注"
						/>
						<div className="feedback-actions">
							<button type="button" className="btn" onClick={() => submit("up")} disabled={saving}>
								👍 有价值
							</button>
							<button type="button" className="btn" onClick={() => submit("down")} disabled={saving}>
								👎 不关心
							</button>
						</div>
					</>
				)}
				{saveError && <p className="text-bad">{saveError}</p>}
			</section>

			<h3 className="detail-subhead">时间线（{items.length} 条来源）</h3>
			{items.length === 0 ? (
				<p className="text-dim">这个事件还没有关联条目。</p>
			) : (
				<ol className="timeline">
					{items.map((it) => (
						<li key={it.id}>
							<span className="timeline-meta">
								{it.publishedAt ? absTime(it.publishedAt) : "时间未知"} · {it.sourceId}
							</span>
							<a href={it.url} target="_blank" rel="noreferrer noopener" className="timeline-link">
								{it.title}
							</a>
						</li>
					))}
				</ol>
			)}
		</article>
	);
}
