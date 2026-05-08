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
});

export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
	name: "my workspace",
	ai_backend: "claude-code",
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
});

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;

// ---------------------------------------------------------------------------
// ResolvedConfig — merged view: defaults → workspace settings → repo overrides
// ---------------------------------------------------------------------------

export type ResolvedConfig = {
	name: string;
	ai_backend: AIBackend;
	editor?: Editor;
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
