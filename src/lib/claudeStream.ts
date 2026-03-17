import type { ClaudeStreamEvent, ContentBlock } from "@/types/logs";

/**
 * Returns the human-readable text to display for a Claude stream-json event,
 * or null to skip the event entirely (not show it in the log viewer).
 */
export function formatStreamEvent(event: ClaudeStreamEvent): string | null {
	switch (event.type) {
		case "system":
			return null; // session init — internal noise

		case "user":
			// Tool results are surfaced via the assistant's tool_use line; skip.
			return null;

		case "result": {
			if (event.is_error || event.subtype !== "success") {
				const msg =
					typeof event.result === "string" && event.result
						? event.result
						: `Session ended: ${event.subtype}`;
				return `[Error]: ${msg}`;
			}
			// Success result text duplicates the last assistant message — skip.
			// Surface cost as a system note instead.
			if (typeof event.total_cost_usd === "number") {
				return `[Cost: $${event.total_cost_usd.toFixed(4)} — ${event.num_turns} turn${event.num_turns === 1 ? "" : "s"}, ${event.duration_ms}ms]`;
			}
			return null;
		}

		case "assistant": {
			const content = event.message?.content;
			if (!Array.isArray(content)) return null;
			const parts: string[] = [];
			for (const block of content as ContentBlock[]) {
				switch (block.type) {
					case "text":
						if (block.text) parts.push(block.text);
						break;
					case "tool_use":
						parts.push(`[Tool: ${block.name}]`);
						break;
					case "thinking":
						// Extended thinking — skip by default (internal reasoning)
						break;
				}
			}
			return parts.length > 0 ? parts.join("\n") : null;
		}

		default:
			// Unknown event type (e.g. rate_limit_event) — skip
			return null;
	}
}
