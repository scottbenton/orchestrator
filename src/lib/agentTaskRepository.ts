import { getDb } from "@/lib/db";
import type { AgentTask, TaskStatus, TaskType } from "@/types/agent-task";

// ---------------------------------------------------------------------------
// Row shape returned by SQLite selects
// ---------------------------------------------------------------------------

interface AgentTaskRow {
	id: string;
	task_type: string;
	parent_task_id: string | null;
	title: string;
	description: string;
	source_url: string | null;
	source_provider: string | null;
	workspace_path: string;
	repo_path: string;
	owner: string;
	repo: string;
	branch_name: string;
	worktree_path: string | null;
	status: string;
	plan: string | null;
	plan_questions: string | null;
	acp_session_id: string | null;
	pr_url: string | null;
	head_sha: string | null;
	error: string | null;
	archived_at: string | null;
	created_at: string;
	updated_at: string;
}

function rowToTask(row: AgentTaskRow): AgentTask {
	return {
		id: row.id,
		taskType: row.task_type as TaskType,
		parentTaskId: row.parent_task_id ?? undefined,
		title: row.title,
		description: row.description,
		sourceUrl: row.source_url ?? undefined,
		sourceProvider: row.source_provider ?? undefined,
		workspacePath: row.workspace_path,
		repoPath: row.repo_path,
		owner: row.owner,
		repo: row.repo,
		branchName: row.branch_name,
		worktreePath: row.worktree_path ?? undefined,
		status: row.status as TaskStatus,
		plan: row.plan ? (JSON.parse(row.plan) as string[]) : undefined,
		planQuestions: row.plan_questions
			? (JSON.parse(row.plan_questions) as string[])
			: undefined,
		acpSessionId: row.acp_session_id ?? undefined,
		prUrl: row.pr_url ?? undefined,
		headSha: row.head_sha ?? undefined,
		error: row.error ?? undefined,
		archivedAt: row.archived_at ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CreateAgentTaskInput = Omit<AgentTask, "createdAt" | "updatedAt">;

export async function createAgentTask(input: CreateAgentTaskInput): Promise<void> {
	const db = await getDb();
	const now = new Date().toISOString();
	const { id } = input;

	await db.execute(
		`INSERT INTO agent_tasks (
			id, task_type, parent_task_id, title, description,
			source_url, source_provider, workspace_path, repo_path,
			owner, repo, branch_name, worktree_path, status,
			plan, plan_questions, acp_session_id,
			pr_url, head_sha, error, archived_at, created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?,
			?, ?, ?, ?, ?, ?
		)`,
		[
			id,
			input.taskType,
			input.parentTaskId ?? null,
			input.title,
			input.description,
			input.sourceUrl ?? null,
			input.sourceProvider ?? null,
			input.workspacePath,
			input.repoPath,
			input.owner,
			input.repo,
			input.branchName,
			input.worktreePath ?? null,
			input.status,
			input.plan ? JSON.stringify(input.plan) : null,
			input.planQuestions ? JSON.stringify(input.planQuestions) : null,
			input.acpSessionId ?? null,
			input.prUrl ?? null,
			input.headSha ?? null,
			input.error ?? null,
			input.archivedAt ?? null,
			now,
			now,
		]
	);

}

export async function getAgentTask(id: string): Promise<AgentTask | null> {
	const db = await getDb();
	const rows = await db.select<AgentTaskRow[]>(
		"SELECT * FROM agent_tasks WHERE id = ?",
		[id]
	);
	return rows[0] ? rowToTask(rows[0]) : null;
}

export type UpdateAgentTaskInput = Partial<
	Omit<AgentTask, "id" | "taskType" | "parentTaskId" | "createdAt" | "updatedAt">
>;

export async function updateAgentTask(
	id: string,
	updates: UpdateAgentTaskInput
): Promise<void> {
	const db = await getDb();
	const now = new Date().toISOString();

	// Auto-archive on terminal statuses
	const archivedAt =
		updates.archivedAt !== undefined
			? updates.archivedAt
			: updates.status === "done" || updates.status === "cancelled"
				? now
				: undefined;

	await db.execute(
		`UPDATE agent_tasks SET
			title            = COALESCE(?, title),
			description      = COALESCE(?, description),
			source_url       = COALESCE(?, source_url),
			source_provider  = COALESCE(?, source_provider),
			workspace_path   = COALESCE(?, workspace_path),
			repo_path        = COALESCE(?, repo_path),
			owner            = COALESCE(?, owner),
			repo             = COALESCE(?, repo),
			branch_name      = COALESCE(?, branch_name),
			worktree_path    = COALESCE(?, worktree_path),
			status           = COALESCE(?, status),
			plan             = COALESCE(?, plan),
			plan_questions   = COALESCE(?, plan_questions),
			acp_session_id   = COALESCE(?, acp_session_id),
			pr_url           = COALESCE(?, pr_url),
			head_sha         = COALESCE(?, head_sha),
			error            = COALESCE(?, error),
			archived_at      = COALESCE(?, archived_at),
			updated_at       = ?
		WHERE id = ?`,
		[
			updates.title ?? null,
			updates.description ?? null,
			updates.sourceUrl ?? null,
			updates.sourceProvider ?? null,
			updates.workspacePath ?? null,
			updates.repoPath ?? null,
			updates.owner ?? null,
			updates.repo ?? null,
			updates.branchName ?? null,
			updates.worktreePath ?? null,
			updates.status ?? null,
			updates.plan !== undefined ? JSON.stringify(updates.plan) : null,
			updates.planQuestions !== undefined ? JSON.stringify(updates.planQuestions) : null,
			updates.acpSessionId ?? null,
			updates.prUrl ?? null,
			updates.headSha ?? null,
			updates.error ?? null,
			archivedAt ?? null,
			now,
			id,
		]
	);
}

export async function listActiveAgentTasks(
	workspacePath: string,
	owner: string,
	repo: string
): Promise<AgentTask[]> {
	const db = await getDb();
	const rows = await db.select<AgentTaskRow[]>(
		`SELECT * FROM agent_tasks
		 WHERE workspace_path = ? AND owner = ? AND repo = ? AND archived_at IS NULL
		 ORDER BY created_at DESC`,
		[workspacePath, owner, repo]
	);
	return rows.map(rowToTask);
}

export async function listArchivedAgentTasks(
	workspacePath: string,
	owner: string,
	repo: string
): Promise<AgentTask[]> {
	const db = await getDb();
	const rows = await db.select<AgentTaskRow[]>(
		`SELECT * FROM agent_tasks
		 WHERE workspace_path = ? AND owner = ? AND repo = ? AND archived_at IS NOT NULL
		 ORDER BY archived_at DESC`,
		[workspacePath, owner, repo]
	);
	return rows.map(rowToTask);
}
