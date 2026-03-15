import { beforeEach, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @/lib/fs before importing anything that depends on it
// ---------------------------------------------------------------------------

const mockExists = mock((_path: string) => Promise.resolve(false));
const mockReadTextFile = mock((_path: string) => Promise.resolve(""));
const mockWriteTextFile = mock((_path: string, _content: string) => Promise.resolve());
const mockMkdir = mock((_path: string) => Promise.resolve());

mock.module("@/lib/fs", () => ({
	exists: mockExists,
	readTextFile: mockReadTextFile,
	writeTextFile: mockWriteTextFile,
	mkdir: mockMkdir,
	readDir: mock(() => Promise.resolve([])),
	remove: mock(() => Promise.resolve()),
}));

const {
	readWorkspaceSettings,
	writeWorkspaceSettings,
	readRepoSettings,
	getResolvedConfig,
	ConfigError,
} = await import("../configService");
const { DEFAULT_WORKSPACE_SETTINGS } = await import("@/types/config");

beforeEach(() => {
	mockExists.mockReset();
	mockReadTextFile.mockReset();
	mockWriteTextFile.mockReset();
	mockMkdir.mockReset();
	mockExists.mockImplementation(() => Promise.resolve(false));
	mockReadTextFile.mockImplementation(() => Promise.resolve(""));
	mockWriteTextFile.mockImplementation(() => Promise.resolve());
	mockMkdir.mockImplementation(() => Promise.resolve());
});

// ---------------------------------------------------------------------------
// readWorkspaceSettings
// ---------------------------------------------------------------------------

test("readWorkspaceSettings returns defaults when file does not exist", async () => {
	mockExists.mockImplementation(() => Promise.resolve(false));
	const result = await readWorkspaceSettings("/workspace");
	expect(result).toEqual(DEFAULT_WORKSPACE_SETTINGS);
});

test("readWorkspaceSettings parses a valid TOML file", async () => {
	mockExists.mockImplementation(() => Promise.resolve(true));
	mockReadTextFile.mockImplementation(() =>
		Promise.resolve(`name = "my-ws"\nai_backend = "codex"\neditor = "cursor"`)
	);
	const result = await readWorkspaceSettings("/workspace");
	expect(result.name).toBe("my-ws");
	expect(result.ai_backend).toBe("codex");
});

test("readWorkspaceSettings throws ConfigError on invalid TOML", async () => {
	mockExists.mockImplementation(() => Promise.resolve(true));
	mockReadTextFile.mockImplementation(() => Promise.resolve("not = valid = toml ==="));
	await expect(readWorkspaceSettings("/workspace")).rejects.toThrow(ConfigError);
});

test("readWorkspaceSettings throws ConfigError on schema validation failure", async () => {
	mockExists.mockImplementation(() => Promise.resolve(true));
	mockReadTextFile.mockImplementation(() => Promise.resolve(`ai_backend = "unknown-backend"`));
	await expect(readWorkspaceSettings("/workspace")).rejects.toThrow(ConfigError);
});

// ---------------------------------------------------------------------------
// writeWorkspaceSettings
// ---------------------------------------------------------------------------

test("writeWorkspaceSettings merges with existing settings", async () => {
	mockExists.mockImplementation(() => Promise.resolve(true));
	mockReadTextFile.mockImplementation(() =>
		Promise.resolve(`name = "old"\nai_backend = "claude-code"\neditor = "cursor"`)
	);
	await writeWorkspaceSettings("/workspace", { name: "new" });
	expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
	const written = mockWriteTextFile.mock.calls[0][1] as string;
	expect(written).toContain("new");
	expect(written).toContain("claude-code");
});

// ---------------------------------------------------------------------------
// readRepoSettings
// ---------------------------------------------------------------------------

test("readRepoSettings returns null when file does not exist", async () => {
	mockExists.mockImplementation(() => Promise.resolve(false));
	const result = await readRepoSettings("/workspace", "owner", "repo");
	expect(result).toBeNull();
});

test("readRepoSettings parses a valid TOML file", async () => {
	mockExists.mockImplementation(() => Promise.resolve(true));
	mockReadTextFile.mockImplementation(() => Promise.resolve(`repo = "owner/repo"\neditor = "zed"`));
	const result = await readRepoSettings("/workspace", "owner", "repo");
	expect(result?.repo).toBe("owner/repo");
	expect(result?.editor).toBe("zed");
});

// ---------------------------------------------------------------------------
// getResolvedConfig
// ---------------------------------------------------------------------------

test("getResolvedConfig returns workspace defaults when no repo settings", async () => {
	mockExists.mockImplementation(() => Promise.resolve(false));
	const result = await getResolvedConfig("/workspace");
	expect(result.ai_backend).toBe(DEFAULT_WORKSPACE_SETTINGS.ai_backend);
});

test("getResolvedConfig applies repo overrides", async () => {
	// workspace exists with defaults
	mockExists.mockImplementation((path: string) => Promise.resolve(path.endsWith("settings.toml")));
	mockReadTextFile.mockImplementation((path: string) => {
		if (path.endsWith("settings.toml")) {
			return Promise.resolve(`name = "ws"\nai_backend = "claude-code"\neditor = "cursor"`);
		}
		return Promise.resolve(`repo = "owner/repo"\neditor = "zed"`);
	});

	// Second call to exists (for repo settings) returns true
	mockExists.mockImplementation(() => {
		return Promise.resolve(true);
	});

	const result = await getResolvedConfig("/workspace", "owner", "repo");
	expect(result.editor).toBe("zed");
});
