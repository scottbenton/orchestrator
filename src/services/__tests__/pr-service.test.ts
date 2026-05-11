import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock ONLY leaf-level external modules, never sibling services that have
// their own test files. See executor.test.ts for the full rationale.
//
// Has own test file → mock its leaf deps:
//   git.ts           → @tauri-apps/plugin-shell
//   configService.ts → @/lib/fs
//   logStreamService → @/lib/db
//   github-auth.ts   → @tauri-apps/plugin-store
//   github-projects  → global.fetch + @tauri-apps/plugin-store (token path)
//
// No own test file → mock directly:
//   @/lib/agentTaskRepository, @/services/acpService, @/lib/agents
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
const makeSessionHandle = (sessionId = "sess-1", descriptionText = "## Summary\n- Test PR") => ({
	sessionId,
	send: mock(async () => {}),
	subscribe: mock((handler: (event: unknown) => void) => {
		handler({ event: { type: "message_chunk", text: descriptionText } });
		return () => {};
	}),
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

// --- @/lib/fs — drives configService and readRepoSettings ---
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

// --- @/services/github-auth — mocked directly to avoid LazyStore singleton issue.
// github-auth.ts creates `const store = new LazyStore(...)` at module load time;
// if github-auth.test.ts ran first, that singleton already exists and can't be
// replaced via @tauri-apps/plugin-store. Direct mock is safe here because
// pr-service.test.ts always runs after github-auth.test.ts (alphabetical order).
const mockGetGitHubToken = mock(async () => "test-token" as string | null);
mock.module("@/services/github-auth", () => ({
	getGitHubToken: mockGetGitHubToken,
	setGitHubToken: mock(async () => {}),
	hasGitHubToken: mock(async () => true),
}));

// --- @tauri-apps/plugin-shell — drives git.ts (pushBranch via runProcess,
//     getDiffStat and getCommitMessages via execute) ---
const spawnExitCodes: number[] = [];
const executeResults: Array<{ code: number; stdout: string; stderr: string }> = [];

const mockCreateCommand = mock(() => {
	let onClose: ((data: { code: number }) => void) | null = null;
	return {
		execute: mock(async () => executeResults.shift() ?? { code: 0, stdout: "", stderr: "" }),
		stdout: { on: mock() },
		stderr: { on: mock() },
		on: mock((event: string, handler: (data: unknown) => void) => {
			if (event === "close") onClose = handler as (data: { code: number }) => void;
		}),
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

// ---------------------------------------------------------------------------
// global.fetch mock — controls GitHub REST API calls
// ---------------------------------------------------------------------------

type FetchResponse = { ok: boolean; status: number; body: unknown };
const fetchResponses: FetchResponse[] = [];

const mockFetch = mock(async (_url: string, _init?: unknown) => {
	const resp = fetchResponses.shift() ?? { ok: true, status: 200, body: {} };
	return {
		ok: resp.ok,
		status: resp.status,
		json: async () => resp.body,
		text: async () => JSON.stringify(resp.body),
	};
});

globalThis.fetch = mockFetch as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

const { openPullRequest, PushError } = await import("../pr-service");

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const baseTask = {
	id: "t1",
	projectId: "proj-1",
	taskType: "ticket_impl",
	title: "Add feature X",
	description: "Implement the X feature",
	sourceUrl: "https://github.com/acme/app/issues/42",
	sourceProvider: "github_projects",
	sourceItemId: undefined as string | undefined,
	workspacePath: "/ws",
	repoPath: "/ws/_repositories/acme/app",
	owner: "acme",
	repo: "app",
	baseBranch: "main",
	branchName: "ai/t1",
	worktreePath: "/ws/_worktrees/acme/app/t1",
	status: "pushing",
	acpSessionId: "sess-1",
	createdAt: "2024-01-01T00:00:00Z",
	updatedAt: "2024-01-01T00:00:00Z",
};

// Push default successful git responses: push (spawn exit 0), getDiffStat, getCommitMessages
function pushSuccessGitResults() {
	spawnExitCodes.push(0); // pushBranch
	executeResults.push(
		{ code: 0, stdout: "3 files changed, 20 insertions(+), 5 deletions(-)", stderr: "" },
		{ code: 0, stdout: "feat: add feature X\nfix: edge case", stderr: "" },
	);
}

// Push default successful GitHub API responses: PR creation (+ optional labels)
function pushSuccessFetchResults(opts: { labels?: boolean } = {}) {
	fetchResponses.push({
		ok: true,
		status: 201,
		body: { number: 99, html_url: "https://github.com/acme/app/pull/99" },
	});
	if (opts.labels) {
		fetchResponses.push({ ok: true, status: 200, body: [] });
	}
}

beforeEach(() => {
	mockDbExecute.mockClear();
	mockGetAgentTask.mockClear();
	mockUpdateAgentTask.mockClear();
	mockAcpLoadSession.mockClear();
	mockAcpCreateSession.mockClear();
	mockGetAgentDefinition.mockClear();
	mockExists.mockClear();
	mockReadTextFile.mockClear();
	mockCreateCommand.mockClear();
	mockFetch.mockClear();
	mockGetGitHubToken.mockClear();
	spawnExitCodes.length = 0;
	executeResults.length = 0;
	fetchResponses.length = 0;

	mockGetAgentTask.mockImplementation(async () => ({ ...baseTask }));
	mockAcpLoadSession.mockImplementation(async () => makeSessionHandle("sess-1"));
	mockAcpCreateSession.mockImplementation(async () => makeSessionHandle("sess-new"));
	mockExists.mockImplementation(async () => false);
	mockGetGitHubToken.mockImplementation(async () => "test-token");
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("openPullRequest — guards", () => {
	test("throws when task not found", async () => {
		mockGetAgentTask.mockImplementation(async () => null);
		await expect(openPullRequest("t1")).rejects.toThrow("not found");
	});

	test("throws when worktreePath is missing", async () => {
		mockGetAgentTask.mockImplementation(async () => ({ ...baseTask, worktreePath: undefined }));
		await expect(openPullRequest("t1")).rejects.toThrow("no worktree path");
	});
});

// ---------------------------------------------------------------------------
// Push failure
// ---------------------------------------------------------------------------

describe("openPullRequest — push failure", () => {
	test("throws PushError when git push exits non-zero", async () => {
		spawnExitCodes.push(1);

		await expect(openPullRequest("t1")).rejects.toBeInstanceOf(PushError);
	});

	test("does NOT update status when push fails", async () => {
		spawnExitCodes.push(1);

		await openPullRequest("t1").catch(() => {});

		const updateCalls = mockUpdateAgentTask.mock.calls as unknown as Array<
			[string, Record<string, unknown>]
		>;
		const statusUpdates = updateCalls.filter(([, u]) => "status" in u);
		expect(statusUpdates).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("openPullRequest — success", () => {
	test("transitions to pr_open and stores prUrl", async () => {
		pushSuccessGitResults();
		pushSuccessFetchResults();

		await openPullRequest("t1");

		const updateCalls = mockUpdateAgentTask.mock.calls as unknown as Array<
			[string, Record<string, unknown>]
		>;
		const prOpenUpdate = updateCalls.find(([, u]) => u.status === "pr_open");
		expect(prOpenUpdate).toBeDefined();
		expect(prOpenUpdate?.[1].prUrl).toBe("https://github.com/acme/app/pull/99");
	});

	test("calls GitHub PR creation API with correct fields", async () => {
		pushSuccessGitResults();
		pushSuccessFetchResults();

		await openPullRequest("t1");

		const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, RequestInit]>;
		const prCall = fetchCalls.find(([url]) => url.includes("/pulls"));
		expect(prCall).toBeDefined();

		const body = JSON.parse(prCall![1].body as string);
		expect(body.title).toBe("Add feature X");
		expect(body.head).toBe("ai/t1");
		expect(body.base).toBe("main");
		expect(body.draft).toBe(false);
	});

	test("generates PR description via ACP and passes it as PR body", async () => {
		pushSuccessGitResults();
		pushSuccessFetchResults();

		await openPullRequest("t1");

		expect(mockAcpLoadSession).toHaveBeenCalledTimes(1);

		const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, RequestInit]>;
		const prCall = fetchCalls.find(([url]) => url.includes("/pulls"));
		const body = JSON.parse(prCall![1].body as string);
		expect(body.body).toContain("## Summary");
	});

	test("uses acpCreateSession when task has no acpSessionId", async () => {
		mockGetAgentTask.mockImplementation(async () => ({ ...baseTask, acpSessionId: undefined }));
		pushSuccessGitResults();
		pushSuccessFetchResults();

		await openPullRequest("t1");

		expect(mockAcpCreateSession).toHaveBeenCalledTimes(1);
		expect(mockAcpLoadSession).not.toHaveBeenCalled();
	});

	test("disposes ACP session after description generation", async () => {
		const session = makeSessionHandle("sess-1");
		mockAcpLoadSession.mockImplementation(async () => session);
		pushSuccessGitResults();
		pushSuccessFetchResults();

		await openPullRequest("t1");

		expect(session.dispose).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// PR labels
// ---------------------------------------------------------------------------

// Makes mockExists return true only for repo settings paths (so workspace settings
// falls back to defaults, while repo settings reads the custom TOML content)
function mockRepoSettingsFile(toml: string) {
	mockExists.mockImplementation(
		(async (path: unknown) => String(path).includes("_settings")) as () => Promise<boolean>,
	);
	mockReadTextFile.mockImplementation(async () => toml);
}

describe("openPullRequest — labels", () => {
	test("adds labels when pr_labels configured", async () => {
		mockRepoSettingsFile(`repo = "acme/app"\npr_labels = ["ai-generated"]`);
		pushSuccessGitResults();
		pushSuccessFetchResults({ labels: true });

		await openPullRequest("t1");

		const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, RequestInit]>;
		const labelsCall = fetchCalls.find(([url]) => url.includes("/labels"));
		expect(labelsCall).toBeDefined();

		const body = JSON.parse(labelsCall![1].body as string);
		expect(body.labels).toEqual(["ai-generated"]);
	});

	test("does not call labels API when pr_labels is empty", async () => {
		pushSuccessGitResults();
		pushSuccessFetchResults();

		await openPullRequest("t1");

		const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, RequestInit]>;
		const labelsCall = fetchCalls.find(([url]) => url.includes("/labels"));
		expect(labelsCall).toBeUndefined();
	});

	test("creates draft PR when pr_draft = true", async () => {
		mockRepoSettingsFile(`repo = "acme/app"\npr_draft = true`);
		pushSuccessGitResults();
		pushSuccessFetchResults();

		await openPullRequest("t1");

		const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, RequestInit]>;
		const prCall = fetchCalls.find(([url]) => url.includes("/pulls"));
		const body = JSON.parse(prCall![1].body as string);
		expect(body.draft).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Ticket transition
// ---------------------------------------------------------------------------

describe("openPullRequest — ticket transition", () => {
	test("calls GitHub Projects transition when sourceItemId and on_pr_open are set", async () => {
		mockGetAgentTask.mockImplementation(async () => ({
			...baseTask,
			sourceItemId: "PVTI_abc123",
		}));
		mockRepoSettingsFile(
			`repo = "acme/app"\ngithub_project_number = 5\n[transitions]\non_pr_open = "In Review"`,
		);

		pushSuccessGitResults();
		pushSuccessFetchResults();
		// STATUS_FIELD_QUERY response
		fetchResponses.push({
			ok: true,
			status: 200,
			body: {
				data: {
					repositoryOwner: {
						projectV2: {
							id: "PV_123",
							field: {
								id: "PVTSSF_456",
								options: [{ id: "opt_1", name: "In Review" }],
							},
						},
					},
				},
			},
		});
		// TRANSITION_MUTATION response
		fetchResponses.push({
			ok: true,
			status: 200,
			body: { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_abc123" } } } },
		});

		await openPullRequest("t1");

		const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, RequestInit]>;
		const graphqlCalls = fetchCalls.filter(([url]) => url.includes("graphql"));
		expect(graphqlCalls.length).toBeGreaterThanOrEqual(2);

		const mutationCall = graphqlCalls[graphqlCalls.length - 1];
		const body = JSON.parse(mutationCall[1].body as string);
		expect(body.variables.itemId).toBe("PVTI_abc123");
		expect(body.variables.optionId).toBe("opt_1");
	});

	test("skips transition when sourceItemId is absent", async () => {
		mockRepoSettingsFile(
			`repo = "acme/app"\ngithub_project_number = 5\n[transitions]\non_pr_open = "In Review"`,
		);

		pushSuccessGitResults();
		pushSuccessFetchResults();

		// No sourceItemId on task → transition should be skipped
		await openPullRequest("t1");

		const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, RequestInit]>;
		const graphqlCalls = fetchCalls.filter(([url]) => url.includes("graphql"));
		expect(graphqlCalls).toHaveLength(0);
	});

	test("skips transition when on_pr_open is not configured", async () => {
		mockGetAgentTask.mockImplementation(async () => ({
			...baseTask,
			sourceItemId: "PVTI_abc123",
		}));

		pushSuccessGitResults();
		pushSuccessFetchResults();

		// No transitions config → skip
		await openPullRequest("t1");

		const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, RequestInit]>;
		const graphqlCalls = fetchCalls.filter(([url]) => url.includes("graphql"));
		expect(graphqlCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Failure after push
// ---------------------------------------------------------------------------

describe("openPullRequest — post-push failures", () => {
	test("sets status to failed when PR creation fails", async () => {
		pushSuccessGitResults();
		fetchResponses.push({ ok: false, status: 422, body: { message: "Validation failed" } });

		await expect(openPullRequest("t1")).rejects.toThrow("422");

		const updateCalls = mockUpdateAgentTask.mock.calls as unknown as Array<
			[string, Record<string, unknown>]
		>;
		const failUpdate = updateCalls.find(([, u]) => u.status === "failed");
		expect(failUpdate).toBeDefined();
	});
});
