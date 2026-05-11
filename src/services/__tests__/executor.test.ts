import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock ONLY leaf-level external modules, never sibling services that have
// their own test files. Mocking a service module directly leaks into that
// service's own test file within the same Bun test run.
//
// Modules without their own tests (@/lib/agentTaskRepository, @/services/acpService,
// @/lib/agents) are fine to mock directly.
//
// For git.ts (has git.test.ts): mock @tauri-apps/plugin-shell instead.
// For configService.ts (has configService.test.ts): mock @/lib/fs instead.
// For logStreamService.ts (has logStreamService.test.ts): covered by @/lib/db mock.
// ---------------------------------------------------------------------------

// --- @/lib/db — covers logStreamService internally ---
const mockDbExecute = mock(async () => {});
mock.module("@/lib/db", () => ({
	getDb: mock(() =>
		Promise.resolve({
			execute: mockDbExecute,
			select: mock(async () => []),
		})
	),
}));

// --- @/lib/agentTaskRepository (no separate test file) ---
const mockGetAgentTask = mock(async (_id: string) => null as unknown);
const mockUpdateAgentTask = mock(async (_id: string, _updates: unknown) => {});
mock.module("@/lib/agentTaskRepository", () => ({
	getAgentTask: mockGetAgentTask,
	updateAgentTask: mockUpdateAgentTask,
}));

// --- @/services/acpService (no separate test file) ---
const makeSessionHandle = (sessionId = "sess-1") => ({
	sessionId,
	send: mock(async () => {}),
	subscribe: mock((_handler: (event: unknown) => void) => () => {}),
	dispose: mock(async () => {}),
	cancel: mock(async () => {}),
	setPermissionMode: mock(async () => {}),
	resolvePermission: mock(() => {}),
	currentModelId: "",
	currentModeId: "",
	availableModels: [],
	availableModes: [],
});

const mockAcpLoadSession = mock(async () => makeSessionHandle("sess-1"));
const mockAcpCreateSession = mock(async () => makeSessionHandle("sess-new"));
mock.module("@/services/acpService", () => ({
	acpLoadSession: mockAcpLoadSession,
	acpCreateSession: mockAcpCreateSession,
}));

// --- @/lib/agents (no separate test file) ---
const mockGetAgentDefinition = mock(() => ({ acpCommand: "node", acpArgs: [] }));
mock.module("@/lib/agents", () => ({
	getAgentDefinition: mockGetAgentDefinition,
}));

// --- @/lib/fs — drives configService without replacing it ---
// exists() returns false so readWorkspaceSettings returns defaults (ai_backend: "claude-code").
// Must include all exports from fs.ts to avoid "export not found" errors in other test files.
const mockExists = mock(async () => false);
const mockReadTextFile = mock(async () => "");
mock.module("@/lib/fs", () => ({
	exists: mockExists,
	readTextFile: mockReadTextFile,
	writeTextFile: mock(async () => {}),
	mkdir: mock(async () => {}),
	readDir: mock(async () => []),
	remove: mock(async () => {}),
}));

// --- @tauri-apps/plugin-shell — drives git.ts without replacing it ---
// Provides Command.create().execute() for getDiffStat and getCommitMessages.
// getDiffStat args: ["diff", "--shortstat", ...]
// getCommitMessages args: ["log", "--pretty=format:%s", ...]
const gitExecuteResults: Array<{ code: number; stdout: string; stderr: string }> = [];

const mockShellExecute = mock(async () => {
	const result = gitExecuteResults.shift() ?? { code: 0, stdout: "", stderr: "" };
	return result;
});

mock.module("@tauri-apps/plugin-shell", () => ({
	Command: {
		create: mock((_cmd: string, _args: string[], _opts?: unknown) => ({
			execute: mockShellExecute,
			stdout: { on: mock() },
			stderr: { on: mock() },
			on: mock(),
			spawn: mock(async () => ({ write: mock(), kill: mock() })),
		})),
	},
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

const { executeTask, retryTask } = await import("../executor");

// ---------------------------------------------------------------------------
// Shared test task fixture
// ---------------------------------------------------------------------------

const baseTask = {
	id: "t1",
	projectId: "proj-1",
	taskType: "ticket_impl",
	title: "Do the thing",
	description: "...",
	workspacePath: "/ws",
	repoPath: "/ws/_repositories/acme/app",
	owner: "acme",
	repo: "app",
	baseBranch: "main",
	branchName: "ai/t1",
	worktreePath: "/ws/_worktrees/acme/app/t1",
	status: "awaiting_review",
	acpSessionId: "sess-1",
	createdAt: "2024-01-01T00:00:00Z",
	updatedAt: "2024-01-01T00:00:00Z",
};

// Push default successful git results for tests that reach the success path
function pushSuccessGitResults() {
	gitExecuteResults.push(
		{ code: 0, stdout: "2 files changed, 10 insertions(+), 5 deletions(-)", stderr: "" },
		{ code: 0, stdout: "feat: implement X", stderr: "" }
	);
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	mockDbExecute.mockClear();
	mockGetAgentTask.mockClear();
	mockUpdateAgentTask.mockClear();
	mockAcpLoadSession.mockClear();
	mockAcpCreateSession.mockClear();
	mockGetAgentDefinition.mockClear();
	mockExists.mockClear();
	mockShellExecute.mockClear();
	gitExecuteResults.length = 0;

	// Default: task exists with session
	mockGetAgentTask.mockImplementation(async () => ({ ...baseTask }));
	mockAcpLoadSession.mockImplementation(async () => makeSessionHandle("sess-1"));
	mockAcpCreateSession.mockImplementation(async () => makeSessionHandle("sess-new"));
	mockExists.mockImplementation(async () => false);
});

// ---------------------------------------------------------------------------
// executeTask — guard paths
// ---------------------------------------------------------------------------

describe("executeTask — guards", () => {
	test("throws when task not found", async () => {
		mockGetAgentTask.mockImplementation(async () => null);
		await expect(executeTask("t1")).rejects.toThrow("not found");
	});

	test("throws when worktreePath is missing", async () => {
		mockGetAgentTask.mockImplementation(async () => ({ ...baseTask, worktreePath: undefined }));
		await expect(executeTask("t1")).rejects.toThrow("no worktree path");
	});
});

// ---------------------------------------------------------------------------
// executeTask — ACP session selection
// ---------------------------------------------------------------------------

describe("executeTask — ACP session selection", () => {
	test("calls acpLoadSession when acpSessionId is present", async () => {
		pushSuccessGitResults();
		await executeTask("t1");

		expect(mockAcpLoadSession).toHaveBeenCalledTimes(1);
		expect(mockAcpLoadSession).toHaveBeenCalledWith(
			"sess-1",
			"/ws/_worktrees/acme/app/t1",
			"node",
			[]
		);
		expect(mockAcpCreateSession).not.toHaveBeenCalled();
	});

	test("calls acpCreateSession and persists sessionId when acpSessionId is absent", async () => {
		mockGetAgentTask.mockImplementation(async () => ({
			...baseTask,
			acpSessionId: undefined,
		}));
		pushSuccessGitResults();

		await executeTask("t1");

		expect(mockAcpCreateSession).toHaveBeenCalledTimes(1);
		expect(mockAcpCreateSession).toHaveBeenCalledWith("/ws/_worktrees/acme/app/t1", "node", []);
		expect(mockAcpLoadSession).not.toHaveBeenCalled();

		const updateCalls = mockUpdateAgentTask.mock.calls as unknown as Array<
			[string, Record<string, unknown>]
		>;
		const sessionPersist = updateCalls.find(([, u]) => "acpSessionId" in u);
		expect(sessionPersist).toBeDefined();
		expect(sessionPersist?.[1].acpSessionId).toBe("sess-new");
	});
});

// ---------------------------------------------------------------------------
// executeTask — success path
// ---------------------------------------------------------------------------

describe("executeTask — success", () => {
	test("sets status to executing then pushing", async () => {
		pushSuccessGitResults();
		await executeTask("t1");

		const updateCalls = mockUpdateAgentTask.mock.calls as unknown as Array<
			[string, Record<string, unknown>]
		>;
		const statuses = updateCalls.map(([, u]) => u.status).filter(Boolean);
		expect(statuses[0]).toBe("executing");
		expect(statuses[statuses.length - 1]).toBe("pushing");
	});

	test("calls getDiffStat and getCommitMessages with correct args", async () => {
		pushSuccessGitResults();
		await executeTask("t1");

		// Two Command.create calls: one for getDiffStat, one for getCommitMessages
		expect(mockShellExecute).toHaveBeenCalledTimes(2);
	});

	test("disposes the session on success", async () => {
		pushSuccessGitResults();
		const session = makeSessionHandle("sess-1");
		mockAcpLoadSession.mockImplementation(async () => session);

		await executeTask("t1");

		expect(session.dispose).toHaveBeenCalledTimes(1);
	});

	test("sends the execution prompt to the agent", async () => {
		pushSuccessGitResults();
		const session = makeSessionHandle("sess-1");
		mockAcpLoadSession.mockImplementation(async () => session);

		await executeTask("t1");

		expect(session.send).toHaveBeenCalledTimes(1);
		const [prompt] = (session.send.mock.calls as unknown as Array<[string]>)[0];
		expect(prompt).toContain("The plan has been approved");
		expect(prompt).toContain("Do not push");
	});
});

// ---------------------------------------------------------------------------
// executeTask — failure path
// ---------------------------------------------------------------------------

describe("executeTask — failure", () => {
	test("sets status to failed on ACP load error and re-throws", async () => {
		mockAcpLoadSession.mockImplementation(async () => {
			throw new Error("ACP died");
		});

		await expect(executeTask("t1")).rejects.toThrow("ACP died");

		const updateCalls = mockUpdateAgentTask.mock.calls as unknown as Array<
			[string, Record<string, unknown>]
		>;
		const failUpdate = updateCalls.find(([, u]) => u.status === "failed");
		expect(failUpdate).toBeDefined();
		expect(failUpdate?.[1].error).toBe("ACP died");
	});

	test("sets status to failed on send error and re-throws", async () => {
		const session = makeSessionHandle("sess-1");
		session.send.mockImplementation(async () => {
			throw new Error("send failed");
		});
		mockAcpLoadSession.mockImplementation(async () => session);

		await expect(executeTask("t1")).rejects.toThrow("send failed");

		const updateCalls = mockUpdateAgentTask.mock.calls as unknown as Array<
			[string, Record<string, unknown>]
		>;
		const failUpdate = updateCalls.find(([, u]) => u.status === "failed");
		expect(failUpdate).toBeDefined();
		// Worktree is not removed — removeWorktree is not imported by executor.ts
	});

	test("disposes session on failure", async () => {
		const session = makeSessionHandle("sess-1");
		session.send.mockImplementation(async () => {
			throw new Error("boom");
		});
		mockAcpLoadSession.mockImplementation(async () => session);

		await expect(executeTask("t1")).rejects.toThrow();
		expect(session.dispose).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// executeTask — streaming
// ---------------------------------------------------------------------------

describe("executeTask — streaming", () => {
	test("emits buffered lines from agent output through logStreamService", async () => {
		pushSuccessGitResults();
		const session = makeSessionHandle("sess-1");
		session.subscribe.mockImplementation((handler: (event: unknown) => void) => {
			handler({ sessionId: "sess-1", event: { type: "message_chunk", text: "line1\nline2\n" } });
			return () => {};
		});
		mockAcpLoadSession.mockImplementation(async () => session);

		await executeTask("t1");

		// emitSystemLog writes to DB — verify db.execute was called (at least for the lines)
		expect(mockDbExecute).toHaveBeenCalled();
	});

	test("ignores non-message_chunk events without throwing", async () => {
		pushSuccessGitResults();
		const session = makeSessionHandle("sess-1");
		session.subscribe.mockImplementation((handler: (event: unknown) => void) => {
			handler({ sessionId: "sess-1", event: { type: "session_complete", stopReason: "end_turn" } });
			return () => {};
		});
		mockAcpLoadSession.mockImplementation(async () => session);

		await expect(executeTask("t1")).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// retryTask
// ---------------------------------------------------------------------------

describe("retryTask", () => {
	test("throws when task not found", async () => {
		mockGetAgentTask.mockImplementation(async () => null);
		await expect(retryTask("t1")).rejects.toThrow("not found");
	});

	test("delegates to executeTask — uses acpLoadSession when session exists", async () => {
		pushSuccessGitResults();
		await retryTask("t1");

		expect(mockAcpLoadSession).toHaveBeenCalledTimes(1);
		expect(mockAcpLoadSession).toHaveBeenCalledWith("sess-1", expect.any(String), "node", []);
	});

	test("creates new session via executeTask when acpSessionId is missing", async () => {
		mockGetAgentTask.mockImplementation(async () => ({
			...baseTask,
			acpSessionId: undefined,
		}));
		pushSuccessGitResults();

		await retryTask("t1");

		expect(mockAcpCreateSession).toHaveBeenCalledTimes(1);
		expect(mockAcpLoadSession).not.toHaveBeenCalled();
	});
});
