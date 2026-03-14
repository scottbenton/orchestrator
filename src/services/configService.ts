import { parse, stringify } from "smol-toml";
import { exists, mkdir, readTextFile, writeTextFile } from "@/lib/fs";
import {
	DEFAULT_WORKSPACE_SETTINGS,
	RepoSettingsSchema,
	WorkspaceSettingsSchema,
	type RepoSettings,
	type WorkspaceSettings,
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

function repoSettingsPath(
	workspacePath: string,
	owner: string,
	repo: string,
): string {
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
export async function readWorkspaceSettings(
	workspacePath: string,
): Promise<WorkspaceSettings> {
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
		throw new ConfigError(
			`Failed to parse settings.toml in ${workspacePath}`,
			{ cause },
		);
	}

	const result = WorkspaceSettingsSchema.safeParse(parsed);
	if (!result.success) {
		throw new ConfigError(
			`Invalid settings.toml in ${workspacePath}: ${result.error.message}`,
			{ cause: result.error },
		);
	}
	return result.data;
}

/**
 * Writes validated settings to {workspacePath}/settings.toml.
 * Creates the workspace directory if it does not exist.
 * Throws ConfigError if settings fail validation or the write fails.
 */
export async function writeWorkspaceSettings(
	workspacePath: string,
	settings: WorkspaceSettings,
): Promise<void> {
	const result = WorkspaceSettingsSchema.safeParse(settings);
	if (!result.success) {
		throw new ConfigError(
			`Cannot write invalid WorkspaceSettings: ${result.error.message}`,
			{ cause: result.error },
		);
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
	repo: string,
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
		throw new ConfigError(
			`Failed to parse repo settings for ${owner}/${repo}`,
			{ cause },
		);
	}

	const result = RepoSettingsSchema.safeParse(parsed);
	if (!result.success) {
		throw new ConfigError(
			`Invalid repo settings for ${owner}/${repo}: ${result.error.message}`,
			{ cause: result.error },
		);
	}
	return result.data;
}

/**
 * Writes validated settings to {workspacePath}/_repositories/_settings/{owner}/{repo}.toml.
 * Creates intermediate directories ({owner}/) if they do not exist.
 * Throws ConfigError if settings fail validation or the write fails.
 */
export async function writeRepoSettings(
	workspacePath: string,
	owner: string,
	repo: string,
	settings: RepoSettings,
): Promise<void> {
	const result = RepoSettingsSchema.safeParse(settings);
	if (!result.success) {
		throw new ConfigError(
			`Cannot write invalid RepoSettings: ${result.error.message}`,
			{ cause: result.error },
		);
	}

	await ensureDir(repoSettingsDir(workspacePath, owner));
	const toml = stringify(result.data as Record<string, unknown>);
	await writeTextFile(repoSettingsPath(workspacePath, owner, repo), toml);
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
