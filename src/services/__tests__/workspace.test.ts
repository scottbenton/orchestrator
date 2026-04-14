import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @/lib/fs before importing anything that depends on it
// ---------------------------------------------------------------------------

const mockExists = mock((_path: string) => Promise.resolve(false));
const mockReadTextFile = mock((_path: string) => Promise.resolve(""));
const mockWriteTextFile = mock((_path: string, _content: string) => Promise.resolve());
const mockMkdir = mock((_path: string, _options?: { recursive?: boolean }) => Promise.resolve());
const mockReadDir = mock((_path: string) => Promise.resolve([]));

mock.module("@/lib/fs", () => ({
	exists: mockExists,
	readTextFile: mockReadTextFile,
	writeTextFile: mockWriteTextFile,
	mkdir: mockMkdir,
	readDir: mockReadDir,
	remove: mock(() => Promise.resolve()),
}));

const { detectLanguage, buildSystemPrompt, appendMemory } = await import("../workspace");
const { DEFAULT_WORKSPACE_SETTINGS } = await import("@/types/config");

beforeEach(() => {
	mockExists.mockReset();
	mockReadTextFile.mockReset();
	mockWriteTextFile.mockReset();
	mockMkdir.mockReset();
	mockReadDir.mockReset();

	mockExists.mockImplementation(() => Promise.resolve(false));
	mockReadTextFile.mockImplementation(() => Promise.resolve(""));
	mockWriteTextFile.mockImplementation(() => Promise.resolve());
	mockMkdir.mockImplementation(() => Promise.resolve());
	mockReadDir.mockImplementation(() => Promise.resolve([]));
});

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

describe("detectLanguage", () => {
	test("detects typescript from .ts files", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "index.ts", isFile: true, isDirectory: false },
					{ name: "utils.ts", isFile: true, isDirectory: false },
					{ name: "main.rs", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("typescript");
	});

	test("detects typescript from .tsx files", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "App.tsx", isFile: true, isDirectory: false },
					{ name: "Component.tsx", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("typescript");
	});

	test("detects rust from .rs files", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "main.rs", isFile: true, isDirectory: false },
					{ name: "lib.rs", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("rust");
	});

	test("detects python from .py files", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "main.py", isFile: true, isDirectory: false },
					{ name: "utils.py", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("python");
	});

	test("detects go from .go files", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "main.go", isFile: true, isDirectory: false },
					{ name: "server.go", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("go");
	});

	test("returns unknown when no recognized extensions found", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "README.md", isFile: true, isDirectory: false },
					{ name: "config.json", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("unknown");
	});

	test("skips node_modules directory", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "node_modules", isFile: false, isDirectory: true },
					{ name: "index.ts", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("typescript");
	});

	test("skips .git, target, and _worktrees directories", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: ".git", isFile: false, isDirectory: true },
					{ name: "target", isFile: false, isDirectory: true },
					{ name: "_worktrees", isFile: false, isDirectory: true },
					{ name: "main.rs", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("rust");
	});

	test("recursively scans subdirectories", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "src", isFile: false, isDirectory: true },
					{ name: "README.md", isFile: true, isDirectory: false },
				]);
			}
			if (path === "/repo/src") {
				return Promise.resolve([
					{ name: "index.ts", isFile: true, isDirectory: false },
					{ name: "utils.ts", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("typescript");
	});

	test("chooses language with most files when multiple languages present", async () => {
		mockReadDir.mockImplementation((path: string) => {
			if (path === "/repo") {
				return Promise.resolve([
					{ name: "a.ts", isFile: true, isDirectory: false },
					{ name: "b.ts", isFile: true, isDirectory: false },
					{ name: "c.ts", isFile: true, isDirectory: false },
					{ name: "main.py", isFile: true, isDirectory: false },
				]);
			}
			return Promise.resolve([]);
		});

		const result = await detectLanguage("/repo");
		expect(result).toBe("typescript");
	});
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
	const mockCtx = {
		workspacePath: "/workspace",
		settings: DEFAULT_WORKSPACE_SETTINGS,
		repoPath: "/workspace/_repositories/owner/repo",
		owner: "owner",
		repo: "repo",
		primaryLanguage: "typescript",
	};

	const mockTask = {
		id: "task-123",
		description: "Implement feature X",
	};

	test("builds prompt with all memory tiers when all files exist", async () => {
		mockExists.mockImplementation((path: string) => {
			const existingFiles = [
				"/workspace/_memory/corrections.md",
				"/workspace/_memory/corrections/typescript.md",
				"/workspace/_memory/repos/owner/repo/corrections.md",
			];
			return Promise.resolve(existingFiles.includes(path));
		});

		mockReadTextFile.mockImplementation((path: string) => {
			if (path === "/workspace/_memory/corrections.md") {
				return Promise.resolve("Global corrections content");
			}
			if (path === "/workspace/_memory/corrections/typescript.md") {
				return Promise.resolve("TypeScript corrections content");
			}
			if (path === "/workspace/_memory/repos/owner/repo/corrections.md") {
				return Promise.resolve("Repo corrections content");
			}
			return Promise.resolve("");
		});

		const result = await buildSystemPrompt(mockCtx, mockTask, "ai/task-123", "/worktree/path");

		expect(result).toContain("You are working on my workspace");
		expect(result).toContain("Repository: owner/repo");
		expect(result).toContain("Working directory: /worktree/path");
		expect(result).toContain("Your branch: ai/task-123");
		expect(result).toContain("## Corrections");
		expect(result).toContain("Global corrections content");
		expect(result).toContain("## Typescript Corrections");
		expect(result).toContain("TypeScript corrections content");
		expect(result).toContain("## Repository Corrections");
		expect(result).toContain("Repo corrections content");
		expect(result).toContain("Always run tests before considering any task complete");
	});

	test("omits sections for missing memory files", async () => {
		mockExists.mockImplementation((path: string) => {
			// Only corrections.md exists
			return Promise.resolve(path === "/workspace/_memory/corrections.md");
		});

		mockReadTextFile.mockImplementation((path: string) => {
			if (path === "/workspace/_memory/corrections.md") {
				return Promise.resolve("Global corrections only");
			}
			return Promise.resolve("");
		});

		const result = await buildSystemPrompt(mockCtx, mockTask, "ai/task-123", "/worktree/path");

		expect(result).toContain("## Corrections");
		expect(result).toContain("Global corrections only");
		expect(result).not.toContain("## Typescript Corrections");
		expect(result).not.toContain("## Repository Corrections");
	});

	test("skips language-specific corrections when primaryLanguage is unknown", async () => {
		const ctxWithUnknownLang = {
			...mockCtx,
			primaryLanguage: "unknown",
		};

		mockExists.mockImplementation((path: string) => {
			return Promise.resolve(path === "/workspace/_memory/corrections.md");
		});

		mockReadTextFile.mockImplementation((path: string) => {
			if (path === "/workspace/_memory/corrections.md") {
				return Promise.resolve("Global corrections");
			}
			return Promise.resolve("");
		});

		const result = await buildSystemPrompt(
			ctxWithUnknownLang,
			mockTask,
			"ai/task-123",
			"/worktree/path"
		);

		expect(result).toContain("## Corrections");
		expect(result).not.toContain("## Unknown Corrections");
	});

	test("handles all memory files missing gracefully", async () => {
		mockExists.mockImplementation(() => Promise.resolve(false));

		const result = await buildSystemPrompt(mockCtx, mockTask, "ai/task-123", "/worktree/path");

		expect(result).toContain("You are working on my workspace");
		expect(result).toContain("Repository: owner/repo");
		expect(result).not.toContain("## Corrections");
		expect(result).not.toContain("## Typescript Corrections");
		expect(result).not.toContain("## Repository Corrections");
		expect(result).toContain("Always run tests");
	});

	test("uses custom workspace name from settings", async () => {
		const ctxWithCustomName = {
			...mockCtx,
			settings: {
				...DEFAULT_WORKSPACE_SETTINGS,
				name: "My Cool Project",
			},
		};

		mockExists.mockImplementation(() => Promise.resolve(false));

		const result = await buildSystemPrompt(
			ctxWithCustomName,
			mockTask,
			"ai/task-123",
			"/worktree/path"
		);

		expect(result).toContain("You are working on My Cool Project");
	});

	test("trims whitespace from memory file content", async () => {
		mockExists.mockImplementation((path: string) => {
			return Promise.resolve(path === "/workspace/_memory/corrections.md");
		});

		mockReadTextFile.mockImplementation((path: string) => {
			if (path === "/workspace/_memory/corrections.md") {
				return Promise.resolve("\n\n  Corrections with whitespace  \n\n");
			}
			return Promise.resolve("");
		});

		const result = await buildSystemPrompt(mockCtx, mockTask, "ai/task-123", "/worktree/path");

		expect(result).toContain("## Corrections");
		expect(result).toContain("Corrections with whitespace");
		expect(result).not.toContain("\n\n  Corrections");
	});
});

// ---------------------------------------------------------------------------
// appendMemory
// ---------------------------------------------------------------------------

describe("appendMemory", () => {
	test("creates new file with entry when file does not exist", async () => {
		mockExists.mockImplementation(() => Promise.resolve(false));

		await appendMemory("/workspace", "_memory/corrections.md", "New correction entry");

		expect(mockMkdir).toHaveBeenCalledWith("/workspace/_memory", { recursive: true });
		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/workspace/_memory/corrections.md",
			"New correction entry"
		);
	});

	test("appends to existing file with newline separator", async () => {
		mockExists.mockImplementation(() => Promise.resolve(true));
		mockReadTextFile.mockImplementation(() =>
			Promise.resolve("Existing content with trailing newline\n")
		);

		await appendMemory("/workspace", "_memory/corrections.md", "New entry");

		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/workspace/_memory/corrections.md",
			"Existing content with trailing newline\n\nNew entry"
		);
	});

	test("appends to existing file without trailing newline", async () => {
		mockExists.mockImplementation(() => Promise.resolve(true));
		mockReadTextFile.mockImplementation(() => Promise.resolve("Existing content"));

		await appendMemory("/workspace", "_memory/corrections.md", "New entry");

		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/workspace/_memory/corrections.md",
			"Existing content\n\nNew entry"
		);
	});

	test("creates nested directories if they do not exist", async () => {
		mockExists.mockImplementation(() => Promise.resolve(false));

		await appendMemory("/workspace", "_memory/repos/owner/repo/corrections.md", "Entry");

		expect(mockMkdir).toHaveBeenCalledWith("/workspace/_memory/repos/owner/repo", {
			recursive: true,
		});
		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/workspace/_memory/repos/owner/repo/corrections.md",
			"Entry"
		);
	});

	test("handles empty existing file", async () => {
		mockExists.mockImplementation(() => Promise.resolve(true));
		mockReadTextFile.mockImplementation(() => Promise.resolve(""));

		await appendMemory("/workspace", "_memory/corrections.md", "First entry");

		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/workspace/_memory/corrections.md",
			"First entry"
		);
	});

	test("handles whitespace-only existing file", async () => {
		mockExists.mockImplementation(() => Promise.resolve(true));
		mockReadTextFile.mockImplementation(() => Promise.resolve("   \n\n  "));

		await appendMemory("/workspace", "_memory/corrections.md", "First real entry");

		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/workspace/_memory/corrections.md",
			"First real entry"
		);
	});

	test("handles file read errors gracefully by starting fresh", async () => {
		mockExists.mockImplementation(() => Promise.resolve(true));
		mockReadTextFile.mockImplementation(() => Promise.reject(new Error("Read failed")));

		await appendMemory("/workspace", "_memory/corrections.md", "New entry");

		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/workspace/_memory/corrections.md",
			"New entry"
		);
	});

	test("works with deep nested paths", async () => {
		mockExists.mockImplementation(() => Promise.resolve(false));

		await appendMemory(
			"/workspace",
			"_memory/repos/owner/repo/modules/auth.md",
			"Auth module note"
		);

		expect(mockMkdir).toHaveBeenCalledWith("/workspace/_memory/repos/owner/repo/modules", {
			recursive: true,
		});
		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/workspace/_memory/repos/owner/repo/modules/auth.md",
			"Auth module note"
		);
	});
});
