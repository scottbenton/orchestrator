import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock dependencies at the external boundary only.
// We do NOT mock ../logStreamService — that would cause mock.module leaks
// into logStreamService.test.ts. Instead we mock the two external layers that
// logStreamService itself depends on so the real functions run through.
// ---------------------------------------------------------------------------

// For Command.execute() — used directly by getDiffStat / getCommitMessages
const mockCmdExecute = mock();

// Exit codes to return from successive runProcess() calls (via spawn)
const spawnExitCodes: number[] = [];

// Factory so each Command.create() call gets its own close-handler closure
const mockCreateCommand = mock(() => {
	let onClose: ((data: { code: number }) => void) | null = null;
	return {
		execute: mockCmdExecute,
		stdout: { on: mock() },
		stderr: { on: mock() },
		on: mock((event: string, handler: (data: unknown) => void) => {
			if (event === "close") {
				onClose = handler as (data: { code: number }) => void;
			}
		}),
		// Fires the close handler synchronously so done promises resolve immediately
		spawn: mock(async () => {
			const code = spawnExitCodes.shift() ?? 0;
			onClose?.({ code });
			return { write: mock(), kill: mock() };
		}),
	};
});

mock.module("@tauri-apps/plugin-shell", () => ({
	Command: { create: mockCreateCommand },
}));

// emitSystemLog writes one row per call — track via db.execute
const mockDbExecute = mock(async () => {});

mock.module("@/lib/db", () => ({
	getDb: mock(() =>
		Promise.resolve({
			execute: mockDbExecute,
			select: mock(async () => []),
		})
	),
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
	mockCmdExecute.mockClear();
	mockCreateCommand.mockClear();
	mockDbExecute.mockClear();
	spawnExitCodes.length = 0;
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
		mockCmdExecute.mockResolvedValue({
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
		mockCmdExecute.mockResolvedValue({
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
		mockCmdExecute.mockResolvedValue({
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
		mockCmdExecute.mockResolvedValue({
			code: 0,
			stdout: "Fix bug in parser\nAdd new feature\nUpdate documentation",
			stderr: "",
		});

		const result = await getCommitMessages("/worktree/path", "main");

		expect(result).toEqual(["Fix bug in parser", "Add new feature", "Update documentation"]);
	});

	test("filters out empty lines", async () => {
		mockCmdExecute.mockResolvedValue({
			code: 0,
			stdout: "First commit\n\n\nSecond commit\n",
			stderr: "",
		});

		const result = await getCommitMessages("/worktree/path", "main");

		expect(result).toEqual(["First commit", "Second commit"]);
	});

	test("returns empty array when no commits", async () => {
		mockCmdExecute.mockResolvedValue({
			code: 0,
			stdout: "",
			stderr: "",
		});

		const result = await getCommitMessages("/worktree/path", "main");

		expect(result).toEqual([]);
	});

	test("handles commits with special characters", async () => {
		mockCmdExecute.mockResolvedValue({
			code: 0,
			stdout: 'Fix: "quote" test\nAdd [tag] support\nUse <brackets>',
			stderr: "",
		});

		const result = await getCommitMessages("/worktree/path", "main");

		expect(result).toEqual(['Fix: "quote" test', "Add [tag] support", "Use <brackets>"]);
	});

	test("throws GitError on failure", async () => {
		mockCmdExecute.mockResolvedValue({
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
		spawnExitCodes.push(0, 0); // fetch succeeds, worktree creation succeeds
		const onLine = mock(() => {});

		await createWorktree({
			repoPath: "/repo",
			worktreePath: "/worktree",
			branchName: "ai/task-1",
			baseBranch: "main",
			taskId: "task-1",
			onLine,
		});

		expect(mockCreateCommand).toHaveBeenCalledTimes(2); // fetch + worktree add
		expect(mockDbExecute).toHaveBeenCalledTimes(3); // fetch msg, create msg, success msg
	});

	test("throws GitError if fetch fails", async () => {
		spawnExitCodes.push(1);
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
		spawnExitCodes.push(0, 128); // fetch succeeds, worktree creation fails
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
		spawnExitCodes.push(0);
		const onLine = mock(() => {});

		await removeWorktree({
			repoPath: "/repo",
			worktreePath: "/worktree",
			taskId: "task-1",
			onLine,
		});

		expect(mockCreateCommand).toHaveBeenCalledTimes(1);
		expect(mockDbExecute).toHaveBeenCalledTimes(2); // removing msg, success msg
	});

	test("does not throw on failure (graceful handling)", async () => {
		spawnExitCodes.push(1);
		const onLine = mock(() => {});

		await removeWorktree({
			repoPath: "/repo",
			worktreePath: "/worktree",
			taskId: "task-1",
			onLine,
		});

		expect(mockDbExecute).toHaveBeenCalledTimes(2); // removing msg, failure msg
	});
});

// ---------------------------------------------------------------------------
// pushBranch tests
// ---------------------------------------------------------------------------

describe("pushBranch", () => {
	test("pushes branch successfully", async () => {
		spawnExitCodes.push(0);
		const onLine = mock(() => {});

		await pushBranch({
			worktreePath: "/worktree",
			remote: "origin",
			branchName: "ai/task-1",
			taskId: "task-1",
			onLine,
		});

		expect(mockCreateCommand).toHaveBeenCalledTimes(1);
		expect(mockDbExecute).toHaveBeenCalledTimes(2); // pushing msg, success msg
	});

	test("throws GitError on push failure", async () => {
		spawnExitCodes.push(1);
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
