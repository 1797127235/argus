import { useEffect, useState } from "react";
import { api, timeAgo, type SourceWithHealth } from "../api.js";

/** 信息源健康表 */
export function SourcesView() {
	const [sources, setSources] = useState<SourceWithHealth[]>([]);

	useEffect(() => {
		api.sources().then(setSources).catch(console.error);
	}, []);

	return (
		<table className="table">
			<thead>
				<tr>
					<th>信息源</th>
					<th>状态</th>
					<th>条目数</th>
					<th>最近抓取</th>
					<th>说明</th>
				</tr>
			</thead>
			<tbody>
				{sources.map((s) => {
					const h = s.health;
					const state = !s.enabled ? "已停用" : !h ? "未抓取" : h.lastError ? `失败 ×${h.failCount}` : "正常";
					const stateClass = !s.enabled ? "muted" : h?.lastError ? "bad" : h ? "good" : "muted";
					return (
						<tr key={s.id}>
							<td>
								<a href={s.url} target="_blank" rel="noreferrer">
									{s.name}
								</a>
							</td>
							<td className={stateClass}>{state}</td>
							<td>{h?.itemCount ?? 0}</td>
							<td>{timeAgo(h?.lastFetchAt ?? null)}</td>
							<td className="muted">{h?.lastError ?? ""}</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}
