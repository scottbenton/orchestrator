import type { RepoSettings } from "@/types/config";
import type { Task } from "@/types/task";
import type { TicketSource } from "@/services/ticket-source";

// Lazy import so loading this module does not pull in github-auth (and its
// LazyStore singleton) until the first real token lookup. Tests always inject
// a getToken function so this path is never exercised in the test suite.
async function defaultGetToken(): Promise<string | null> {
	const { getGitHubToken } = await import("@/services/github-auth");
	return getGitHubToken();
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class GitHubAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GitHubAuthError";
	}
}

export class GitHubNetworkError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "GitHubNetworkError";
	}
}

// ---------------------------------------------------------------------------
// GraphQL queries / mutations
// ---------------------------------------------------------------------------

const PROJECT_ITEMS_QUERY = `
  query($owner: String!, $projectNumber: Int!, $cursor: String) {
    repositoryOwner(login: $owner) {
      ... on Organization {
        projectV2(number: $projectNumber) {
          id
          items(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              content {
                __typename
                ... on Issue {
                  number title body url state
                  labels(first: 20) { nodes { name } }
                  milestone { number title }
                }
              }
            }
          }
        }
      }
      ... on User {
        projectV2(number: $projectNumber) {
          id
          items(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              content {
                __typename
                ... on Issue {
                  number title body url state
                  labels(first: 20) { nodes { name } }
                  milestone { number title }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const STATUS_FIELD_QUERY = `
  query($owner: String!, $projectNumber: Int!) {
    repositoryOwner(login: $owner) {
      ... on Organization {
        projectV2(number: $projectNumber) {
          id
          field(name: "Status") {
            ... on ProjectV2SingleSelectField {
              id
              options { id name }
            }
          }
        }
      }
      ... on User {
        projectV2(number: $projectNumber) {
          id
          field(name: "Status") {
            ... on ProjectV2SingleSelectField {
              id
              options { id name }
            }
          }
        }
      }
    }
  }
`;

const TRANSITION_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function graphqlRequest(
	token: string,
	query: string,
	variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	let response: Response;
	try {
		response = await fetch("https://api.github.com/graphql", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query, variables }),
		});
	} catch (cause) {
		throw new GitHubNetworkError("Failed to connect to GitHub API", { cause });
	}

	if (response.status === 401) {
		throw new GitHubAuthError("GitHub token is invalid or expired");
	}

	return response.json() as Promise<Record<string, unknown>>;
}

function extractProject(
	data: Record<string, unknown>,
	owner: string,
	projectNumber: number,
): Record<string, unknown> {
	const d = data.data as Record<string, unknown> | undefined;
	const repoOwner = d?.repositoryOwner as Record<string, unknown> | null | undefined;
	const project = (repoOwner?.projectV2 as Record<string, unknown> | null | undefined) ?? null;
	if (!project) {
		throw new Error(`GitHub project #${projectNumber} not found for ${owner}`);
	}
	return project;
}

function mapIssueNode(node: Record<string, unknown>): Task | null {
	const content = node.content as Record<string, unknown> | null | undefined;
	if (!content?.url) return null;
	if ((content.state as string | undefined) !== "open") return null;

	const milestone = content.milestone as
		| { number: number; title: string }
		| null
		| undefined;
	const labelNodes = (
		(content.labels as Record<string, unknown> | undefined)?.nodes as
			| Array<{ name: string }>
			| undefined
	) ?? [];

	const task: Task = {
		id: node.id as string,
		title: content.title as string,
		description: (content.body as string | null) ?? "",
		labels: labelNodes.map((l) => l.name),
		url: content.url as string,
		provider: "github_projects",
		sourceIssueNumber: content.number as number,
	};

	if (milestone) {
		task.grouping = {
			id: String(milestone.number),
			label: milestone.title,
		};
	}

	return task;
}

// ---------------------------------------------------------------------------
// GitHubProjectsSource
// ---------------------------------------------------------------------------

export class GitHubProjectsSource implements TicketSource {
	private _owner: string | null = null;
	private _projectNumber: number | null = null;
	private _statusCache: {
		projectId: string;
		fieldId: string;
		options: Map<string, string>;
	} | null = null;
	private readonly _getToken: () => Promise<string | null>;

	constructor(getToken: () => Promise<string | null> = defaultGetToken) {
		this._getToken = getToken;
	}

	async fetchTasks(repoSettings: RepoSettings): Promise<Task[]> {
		if (!repoSettings.github_project_number) return [];

		const token = await this._getToken();
		if (!token) return [];

		const [owner] = repoSettings.repo.split("/");
		this._owner = owner;
		this._projectNumber = repoSettings.github_project_number;
		this._statusCache = null;

		const tasks: Task[] = [];
		let cursor: string | null = null;

		do {
			const data = await graphqlRequest(token, PROJECT_ITEMS_QUERY, {
				owner,
				projectNumber: repoSettings.github_project_number,
				cursor,
			});

			const project = extractProject(data, owner, repoSettings.github_project_number);
			const items = project.items as Record<string, unknown>;
			const pageInfo = items.pageInfo as { hasNextPage: boolean; endCursor: string };
			const nodes = (items.nodes as Array<Record<string, unknown>>) ?? [];

			for (const node of nodes) {
				const task = mapIssueNode(node);
				if (task) tasks.push(task);
			}

			cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
		} while (cursor !== null);

		if (repoSettings.labels && repoSettings.labels.length > 0) {
			const labelSet = new Set(repoSettings.labels);
			return tasks.filter((t) => t.labels.some((l) => labelSet.has(l)));
		}

		return tasks;
	}

	async transitionTask(taskId: string, status: string): Promise<void> {
		if (!this._owner || !this._projectNumber) {
			throw new Error("fetchTasks must be called before transitionTask");
		}

		const token = await this._getToken();
		if (!token) throw new GitHubAuthError("No GitHub token configured");

		if (!this._statusCache) {
			const data = await graphqlRequest(token, STATUS_FIELD_QUERY, {
				owner: this._owner,
				projectNumber: this._projectNumber,
			});

			const project = extractProject(data, this._owner, this._projectNumber);
			const field = project.field as Record<string, unknown> | null | undefined;

			if (!field?.id) {
				throw new Error(`No "Status" field found on project #${this._projectNumber}`);
			}

			const options = new Map<string, string>();
			for (const opt of (field.options as Array<{ id: string; name: string }>) ?? []) {
				options.set(opt.name, opt.id);
			}

			this._statusCache = {
				projectId: project.id as string,
				fieldId: field.id as string,
				options,
			};
		}

		const optionId = this._statusCache.options.get(status);
		if (!optionId) {
			throw new Error(
				`Status option "${status}" not found. Available: ${[...this._statusCache.options.keys()].join(", ")}`,
			);
		}

		await graphqlRequest(token, TRANSITION_MUTATION, {
			projectId: this._statusCache.projectId,
			itemId: taskId,
			fieldId: this._statusCache.fieldId,
			optionId,
		});
	}
}

// ---------------------------------------------------------------------------
// fetchGitHubIssue — standalone helper for single-issue URL import flow
// ---------------------------------------------------------------------------

export async function fetchGitHubIssue(
	owner: string,
	repo: string,
	issueNumber: number,
	token: string,
): Promise<Task> {
	let response: Response;
	try {
		response = await fetch(
			`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
				},
			},
		);
	} catch (cause) {
		throw new GitHubNetworkError("Failed to connect to GitHub API", { cause });
	}

	if (response.status === 401) {
		throw new GitHubAuthError("GitHub token is invalid or expired");
	}

	if (response.status === 404) {
		throw new Error(`Issue #${issueNumber} not found in ${owner}/${repo}`);
	}

	const issue = (await response.json()) as Record<string, unknown>;

	const milestone = issue.milestone as
		| { number: number; title: string }
		| null
		| undefined;
	const labelNodes = (issue.labels as Array<{ name: string }> | undefined) ?? [];

	const task: Task = {
		id: String(issue.id),
		title: issue.title as string,
		description: (issue.body as string | null) ?? "",
		labels: labelNodes.map((l) => l.name),
		url: issue.html_url as string,
		provider: "github_issue",
		sourceIssueNumber: issueNumber,
	};

	if (milestone) {
		task.grouping = {
			id: String(milestone.number),
			label: milestone.title,
		};
	}

	return task;
}
