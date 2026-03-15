import { LazyStore } from "@tauri-apps/plugin-store";
import { z } from "zod";
import { mkdir } from "@/lib/fs";
import { writeWorkspaceSettings } from "@/services/configService";
import {
	DEFAULT_WORKSPACE_SETTINGS,
	type WorkspaceListEntry,
	WorkspaceListEntrySchema,
} from "@/types/config";

// ---------------------------------------------------------------------------
// Store singleton
// ---------------------------------------------------------------------------

const WORKSPACES_KEY = "workspaces";
const ACTIVE_WORKSPACE_KEY = "activeWorkspacePath";

const store = new LazyStore("workspaces.json", {
	defaults: {
		[WORKSPACES_KEY]: [],
		[ACTIVE_WORKSPACE_KEY]: null,
	},
	autoSave: true,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readWorkspaceList(): Promise<WorkspaceListEntry[]> {
	const raw = await store.get<unknown>(WORKSPACES_KEY);
	if (raw == null) return [];
	const result = z.array(WorkspaceListEntrySchema).safeParse(raw);
	return result.success ? result.data : [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new workspace at the given path:
 *   1. Writes settings.toml with defaults (name overrideable via options)
 *   2. Creates the standard directory structure
 *   3. Registers it in the workspace list
 *
 * Returns the new WorkspaceListEntry. Safe to call on an existing path —
 * directories are created only if they don't already exist.
 */
export async function createWorkspace(
	path: string,
	options?: { name?: string }
): Promise<WorkspaceListEntry> {
	// Write settings.toml (also creates the root directory)
	await writeWorkspaceSettings(path, {
		...DEFAULT_WORKSPACE_SETTINGS,
		...(options?.name ? { name: options.name } : {}),
	});

	// Create the standard directory structure
	const dirs = [
		`${path}/_memory/corrections`,
		`${path}/_memory/repos`,
		`${path}/_memory/skills`,
		`${path}/_repositories/_settings`,
		`${path}/_worktrees`,
	];
	await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));

	const entry: WorkspaceListEntry = {
		path,
		name: options?.name ?? DEFAULT_WORKSPACE_SETTINGS.name,
	};
	await addWorkspace(entry);
	return entry;
}

/**
 * Returns all registered workspaces in insertion order.
 */
export async function getWorkspaces(): Promise<WorkspaceListEntry[]> {
	return readWorkspaceList();
}

/**
 * Adds a workspace to the list. If the path already exists, the entry is
 * updated in place (e.g. name changed). The list is deduplicated by path.
 */
export async function addWorkspace(entry: WorkspaceListEntry): Promise<void> {
	const workspaces = await readWorkspaceList();
	const existingIndex = workspaces.findIndex((w) => w.path === entry.path);
	if (existingIndex >= 0) {
		workspaces[existingIndex] = entry;
	} else {
		workspaces.push(entry);
	}
	await store.set(WORKSPACES_KEY, workspaces);
}

/**
 * Removes a workspace by path. If the removed workspace was active, the
 * active workspace is cleared.
 */
export async function removeWorkspace(path: string): Promise<void> {
	const workspaces = await readWorkspaceList();
	const filtered = workspaces.filter((w) => w.path !== path);
	await store.set(WORKSPACES_KEY, filtered);

	const active = await getActiveWorkspacePath();
	if (active === path) {
		await store.set(ACTIVE_WORKSPACE_KEY, null);
	}
}

/**
 * Returns the path of the currently active workspace, or null if none is set.
 */
export async function getActiveWorkspacePath(): Promise<string | null> {
	const raw = await store.get<unknown>(ACTIVE_WORKSPACE_KEY);
	if (typeof raw === "string") return raw;
	return null;
}

/**
 * Sets the active workspace by path. Throws if the path is not in the list.
 */
export async function setActiveWorkspacePath(path: string): Promise<void> {
	const workspaces = await readWorkspaceList();
	const exists = workspaces.some((w) => w.path === path);
	if (!exists) {
		throw new Error(`Workspace not found in list: ${path}`);
	}
	await store.set(ACTIVE_WORKSPACE_KEY, path);
}

/**
 * Clears the active workspace selection without removing the workspace.
 */
export async function clearActiveWorkspace(): Promise<void> {
	await store.set(ACTIVE_WORKSPACE_KEY, null);
}
