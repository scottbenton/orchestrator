/**
 * Typed wrappers for ACP events that Orchestrator consumes internally.
 * These map to the session/update notifications from the ACP protocol.
 */

export type AgentEventKind =
	| { type: "message_chunk"; text: string }
	| { type: "tool_call"; id: string; title: string; status: ToolCallStatus }
	| {
			type: "tool_call_update";
			id: string;
			status: ToolCallStatus;
			content?: string;
	  }
	| { type: "plan"; entries: PlanEntry[] }
	| { type: "session_complete"; stopReason: string }
	| { type: "session_error"; error: string };

export type ToolCallStatus = "pending" | "in_progress" | "completed";

export interface PlanEntry {
	title: string;
	status: string;
	priority: "high" | "medium" | "low";
}

export interface AgentEvent {
	sessionId: string;
	event: AgentEventKind;
}
