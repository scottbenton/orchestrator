import { beforeEach, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock tauri plugins before importing the service
// ---------------------------------------------------------------------------

const storeData: Record<string, unknown> = {};

const mockGet = mock((key: string) => Promise.resolve(storeData[key] ?? null));
const mockSet = mock((key: string, value: unknown) => {
	storeData[key] = value;
	return Promise.resolve();
});

mock.module("@tauri-apps/plugin-store", () => ({
	LazyStore: class {
		get = mockGet;
		set = mockSet;
	},
}));

mock.module("@/lib/fs", () => ({
	exists: mock(() => Promise.resolve(false)),
	mkdir: mock(() => Promise.resolve()),
	readDir: mock(() => Promise.resolve([])),
	readTextFile: mock(() => Promise.resolve("")),
	remove: mock(() => Promise.resolve()),
	writeTextFile: mock(() => Promise.resolve()),
}));

const {
	getWorkspaces,
	addWorkspace,
	removeWorkspace,
	getActiveWorkspacePath,
	setActiveWorkspacePath,
	clearActiveWorkspace,
} = await import("../workspaceListService");

beforeEach(() => {
	// Clear the in-memory store
	for (const key of Object.keys(storeData)) {
		delete storeData[key];
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("getWorkspaces returns empty array when none registered", async () => {
	const result = await getWorkspaces();
	expect(result).toEqual([]);
});

test("addWorkspace adds an entry", async () => {
	await addWorkspace({ id: "id-one", path: "/ws/one", name: "One" });
	const result = await getWorkspaces();
	expect(result).toHaveLength(1);
	expect(result[0].name).toBe("One");
});

test("addWorkspace deduplicates by path (updates existing)", async () => {
	await addWorkspace({ id: "id-one", path: "/ws/one", name: "One" });
	await addWorkspace({ id: "id-one", path: "/ws/one", name: "Updated" });
	const result = await getWorkspaces();
	expect(result).toHaveLength(1);
	expect(result[0].name).toBe("Updated");
});

test("removeWorkspace removes by path", async () => {
	await addWorkspace({ id: "id-one", path: "/ws/one", name: "One" });
	await addWorkspace({ id: "id-two", path: "/ws/two", name: "Two" });
	await removeWorkspace("/ws/one");
	const result = await getWorkspaces();
	expect(result).toHaveLength(1);
	expect(result[0].path).toBe("/ws/two");
});

test("getActiveWorkspacePath returns null when not set", async () => {
	const result = await getActiveWorkspacePath();
	expect(result).toBeNull();
});

test("setActiveWorkspacePath stores the active path", async () => {
	await addWorkspace({ id: "id-one", path: "/ws/one", name: "One" });
	await setActiveWorkspacePath("/ws/one");
	const result = await getActiveWorkspacePath();
	expect(result).toBe("/ws/one");
});

test("setActiveWorkspacePath throws if path not in list", async () => {
	await expect(setActiveWorkspacePath("/ws/unknown")).rejects.toThrow();
});

test("clearActiveWorkspace unsets the active path", async () => {
	await addWorkspace({ id: "id-one", path: "/ws/one", name: "One" });
	await setActiveWorkspacePath("/ws/one");
	await clearActiveWorkspace();
	const result = await getActiveWorkspacePath();
	expect(result).toBeNull();
});

test("removeWorkspace clears active workspace if it was active", async () => {
	await addWorkspace({ id: "id-one", path: "/ws/one", name: "One" });
	await setActiveWorkspacePath("/ws/one");
	await removeWorkspace("/ws/one");
	const active = await getActiveWorkspacePath();
	expect(active).toBeNull();
});
