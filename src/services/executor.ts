import { getAgentDefinition } from "@/lib/agents";
import { getAgentTask, updateAgentTask } from "@/lib/agentTaskRepository";
import { acpCreateSession, acpLoadSession } from "@/services/acpService";
import { getResolvedConfig } from "@/services/configService";
import { getDiffStat, getCommitMessages } from "@/services/git";
import { emitSystemLog } from "@/services/logStreamService";
import type { AcpSessionHandle } from "@/services/acpService";
import type { ProcessEvent } from "@/types/logs";

export type LogCallback = (event: ProcessEvent) => void;

const EXECUTION_PROMPT = `The plan has been approved. Please implement it now in the working directory.

Run the project's tests before considering the task done.
Commit in logical chunks. Do not push — the orchestrator handles that.`;

export async function executeTask(taskId: string, onLine?: LogCallback): Promise<void> {
	const task = await getAgentTask(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);
	if (!task.worktreePath) throw new Error(`Task ${taskId} has no worktree path`);

	const { worktreePath } = task;

	await updateAgentTask(taskId, { status: "executing" });

	const settings = await getResolvedConfig(task.workspacePath, task.owner, task.repo);
	const agentDef = getAgentDefinition(settings.ai_backend);

	let session: AcpSessionHandle | undefined;

	try {
		if (task.acpSessionId) {
			session = await acpLoadSession(
				task.acpSessionId,
				worktreePath,
				agentDef.acpCommand,
				agentDef.acpArgs
			);
		} else {
			session = await acpCreateSession(worktreePath, agentDef.acpCommand, agentDef.acpArgs);
			await updateAgentTask(taskId, { acpSessionId: session.sessionId });
		}

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
				emitSystemLog(taskId, line, onLine).catch(console.error);
			}
		});

		await session.send(EXECUTION_PROMPT);
		unsubscribe();

		if (lineBuffer) {
			await emitSystemLog(taskId, lineBuffer, onLine);
		}
	} catch (err) {
		await session?.dispose();
		await updateAgentTask(taskId, {
			status: "failed",
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}

	const diffStat = await getDiffStat(worktreePath, task.baseBranch);
	const commitMessages = await getCommitMessages(worktreePath, task.baseBranch);

	await emitSystemLog(
		taskId,
		`Execution complete: ${diffStat.filesChanged} files changed, ${commitMessages.length} commit(s)`,
		onLine
	);

	await session.dispose();
	await updateAgentTask(taskId, { status: "pushing" });
}

// Runs the full task pipeline: agent execution followed by branch push and PR creation.
// Callers should use this rather than calling executeTask and openPullRequest separately.
export async function runTaskPipeline(taskId: string, onLine?: LogCallback): Promise<void> {
	const { openPullRequest } = await import("@/services/pr-service");
	await executeTask(taskId, onLine);
	await openPullRequest(taskId, onLine);
}

export async function retryTask(taskId: string, onLine?: LogCallback): Promise<void> {
	const task = await getAgentTask(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);
	await executeTask(taskId, onLine);
}
