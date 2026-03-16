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
		const args = ["--output-format", "stream-json", "--print", prompt];
		if (sessionId) {
			args.push("--resume", sessionId);
		}
		if (options?.model && options.model !== "default") {
			args.push("--model", options.model);
		}
		if (options?.permissions === "bypass") {
			args.push("--dangerously-skip-permissions");
		}

		const { handle, done } = await runProcess("claude", args, {
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

						// Replace the raw JSON line with human-readable text
						const text = extractText(raw);
						const enrichedEvent: ProcessEvent = {
							type: "log",
							data: {
								...event.data,
								line: text ?? event.data.line,
								raw,
							},
						};
						onEvent(enrichedEvent);
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

// Extract the human-readable text from a stream event.
// Returns null for non-text events (system, result) so the caller can
// fall back to the raw JSON line.
function extractText(event: ClaudeStreamEvent): string | null {
	if (event.type !== "assistant") return null;
	// Use explicit property access through unknown to avoid catch-all union narrowing issues
	const message = (event as Record<string, unknown>).message;
	if (!message || typeof message !== "object") return null;
	const content = (message as Record<string, unknown>).content;
	if (!Array.isArray(content)) return null;
	const parts = (content as Array<Record<string, unknown>>)
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string);
	return parts.length > 0 ? parts.join("") : null;
}

export function getBackend(settings: WorkspaceSettings): AIBackend {
	switch (settings.ai_backend) {
		case "claude-code":
			return new ClaudeCodeBackend();
		default:
			throw new Error(`Unknown AI backend: ${settings.ai_backend}`);
	}
}
