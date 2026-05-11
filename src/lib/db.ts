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

	// v3 — introduce projects table, normalize per-repo data (issue #48)
	async (db) => {
		// Create projects table
		await db.execute(`
			CREATE TABLE projects (
				id             TEXT PRIMARY KEY,
				workspace_path TEXT NOT NULL,
				owner          TEXT NOT NULL,
				repo           TEXT NOT NULL,
				repo_path      TEXT NOT NULL,
				base_branch    TEXT NOT NULL DEFAULT 'main',
				created_at     TEXT NOT NULL,
				updated_at     TEXT NOT NULL
			)
		`);
		await db.execute(
			"CREATE UNIQUE INDEX idx_projects_workspace_owner_repo ON projects(workspace_path, owner, repo)"
		);

		// Migrate one project row per unique (workspace_path, owner, repo)
		const now = new Date().toISOString();
		await db.execute(`
			INSERT INTO projects (id, workspace_path, owner, repo, repo_path, base_branch, created_at, updated_at)
			SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
			       workspace_path, owner, repo, repo_path, 'main', '${now}', '${now}'
			FROM (
				SELECT DISTINCT workspace_path, owner, repo, repo_path
				FROM agent_tasks
			)
		`);

		// Recreate agent_tasks without the per-repo columns, adding project_id FK
		await db.execute(`
			CREATE TABLE agent_tasks_new (
				id               TEXT PRIMARY KEY,
				project_id       TEXT NOT NULL REFERENCES projects(id),
				task_type        TEXT NOT NULL DEFAULT 'ticket_impl',
				parent_task_id   TEXT REFERENCES agent_tasks_new(id),
				title            TEXT NOT NULL,
				description      TEXT NOT NULL,
				source_url       TEXT,
				source_provider  TEXT,
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

		// Copy rows, resolving project_id via subquery
		await db.execute(`
			INSERT INTO agent_tasks_new
			SELECT
				t.id,
				p.id,
				t.task_type,
				t.parent_task_id,
				t.title,
				t.description,
				t.source_url,
				t.source_provider,
				t.branch_name,
				t.worktree_path,
				t.status,
				t.plan,
				t.acp_session_id,
				t.pr_url,
				t.head_sha,
				t.error,
				t.archived_at,
				t.created_at,
				t.updated_at
			FROM agent_tasks t
			JOIN projects p ON p.workspace_path = t.workspace_path
			                AND p.owner = t.owner
			                AND p.repo = t.repo
		`);

		await db.execute("DROP TABLE agent_tasks");
		await db.execute("ALTER TABLE agent_tasks_new RENAME TO agent_tasks");
		await db.execute("CREATE INDEX idx_agent_tasks_project ON agent_tasks(project_id)");
		await db.execute("CREATE INDEX idx_agent_tasks_status ON agent_tasks(status)");
	},

	// v4 — add source_item_id to agent_tasks for ticket source transitions (issue #12)
	async (db) => {
		await db.execute("ALTER TABLE agent_tasks ADD COLUMN source_item_id TEXT");
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
