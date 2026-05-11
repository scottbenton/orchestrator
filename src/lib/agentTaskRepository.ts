import { getDb } from "@/lib/db";
import type { AgentTask, TaskStatus, TaskType } from "@/types/agent-task";

// ---------------------------------------------------------------------------
// Row shape returned by SQLite selects (agent_tasks JOIN projects)
// ---------------------------------------------------------------------------

interface AgentTaskRow {
	id: string;
	project_id: string;
	task_type: string;
	parent_task_id: string | null;
	title: string;
	description: string;
	source_url: string | null;
	source_provider: string | null;
	source_item_id: string | null;
	branch_name: string;
	worktree_path: string | null;
	status: string;
	plan: string | null;
	acp_session_id: string | null;
	pr_url: string | null;
	head_sha: string | null;
	error: string | null;
	archived_at: string | null;
	created_at: string;
	updated_at: string;
	// From projects JOIN
	workspace_path: string;
	owner: string;
	repo: string;
	repo_path: string;
	base_branch: string;
}

const TASK_JOIN = `
	SELECT
		t.id, t.project_id, t.task_type, t.parent_task_id,
		t.title, t.description, t.source_url, t.source_provider, t.source_item_id,
		t.branch_name, t.worktree_path, t.status, t.plan,
		t.acp_session_id, t.pr_url, t.head_sha, t.error,
		t.archived_at, t.created_at, t.updated_at,
		p.workspace_path, p.owner, p.repo, p.repo_path, p.base_branch
	FROM agent_tasks t
	JOIN projects p ON p.id = t.project_id
`;

function rowToTask(row: AgentTaskRow): AgentTask {
	return {
		id: row.id,
		projectId: row.project_id,
		taskType: row.task_type as TaskType,
		parentTaskId: row.parent_task_id ?? undefined,
		title: row.title,
		description: row.description,
		sourceUrl: row.source_url ?? undefined,
		sourceProvider: row.source_provider ?? undefined,
		sourceItemId: row.source_item_id ?? undefined,
		workspacePath: row.workspace_path,
		repoPath: row.repo_path,
		owner: row.owner,
		repo: row.repo,
		baseBranch: row.base_branch,
		branchName: row.branch_name,
		worktreePath: row.worktree_path ?? undefined,
		status: row.status as TaskStatus,
		plan: row.plan ? (JSON.parse(row.plan) as string[]) : undefined,
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

export interface CreateAgentTaskInput {
	id: string;
	projectId: string;
	taskType: TaskType;
	parentTaskId?: string;
	title: string;
	description: string;
	sourceUrl?: string;
	sourceProvider?: string;
	sourceItemId?: string;
	branchName: string;
	worktreePath?: string;
	status: TaskStatus;
	plan?: string[];
	acpSessionId?: string;
	prUrl?: string;
	headSha?: string;
	error?: string;
	archivedAt?: string;
}

export async function createAgentTask(input: CreateAgentTaskInput): Promise<void> {
	const db = await getDb();
	const now = new Date().toISOString();

	await db.execute(
		`INSERT INTO agent_tasks (
			id, project_id, task_type, parent_task_id, title, description,
			source_url, source_provider, source_item_id, branch_name, worktree_path, status,
			plan, acp_session_id, pr_url, head_sha, error, archived_at,
			created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?,
			?, ?, ?
		)`,
		[
			input.id,
			input.projectId,
			input.taskType,
			input.parentTaskId ?? null,
			input.title,
			input.description,
			input.sourceUrl ?? null,
			input.sourceProvider ?? null,
			input.sourceItemId ?? null,
			input.branchName,
			input.worktreePath ?? null,
			input.status,
			input.plan ? JSON.stringify(input.plan) : null,
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
		`${TASK_JOIN} WHERE t.id = ?`,
		[id]
	);
	return rows[0] ? rowToTask(rows[0]) : null;
}

export type UpdateAgentTaskInput = Partial<
	Omit<
		AgentTask,
		| "id"
		| "projectId"
		| "taskType"
		| "parentTaskId"
		| "workspacePath"
		| "repoPath"
		| "owner"
		| "repo"
		| "baseBranch"
		| "createdAt"
		| "updatedAt"
	>
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
			title          = COALESCE(?, title),
			description    = COALESCE(?, description),
			source_url     = COALESCE(?, source_url),
			source_provider = COALESCE(?, source_provider),
			source_item_id = COALESCE(?, source_item_id),
			branch_name    = COALESCE(?, branch_name),
			worktree_path  = COALESCE(?, worktree_path),
			status         = COALESCE(?, status),
			plan           = COALESCE(?, plan),
			acp_session_id = COALESCE(?, acp_session_id),
			pr_url         = COALESCE(?, pr_url),
			head_sha       = COALESCE(?, head_sha),
			error          = COALESCE(?, error),
			archived_at    = COALESCE(?, archived_at),
			updated_at     = ?
		WHERE id = ?`,
		[
			updates.title ?? null,
			updates.description ?? null,
			updates.sourceUrl ?? null,
			updates.sourceProvider ?? null,
			updates.sourceItemId ?? null,
			updates.branchName ?? null,
			updates.worktreePath ?? null,
			updates.status ?? null,
			updates.plan !== undefined ? JSON.stringify(updates.plan) : null,
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
		`${TASK_JOIN}
		 WHERE p.workspace_path = ? AND p.owner = ? AND p.repo = ? AND t.archived_at IS NULL
		 ORDER BY t.created_at DESC`,
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
		`${TASK_JOIN}
		 WHERE p.workspace_path = ? AND p.owner = ? AND p.repo = ? AND t.archived_at IS NOT NULL
		 ORDER BY t.archived_at DESC`,
		[workspacePath, owner, repo]
	);
	return rows.map(rowToTask);
}
