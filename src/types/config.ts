import { z } from "zod";

// ---------------------------------------------------------------------------
// WorkspaceSettings — maps to {workspacePath}/settings.toml
// ---------------------------------------------------------------------------

export const AI_BACKENDS = ["claude-code", "codex", "ollama"] as const;
export const EDITORS = ["cursor", "code", "zed", "idea"] as const;

export type AIBackend = (typeof AI_BACKENDS)[number];
export type Editor = (typeof EDITORS)[number];

export const WorkspaceSettingsSchema = z.object({
	name: z.string().min(1),
	ai_backend: z.enum(AI_BACKENDS),
	editor: z.enum(EDITORS).optional(),
	plan_review: z.boolean().optional(),
});

export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
	name: "my workspace",
	ai_backend: "claude-code",
	plan_review: true,
};

// ---------------------------------------------------------------------------
// RepoSettings — maps to {workspacePath}/_repositories/_settings/{owner}/{repo}.toml
// repo-level ai_backend and editor override the workspace-level values
// ---------------------------------------------------------------------------

export const RepoSettingsSchema = z.object({
	repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be in 'owner/repo' format"),
	ai_backend: z.enum(AI_BACKENDS).optional(),
	editor: z.enum(EDITORS).optional(),
	github_project_number: z.number().int().positive().optional(),
	labels: z.array(z.string()).optional(),
	auto_grab: z.boolean().optional(),
	pr_labels: z.array(z.string()).optional(),
	pr_draft: z.boolean().optional(),
	transitions: z.object({ on_pr_open: z.string().optional() }).optional(),
});

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;

// ---------------------------------------------------------------------------
// ResolvedConfig — merged view: defaults → workspace settings → repo overrides
// ---------------------------------------------------------------------------

export type ResolvedConfig = {
	name: string;
	ai_backend: AIBackend;
	editor?: Editor;
	plan_review: boolean;
	pr_labels: string[];
	pr_draft: boolean;
	transitions: { on_pr_open?: string };
};

// ---------------------------------------------------------------------------
// WorkspaceListEntry — persisted in plugin-store, NOT in any workspace folder
// ---------------------------------------------------------------------------

export const WorkspaceListEntrySchema = z.object({
	id: z.string().min(1).optional(),
	path: z.string().min(1),
	name: z.string().min(1),
});

export type WorkspaceListEntry = z.infer<typeof WorkspaceListEntrySchema> & { id: string };
