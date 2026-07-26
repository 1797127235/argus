import type { SourceWithHealth } from "../api.js";
import { absTime, api, timeAgo } from "../api.js";
import { useAsync } from "../hooks.js";
import { EmptyState, ErrorState, Skeleton } from "./common.js";

type State = "failing" | "ok" | "never" | "disabled";

function stateOf(s: SourceWithHealth): State {
	if (!s.enabled) return "disabled";
	if (!s.health) return "never";
	return s.health.failCount > 0 ? "failing" : "ok";
}

const STATE_LABEL: Record<State, string> = {
	failing: "失败",
	ok: "正常",
	never: "未抓取",
	disabled: "已停用",
};

// 失败的排最前——最该被看见的信息不该埋在 33 行里
const STATE_ORDER: Record<State, number> = { failing: 0, never: 1, ok: 2, disabled: 3 };

/** 信息源健康表：按健康度排序，失败原因直接展开 */
export function SourcesView({ refreshToken }: { refreshToken: number }) {
	const { data, loading, error, refresh } = useAsync(() => api.sources(), [refreshToken], 60_000);
	const sources = data ?? [];

	if (loading) return <Skeleton rows={6} />;
	if (error && sources.length === 0) return <ErrorState message={error} onRetry={refresh} />;
	if (sources.length === 0) {
		return <EmptyState title="没有配置信息源" hint="在 config/argus.yaml 的 sources 里添加" />;
	}

	const sorted = [...sources].sort((a, b) => {
		const diff = STATE_ORDER[stateOf(a)] - STATE_ORDER[stateOf(b)];
		return diff !== 0 ? diff : a.name.localeCompare(b.name, "zh-CN");
	});
	const failing = sorted.filter((s) => stateOf(s) === "failing").length;

	return (
		<>
			<p className="section-note">
				{sources.length} 个信息源
				{failing > 0 ? (
					<>
						，其中 <strong className="text-bad">{failing} 个正在失败</strong>
					</>
				) : (
					"，全部正常"
				)}
			</p>
			<div className="table-wrap">
				<table className="table">
					<thead>
						<tr>
							<th>信息源</th>
							<th>状态</th>
							<th className="num">条目</th>
							<th>最近抓取</th>
							<th>最近错误</th>
						</tr>
					</thead>
					<tbody>
						{sorted.map((s) => {
							const state = stateOf(s);
							const h = s.health;
							return (
								<tr key={s.id} className={state === "failing" ? "row-bad" : undefined}>
									<td>
										<a href={s.url} target="_blank" rel="noreferrer noopener" className="link">
											{s.name}
										</a>
										{/* 展开后的备用地址数量，说明这个源有几条腿 */}
										{s.fallbackUrls && s.fallbackUrls.length > 0 && (
											<span className="badge-soft" title={s.fallbackUrls.join("\n")}>
												+{s.fallbackUrls.length} 备用
											</span>
										)}
									</td>
									<td>
										<span className={`dot dot-${state}`} aria-hidden="true" />
										<span className={state === "failing" ? "text-bad" : "text-dim"}>
											{STATE_LABEL[state]}
											{state === "failing" && h ? ` ×${h.failCount}` : ""}
										</span>
									</td>
									<td className="num">{h?.itemCount ?? 0}</td>
									<td className="text-dim" title={absTime(h?.lastFetchAt ?? null)}>
										{timeAgo(h?.lastFetchAt ?? null)}
									</td>
									<td className="text-dim cell-error" title={h?.lastError ?? ""}>
										{h?.lastError ?? ""}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</>
	);
}
