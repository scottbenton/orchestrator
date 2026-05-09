import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
	if (!db) {
		db = await Database.load("sqlite:orchestrator.db");
		await migrate(db);
	}
	return db;
}

// ---------------------------------------------------------------------------
// Migrations
//
// Append-only. Never edit an existing entry — add a new one.
// Schema version is stored in SQLite's built-in PRAGMA user_version,
// so no bootstrap table is needed.
// ---------------------------------------------------------------------------

const MIGRATIONS: Array<(db: Database) => Promise<void>> = [
	// v1 — log capture + streaming (issue #5)
	async (db) => {
		await db.execute(`
			CREATE TABLE task_logs (
				id        TEXT PRIMARY KEY,
				task_id   TEXT NOT NULL,
				timestamp TEXT NOT NULL,
				stream    TEXT NOT NULL CHECK(stream IN ('stdout', 'stderr', 'system')),
				line      TEXT NOT NULL
			)
		`);
		await db.execute("CREATE INDEX idx_task_logs_task_id ON task_logs(task_id)");
		await db.execute(`
			CREATE TABLE task_interactions (
				id          TEXT PRIMARY KEY,
				task_id     TEXT NOT NULL,
				timestamp   TEXT NOT NULL,
				type        TEXT NOT NULL,
				payload     TEXT NOT NULL,
				status      TEXT NOT NULL DEFAULT 'pending',
				resolved_at TEXT,
				resolution  TEXT
			)
		`);
		await db.execute("CREATE INDEX idx_task_interactions_task_id ON task_interactions(task_id)");
	},

	// v2 — agent task pipeline (issue #10)
	async (db) => {
		await db.execute(`
			CREATE TABLE agent_tasks (
				id               TEXT PRIMARY KEY,
				task_type        TEXT NOT NULL DEFAULT 'ticket_impl',
				parent_task_id   TEXT REFERENCES agent_tasks(id),
				title            TEXT NOT NULL,
				description      TEXT NOT NULL,
				source_url       TEXT,
				source_provider  TEXT,
				workspace_path   TEXT NOT NULL,
				repo_path        TEXT NOT NULL,
				owner            TEXT NOT NULL,
				repo             TEXT NOT NULL,
				branch_name      TEXT NOT NULL,
				worktree_path    TEXT,
				status           TEXT NOT NULL DEFAULT 'pending',
				plan             TEXT,
				acp_session_id   TEXT,
				pr_url           TEXT,
				head_sha         TEXT,
				error            TEXT,
				archived_at      TEXT,
				created_at       TEXT NOT NULL,
				updated_at       TEXT NOT NULL
			)
		`);
		await db.execute(
			"CREATE INDEX idx_agent_tasks_workspace ON agent_tasks(workspace_path, owner, repo)"
		);
		await db.execute("CREATE INDEX idx_agent_tasks_status ON agent_tasks(status)");
	},

	// v3 — base branch per task (issue #11)
	async (db) => {
		await db.execute(
			"ALTER TABLE agent_tasks ADD COLUMN base_branch TEXT NOT NULL DEFAULT 'main'"
		);
	},
];

async function migrate(db: Database): Promise<void> {
	const [{ user_version }] = await db.select<[{ user_version: number }]>("PRAGMA user_version");

	for (let i = user_version; i < MIGRATIONS.length; i++) {
		await MIGRATIONS[i](db);
		// PRAGMA user_version doesn't support bound parameters
		await db.execute(`PRAGMA user_version = ${i + 1}`);
	}
}
