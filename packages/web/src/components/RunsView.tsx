import type { AgentRunLog } from "@argus/core";
import { useEffect, useState } from "react";
import { api, timeAgo } from "../api.js";

const ROLE_LABEL: Record<AgentRunLog["role"], string> = {
	analyst: "分析师",
	editor: "主编",
};

/** agent 运行记录：每轮干了什么、花了多少 token */
export function RunsView() {
	const [runs, setRuns] = useState<AgentRunLog[]>([]);

	useEffect(() => {
		api.runs().then(setRuns).catch(console.error);
	}, []);

	if (runs.length === 0) {
		return <p className="empty">还没有 agent 运行记录。</p>;
	}

	return (
		<div className="runs">
			{runs.map((r) => (
				<div key={r.id} className="run-item">
					<div className="run-head">
						<span className={`role ${r.role}`}>{ROLE_LABEL[r.role]}</span>
						<span className="muted">{timeAgo(r.finishedAt)}</span>
						<span className="muted">
							输入 {r.inputCount} · 工具 {r.toolCalls} 次
							{r.usageInput !== null && ` · ${r.usageInput} + ${r.usageOutput} tokens`}
						</span>
					</div>
					<p>{r.summary}</p>
				</div>
			))}
		</div>
	);
}
