import { useEffect, useState } from "react";
import { absTime, api, timeAgo } from "./api.js";
import { BriefsView } from "./components/BriefsView.js";
import { RunsView } from "./components/RunsView.js";
import { SourcesView } from "./components/SourcesView.js";
import { StoriesView } from "./components/StoriesView.js";
import { useAsync } from "./hooks.js";

type Tab = "briefs" | "stories" | "sources" | "runs";

const TABS: { key: Tab; label: string; title: string }[] = [
	{ key: "briefs", label: "简报", title: "简报" },
	{ key: "stories", label: "事件", title: "事件" },
	{ key: "sources", label: "信息源", title: "信息源健康" },
	{ key: "runs", label: "运行记录", title: "agent 运行记录" },
];

const TAB_KEYS = TABS.map((t) => t.key);

/** 从 URL hash 读当前标签，非法值回落到简报 */
function tabFromHash(): Tab {
	const key = window.location.hash.replace(/^#\/?/, "") as Tab;
	return TAB_KEYS.includes(key) ? key : "briefs";
}

export function App() {
	// 标签放进 hash：可收藏、可分享、浏览器前进后退可用
	const [tab, setTab] = useState<Tab>(tabFromHash);

	useEffect(() => {
		const onHashChange = () => setTab(tabFromHash());
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);

	const goTab = (key: Tab) => {
		window.location.hash = `#/${key}`;
		setTab(key);
	};

	// 每点一次刷新就 +1，各视图把它放进 useAsync 的依赖里一起重新加载，
	// 否则"刷新"只会更新侧栏，用户看的那一屏纹丝不动
	const [refreshToken, setRefreshToken] = useState(0);
	const overview = useAsync(() => api.overview(), [], 30_000);
	const o = overview.data;
	const active = TABS.find((t) => t.key === tab) ?? TABS[0];

	const refreshAll = () => {
		overview.refresh();
		setRefreshToken((n) => n + 1);
	};

	return (
		<div className="layout">
			<aside className="sidebar">
				<div className="brand">
					<span className="brand-eye" aria-hidden="true">
						◉
					</span>
					<span className="brand-name">Argus</span>
				</div>

				<nav className="nav" aria-label="主导航">
					{TABS.map((t) => (
						<button
							type="button"
							key={t.key}
							className={tab === t.key ? "nav-item is-active" : "nav-item"}
							onClick={() => goTab(t.key)}
							aria-current={tab === t.key ? "page" : undefined}
						>
							{t.label}
							{/* 有源在失败时，在信息源入口上挂个角标 */}
							{t.key === "sources" && o && o.failingSources > 0 && (
								<span className="nav-badge">{o.failingSources}</span>
							)}
						</button>
					))}
				</nav>

				<div className="sidebar-foot">
					{o && (
						<>
							<dl className="stats">
								<div className="stat">
									<dt>活跃事件</dt>
									<dd>{o.activeStories}</dd>
								</div>
								<div className="stat">
									<dt>待分析</dt>
									<dd>{o.pendingItems}</dd>
								</div>
								<div className="stat">
									<dt>信息源</dt>
									<dd>
										{o.sources}
										{o.failingSources > 0 && <span className="text-bad"> / {o.failingSources} 失败</span>}
									</dd>
								</div>
							</dl>
							{/* 调度是这个系统的心跳，之前完全不可见 */}
							<dl className="schedule">
								<div>
									<dt>下次采集</dt>
									<dd title={absTime(o.nextCollectAt)}>{timeAgo(o.nextCollectAt)}</dd>
								</div>
								<div>
									<dt>下期简报</dt>
									<dd title={absTime(o.nextBriefAt)}>{timeAgo(o.nextBriefAt)}</dd>
								</div>
							</dl>
							{o.busy && <p className="running">● 正在运行…</p>}
						</>
					)}
					{overview.error && <p className="text-bad sidebar-error">{overview.error}</p>}
				</div>
			</aside>

			<main className="content">
				<header className="content-head">
					<h1>{active.title}</h1>
					<div className="content-actions">
						<span className="text-dim updated-at">
							{overview.loadedAt ? `更新于 ${timeAgo(overview.loadedAt)}` : ""}
						</span>
						<button
							type="button"
							className="btn btn-ghost btn-sm"
							onClick={refreshAll}
							disabled={overview.refreshing}
						>
							{overview.refreshing ? "刷新中…" : "刷新"}
						</button>
					</div>
				</header>

				{/* key 让切换标签时组件重建，避免上一个视图的状态残留 */}
				<div className="content-body" key={tab}>
					{tab === "briefs" && <BriefsView refreshToken={refreshToken} />}
					{tab === "stories" && <StoriesView refreshToken={refreshToken} />}
					{tab === "sources" && <SourcesView refreshToken={refreshToken} />}
					{tab === "runs" && <RunsView refreshToken={refreshToken} />}
				</div>
			</main>
		</div>
	);
}
