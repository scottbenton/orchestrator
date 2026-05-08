import { v4 as uuid } from "uuid";
import { getAgentDefinition } from "@/lib/agents";
import { createAgentTask, getAgentTask, updateAgentTask } from "@/lib/agentTaskRepository";
import { acpCreateSession } from "@/services/acpService";
import { getResolvedConfig } from "@/services/configService";
import { agentBranchName, createWorktree, worktreePath as buildWorktreePath } from "@/services/git";
import { emitSystemLog } from "@/services/logStreamService";
import { buildSystemPrompt, detectLanguage } from "@/services/workspace";
import type { TaskType } from "@/types/agent-task";
import type { Task } from "@/types/task";
import type { ProcessEvent } from "@/types/logs";
import type { WorkspaceContext } from "@/services/workspace";

export type PlannerLogCallback = (event: ProcessEvent) => void;

// ---------------------------------------------------------------------------
// startTask — creates DB record, fires plan generation in the background
// ---------------------------------------------------------------------------

export async function startTask(
	task: Task,
	workspaceCtx: WorkspaceContext,
	opts?: { parentTaskId?: string; taskType?: TaskType }
): Promise<string> {
	const id = uuid();
	const branchName = agentBranchName(id);
	const wPath = buildWorktreePath(
		workspaceCtx.workspacePath,
		workspaceCtx.owner,
		workspaceCtx.repo,
		id
	);

	await createAgentTask({
		id,
		taskType: opts?.taskType ?? "ticket_impl",
		parentTaskId: opts?.parentTaskId,
		title: task.title,
		description: task.description,
		sourceUrl: task.url,
		sourceProvider: task.provider,
		workspacePath: workspaceCtx.workspacePath,
		repoPath: workspaceCtx.repoPath,
		owner: workspaceCtx.owner,
		repo: workspaceCtx.repo,
		branchName,
		worktreePath: wPath,
		status: "pending",
	});

	// Fire plan generation asynchronously — errors transition the task to 'failed'
	generatePlan(id).catch(async (err) => {
		await updateAgentTask(id, {
			status: "failed",
			error: err instanceof Error ? err.message : String(err),
		}).catch(console.error);
	});

	return id;
}

// ---------------------------------------------------------------------------
// generatePlan — creates worktree, runs AI planner, stores plan in DB
// ---------------------------------------------------------------------------

export async function generatePlan(
	taskId: string,
	onLine?: PlannerLogCallback
): Promise<void> {
	const task = await getAgentTask(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);
	if (!task.worktreePath) throw new Error(`Task ${taskId} has no worktree path`);

	const { worktreePath } = task;

	await updateAgentTask(taskId, { status: "planning" });

	const emit: PlannerLogCallback = (event) => {
		onLine?.(event);
	};

	try {
		// Create the worktree
		await createWorktree({
			repoPath: task.repoPath,
			worktreePath,
			branchName: task.branchName,
			baseBranch: "main",
			taskId,
			onLine: emit,
		});

		// Build workspace context for the system prompt
		const settings = await getResolvedConfig(task.workspacePath, task.owner, task.repo);
		const primaryLanguage = await detectLanguage(task.repoPath);

		const workspaceCtx: WorkspaceContext = {
			workspacePath: task.workspacePath,
			settings: {
				name: settings.name,
				ai_backend: settings.ai_backend,
				editor: settings.editor,
			},
			repoPath: task.repoPath,
			owner: task.owner,
			repo: task.repo,
			primaryLanguage,
		};

		const systemPrompt = await buildSystemPrompt(
			workspaceCtx,
			{ id: taskId, description: task.description },
			task.branchName,
			worktreePath
		);

		// Build the plan generation prompt
		const planPrompt = `${systemPrompt}

## Task
Title: ${task.title}
Description:
${task.description}

Output a numbered implementation plan. Each step = one atomic change.
List any ambiguities as QUESTIONS before the plan.

Format:
QUESTIONS:
- ...
(omit if none)

PLAN:
1. ...
2. ...`;

		// Start ACP session in the worktree
		const agentDef = getAgentDefinition(settings.ai_backend);
		const session = await acpCreateSession(
			worktreePath,
			agentDef.acpCommand,
			agentDef.acpArgs
		);

		await updateAgentTask(taskId, { acpSessionId: session.sessionId });

		// Stream response, buffering incomplete lines for log emission
		const responseChunks: string[] = [];
		let lineBuffer = "";

		const unsubscribe = session.subscribe((agentEvent) => {
			if (agentEvent.event.type !== "message_chunk") return;
			const text = agentEvent.event.text;
			responseChunks.push(text);
			lineBuffer += text;
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				emitSystemLog(taskId, line, emit).catch(console.error);
			}
		});

		await session.send(planPrompt);
		unsubscribe();

		// Flush any remaining partial line
		if (lineBuffer) {
			await emitSystemLog(taskId, lineBuffer, emit);
		}

		const fullResponse = responseChunks.join("");
		const plan = parsePlanResponse(fullResponse);

		await updateAgentTask(taskId, {
			plan,
			status: "awaiting_review",
		});

		// Auto-approve when plan review is disabled
		if (!settings.plan_review) {
			await approvePlan(taskId);
		}
	} catch (err) {
		await updateAgentTask(taskId, {
			status: "failed",
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}
}

// ---------------------------------------------------------------------------
// approvePlan — transitions to executing
// ---------------------------------------------------------------------------

export async function approvePlan(taskId: string): Promise<void> {
	const task = await getAgentTask(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);

	await updateAgentTask(taskId, { status: "executing" });

	// TODO: issue #11 — trigger execution here using task.acpSessionId
}

// ---------------------------------------------------------------------------
// dismissTask — cancels from any state
// ---------------------------------------------------------------------------

export async function dismissTask(taskId: string): Promise<void> {
	await updateAgentTask(taskId, { status: "cancelled" });
}

// ---------------------------------------------------------------------------
// Plan response parser
// ---------------------------------------------------------------------------

function parsePlanResponse(response: string): string[] {
	const plan: string[] = [];

	// Extract PLAN section
	const planMatch = response.match(/PLAN:\s*\n([\s\S]*?)(?=\n#|$)/i);
	if (planMatch) {
		for (const line of planMatch[1].split("\n")) {
			const trimmed = line.replace(/^\d+[.)]\s*/, "").trim();
			if (trimmed) plan.push(trimmed);
		}
	}

	// Lenient fallback: treat any numbered lines as steps
	if (plan.length === 0) {
		for (const line of response.split("\n")) {
			const match = line.match(/^\s*\d+[.)]\s+(.+)/);
			if (match) plan.push(match[1].trim());
		}
	}

	return plan;
}
