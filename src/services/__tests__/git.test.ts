import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockExecute = mock();
const mockSpawn = mock();
const mockRunProcess = mock();
const mockEmitSystemLog = mock();

mock.module("@tauri-apps/plugin-shell", () => ({
	Command: {
		create: mock((_program: string, _args: string[]) => ({
			execute: mockExecute,
			spawn: mockSpawn,
		})),
	},
}));

mock.module("../logStreamService", () => ({
	runProcess: mockRunProcess,
	emitSystemLog: mockEmitSystemLog,
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

const {
	agentBranchName,
	worktreePath,
	parseDiffStat,
	getDiffStat,
	getCommitMessages,
	createWorktree,
	removeWorktree,
	pushBranch,
	GitError,
} = await import("../git");

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	mockExecute.mockClear();
	mockSpawn.mockClear();
	mockRunProcess.mockClear();
	mockEmitSystemLog.mockClear();
});

afterAll(() => {
	mock.restore();
});

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe("agentBranchName", () => {
	test("formats branch name correctly", () => {
		expect(agentBranchName("task-123")).toBe("ai/task-123");
		expect(agentBranchName("abc-def-456")).toBe("ai/abc-def-456");
	});
});

describe("worktreePath", () => {
	test("constructs path correctly", () => {
		const result = worktreePath("/workspace", "owner", "repo", "task-1");
		expect(result).toBe("/workspace/_worktrees/owner/repo/task-1");
	});

	test("handles different inputs", () => {
		const result = worktreePath("/home/user/ws", "scottbenton", "orchestrator", "task-abc");
		expect(result).toBe("/home/user/ws/_worktrees/scottbenton/orchestrator/task-abc");
	});
});

// ---------------------------------------------------------------------------
// parseDiffStat tests
// ---------------------------------------------------------------------------

describe("parseDiffStat", () => {
	test("parses standard format with all components", () => {
		const result = parseDiffStat("3 files changed, 45 insertions(+), 12 deletions(-)");
		expect(result).toEqual({
			filesChanged: 3,
			insertions: 45,
			deletions: 12,
		});
	});

	test("parses insertions only", () => {
		const result = parseDiffStat("1 file changed, 5 insertions(+)");
		expect(result).toEqual({
			filesChanged: 1,
			insertions: 5,
			deletions: 0,
		});
	});

	test("parses deletions only", () => {
		const result = parseDiffStat("2 files changed, 10 deletions(-)");
		expect(result).toEqual({
			filesChanged: 2,
			insertions: 0,
			deletions: 10,
		});
	});

	test("handles empty string (no changes)", () => {
		const result = parseDiffStat("");
		expect(result).toEqual({
			filesChanged: 0,
			insertions: 0,
			deletions: 0,
		});
	});

	test("handles whitespace-only string", () => {
		const result = parseDiffStat("   ");
		expect(result).toEqual({
			filesChanged: 0,
			insertions: 0,
			deletions: 0,
		});
	});

	test("handles large numbers", () => {
		const result = parseDiffStat("150 files changed, 5234 insertions(+), 1892 deletions(-)");
		expect(result).toEqual({
			filesChanged: 150,
			insertions: 5234,
			deletions: 1892,
		});
	});

	test("handles singular 'file' vs plural 'files'", () => {
		const single = parseDiffStat("1 file changed, 1 insertion(+), 1 deletion(-)");
		expect(single.filesChanged).toBe(1);

		const plural = parseDiffStat("2 files changed, 2 insertions(+), 2 deletions(-)");
		expect(plural.filesChanged).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// getDiffStat tests
// ---------------------------------------------------------------------------

describe("getDiffStat", () => {
	test("returns parsed diff stat on success", async () => {
		mockExecute.mockResolvedValue({
			code: 0,
			stdout: "3 files changed, 45 insertions(+), 12 deletions(-)",
			stderr: "",
		});

		const result = await getDiffStat("/worktree/path", "main");

		expect(result).toEqual({
			filesChanged: 3,
			insertions: 45,
			deletions: 12,
		});
	});

	test("handles empty diff (no changes)", async () => {
		mockExecute.mockResolvedValue({
			code: 0,
			stdout: "",
			stderr: "",
		});

		const result = await getDiffStat("/worktree/path", "main");

		expect(result).toEqual({
			filesChanged: 0,
			insertions: 0,
			deletions: 0,
		});
	});

	test("throws GitError on failure", async () => {
		mockExecute.mockResolvedValue({
			code: 128,
			stdout: "",
			stderr: "fatal: not a git repository",
		});

		await expect(getDiffStat("/invalid/path", "main")).rejects.toThrow(GitError);
	});
});

// ---------------------------------------------------------------------------
// getCommitMessages tests
// ---------------------------------------------------------------------------

describe("getCommitMessages", () => {
	test("returns array of commit messages", async () => {
		mockExecute.mockResolvedValue({
			code: 0,
			stdout: "Fix bug in parser\nAdd new feature\nUpdate documentation",
			stderr: "",
		});

		const result = await getCommitMessages("/worktree/path", "main");

		expect(result).toEqual(["Fix bug in parser", "Add new feature", "Update documentation"]);
	});

	test("filters out empty lines", async () => {
		mockExecute.mockResolvedValue({
			code: 0,
			stdout: "First commit\n\n\nSecond commit\n",
			stderr: "",
		});

		const result = await getCommitMessages("/worktree/path", "main");

		expect(result).toEqual(["First commit", "Second commit"]);
	});

	test("returns empty array when no commits", async () => {
		mockExecute.mockResolvedValue({
			code: 0,
			stdout: "",
			stderr: "",
		});

		const result = await getCommitMessages("/worktree/path", "main");

		expect(result).toEqual([]);
	});

	test("handles commits with special characters", async () => {
		mockExecute.mockResolvedValue({
			code: 0,
			stdout: 'Fix: "quote" test\nAdd [tag] support\nUse <brackets>',
			stderr: "",
		});

		const result = await getCommitMessages("/worktree/path", "main");

		expect(result).toEqual(['Fix: "quote" test', "Add [tag] support", "Use <brackets>"]);
	});

	test("throws GitError on failure", async () => {
		mockExecute.mockResolvedValue({
			code: 128,
			stdout: "",
			stderr: "fatal: not a git repository",
		});

		await expect(getCommitMessages("/invalid/path", "main")).rejects.toThrow(GitError);
	});
});

// ---------------------------------------------------------------------------
// createWorktree tests
// ---------------------------------------------------------------------------

describe("createWorktree", () => {
	test("fetches base branch then creates worktree", async () => {
		mockEmitSystemLog.mockResolvedValue(undefined);
		mockRunProcess
			.mockResolvedValueOnce({
				handle: {},
				done: Promise.resolve(0),
			})
			.mockResolvedValueOnce({
				handle: {},
				done: Promise.resolve(0),
			});

		const onLine = mock(() => {});

		await createWorktree({
			repoPath: "/repo",
			worktreePath: "/worktree",
			branchName: "ai/task-1",
			baseBranch: "main",
			taskId: "task-1",
			onLine,
		});

		expect(mockRunProcess).toHaveBeenCalledTimes(2);
		expect(mockEmitSystemLog).toHaveBeenCalledTimes(3); // fetch, create, success
	});

	test("throws GitError if fetch fails", async () => {
		mockEmitSystemLog.mockResolvedValue(undefined);
		mockRunProcess.mockResolvedValueOnce({
			handle: {},
			done: Promise.resolve(1), // non-zero exit code
		});

		const onLine = mock(() => {});

		await expect(
			createWorktree({
				repoPath: "/repo",
				worktreePath: "/worktree",
				branchName: "ai/task-1",
				baseBranch: "main",
				taskId: "task-1",
				onLine,
			})
		).rejects.toThrow(GitError);
	});

	test("throws GitError if worktree creation fails", async () => {
		mockEmitSystemLog.mockResolvedValue(undefined);
		mockRunProcess
			.mockResolvedValueOnce({
				handle: {},
				done: Promise.resolve(0), // fetch succeeds
			})
			.mockResolvedValueOnce({
				handle: {},
				done: Promise.resolve(128), // worktree creation fails
			});

		const onLine = mock(() => {});

		await expect(
			createWorktree({
				repoPath: "/repo",
				worktreePath: "/worktree",
				branchName: "ai/task-1",
				baseBranch: "main",
				taskId: "task-1",
				onLine,
			})
		).rejects.toThrow(GitError);
	});
});

// ---------------------------------------------------------------------------
// removeWorktree tests
// ---------------------------------------------------------------------------

describe("removeWorktree", () => {
	test("removes worktree successfully", async () => {
		mockEmitSystemLog.mockResolvedValue(undefined);
		mockRunProcess.mockResolvedValueOnce({
			handle: {},
			done: Promise.resolve(0),
		});

		const onLine = mock(() => {});

		await removeWorktree({
			repoPath: "/repo",
			worktreePath: "/worktree",
			taskId: "task-1",
			onLine,
		});

		expect(mockRunProcess).toHaveBeenCalledTimes(1);
		expect(mockEmitSystemLog).toHaveBeenCalledTimes(2); // removing, success
	});

	test("does not throw on failure (graceful handling)", async () => {
		mockEmitSystemLog.mockResolvedValue(undefined);
		mockRunProcess.mockResolvedValueOnce({
			handle: {},
			done: Promise.resolve(1), // non-zero exit code
		});

		const onLine = mock(() => {});

		await removeWorktree({
			repoPath: "/repo",
			worktreePath: "/worktree",
			taskId: "task-1",
			onLine,
		});

		expect(mockEmitSystemLog).toHaveBeenCalledTimes(2); // removing, failure message
	});
});

// ---------------------------------------------------------------------------
// pushBranch tests
// ---------------------------------------------------------------------------

describe("pushBranch", () => {
	test("pushes branch successfully", async () => {
		mockEmitSystemLog.mockResolvedValue(undefined);
		mockRunProcess.mockResolvedValueOnce({
			handle: {},
			done: Promise.resolve(0),
		});

		const onLine = mock(() => {});

		await pushBranch({
			worktreePath: "/worktree",
			remote: "origin",
			branchName: "ai/task-1",
			taskId: "task-1",
			onLine,
		});

		expect(mockRunProcess).toHaveBeenCalledTimes(1);
		expect(mockEmitSystemLog).toHaveBeenCalledTimes(2); // pushing, success
	});

	test("throws GitError on push failure", async () => {
		mockEmitSystemLog.mockResolvedValue(undefined);
		mockRunProcess.mockResolvedValueOnce({
			handle: {},
			done: Promise.resolve(1),
		});

		const onLine = mock(() => {});

		await expect(
			pushBranch({
				worktreePath: "/worktree",
				remote: "origin",
				branchName: "ai/task-1",
				taskId: "task-1",
				onLine,
			})
		).rejects.toThrow(GitError);
	});
});

// ---------------------------------------------------------------------------
// GitError tests
// ---------------------------------------------------------------------------

describe("GitError", () => {
	test("creates error with all properties", () => {
		const error = new GitError("Test error", "git command", "stderr output", 1);

		expect(error.message).toBe("Test error");
		expect(error.command).toBe("git command");
		expect(error.stderr).toBe("stderr output");
		expect(error.exitCode).toBe(1);
		expect(error.name).toBe("GitError");
	});
});
