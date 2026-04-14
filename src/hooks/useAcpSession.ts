import { LazyStore } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AcpSessionHandle, AgentModeInfo, AgentModelInfo } from "@/services/acpService";
import { acpCreateSession, acpLoadSession } from "@/services/acpService";

export type { AgentModeInfo, AgentModelInfo };

import type { AgentEvent, PermissionOption, PlanEntry, ToolCallStatus } from "@/types/acp";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type ConversationMessage =
	| { type: "user"; text: string }
	| { type: "assistant"; id: string; chunks: string[]; streaming: boolean }
	| {
			type: "tool_call";
			id: string;
			title: string;
			status: ToolCallStatus;
			output?: string;
	  }
	| { type: "plan"; id: string; entries: PlanEntry[] }
	| {
			type: "permission_request";
			id: string;
			toolTitle: string;
			options: PermissionOption[];
			resolved: boolean;
			selectedOptionId?: string;
	  };

// ---------------------------------------------------------------------------
// Hook result
// ---------------------------------------------------------------------------

export interface UseAcpSessionResult {
	messages: ConversationMessage[];
	isRunning: boolean;
	sessionId: string | null;
	currentModelId: string | null;
	currentModeId: string | null;
	availableModels: AgentModelInfo[];
	availableModes: AgentModeInfo[];
	send: (prompt: string) => Promise<void>;
	stop: () => Promise<void>;
	resolvePermission: (requestId: string, optionId: string) => void;
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
	/** Model ID to pass with each prompt request */
	model?: string;
	/** Permission mode controlling how requestPermission is handled */
	permissionMode?: string;
}

export function useAcpSession(opts: UseAcpSessionOptions): UseAcpSessionResult {
	const [messages, setMessages] = useState<ConversationMessage[]>([]);
	const [isRunning, setIsRunning] = useState(false);
	const [sessionId, setSessionId] = useState<string | null>(opts.existingSessionId ?? null);
	const [currentModelId, setCurrentModelId] = useState<string | null>(null);
	const [currentModeId, setCurrentModeId] = useState<string | null>(null);
	const [availableModels, setAvailableModels] = useState<AgentModelInfo[]>([]);
	const [availableModes, setAvailableModes] = useState<AgentModeInfo[]>([]);

	const handleRef = useRef<AcpSessionHandle | null>(null);
	const assistantIdRef = useRef<string | null>(null);
	const mountedRef = useRef(true);
	const modelRef = useRef(opts.model);
	modelRef.current = opts.model;
	// Keep a ref to current messages so the unmount cleanup can save the latest state
	const messagesRef = useRef(messages);
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	// ---------------------------------------------------------------------------
	// Message persistence
	// ---------------------------------------------------------------------------

	// Load persisted messages on mount (before the session is ready to receive events)
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only
	useEffect(() => {
		const load = async () => {
			const storeKey = `chat_${opts.workspaceId}.json`;
			try {
				const store = new LazyStore(storeKey);
				const saved = await store.get<ConversationMessage[]>(opts.tabId);
				if (!mountedRef.current || !Array.isArray(saved) || saved.length === 0) return;
				// Sanitise in-flight state that can't survive a restart:
				// - streaming assistant messages → mark complete
				// - unresolved permission requests → mark resolved (the Promise is gone)
				const restored = saved.map((m) => {
					if (m.type === "assistant" && m.streaming) return { ...m, streaming: false };
					if (m.type === "permission_request" && !m.resolved) return { ...m, resolved: true };
					return m;
				});
				setMessages(restored);
			} catch (err) {
				console.error("[ACP] failed to load messages:", err);
			}
		};
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ---------------------------------------------------------------------------
	// Bootstrap: create or load session on mount
	// ---------------------------------------------------------------------------

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only — opts values are captured once at mount
	useEffect(() => {
		mountedRef.current = true;

		const { existingSessionId, cwd, acpCommand, acpArgs, workspaceId, tabId } = opts;

		const bootstrap = async () => {
			try {
				let handle: AcpSessionHandle;
				if (existingSessionId) {
					try {
						handle = await acpLoadSession(existingSessionId, cwd, acpCommand, acpArgs);
					} catch (err) {
						console.warn("[ACP] failed to resume session, starting fresh:", err);
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

				if (handle.currentModelId) setCurrentModelId(handle.currentModelId);
				if (handle.currentModeId) setCurrentModeId(handle.currentModeId);
				if (handle.availableModels.length > 0) setAvailableModels(handle.availableModels);
				if (handle.availableModes.length > 0) setAvailableModes(handle.availableModes);

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
			// Persist whatever messages we have when the tab unmounts
			void saveMessages(workspaceId, tabId, messagesRef.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Sync permissionMode to the handle whenever it changes
	useEffect(() => {
		void handleRef.current?.setPermissionMode(opts.permissionMode ?? "default");
	}, [opts.permissionMode]);

	// ---------------------------------------------------------------------------
	// Event → message state
	// ---------------------------------------------------------------------------

	// biome-ignore lint/correctness/useExhaustiveDependencies: opts fields are stable for component lifetime
	const handleEvent = useCallback(
		(event: AgentEvent) => {
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
						// If a card with this ID already exists, update it in-place.
						const existingIdx = prev.findIndex((m) => m.type === "tool_call" && m.id === kind.id);
						if (existingIdx >= 0) {
							const next = [...prev];
							const existing = next[existingIdx] as Extract<
								ConversationMessage,
								{ type: "tool_call" }
							>;
							next[existingIdx] = {
								...existing,
								title: kind.title || existing.title,
								status: kind.status,
							};
							return next;
						}
						// New tool call — close any in-progress assistant message first.
						const closed = closePendingAssistant(prev);
						return [
							...closed,
							{
								type: "tool_call",
								id: kind.id,
								title: kind.title,
								status: kind.status,
							},
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

				case "permission_request": {
					setMessages((prev) => {
						const closed = closePendingAssistant(prev);
						return [
							...closed,
							{
								type: "permission_request",
								id: kind.id,
								toolTitle: kind.toolTitle,
								options: kind.options,
								resolved: false,
							},
						];
					});
					break;
				}

				case "session_complete": {
					setIsRunning(false);
					setMessages((prev) => {
						const closed = closePendingAssistant(prev);
						// Persist after each completed turn
						void saveMessages(opts.workspaceId, opts.tabId, closed);
						return closed;
					});
					assistantIdRef.current = null;
					break;
				}

				case "mode_update": {
					setCurrentModeId(kind.modeId);
					break;
				}

				case "session_error": {
					setIsRunning(false);
					setMessages((prev) => closePendingAssistant(prev));
					console.error("[ACP] session error:", kind.error);
					break;
				}
			}
		},
		// opts.workspaceId and opts.tabId are stable for the component lifetime
		[]
	);

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
				await handleRef.current.send(prompt, modelRef.current);
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

	const resolvePermission = useCallback((requestId: string, optionId: string) => {
		handleRef.current?.resolvePermission(requestId, optionId);
		setMessages((prev) =>
			prev.map((m) =>
				m.type === "permission_request" && m.id === requestId
					? { ...m, resolved: true, selectedOptionId: optionId }
					: m
			)
		);
	}, []);

	return {
		messages,
		isRunning,
		sessionId,
		currentModelId,
		currentModeId,
		availableModels,
		availableModes,
		send,
		stop,
		resolvePermission,
	};
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

async function saveMessages(
	workspaceId: string,
	tabId: string,
	messages: ConversationMessage[]
): Promise<void> {
	if (messages.length === 0) return;
	try {
		const store = new LazyStore(`chat_${workspaceId}.json`);
		await store.set(tabId, messages);
		await store.save();
	} catch {
		// ignore — persistence is best-effort
	}
}
