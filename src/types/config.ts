import { z } from "zod";

// ---------------------------------------------------------------------------
// WorkspaceSettings — maps to {workspacePath}/settings.toml
// ---------------------------------------------------------------------------

export const AI_BACKENDS = ["claude-code", "codex", "ollama"] as const;
export const EDITORS = ["cursor", "code", "zed", "idea"] as const;

export const WorkspaceSettingsSchema = z.object({
	name: z.string().min(1),
	ai_backend: z.enum(AI_BACKENDS),
	editor: z.enum(EDITORS),
});

export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
	name: "my workspace",
	ai_backend: "claude-code",
	editor: "cursor",
};

// ---------------------------------------------------------------------------
// RepoSettings — maps to {workspacePath}/_repositories/_settings/{owner}/{repo}.toml
// ---------------------------------------------------------------------------

export const RepoSettingsSchema = z.object({
	repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be in 'owner/repo' format"),
});

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;

// ---------------------------------------------------------------------------
// WorkspaceListEntry — persisted in plugin-store, NOT in any workspace folder
// ---------------------------------------------------------------------------

export const WorkspaceListEntrySchema = z.object({
	path: z.string().min(1),
	name: z.string().min(1),
});

export type WorkspaceListEntry = z.infer<typeof WorkspaceListEntrySchema>;
