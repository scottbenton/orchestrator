import { LazyStore } from "@tauri-apps/plugin-store";
import { z } from "zod";
import {
	WorkspaceListEntrySchema,
	type WorkspaceListEntry,
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
