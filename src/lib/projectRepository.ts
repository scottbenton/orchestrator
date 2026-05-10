import { v4 as uuid } from "uuid";
import { getDb } from "@/lib/db";
import { detectDefaultBranch } from "@/services/git";
import type { Project } from "@/types/project";

interface ProjectRow {
	id: string;
	workspace_path: string;
	owner: string;
	repo: string;
	repo_path: string;
	base_branch: string;
	created_at: string;
	updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
	return {
		id: row.id,
		workspacePath: row.workspace_path,
		owner: row.owner,
		repo: row.repo,
		repoPath: row.repo_path,
		baseBranch: row.base_branch,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function findOrCreateProject(
	workspacePath: string,
	owner: string,
	repo: string,
	repoPath: string
): Promise<Project> {
	const db = await getDb();
	const existing = await db.select<ProjectRow[]>(
		"SELECT * FROM projects WHERE workspace_path = ? AND owner = ? AND repo = ?",
		[workspacePath, owner, repo]
	);
	if (existing[0]) return rowToProject(existing[0]);

	const id = uuid();
	const now = new Date().toISOString();
	const baseBranch = await detectDefaultBranch(repoPath);

	await db.execute(
		`INSERT INTO projects (id, workspace_path, owner, repo, repo_path, base_branch, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[id, workspacePath, owner, repo, repoPath, baseBranch, now, now]
	);

	return { id, workspacePath, owner, repo, repoPath, baseBranch, createdAt: now, updatedAt: now };
}

export async function getProject(id: string): Promise<Project | null> {
	const db = await getDb();
	const rows = await db.select<ProjectRow[]>("SELECT * FROM projects WHERE id = ?", [id]);
	return rows[0] ? rowToProject(rows[0]) : null;
}

export async function listProjects(workspacePath: string): Promise<Project[]> {
	const db = await getDb();
	const rows = await db.select<ProjectRow[]>(
		"SELECT * FROM projects WHERE workspace_path = ? ORDER BY created_at ASC",
		[workspacePath]
	);
	return rows.map(rowToProject);
}
