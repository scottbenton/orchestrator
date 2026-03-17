// Typed representation of a single event from `claude --output-format stream-json`.
// The union covers the known subtypes; the catch-all preserves future events.

export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "thinking"; thinking: string }
	| { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
	| { type: string; [key: string]: unknown };

export type ClaudeStreamEvent =
	| {
			type: "system";
			subtype: "init";
			session_id: string;
			tools: string[];
			model: string;
			permissionMode: string;
			[key: string]: unknown;
	  }
	| { type: "system"; subtype: string; [key: string]: unknown }
	| {
			type: "assistant";
			message: {
				id: string;
				role: "assistant";
				content: ContentBlock[];
				stop_reason: "end_turn" | "tool_use" | "max_tokens" | null;
				usage: {
					input_tokens: number;
					output_tokens: number;
					cache_creation_input_tokens?: number;
					cache_read_input_tokens?: number;
				};
				[key: string]: unknown;
			};
			session_id: string;
			[key: string]: unknown;
	  }
	| {
			type: "user";
			message: {
				role: "user";
				content: ContentBlock[];
			};
			session_id: string;
			[key: string]: unknown;
	  }
	| {
			type: "result";
			subtype: "success" | "error_max_turns" | "error_during_generation" | string;
			session_id: string;
			is_error: boolean;
			result?: string;
			total_cost_usd: number;
			duration_ms: number;
			num_turns: number;
			usage: {
				input_tokens: number;
				output_tokens: number;
				cache_creation_input_tokens: number;
				cache_read_input_tokens: number;
			};
			[key: string]: unknown;
	  }
	| { type: string; [key: string]: unknown };

export type LogLine = {
	id: string;
	taskId: string;
	timestamp: string;
	stream: "stdout" | "stderr" | "system";
	line: string;
	raw?: ClaudeStreamEvent;
};

export type InteractionResolution = {
	approved: boolean;
	response?: string;
	resolvedAt: string;
};

export type InteractionRequest = {
	id: string;
	taskId: string;
	timestamp: string;
	type: "permission" | "clarification" | "plan_review";
	payload: unknown;
	status: "pending" | "resolved";
	resolution?: InteractionResolution;
};

export type ProcessEvent =
	| { type: "log"; data: LogLine }
	| { type: "interaction"; data: InteractionRequest }
	| { type: "done"; data: { exitCode: number } };

export type ProcessHandle = {
	respond: (interactionId: string, resolution: InteractionResolution) => Promise<void>;
	kill: () => Promise<void>;
};
