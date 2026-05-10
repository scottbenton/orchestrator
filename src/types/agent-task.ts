export type TaskStatus =
	| "pending"
	| "planning"
	| "awaiting_review"
	| "executing"
	| "pushing"
	| "pr_open"
	| "done"
	| "failed"
	| "cancelled";

export type TaskType = "ticket_impl" | "pr_revision" | "manual";

export interface AgentTask {
	id: string;
	projectId: string;
	taskType: TaskType;
	parentTaskId?: string;
	title: string;
	description: string;
	sourceUrl?: string;
	sourceProvider?: string;
	// Denormalized from projects JOIN — read-only on the task
	workspacePath: string;
	repoPath: string;
	owner: string;
	repo: string;
	baseBranch: string;
	branchName: string;
	worktreePath?: string;
	status: TaskStatus;
	plan?: string[];
	acpSessionId?: string;
	prUrl?: string;
	headSha?: string;
	error?: string;
	archivedAt?: string;
	createdAt: string;
	updatedAt: string;
}
