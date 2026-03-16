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
	// v2 — AI tabs: store raw stream-json event alongside parsed line (issue #6)
	async (db) => {
		await db.execute("ALTER TABLE task_logs ADD COLUMN raw_event TEXT");
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
