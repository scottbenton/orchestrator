export type LogLine = {
	id: string;
	taskId: string;
	timestamp: string;
	stream: "stdout" | "stderr" | "system";
	line: string;
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
	respond: (
		interactionId: string,
		resolution: InteractionResolution,
	) => Promise<void>;
	kill: () => Promise<void>;
};
