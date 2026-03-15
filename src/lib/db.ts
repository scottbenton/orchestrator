import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
	if (!db) {
		db = await Database.load("sqlite:orchestrator.db");
		await migrate(db);
	}
	return db;
}

async function migrate(db: Database): Promise<void> {
	await db.execute(`
		CREATE TABLE IF NOT EXISTS task_logs (
			id        TEXT PRIMARY KEY,
			task_id   TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			stream    TEXT NOT NULL CHECK(stream IN ('stdout', 'stderr', 'system')),
			line      TEXT NOT NULL
		)
	`);
	await db.execute(
		"CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id)",
	);
	await db.execute(`
		CREATE TABLE IF NOT EXISTS task_interactions (
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
	await db.execute(
		"CREATE INDEX IF NOT EXISTS idx_task_interactions_task_id ON task_interactions(task_id)",
	);
}
