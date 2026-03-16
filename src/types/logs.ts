// Typed representation of a single event from `claude --output-format stream-json`.
// The union covers the known subtypes; the catch-all preserves future events.
export type ClaudeStreamEvent =
	| { type: "system"; subtype: "init"; session_id: string; [key: string]: unknown }
	| { type: "system"; subtype: string; [key: string]: unknown }
	| {
			type: "assistant";
			message: {
				content: Array<{ type: string; text?: string }>;
				[key: string]: unknown;
			};
			[key: string]: unknown;
	  }
	| { type: "result"; subtype: string; [key: string]: unknown }
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
