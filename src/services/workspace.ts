import { exists, readDir, readTextFile, writeTextFile, mkdir } from "@/lib/fs";
import type { WorkspaceSettings } from "@/types/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceContext {
	workspacePath: string;
	settings: WorkspaceSettings;
	repoPath: string; // local path to the git repo clone
	owner: string; // e.g. "scottbenton"
	repo: string; // e.g. "orchestrator"
	primaryLanguage: string;
}

// ---------------------------------------------------------------------------
// Language Detection
// ---------------------------------------------------------------------------

const LANGUAGE_EXTENSIONS: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	rs: "rust",
	py: "python",
	go: "go",
};

const SKIP_DIRS = new Set(["node_modules", ".git", "target", "_worktrees", "dist", "build"]);

/**
 * Detect the primary programming language by counting file extensions.
 * Skips node_modules, .git, target, and _worktrees directories.
 * Returns "unknown" if no recognized extensions are found.
 */
export async function detectLanguage(repoPath: string): Promise<string> {
	const extensionCounts = new Map<string, number>();

	async function scanDirectory(dirPath: string): Promise<void> {
		try {
			const entries = await readDir(dirPath);

			for (const entry of entries) {
				const fullPath = `${dirPath}/${entry.name}`;

				if (entry.isDirectory) {
					// Skip excluded directories
					if (SKIP_DIRS.has(entry.name)) {
						continue;
					}
					await scanDirectory(fullPath);
				} else if (entry.isFile) {
					// Count file extensions
					const dotIndex = entry.name.lastIndexOf(".");
					if (dotIndex > 0) {
						const ext = entry.name.slice(dotIndex + 1);
						if (LANGUAGE_EXTENSIONS[ext]) {
							const count = extensionCounts.get(ext) || 0;
							extensionCounts.set(ext, count + 1);
						}
					}
				}
			}
		} catch (_error) {
			// Silently skip directories we can't read
			console.warn(`Could not read directory ${dirPath}:`, _error);
		}
	}

	await scanDirectory(repoPath);

	// Find the most common extension
	let maxCount = 0;
	let primaryExt = "";

	for (const [ext, count] of extensionCounts.entries()) {
		if (count > maxCount) {
			maxCount = count;
			primaryExt = ext;
		}
	}

	return primaryExt ? LANGUAGE_EXTENSIONS[primaryExt] : "unknown";
}

// ---------------------------------------------------------------------------
// System Prompt Building
// ---------------------------------------------------------------------------

interface MemoryFile {
	path: string;
	heading: string;
}

/**
 * Build the system prompt by loading always-load memory tiers.
 * Tiers loaded in order:
 * 1. _memory/corrections.md (always)
 * 2. _memory/corrections/{language}.md (if language matches and file exists)
 * 3. _memory/repos/{owner}/{repo}/corrections.md (if file exists)
 *
 * Missing files are silently skipped. Sections for missing files are omitted.
 */
export async function buildSystemPrompt(
	ctx: WorkspaceContext,
	_task: { id: string; description: string },
	branchName: string,
	worktreePath: string
): Promise<string> {
	const sections: string[] = [];

	// Header
	sections.push(`You are working on ${ctx.settings.name}.

Repository: ${ctx.owner}/${ctx.repo}
Working directory: ${worktreePath}
Main branch: main
Your branch: ${branchName}
`);

	// Load memory files in order
	const memoryFiles: MemoryFile[] = [
		{
			path: `${ctx.workspacePath}/_memory/corrections.md`,
			heading: "## Corrections",
		},
	];

	// Add language-specific corrections if we detected a known language
	if (ctx.primaryLanguage !== "unknown") {
		memoryFiles.push({
			path: `${ctx.workspacePath}/_memory/corrections/${ctx.primaryLanguage}.md`,
			heading: `## ${capitalizeFirst(ctx.primaryLanguage)} Corrections`,
		});
	}

	// Add repo-specific corrections
	memoryFiles.push({
		path: `${ctx.workspacePath}/_memory/repos/${ctx.owner}/${ctx.repo}/corrections.md`,
		heading: "## Repository Corrections",
	});

	// Load each memory file
	for (const { path, heading } of memoryFiles) {
		const content = await loadMemoryFile(path);
		if (content) {
			sections.push(`${heading}\n${content}`);
		}
	}

	// Footer instructions
	sections.push(
		`Always run tests before considering any task complete. Do not push — the orchestrator handles that.`
	);

	return sections.join("\n\n");
}

/**
 * Load a memory file if it exists. Returns null if the file doesn't exist.
 * Silently handles errors by returning null.
 */
async function loadMemoryFile(path: string): Promise<string | null> {
	try {
		const fileExists = await exists(path);
		if (!fileExists) {
			return null;
		}
		const content = await readTextFile(path);
		return content.trim();
	} catch (_error) {
		console.warn(`Could not load memory file ${path}:`, _error);
		return null;
	}
}

/**
 * Capitalize the first letter of a string
 */
function capitalizeFirst(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---------------------------------------------------------------------------
// Memory Appending
// ---------------------------------------------------------------------------

/**
 * Append an entry to a memory file. Creates the file and parent directories
 * if they don't exist. Adds a newline separator before the entry if the file
 * already has content.
 */
export async function appendMemory(
	workspacePath: string,
	relativePath: string,
	entry: string
): Promise<void> {
	const fullPath = `${workspacePath}/${relativePath}`;

	// Ensure parent directories exist
	const lastSlash = fullPath.lastIndexOf("/");
	if (lastSlash > 0) {
		const dirPath = fullPath.slice(0, lastSlash);
		try {
			await mkdir(dirPath, { recursive: true });
		} catch (_error) {
			// Directory might already exist
		}
	}

	// Read existing content if file exists
	let existingContent = "";
	try {
		const fileExists = await exists(fullPath);
		if (fileExists) {
			existingContent = await readTextFile(fullPath);
		}
	} catch (_error) {
		// File doesn't exist or can't be read, start fresh
	}

	// Append with appropriate spacing
	let newContent: string;
	if (existingContent.trim() === "") {
		// File is empty or doesn't exist
		newContent = entry;
	} else {
		// Add newline separator before new entry
		newContent = existingContent.endsWith("\n")
			? `${existingContent}\n${entry}`
			: `${existingContent}\n\n${entry}`;
	}

	await writeTextFile(fullPath, newContent);
}
