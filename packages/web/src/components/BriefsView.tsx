import type { Brief } from "@argus/core";
import { marked } from "marked";
import { useEffect, useState } from "react";
import { api, timeAgo } from "../api.js";

/** 简报列表 + 阅读视图 */
export function BriefsView() {
	const [briefs, setBriefs] = useState<Brief[]>([]);
	const [selected, setSelected] = useState<Brief | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api
			.briefs()
			.then((list) => {
				setBriefs(list);
				if (list.length > 0) setSelected(list[0]);
			})
			.catch((e) => setError(String(e)));
	}, []);

	if (error) return <p className="empty">加载失败：{error}</p>;
	if (briefs.length === 0) {
		return <p className="empty">还没有简报。运行 npm run argus -- run 生成第一期。</p>;
	}

	return (
		<div className="briefs">
			<div className="brief-list">
				{briefs.map((b) => (
					<button
						key={b.id}
						className={selected?.id === b.id ? "brief-item active" : "brief-item"}
						onClick={() => setSelected(b)}
					>
						<span className="brief-title">简报 #{b.id}</span>
						<span className="brief-meta">
							{new Date(b.createdAt).toLocaleString("zh-CN")} · {b.storyIds.length} 个事件 · {timeAgo(b.createdAt)}
						</span>
					</button>
				))}
			</div>
			{selected && (
				<article
					className="brief-content markdown"
					// 内容来自本地 Editor agent 的产出，仅本机使用
					dangerouslySetInnerHTML={{ __html: marked.parse(selected.content, { async: false }) }}
				/>
			)}
		</div>
	);
}
