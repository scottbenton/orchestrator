import { Command } from "@tauri-apps/plugin-shell";
import type { ProcessEvent } from "@/types/logs";
import { emitSystemLog, runProcess } from "./logStreamService";

export type LogCallback = (event: ProcessEvent) => void;

export interface DiffStat {
	filesChanged: number;
	insertions: number;
	deletions: number;
}

export class GitError extends Error {
	constructor(
		message: string,
		public readonly command: string,
		public readonly stderr: string,
		public readonly exitCode: number
	) {
		super(message);
		this.name = "GitError";
	}
}

/**
 * Generate branch name for agent tasks
 * Format: ai/{taskId}
 */
export function agentBranchName(taskId: string): string {
	return `ai/${taskId}`;
}

/**
 * Generate worktree path within workspace
 * Format: {workspacePath}/_worktrees/{owner}/{repo}/{taskId}
 */
export function worktreePath(
	workspacePath: string,
	owner: string,
	repo: string,
	taskId: string
): string {
	return `${workspacePath}/_worktrees/${owner}/${repo}/${taskId}`;
}

/**
 * Create a new worktree branched off baseBranch
 */
export async function createWorktree(opts: {
	repoPath: string;
	worktreePath: string;
	branchName: string;
	baseBranch: string;
	taskId: string;
	onLine: LogCallback;
}): Promise<void> {
	const { repoPath, worktreePath, branchName, baseBranch, taskId, onLine } = opts;

	// First, fetch the base branch to ensure it's up to date
	await emitSystemLog(taskId, `Fetching ${baseBranch} from origin...`, onLine);
	const fetchResult = await runProcess("git", ["fetch", "origin", baseBranch], {
		cwd: repoPath,
		taskId,
		onEvent: onLine,
	});

	const fetchExitCode = await fetchResult.done;
	if (fetchExitCode !== 0) {
		throw new GitError(
			`Failed to fetch ${baseBranch} from origin`,
			`git fetch origin ${baseBranch}`,
			"See logs for details",
			fetchExitCode
		);
	}

	// Create the worktree
	await emitSystemLog(taskId, `Creating worktree at ${worktreePath}...`, onLine);
	const worktreeResult = await runProcess(
		"git",
		["worktree", "add", "-b", branchName, worktreePath, `origin/${baseBranch}`],
		{
			cwd: repoPath,
			taskId,
			onEvent: onLine,
		}
	);

	const worktreeExitCode = await worktreeResult.done;
	if (worktreeExitCode !== 0) {
		throw new GitError(
			`Failed to create worktree. Branch may already exist or base branch not found.`,
			`git worktree add -b ${branchName} ${worktreePath} origin/${baseBranch}`,
			"See logs for details",
			worktreeExitCode
		);
	}

	await emitSystemLog(taskId, `Worktree created successfully at ${worktreePath}`, onLine);
}

/**
 * Remove a worktree
 */
export async function removeWorktree(opts: {
	repoPath: string;
	worktreePath: string;
	taskId: string;
	onLine: LogCallback;
}): Promise<void> {
	const { repoPath, worktreePath, taskId, onLine } = opts;

	await emitSystemLog(taskId, `Removing worktree at ${worktreePath}...`, onLine);

	const result = await runProcess("git", ["worktree", "remove", "--force", worktreePath], {
		cwd: repoPath,
		taskId,
		onEvent: onLine,
	});

	const exitCode = await result.done;

	// Don't throw on failure - worktree might already be removed
	if (exitCode === 0) {
		await emitSystemLog(taskId, "Worktree removed successfully", onLine);
	} else {
		await emitSystemLog(taskId, "Worktree removal failed (may already be removed)", onLine);
	}
}

/**
 * Push branch to remote
 */
export async function pushBranch(opts: {
	worktreePath: string;
	remote: string;
	branchName: string;
	taskId: string;
	onLine: LogCallback;
}): Promise<void> {
	const { worktreePath, remote, branchName, taskId, onLine } = opts;

	await emitSystemLog(taskId, `Pushing ${branchName} to ${remote}...`, onLine);

	const result = await runProcess("git", ["push", "--set-upstream", remote, branchName], {
		cwd: worktreePath,
		taskId,
		onEvent: onLine,
	});

	const exitCode = await result.done;
	if (exitCode !== 0) {
		throw new GitError(
			`Failed to push branch ${branchName} to ${remote}`,
			`git push --set-upstream ${remote} ${branchName}`,
			"See logs for details",
			exitCode
		);
	}

	await emitSystemLog(taskId, `Branch ${branchName} pushed successfully`, onLine);
}

/**
 * Get diff statistics (files changed, insertions, deletions)
 * Non-streaming operation
 */
export async function getDiffStat(worktreePath: string, baseBranch: string): Promise<DiffStat> {
	const cmd = Command.create("git", ["diff", "--shortstat", `${baseBranch}...HEAD`], {
		cwd: worktreePath,
	});

	const output = await cmd.execute();

	if (output.code !== 0) {
		throw new GitError(
			`Failed to get diff stat`,
			`git diff --shortstat ${baseBranch}...HEAD`,
			output.stderr,
			output.code ?? 1
		);
	}

	return parseDiffStat(output.stdout.trim());
}

/**
 * Parse diff stat output from git diff --shortstat
 * Example formats:
 * - "3 files changed, 45 insertions(+), 12 deletions(-)"
 * - "1 file changed, 5 insertions(+)"
 * - "1 file changed, 10 deletions(-)"
 * - "" (no changes)
 */
export function parseDiffStat(output: string): DiffStat {
	if (!output || output.trim() === "") {
		return { filesChanged: 0, insertions: 0, deletions: 0 };
	}

	const filesMatch = output.match(/(\d+)\s+files?\s+changed/);
	const insertionsMatch = output.match(/(\d+)\s+insertions?\(/);
	const deletionsMatch = output.match(/(\d+)\s+deletions?\(/);

	return {
		filesChanged: filesMatch ? Number.parseInt(filesMatch[1], 10) : 0,
		insertions: insertionsMatch ? Number.parseInt(insertionsMatch[1], 10) : 0,
		deletions: deletionsMatch ? Number.parseInt(deletionsMatch[1], 10) : 0,
	};
}

/**
 * Detect the default remote branch (e.g. "main" or "master").
 * Uses `git symbolic-ref refs/remotes/origin/HEAD --short` and strips the
 * "origin/" prefix. Falls back to "main" if the ref is unset or the command
 * fails (shallow clone, no remote fetch yet, etc.).
 */
export async function detectDefaultBranch(repoPath: string): Promise<string> {
	const cmd = Command.create(
		"git",
		["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
		{ cwd: repoPath }
	);
	const output = await cmd.execute();
	if (output.code === 0) {
		const ref = output.stdout.trim();
		const slash = ref.lastIndexOf("/");
		return slash >= 0 ? ref.slice(slash + 1) : ref || "main";
	}
	return "main";
}

/**
 * Get commit messages since branching from baseBranch
 * Non-streaming operation
 */
export async function getCommitMessages(
	worktreePath: string,
	baseBranch: string
): Promise<string[]> {
	const cmd = Command.create("git", ["log", "--pretty=format:%s", `${baseBranch}..HEAD`], {
		cwd: worktreePath,
	});

	const output = await cmd.execute();

	if (output.code !== 0) {
		throw new GitError(
			`Failed to get commit messages`,
			`git log --pretty=format:%s ${baseBranch}..HEAD`,
			output.stderr,
			output.code ?? 1
		);
	}

	return output.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}
