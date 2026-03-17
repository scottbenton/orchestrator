import { formatStreamEvent } from "@/lib/claudeStream";
import { runProcess } from "@/services/logStreamService";
import type { ClaudeStreamEvent, ProcessEvent, ProcessHandle } from "@/types/logs";
import type { WorkspaceSettings } from "@/types/config";

export type PermissionLevel = "default" | "bypass";

export interface RunOptions {
	model?: string;
	permissions?: PermissionLevel;
}

export interface AIBackend {
	run(
		prompt: string,
		cwd: string,
		taskId: string,
		sessionId: string | undefined,
		onEvent: (event: ProcessEvent) => void,
		onSessionId: (id: string) => void,
		options?: RunOptions
	): Promise<{ handle: ProcessHandle; exitCode: number }>;
}

export class ClaudeCodeBackend implements AIBackend {
	async run(
		prompt: string,
		cwd: string,
		taskId: string,
		sessionId: string | undefined,
		onEvent: (event: ProcessEvent) => void,
		onSessionId: (id: string) => void,
		options?: RunOptions
	): Promise<{ handle: ProcessHandle; exitCode: number }> {
		const claudeArgs = ["--output-format", "stream-json", "--verbose", "--print", prompt];
		if (sessionId) {
			claudeArgs.push("--resume", sessionId);
		}
		if (options?.model && options.model !== "default") {
			claudeArgs.push("--model", options.model);
		}
		if (options?.permissions === "bypass") {
			claudeArgs.push("--dangerously-skip-permissions");
		}

		// Run via /bin/sh so stdin is closed (</dev/null) and PATH is resolved
		// from the user's shell environment.
		const shellCmd = `claude ${claudeArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")} </dev/null`;
		const { handle, done } = await runProcess("sh", ["-c", shellCmd], {
			cwd,
			taskId,
			onEvent: (event) => {
				if (event.type === "log" && event.data.stream === "stdout") {
					const raw = tryParseStreamEvent(event.data.line);
					if (raw) {
						// Capture session_id from the init event
						if (
							raw.type === "system" &&
							"subtype" in raw &&
							raw.subtype === "init" &&
							"session_id" in raw &&
							typeof raw.session_id === "string"
						) {
							onSessionId(raw.session_id);
						}

						// Replace the raw JSON line with human-readable text; skip if null
						const text = formatStreamEvent(raw);
						if (text === null) return;
						onEvent({ type: "log", data: { ...event.data, line: text, raw } });
						return;
					}
				}
				onEvent(event);
			},
		});

		const exitCode = await done;
		return { handle, exitCode };
	}
}

function tryParseStreamEvent(line: string): ClaudeStreamEvent | null {
	try {
		const parsed = JSON.parse(line);
		if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
			return parsed as ClaudeStreamEvent;
		}
	} catch {
		// Not JSON — pass through as-is
	}
	return null;
}


export function getBackend(settings: WorkspaceSettings): AIBackend {
	switch (settings.ai_backend) {
		case "claude-code":
			return new ClaudeCodeBackend();
		default:
			throw new Error(`Unknown AI backend: ${settings.ai_backend}`);
	}
}
