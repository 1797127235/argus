import { useEffect, useState } from "react";
import { api, type Overview } from "./api.js";
import { BriefsView } from "./components/BriefsView.js";
import { RunsView } from "./components/RunsView.js";
import { SourcesView } from "./components/SourcesView.js";
import { StoriesView } from "./components/StoriesView.js";

type Tab = "briefs" | "stories" | "sources" | "runs";

const TABS: { key: Tab; label: string }[] = [
	{ key: "briefs", label: "简报" },
	{ key: "stories", label: "事件" },
	{ key: "sources", label: "信息源" },
	{ key: "runs", label: "运行记录" },
];

export function App() {
	const [tab, setTab] = useState<Tab>("briefs");
	const [overview, setOverview] = useState<Overview | null>(null);

	useEffect(() => {
		api.overview().then(setOverview).catch(console.error);
		const timer = setInterval(() => {
			api.overview().then(setOverview).catch(console.error);
		}, 30000);
		return () => clearInterval(timer);
	}, []);

	return (
		<div className="layout">
			<aside className="sidebar">
				<div className="logo">
					<span className="logo-eye">◉</span> Argus
				</div>
				<nav>
					{TABS.map((t) => (
						<button
							key={t.key}
							className={tab === t.key ? "nav-item active" : "nav-item"}
							onClick={() => setTab(t.key)}
						>
							{t.label}
						</button>
					))}
				</nav>
				{overview && (
					<div className="overview">
						<div className="stat">
							<span className="stat-num">{overview.activeStories}</span>
							<span className="stat-label">活跃事件</span>
						</div>
						<div className="stat">
							<span className="stat-num">{overview.pendingItems}</span>
							<span className="stat-label">待分析条目</span>
						</div>
						<div className="stat">
							<span className="stat-num">{overview.sources}</span>
							<span className="stat-label">启用信息源</span>
						</div>
					</div>
				)}
			</aside>
			<main className="content">
				{tab === "briefs" && <BriefsView />}
				{tab === "stories" && <StoriesView />}
				{tab === "sources" && <SourcesView />}
				{tab === "runs" && <RunsView />}
			</main>
		</div>
	);
}
