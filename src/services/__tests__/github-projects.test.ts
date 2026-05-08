import { beforeEach, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @/services/github-auth before importing module under test.
// Mocking the direct dependency (rather than the Tauri plugin two hops away)
// avoids module-cache cross-contamination when the full test suite runs.
// ---------------------------------------------------------------------------

let _mockToken: string | null = null;

mock.module("@/services/github-auth", () => ({
	getGitHubToken: () => Promise.resolve(_mockToken),
}));

// ---------------------------------------------------------------------------
// Import modules under test after mocks are registered
// ---------------------------------------------------------------------------

const {
	GitHubProjectsSource,
	GitHubAuthError,
	GitHubNetworkError,
	fetchGitHubIssue,
} = await import("../github-projects");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setToken(token: string | null) {
	_mockToken = token;
}

const BASE_REPO_SETTINGS = {
	repo: "testowner/testrepo",
	github_project_number: 42,
};

function makeIssueNode(
	overrides: {
		id?: string;
		contentType?: string;
		number?: number;
		title?: string;
		body?: string | null;
		state?: string;
		url?: string;
		labels?: string[];
		milestone?: { number: number; title: string } | null;
	} = {},
): Record<string, unknown> {
	const {
		id = "item_001",
		contentType = "Issue",
		number = 1,
		title = "Test issue",
		body = "Issue body",
		state = "open",
		url = "https://github.com/testowner/testrepo/issues/1",
		labels = [],
		milestone = null,
	} = overrides;

	if (contentType !== "Issue") {
		return { id, content: { __typename: contentType } };
	}

	return {
		id,
		content: {
			__typename: "Issue",
			number,
			title,
			body,
			state,
			url,
			labels: { nodes: labels.map((name) => ({ name })) },
			milestone,
		},
	};
}

function makePageResponse(
	nodes: Record<string, unknown>[],
	hasNextPage = false,
	endCursor = "cursor_end",
): Record<string, unknown> {
	const projectData = {
		id: "project_id_001",
		items: {
			pageInfo: { hasNextPage, endCursor },
			nodes,
		},
	};
	return {
		data: {
			organization: { projectV2: projectData },
			user: null,
		},
	};
}

function makeStatusFieldResponse(
	options: Array<{ id: string; name: string }>,
): Record<string, unknown> {
	return {
		data: {
			organization: {
				projectV2: {
					id: "project_id_001",
					field: {
						id: "field_status_001",
						options,
					},
				},
			},
			user: null,
		},
	};
}

function makeTransitionMutationResponse(): Record<string, unknown> {
	return {
		data: {
			updateProjectV2ItemFieldValue: {
				projectV2Item: { id: "item_001" },
			},
		},
	};
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
	_mockToken = null;
	fetchCalls = [];
	globalThis.fetch = mock(() =>
		Promise.resolve(new Response("", { status: 200 })),
	) as unknown as typeof fetch;
});

function mockFetch(responses: Record<string, unknown>[]) {
	fetchCalls = [];
	let callIndex = 0;
	globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
		const body = init?.body ? JSON.parse(init.body as string) : {};
		fetchCalls.push({ url: String(url), body });
		const resp = responses[callIndex] ?? responses[responses.length - 1];
		callIndex++;
		return new Response(JSON.stringify(resp), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as unknown as typeof fetch;
}

function mockFetchStatus(status: number) {
	globalThis.fetch = mock(() =>
		Promise.resolve(new Response("", { status })),
	) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// fetchTasks tests
// ---------------------------------------------------------------------------

test("fetchTasks returns [] when github_project_number not configured", async () => {
	setToken("ghp_token");
	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks({ repo: "testowner/testrepo" });
	expect(tasks).toEqual([]);
});

test("fetchTasks returns [] when no token stored", async () => {
	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks(BASE_REPO_SETTINGS);
	expect(tasks).toEqual([]);
});

test("fetchTasks maps a single page of Issue nodes to Task[] correctly including grouping", async () => {
	setToken("ghp_token");
	mockFetch([
		makePageResponse([
			makeIssueNode({
				id: "item_001",
				number: 5,
				title: "My Issue",
				body: "Some description",
				labels: ["bug", "priority"],
				milestone: { number: 2, title: "v1.0" },
			}),
		]),
	]);

	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks(BASE_REPO_SETTINGS);

	expect(tasks).toHaveLength(1);
	expect(tasks[0]).toMatchObject({
		id: "item_001",
		title: "My Issue",
		description: "Some description",
		labels: ["bug", "priority"],
		provider: "github_projects",
		sourceIssueNumber: 5,
		grouping: { id: "2", label: "v1.0" },
	});
});

test("fetchTasks: issue with no milestone has no grouping field", async () => {
	setToken("ghp_token");
	mockFetch([makePageResponse([makeIssueNode({ id: "item_001" })])]);

	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks(BASE_REPO_SETTINGS);

	expect(tasks).toHaveLength(1);
	expect(tasks[0].grouping).toBeUndefined();
});

test("fetchTasks paginates correctly (two pages, both fetched and combined)", async () => {
	setToken("ghp_token");
	mockFetch([
		makePageResponse(
			[makeIssueNode({ id: "item_001", number: 1, title: "Issue 1" })],
			true,
			"cursor_page2",
		),
		makePageResponse([makeIssueNode({ id: "item_002", number: 2, title: "Issue 2" })]),
	]);

	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks(BASE_REPO_SETTINGS);

	expect(tasks).toHaveLength(2);
	expect(fetchCalls).toHaveLength(2);
	expect((fetchCalls[1].body.variables as { cursor: string }).cursor).toBe("cursor_page2");
});

test("fetchTasks filters out non-Issue content nodes", async () => {
	setToken("ghp_token");
	mockFetch([
		makePageResponse([
			makeIssueNode({ id: "item_001" }),
			makeIssueNode({ id: "item_pr", contentType: "PullRequest" }),
			makeIssueNode({ id: "item_draft", contentType: "DraftIssue" }),
		]),
	]);

	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks(BASE_REPO_SETTINGS);

	expect(tasks).toHaveLength(1);
	expect(tasks[0].id).toBe("item_001");
});

test("fetchTasks filters out closed issues", async () => {
	setToken("ghp_token");
	mockFetch([
		makePageResponse([
			makeIssueNode({ id: "item_open", state: "open" }),
			makeIssueNode({ id: "item_closed", state: "closed" }),
		]),
	]);

	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks(BASE_REPO_SETTINGS);

	expect(tasks).toHaveLength(1);
	expect(tasks[0].id).toBe("item_open");
});

test("fetchTasks maps null body to empty string", async () => {
	setToken("ghp_token");
	mockFetch([makePageResponse([makeIssueNode({ body: null })])]);

	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks(BASE_REPO_SETTINGS);

	expect(tasks[0].description).toBe("");
});

test("fetchTasks applies label filtering when repoSettings.labels is set", async () => {
	setToken("ghp_token");
	mockFetch([
		makePageResponse([
			makeIssueNode({ id: "item_bug", labels: ["bug"] }),
			makeIssueNode({ id: "item_feat", labels: ["feature"] }),
			makeIssueNode({ id: "item_both", labels: ["bug", "feature"] }),
		]),
	]);

	const source = new GitHubProjectsSource();
	const tasks = await source.fetchTasks({ ...BASE_REPO_SETTINGS, labels: ["bug"] });

	expect(tasks).toHaveLength(2);
	expect(tasks.map((t) => t.id).sort()).toEqual(["item_both", "item_bug"].sort());
});

test("fetchTasks throws GitHubAuthError on 401", async () => {
	setToken("ghp_expired");
	mockFetchStatus(401);

	const source = new GitHubProjectsSource();
	await expect(source.fetchTasks(BASE_REPO_SETTINGS)).rejects.toBeInstanceOf(GitHubAuthError);
});

test("fetchTasks throws readable error on GraphQL project-not-found", async () => {
	setToken("ghp_token");
	mockFetch([{ data: { organization: null, user: null } }]);

	const source = new GitHubProjectsSource();
	await expect(source.fetchTasks(BASE_REPO_SETTINGS)).rejects.toThrow(
		/project.*not found/i,
	);
});

test("fetchTasks wraps network errors as GitHubNetworkError", async () => {
	setToken("ghp_token");
	globalThis.fetch = mock(() =>
		Promise.reject(new Error("Network failure")),
	) as unknown as typeof fetch;

	const source = new GitHubProjectsSource();
	await expect(source.fetchTasks(BASE_REPO_SETTINGS)).rejects.toBeInstanceOf(
		GitHubNetworkError,
	);
});

// ---------------------------------------------------------------------------
// transitionTask tests
// ---------------------------------------------------------------------------

async function setupSourceWithTasks(): Promise<InstanceType<typeof GitHubProjectsSource>> {
	setToken("ghp_token");
	mockFetch([makePageResponse([makeIssueNode()])]);
	const source = new GitHubProjectsSource();
	await source.fetchTasks(BASE_REPO_SETTINGS);
	return source;
}

test("transitionTask calls correct GraphQL mutation", async () => {
	const source = await setupSourceWithTasks();

	mockFetch([
		makeStatusFieldResponse([
			{ id: "opt_todo", name: "Todo" },
			{ id: "opt_done", name: "Done" },
		]),
		makeTransitionMutationResponse(),
	]);

	await source.transitionTask("item_001", "Done");

	expect(fetchCalls).toHaveLength(2);
	const mutationBody = fetchCalls[1].body;
	expect(mutationBody.variables).toMatchObject({
		projectId: "project_id_001",
		itemId: "item_001",
		fieldId: "field_status_001",
		optionId: "opt_done",
	});
});

test("transitionTask caches status field (only one field-lookup query on second call)", async () => {
	const source = await setupSourceWithTasks();

	mockFetch([
		makeStatusFieldResponse([{ id: "opt_done", name: "Done" }]),
		makeTransitionMutationResponse(),
		makeTransitionMutationResponse(),
	]);

	await source.transitionTask("item_001", "Done");
	await source.transitionTask("item_002", "Done");

	// 2 total fetches: 1 field lookup + 2 mutations = 3 total, but 1 field lookup + 1 mutation for first call,
	// then just 1 mutation for second call = 3 total
	expect(fetchCalls).toHaveLength(3);
	// First call: field lookup (index 0) + mutation (index 1)
	// Second call: mutation only (index 2)
	expect(fetchCalls[0].body.query).toContain("Status");
	expect(fetchCalls[2].body.query).toContain("updateProjectV2ItemFieldValue");
});

test("transitionTask throws descriptively if no Status field", async () => {
	const source = await setupSourceWithTasks();

	mockFetch([
		{
			data: {
				organization: { projectV2: { id: "project_id_001", field: null } },
				user: null,
			},
		},
	]);

	await expect(source.transitionTask("item_001", "Done")).rejects.toThrow(/Status/);
});

// ---------------------------------------------------------------------------
// fetchGitHubIssue tests
// ---------------------------------------------------------------------------

function makeRestIssueResponse(overrides: {
	id?: number;
	number?: number;
	title?: string;
	body?: string | null;
	htmlUrl?: string;
	labels?: string[];
	milestone?: { number: number; title: string } | null;
} = {}): Record<string, unknown> {
	const {
		id = 123456,
		number = 7,
		title = "REST issue",
		body = "Issue via REST",
		htmlUrl = "https://github.com/testowner/testrepo/issues/7",
		labels = [],
		milestone = null,
	} = overrides;

	return {
		id,
		number,
		title,
		body,
		html_url: htmlUrl,
		labels: labels.map((name) => ({ name })),
		milestone,
	};
}

test("fetchGitHubIssue maps a single issue correctly including grouping", async () => {
	mockFetch([
		makeRestIssueResponse({
			id: 99,
			number: 7,
			title: "REST Issue Title",
			body: "REST body",
			labels: ["good first issue"],
			milestone: { number: 3, title: "Sprint 1" },
		}),
	]);

	const task = await fetchGitHubIssue("testowner", "testrepo", 7, "ghp_token");

	expect(task).toMatchObject({
		id: "99",
		title: "REST Issue Title",
		description: "REST body",
		labels: ["good first issue"],
		provider: "github_issue",
		sourceIssueNumber: 7,
		grouping: { id: "3", label: "Sprint 1" },
	});
});

test("fetchGitHubIssue: issue with no milestone has no grouping field", async () => {
	mockFetch([makeRestIssueResponse({ milestone: null })]);

	const task = await fetchGitHubIssue("testowner", "testrepo", 7, "ghp_token");

	expect(task.grouping).toBeUndefined();
});

test("fetchGitHubIssue maps null body to empty string", async () => {
	mockFetch([makeRestIssueResponse({ body: null })]);

	const task = await fetchGitHubIssue("testowner", "testrepo", 7, "ghp_token");

	expect(task.description).toBe("");
});

test("fetchGitHubIssue throws on 404", async () => {
	globalThis.fetch = mock(() =>
		Promise.resolve(new Response("", { status: 404 })),
	) as unknown as typeof fetch;

	await expect(fetchGitHubIssue("testowner", "testrepo", 999, "ghp_token")).rejects.toThrow(
		/not found/i,
	);
});

test("fetchGitHubIssue throws GitHubAuthError on 401", async () => {
	mockFetchStatus(401);

	await expect(
		fetchGitHubIssue("testowner", "testrepo", 7, "ghp_token"),
	).rejects.toBeInstanceOf(GitHubAuthError);
});

test("fetchGitHubIssue wraps network errors as GitHubNetworkError", async () => {
	globalThis.fetch = mock(() =>
		Promise.reject(new Error("Connection refused")),
	) as unknown as typeof fetch;

	await expect(
		fetchGitHubIssue("testowner", "testrepo", 7, "ghp_token"),
	).rejects.toBeInstanceOf(GitHubNetworkError);
});
