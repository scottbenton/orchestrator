import { beforeEach, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @tauri-apps/plugin-store before importing the module under test
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

const { getGitHubToken, setGitHubToken, hasGitHubToken } = await import("../github-auth");

beforeEach(() => {
	for (const key of Object.keys(storeData)) {
		delete storeData[key];
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("hasGitHubToken returns false on fresh install", async () => {
	const result = await hasGitHubToken();
	expect(result).toBe(false);
});

test("getGitHubToken returns null when no token stored", async () => {
	const result = await getGitHubToken();
	expect(result).toBeNull();
});

test("round-trip: setGitHubToken then getGitHubToken returns same value", async () => {
	await setGitHubToken("ghp_testtoken123");
	const result = await getGitHubToken();
	expect(result).toBe("ghp_testtoken123");
});

test("hasGitHubToken returns true after setting a token", async () => {
	await setGitHubToken("ghp_testtoken123");
	const result = await hasGitHubToken();
	expect(result).toBe(true);
});

test("error messages contain no token value", async () => {
	const faultyStore = mock(() => {
		throw new Error("internal storage failure");
	});
	const originalGet = mockGet.mockImplementation(faultyStore);

	let errorMessage = "";
	try {
		await getGitHubToken();
	} catch (e) {
		errorMessage = e instanceof Error ? e.message : String(e);
	}

	mockGet.mockImplementation(originalGet);

	expect(errorMessage).not.toContain("ghp_");
	expect(errorMessage.length).toBeGreaterThan(0);
});
