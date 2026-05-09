import { getAgentDefinition } from "@/lib/agents";
import { getAgentTask, updateAgentTask } from "@/lib/agentTaskRepository";
import { acpCreateSession, acpLoadSession } from "@/services/acpService";
import { getResolvedConfig } from "@/services/configService";
import { getDiffStat, getCommitMessages } from "@/services/git";
import { emitSystemLog } from "@/services/logStreamService";
import type { PlannerLogCallback } from "@/services/planner";

const EXECUTION_PROMPT = `The plan has been approved. Please implement it now in the working directory.

Run the project's tests before considering the task done.
Commit in logical chunks. Do not push — the orchestrator handles that.`;

export async function executeTask(taskId: string, onLine?: PlannerLogCallback): Promise<void> {
	const task = await getAgentTask(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);
	if (!task.worktreePath) throw new Error(`Task ${taskId} has no worktree path`);

	const { worktreePath } = task;

	await updateAgentTask(taskId, { status: "executing" });

	const emit: PlannerLogCallback = (event) => {
		onLine?.(event);
	};

	try {
		const settings = await getResolvedConfig(task.workspacePath, task.owner, task.repo);
		const agentDef = getAgentDefinition(settings.ai_backend);

		// Resume the planning session if available; otherwise create a fresh one
		const session = task.acpSessionId
			? await acpLoadSession(task.acpSessionId, worktreePath, agentDef.acpCommand, agentDef.acpArgs)
			: await acpCreateSession(worktreePath, agentDef.acpCommand, agentDef.acpArgs);

		if (!task.acpSessionId) {
			await updateAgentTask(taskId, { acpSessionId: session.sessionId });
		}

		// Stream execution output line by line
		let lineBuffer = "";
		const unsubscribe = session.subscribe((agentEvent) => {
			if (agentEvent.event.type !== "message_chunk") return;
			const text = agentEvent.event.text;
			lineBuffer += text;
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				emitSystemLog(taskId, line, emit).catch(console.error);
			}
		});

		await session.send(EXECUTION_PROMPT);
		unsubscribe();
		await session.dispose();

		// Flush any remaining partial line
		if (lineBuffer) {
			await emitSystemLog(taskId, lineBuffer, emit);
		}

		// Capture and log diff stat + commit messages
		const baseBranch = `origin/${task.baseBranch}`;
		const [diffStat, commitMessages] = await Promise.all([
			getDiffStat(worktreePath, baseBranch),
			getCommitMessages(worktreePath, baseBranch),
		]);

		await emitSystemLog(
			taskId,
			`Changes: ${diffStat.filesChanged} files, +${diffStat.insertions}/-${diffStat.deletions}`,
			emit
		);
		if (commitMessages.length > 0) {
			await emitSystemLog(taskId, `Commits:\n${commitMessages.map((m) => `  ${m}`).join("\n")}`, emit);
		}

		await updateAgentTask(taskId, { status: "pushing" });
	} catch (err) {
		await updateAgentTask(taskId, {
			status: "failed",
			error: err instanceof Error ? err.message : String(err),
		});
		// Worktree is preserved intentionally for debugging
		throw err;
	}
}

export async function retryTask(taskId: string, onLine?: PlannerLogCallback): Promise<void> {
	await updateAgentTask(taskId, { status: "executing", error: undefined });
	await executeTask(taskId, onLine);
}
