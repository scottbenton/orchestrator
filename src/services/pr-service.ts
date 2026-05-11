import { getAgentTask, updateAgentTask } from "@/lib/agentTaskRepository";
import { getGitHubToken } from "@/services/github-auth";
import { acpCreateSession, acpLoadSession } from "@/services/acpService";
import { getResolvedConfig, readRepoSettings } from "@/services/configService";
import { GitHubProjectsSource } from "@/services/github-projects";
import { getDiffStat, getCommitMessages, pushBranch } from "@/services/git";
import { emitSystemLog } from "@/services/logStreamService";
import { getAgentDefinition } from "@/lib/agents";
import type { AcpSessionHandle } from "@/services/acpService";
import type { ProcessEvent } from "@/types/logs";

export type LogCallback = (event: ProcessEvent) => void;

export class PushError extends Error {
	constructor(message: string, public readonly cause?: Error) {
		super(message);
		this.name = "PushError";
	}
}

const PR_DESCRIPTION_PROMPT = (
	title: string,
	description: string,
	commitMessages: string[],
	filesChanged: number,
	insertions: number,
	deletions: number,
	sourceUrl?: string,
) => `Task: ${title}
Description: ${description}
Commits:
${commitMessages.map((m) => `- ${m}`).join("\n")}
Files changed: ${filesChanged} (${insertions}+, ${deletions}-)

Write a GitHub pull request description using exactly this format:

## Summary
- <bullet>

## Changes
<key technical decisions>

## Testing
<what was tested>
${sourceUrl ? `\nCloses ${sourceUrl}` : ""}`;

async function generatePrDescription(
	worktreePath: string,
	acpSessionId: string | undefined,
	agentDef: { acpCommand: string; acpArgs: string[] },
	prompt: string,
): Promise<string> {
	let session: AcpSessionHandle | undefined;

	try {
		if (acpSessionId) {
			session = await acpLoadSession(acpSessionId, worktreePath, agentDef.acpCommand, agentDef.acpArgs);
		} else {
			session = await acpCreateSession(worktreePath, agentDef.acpCommand, agentDef.acpArgs);
		}

		const chunks: string[] = [];

		const unsubscribe = session.subscribe((agentEvent) => {
			if (agentEvent.event.type !== "message_chunk") return;
			chunks.push(agentEvent.event.text);
		});

		await session.send(prompt);
		unsubscribe();

		return chunks.join("").trim();
	} finally {
		await session?.dispose();
	}
}

interface GitHubPrResponse {
	number: number;
	html_url: string;
}

async function createGitHubPr(opts: {
	owner: string;
	repo: string;
	token: string;
	title: string;
	body: string;
	head: string;
	base: string;
	draft: boolean;
}): Promise<GitHubPrResponse> {
	const response = await fetch(`https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${opts.token}`,
			"Content-Type": "application/json",
			Accept: "application/vnd.github+json",
		},
		body: JSON.stringify({
			title: opts.title,
			body: opts.body,
			head: opts.head,
			base: opts.base,
			draft: opts.draft,
		}),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => response.statusText);
		throw new Error(`GitHub PR creation failed (${response.status}): ${text}`);
	}

	return response.json() as Promise<GitHubPrResponse>;
}

async function addGitHubLabels(
	owner: string,
	repo: string,
	prNumber: number,
	labels: string[],
	token: string,
): Promise<void> {
	if (labels.length === 0) return;

	const response = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/labels`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				Accept: "application/vnd.github+json",
			},
			body: JSON.stringify({ labels }),
		},
	);

	if (!response.ok) {
		const text = await response.text().catch(() => response.statusText);
		throw new Error(`Failed to add labels (${response.status}): ${text}`);
	}
}

export async function openPullRequest(taskId: string, onLine?: LogCallback): Promise<void> {
	const task = await getAgentTask(taskId);
	if (!task) throw new Error(`Task ${taskId} not found`);
	if (!task.worktreePath) throw new Error(`Task ${taskId} has no worktree path`);

	const { worktreePath, owner, repo, baseBranch, branchName, workspacePath } = task;

	const config = await getResolvedConfig(workspacePath, owner, repo);
	const agentDef = getAgentDefinition(config.ai_backend);

	// Step 1: Push branch — failure stays in `pushing` for retry
	await emitSystemLog(taskId, "Pushing branch...", onLine);
	try {
		await pushBranch({ worktreePath, remote: "origin", branchName, taskId, onLine: onLine ?? (() => {}) });
	} catch (err) {
		throw new PushError(
			`Failed to push branch: ${err instanceof Error ? err.message : String(err)}`,
			err instanceof Error ? err : undefined,
		);
	}

	try {
		// Step 2: Gather commit info for PR description
		const [commitMessages, diffStat] = await Promise.all([
			getCommitMessages(worktreePath, baseBranch),
			getDiffStat(worktreePath, baseBranch),
		]);

		// Step 3: Generate PR description via ACP session
		await emitSystemLog(taskId, "Generating PR description...", onLine);
		const descriptionPrompt = PR_DESCRIPTION_PROMPT(
			task.title,
			task.description,
			commitMessages,
			diffStat.filesChanged,
			diffStat.insertions,
			diffStat.deletions,
			task.sourceUrl,
		);
		const prBody = await generatePrDescription(
			worktreePath,
			task.acpSessionId,
			agentDef,
			descriptionPrompt,
		);

		// Step 4: Create PR via GitHub REST API
		await emitSystemLog(taskId, "Creating pull request...", onLine);
		const token = await getGitHubToken();
		if (!token) throw new Error("No GitHub token configured");

		const pr = await createGitHubPr({
			owner,
			repo,
			token,
			title: task.title,
			body: prBody,
			head: branchName,
			base: baseBranch,
			draft: config.pr_draft,
		});

		// Step 5: Apply labels if configured
		if (config.pr_labels.length > 0) {
			await addGitHubLabels(owner, repo, pr.number, config.pr_labels, token).catch((err) => {
				console.error("Failed to add PR labels (non-fatal):", err);
			});
		}

		// Step 6: Update task status
		await updateAgentTask(taskId, { status: "pr_open", prUrl: pr.html_url });

		// Step 7: Transition source ticket if configured
		if (
			task.sourceProvider === "github_projects" &&
			task.sourceItemId &&
			config.transitions.on_pr_open
		) {
			const repoSettings = await readRepoSettings(workspacePath, owner, repo);
			if (repoSettings?.github_project_number) {
				await new GitHubProjectsSource(owner, repoSettings.github_project_number)
					.transitionTask(task.sourceItemId, config.transitions.on_pr_open)
					.catch((err) => {
						console.error("Failed to transition source ticket (non-fatal):", err);
					});
			}
		}

		await emitSystemLog(taskId, `PR opened: ${pr.html_url}`, onLine);
	} catch (err) {
		await updateAgentTask(taskId, {
			status: "failed",
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}
}
