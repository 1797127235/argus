import type { AgentRunLog } from "@argus/core";
import { absTime, api, duration, timeAgo } from "../api.js";
import { useAsync } from "../hooks.js";
import { EmptyState, ErrorState, Skeleton } from "./common.js";

const ROLE_LABEL: Record<AgentRunLog["role"], string> = {
	analyst: "分析师",
	editor: "主编",
};

/** 出错的运行记录：summary 由 pipeline 写成"出错：…" */
function isFailed(run: AgentRunLog): boolean {
	return run.summary.startsWith("出错：");
}

/** agent 运行记录：每轮干了什么、耗时多久、花了多少 token */
export function RunsView({ refreshToken }: { refreshToken: number }) {
	const { data, loading, error, refresh } = useAsync(() => api.runs(), [refreshToken], 60_000);
	const runs = data ?? [];

	if (loading) return <Skeleton rows={5} />;
	if (error && runs.length === 0) return <ErrorState message={error} onRetry={refresh} />;
	if (runs.length === 0) {
		return <EmptyState title="还没有 agent 运行记录" hint="第一轮分析或简报跑完后会出现在这里" />;
	}

	const totalTokens = runs.reduce((sum, r) => sum + (r.usageInput ?? 0) + (r.usageOutput ?? 0), 0);

	return (
		<>
			<p className="section-note">
				最近 {runs.length} 轮，累计 {totalTokens.toLocaleString("zh-CN")} tokens
			</p>
			<div className="stack">
				{runs.map((r) => (
					<article key={r.id} className={isFailed(r) ? "panel run is-failed" : "panel run"}>
						<header className="run-head">
							<span className={`tag tag-${r.role}`}>{ROLE_LABEL[r.role]}</span>
							{isFailed(r) && <span className="tag tag-bad">失败</span>}
							<span className="run-time" title={absTime(r.finishedAt)}>
								{timeAgo(r.finishedAt)}
							</span>
						</header>
						<p className="run-summary">{r.summary}</p>
						<dl className="run-metrics">
							<div>
								<dt>输入</dt>
								<dd>{r.inputCount}</dd>
							</div>
							<div>
								<dt>工具调用</dt>
								<dd>{r.toolCalls} 次</dd>
							</div>
							<div>
								<dt>耗时</dt>
								<dd>{duration(r.startedAt, r.finishedAt)}</dd>
							</div>
							<div>
								<dt>tokens</dt>
								<dd>
									{r.usageInput === null
										? "—"
										: `${r.usageInput.toLocaleString("zh-CN")} + ${(r.usageOutput ?? 0).toLocaleString("zh-CN")}`}
								</dd>
							</div>
						</dl>
					</article>
				))}
			</div>
		</>
	);
}
