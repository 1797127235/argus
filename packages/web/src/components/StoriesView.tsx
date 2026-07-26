import type { Story, StoryWithItems } from "@argus/core";
import { useEffect, useState } from "react";
import { api, STATUS_LABEL, timeAgo } from "../api.js";

function scoreClass(score: number): string {
	if (score >= 8) return "score high";
	if (score >= 5) return "score mid";
	return "score low";
}

/** 事件列表 + 时间线详情 + 👍👎 反馈 */
export function StoriesView() {
	const [stories, setStories] = useState<Story[]>([]);
	const [detail, setDetail] = useState<StoryWithItems | null>(null);
	const [sent, setSent] = useState<Record<number, "up" | "down">>({});

	useEffect(() => {
		api.stories().then(setStories).catch(console.error);
	}, []);

	const open = (id: number) => {
		api.story(id).then(setDetail).catch(console.error);
	};

	const sendFeedback = async (storyId: number, verdict: "up" | "down") => {
		await api.feedback(storyId, verdict);
		setSent((prev) => ({ ...prev, [storyId]: verdict }));
	};

	if (stories.length === 0) {
		return <p className="empty">还没有事件。Analyst 分析出内容后会出现在这里。</p>;
	}

	return (
		<div className="stories">
			<div className="story-list">
				{stories.map((s) => (
					<button
						key={s.id}
						className={detail?.story.id === s.id ? "story-item active" : "story-item"}
						onClick={() => open(s.id)}
					>
						<div className="story-head">
							<span className={scoreClass(s.score)}>{s.score}</span>
							<span className={`status ${s.status}`}>{STATUS_LABEL[s.status]}</span>
							<span className="story-time">{timeAgo(s.updatedAt)}</span>
						</div>
						<div className="story-title">{s.title}</div>
					</button>
				))}
			</div>
			{detail && (
				<article className="story-detail">
					<header>
						<h2>{detail.story.title}</h2>
						<div className="story-head">
							<span className={scoreClass(detail.story.score)}>重要度 {detail.story.score}/10</span>
							<span className={`status ${detail.story.status}`}>{STATUS_LABEL[detail.story.status]}</span>
						</div>
					</header>
					<p className="story-summary">{detail.story.summary}</p>
					<div className="feedback">
						{sent[detail.story.id] ? (
							<span className="feedback-done">已反馈 {sent[detail.story.id] === "up" ? "👍" : "👎"}，Analyst 下轮会参考</span>
						) : (
							<>
								<button onClick={() => sendFeedback(detail.story.id, "up")}>👍 有价值</button>
								<button onClick={() => sendFeedback(detail.story.id, "down")}>👎 不关心</button>
							</>
						)}
					</div>
					<h3>时间线（{detail.items.length} 条来源）</h3>
					<ul className="timeline">
						{detail.items.map((it) => (
							<li key={it.id}>
								<span className="timeline-time">
									{it.publishedAt ? new Date(it.publishedAt).toLocaleString("zh-CN") : "时间未知"} · {it.sourceId}
								</span>
								<a href={it.url} target="_blank" rel="noreferrer">
									{it.title}
								</a>
							</li>
						))}
					</ul>
				</article>
			)}
		</div>
	);
}
