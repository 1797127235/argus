/** 建表语句。启动时幂等执行 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	source_id TEXT NOT NULL,
	guid TEXT NOT NULL,
	url TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL,
	content TEXT NOT NULL DEFAULT '',
	published_at TEXT,
	fetched_at TEXT NOT NULL,
	analyzed_at TEXT,
	UNIQUE(source_id, guid)
);
CREATE INDEX IF NOT EXISTS idx_items_pending ON items(analyzed_at) WHERE analyzed_at IS NULL;

CREATE TABLE IF NOT EXISTS stories (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL,
	summary TEXT NOT NULL,
	status TEXT NOT NULL,
	score REAL NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS story_items (
	story_id INTEGER NOT NULL,
	item_id INTEGER NOT NULL,
	PRIMARY KEY (story_id, item_id)
);

CREATE TABLE IF NOT EXISTS briefs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	content TEXT NOT NULL,
	story_ids TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	story_id INTEGER NOT NULL,
	verdict TEXT NOT NULL,
	comment TEXT,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_health (
	source_id TEXT PRIMARY KEY,
	last_fetch_at TEXT,
	last_ok_at TEXT,
	last_error TEXT,
	fail_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	role TEXT NOT NULL,
	summary TEXT NOT NULL,
	input_count INTEGER NOT NULL,
	tool_calls INTEGER NOT NULL,
	usage_input INTEGER,
	usage_output INTEGER,
	started_at TEXT NOT NULL,
	finished_at TEXT NOT NULL
);
`;
