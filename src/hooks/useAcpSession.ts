import { useCallback, useEffect, useRef, useState } from "react";
import type { AcpSessionHandle } from "@/services/acpService";
import { acpCreateSession, acpLoadSession } from "@/services/acpService";
import type { AgentEvent, PlanEntry, ToolCallStatus } from "@/types/acp";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type ConversationMessage =
	| { type: "user"; text: string }
	| { type: "assistant"; id: string; chunks: string[]; streaming: boolean }
	| { type: "tool_call"; id: string; title: string; status: ToolCallStatus; output?: string }
	| { type: "plan"; id: string; entries: PlanEntry[] };

// ---------------------------------------------------------------------------
// Hook result
// ---------------------------------------------------------------------------

export interface UseAcpSessionResult {
	messages: ConversationMessage[];
	isRunning: boolean;
	sessionId: string | null;
	send: (prompt: string) => Promise<void>;
	stop: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseAcpSessionOptions {
	/** Existing session ID to resume, or undefined to create a new session */
	existingSessionId?: string;
	/** Working directory for the session */
	cwd: string;
	/** ACP command (e.g. 'node') */
	acpCommand: string;
	/** ACP args (passed after script path when command is 'node') */
	acpArgs: string[];
	/** Workspace + tab identity for persisting the session ID */
	workspaceId: string;
	tabId: string;
	onSessionIdCreated: (sessionId: string) => void;
}

export function useAcpSession(opts: UseAcpSessionOptions): UseAcpSessionResult {
	const [messages, setMessages] = useState<ConversationMessage[]>([]);
	const [isRunning, setIsRunning] = useState(false);
	const [sessionId, setSessionId] = useState<string | null>(opts.existingSessionId ?? null);

	const handleRef = useRef<AcpSessionHandle | null>(null);
	const assistantIdRef = useRef<string | null>(null);
	const mountedRef = useRef(true);

	// ---------------------------------------------------------------------------
	// Bootstrap: create or load session on mount
	// ---------------------------------------------------------------------------

	useEffect(() => {
		mountedRef.current = true;

		const { existingSessionId, cwd, acpCommand, acpArgs } = opts;

		const bootstrap = async () => {
			try {
				let handle: AcpSessionHandle;
				if (existingSessionId) {
					try {
						handle = await acpLoadSession(existingSessionId, cwd, acpCommand, acpArgs);
					} catch {
						// Session no longer exists on the agent — create a fresh one
						handle = await acpCreateSession(cwd, acpCommand, acpArgs);
					}
				} else {
					handle = await acpCreateSession(cwd, acpCommand, acpArgs);
				}

				if (!mountedRef.current) {
					await handle.dispose();
					return;
				}

				handleRef.current = handle;

				if (!existingSessionId || handle.sessionId !== existingSessionId) {
					setSessionId(handle.sessionId);
					opts.onSessionIdCreated(handle.sessionId);
				}

				handle.subscribe((event: AgentEvent) => {
					if (!mountedRef.current) return;
					handleEvent(event);
				});
			} catch (err) {
				console.error("[ACP] session bootstrap failed:", err);
			}
		};

		bootstrap();

		return () => {
			mountedRef.current = false;
			handleRef.current?.dispose();
			handleRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ---------------------------------------------------------------------------
	// Event → message state
	// ---------------------------------------------------------------------------

	const handleEvent = useCallback((event: AgentEvent) => {
		const { event: kind } = event;

		switch (kind.type) {
			case "message_chunk": {
				setMessages((prev) => {
					const last = prev[prev.length - 1];
					if (last?.type === "assistant" && last.streaming) {
						return [...prev.slice(0, -1), { ...last, chunks: [...last.chunks, kind.text] }];
					}
					// Start a new assistant message
					const id = crypto.randomUUID();
					assistantIdRef.current = id;
					return [...prev, { type: "assistant", id, chunks: [kind.text], streaming: true }];
				});
				break;
			}

			case "tool_call": {
				setMessages((prev) => {
					// Close any in-progress assistant message first
					const closed = closePendingAssistant(prev);
					return [
						...closed,
						{ type: "tool_call", id: kind.id, title: kind.title, status: kind.status },
					];
				});
				break;
			}

			case "tool_call_update": {
				setMessages((prev) =>
					prev.map((m) => {
						if (m.type === "tool_call" && m.id === kind.id) {
							return {
								...m,
								status: kind.status,
								output: kind.content !== undefined ? kind.content : m.output,
							};
						}
						return m;
					})
				);
				break;
			}

			case "plan": {
				setMessages((prev) => {
					const closed = closePendingAssistant(prev);
					// Update existing plan or append a new one
					let existingIdx = -1;
					for (let i = closed.length - 1; i >= 0; i--) {
						if (closed[i].type === "plan") {
							existingIdx = i;
							break;
						}
					}
					if (existingIdx >= 0) {
						const planMsg = closed[existingIdx];
						const next = [...closed];
						next[existingIdx] = {
							type: "plan",
							id: planMsg.type === "plan" ? planMsg.id : crypto.randomUUID(),
							entries: kind.entries,
						};
						return next;
					}
					return [...closed, { type: "plan", id: crypto.randomUUID(), entries: kind.entries }];
				});
				break;
			}

			case "session_complete": {
				setIsRunning(false);
				setMessages((prev) => closePendingAssistant(prev));
				assistantIdRef.current = null;
				break;
			}

			case "session_error": {
				setIsRunning(false);
				setMessages((prev) => closePendingAssistant(prev));
				console.error("[ACP] session error:", kind.error);
				break;
			}
		}
	}, []);

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	const send = useCallback(
		async (prompt: string) => {
			if (!prompt.trim() || isRunning) return;

			setMessages((prev) => [...prev, { type: "user", text: prompt }]);

			if (!handleRef.current) return;

			setIsRunning(true);
			assistantIdRef.current = null;

			try {
				await handleRef.current.send(prompt);
			} catch (err) {
				console.error("[ACP] send failed:", err);
				setIsRunning(false);
			}
		},
		[isRunning]
	);

	const stop = useCallback(async () => {
		await handleRef.current?.cancel();
	}, []);

	return { messages, isRunning, sessionId, send, stop };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function closePendingAssistant(messages: ConversationMessage[]): ConversationMessage[] {
	const last = messages[messages.length - 1];
	if (last?.type === "assistant" && last.streaming) {
		return [...messages.slice(0, -1), { ...last, streaming: false }];
	}
	return messages;
}
