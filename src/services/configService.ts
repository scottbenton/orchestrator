import { parse, stringify } from "smol-toml";
import { exists, mkdir, readTextFile, writeTextFile } from "@/lib/fs";
import {
	DEFAULT_WORKSPACE_SETTINGS,
	type RepoSettings,
	RepoSettingsSchema,
	type ResolvedConfig,
	type WorkspaceSettings,
	WorkspaceSettingsSchema,
} from "@/types/config";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function workspaceSettingsPath(workspacePath: string): string {
	return `${workspacePath}/settings.toml`;
}

function repoSettingsDir(workspacePath: string, owner: string): string {
	return `${workspacePath}/_repositories/_settings/${owner}`;
}

function repoSettingsPath(workspacePath: string, owner: string, repo: string): string {
	return `${repoSettingsDir(workspacePath, owner)}/${repo}.toml`;
}

// ---------------------------------------------------------------------------
// WorkspaceSettings
// ---------------------------------------------------------------------------

/**
 * Reads {workspacePath}/settings.toml and returns parsed+validated settings.
 * Returns DEFAULT_WORKSPACE_SETTINGS if the file does not exist.
 * Throws ConfigError if the file exists but cannot be parsed or fails validation.
 */
export async function readWorkspaceSettings(workspacePath: string): Promise<WorkspaceSettings> {
	const path = workspaceSettingsPath(workspacePath);

	const fileExists = await exists(path);
	if (!fileExists) {
		return { ...DEFAULT_WORKSPACE_SETTINGS };
	}

	const raw = await readTextFile(path);
	let parsed: unknown;
	try {
		parsed = parse(raw);
	} catch (cause) {
		throw new ConfigError(`Failed to parse settings.toml in ${workspacePath}`, { cause });
	}

	const result = WorkspaceSettingsSchema.safeParse(parsed);
	if (!result.success) {
		throw new ConfigError(`Invalid settings.toml in ${workspacePath}: ${result.error.message}`, {
			cause: result.error,
		});
	}
	return result.data;
}

/**
 * Merges the given partial settings into the existing settings.toml (or defaults)
 * and writes the result. Creates the workspace directory if it does not exist.
 * Throws ConfigError if the merged result fails validation.
 */
export async function writeWorkspaceSettings(
	workspacePath: string,
	settings: Partial<WorkspaceSettings>
): Promise<void> {
	const current = await readWorkspaceSettings(workspacePath);
	const merged = { ...current, ...settings };

	const result = WorkspaceSettingsSchema.safeParse(merged);
	if (!result.success) {
		throw new ConfigError(`Cannot write invalid WorkspaceSettings: ${result.error.message}`, {
			cause: result.error,
		});
	}

	await ensureDir(workspacePath);
	const toml = stringify(result.data as Record<string, unknown>);
	await writeTextFile(workspaceSettingsPath(workspacePath), toml);
}

// ---------------------------------------------------------------------------
// RepoSettings
// ---------------------------------------------------------------------------

/**
 * Reads {workspacePath}/_repositories/_settings/{owner}/{repo}.toml.
 * Returns null if the file does not exist (no defaults — repo must be explicitly registered).
 * Throws ConfigError if the file exists but cannot be parsed or fails validation.
 */
export async function readRepoSettings(
	workspacePath: string,
	owner: string,
	repo: string
): Promise<RepoSettings | null> {
	const path = repoSettingsPath(workspacePath, owner, repo);

	const fileExists = await exists(path);
	if (!fileExists) {
		return null;
	}

	const raw = await readTextFile(path);
	let parsed: unknown;
	try {
		parsed = parse(raw);
	} catch (cause) {
		throw new ConfigError(`Failed to parse repo settings for ${owner}/${repo}`, { cause });
	}

	const result = RepoSettingsSchema.safeParse(parsed);
	if (!result.success) {
		throw new ConfigError(`Invalid repo settings for ${owner}/${repo}: ${result.error.message}`, {
			cause: result.error,
		});
	}
	return result.data;
}

/**
 * Merges the given partial settings into the existing repo TOML (or an empty
 * object if the file doesn't exist yet) and writes the result. Creates
 * intermediate directories if they do not exist.
 *
 * On first write, `settings.repo` must be provided (it is required by the schema).
 * Throws ConfigError if the merged result fails validation.
 */
export async function writeRepoSettings(
	workspacePath: string,
	owner: string,
	repo: string,
	settings: Partial<RepoSettings>
): Promise<void> {
	const current = (await readRepoSettings(workspacePath, owner, repo)) ?? {};
	const merged = { ...current, ...settings };

	const result = RepoSettingsSchema.safeParse(merged);
	if (!result.success) {
		throw new ConfigError(`Cannot write invalid RepoSettings: ${result.error.message}`, {
			cause: result.error,
		});
	}

	await ensureDir(repoSettingsDir(workspacePath, owner));
	const toml = stringify(result.data as Record<string, unknown>);
	await writeTextFile(repoSettingsPath(workspacePath, owner, repo), toml);
}

// ---------------------------------------------------------------------------
// Resolved config
// ---------------------------------------------------------------------------

/**
 * Returns the effective config for a given context by merging:
 *   defaults → workspace settings → repo overrides (if owner/repo provided)
 *
 * This is the primary way to read config — callers should not need to
 * manually merge levels.
 */
export async function getResolvedConfig(
	workspacePath: string,
	owner?: string,
	repo?: string
): Promise<ResolvedConfig> {
	const workspace = await readWorkspaceSettings(workspacePath);

	const resolved: ResolvedConfig = {
		name: workspace.name,
		ai_backend: workspace.ai_backend,
		editor: workspace.editor,
	};

	if (owner && repo) {
		const repoSettings = await readRepoSettings(workspacePath, owner, repo);
		if (repoSettings) {
			if (repoSettings.ai_backend !== undefined) {
				resolved.ai_backend = repoSettings.ai_backend;
			}
			if (repoSettings.editor !== undefined) {
				resolved.editor = repoSettings.editor;
			}
		}
	}

	return resolved;
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

async function ensureDir(path: string): Promise<void> {
	const dirExists = await exists(path);
	if (!dirExists) {
		await mkdir(path, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ConfigError";
	}
}
