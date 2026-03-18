/**
 * AcpService — wraps the ACP (Agent Client Protocol) SDK to connect Orchestrator
 * to ACP-compatible AI agents (Claude Code, Codex, etc.) via JSON-RPC 2.0 over stdio.
 *
 * Binary resolution: The claude-code-acp adapter lives in node_modules/.bin/.
 * In development, __ACP_SCRIPT_PATH__ is injected by Vite (see vite.config.ts) as the
 * absolute path to the adapter's dist/index.js. Production builds need the binary
 * bundled separately (future work).
 */

import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	type SessionNotification,
} from "@agentclientprotocol/sdk";
import { homeDir } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import { readTextFile, writeTextFile } from "@/lib/fs";
import { ptyKill, ptyOnClose, ptyOnData, ptySpawn } from "@/services/ptyService";
import type { AgentEvent, AgentEventKind, PlanEntry, ToolCallStatus } from "@/types/acp";

// Injected by Vite at build time — absolute path to @zed-industries/claude-code-acp/dist/index.js
declare const __ACP_SCRIPT_PATH__: string;

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface AgentModelInfo {
	modelId: string;
	name: string;
}

export interface AgentModeInfo {
	id: string;
	name: string;
}

export interface AcpSessionHandle {
	sessionId: string;
	currentModelId: string;
	currentModeId: string;
	availableModels: AgentModelInfo[];
	availableModes: AgentModeInfo[];
	send(prompt: string, modelId?: string): Promise<void>;
	cancel(): Promise<void>;
	subscribe(handler: (event: AgentEvent) => void): () => void;
	setPermissionMode(mode: string): Promise<void>;
	resolvePermission(requestId: string, optionId: string): void;
	dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Module-level session registry
// ---------------------------------------------------------------------------

const sessions = new Map<string, AcpSessionHandleImpl>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function acpCreateSession(
	cwd: string,
	agentCmd: string,
	agentArgs: string[]
): Promise<AcpSessionHandle> {
	const impl = await spawnAndConnect(cwd, agentCmd, agentArgs);
	const response = await impl.conn.newSession({ cwd, mcpServers: [] });
	impl.sessionId = response.sessionId;
	impl.currentModelId = extractCurrentModelId(response);
	impl.currentModeId = extractCurrentModeId(response);
	impl.availableModels = extractModels(response);
	impl.availableModes = extractModes(response);
	sessions.set(response.sessionId, impl);
	return impl;
}

export async function acpLoadSession(
	sessionId: string,
	cwd: string,
	agentCmd: string,
	agentArgs: string[]
): Promise<AcpSessionHandle> {
	const impl = await spawnAndConnect(cwd, agentCmd, agentArgs);
	impl.sessionId = sessionId;
	const response = await impl.conn.loadSession({ sessionId, cwd, mcpServers: [] });
	impl.currentModelId = extractCurrentModelId(response);
	impl.currentModeId = extractCurrentModeId(response);
	impl.availableModels = extractModels(response);
	impl.availableModes = extractModes(response);
	sessions.set(sessionId, impl);
	return impl;
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

class AcpSessionHandleImpl implements AcpSessionHandle {
	sessionId = "";
	currentModelId = "";
	currentModeId = "";
	availableModels: AgentModelInfo[] = [];
	availableModes: AgentModeInfo[] = [];
	conn: ClientSideConnection;
	private listeners = new Set<(event: AgentEvent) => void>();
	pendingPermissions = new Map<string, (optionId: string) => void>();
	private disposed = false;
	private child: { kill: () => Promise<void> };

	constructor(conn: ClientSideConnection, child: { kill: () => Promise<void> }) {
		this.conn = conn;
		this.child = child;
	}

	async setPermissionMode(mode: string): Promise<void> {
		await this.conn.setSessionMode({ sessionId: this.sessionId, modeId: mode });
	}

	resolvePermission(requestId: string, optionId: string): void {
		const resolve = this.pendingPermissions.get(requestId);
		if (resolve) {
			resolve(optionId);
			this.pendingPermissions.delete(requestId);
		}
	}

	emit(event: AgentEvent) {
		for (const fn of this.listeners) fn(event);
	}

	subscribe(handler: (event: AgentEvent) => void): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	async send(prompt: string, modelId?: string): Promise<void> {
		const response = await this.conn.prompt({
			sessionId: this.sessionId,
			prompt: [{ type: "text", text: prompt }],
			...(modelId ? { modelId } : {}),
		});
		this.emit({
			sessionId: this.sessionId,
			event: { type: "session_complete", stopReason: response.stopReason },
		});
	}

	async cancel(): Promise<void> {
		await this.conn.cancel({ sessionId: this.sessionId });
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		sessions.delete(this.sessionId);
		this.listeners.clear();
		try {
			await this.child.kill();
		} catch {
			// ignore
		}
	}
}

// ---------------------------------------------------------------------------
// Spawn the agent subprocess and create the ClientSideConnection
// ---------------------------------------------------------------------------

async function spawnAndConnect(
	cwd: string,
	agentCmd: string,
	agentArgs: string[]
): Promise<AcpSessionHandleImpl> {
	// Resolve the command — if agentCmd is 'node', we use the ACP script path from Vite define.
	// Otherwise, we use the command directly (e.g. for future agents that have standalone binaries).
	const [resolvedCmd, resolvedArgs] = resolveCommand(agentCmd, agentArgs);

	// Explicitly pass HOME so Claude Code can find its config at ~/.claude/ regardless
	// of how the Tauri app was launched (GUI launch on macOS strips shell env vars).
	const home = await homeDir();
	const command = Command.create(resolvedCmd, resolvedArgs, { cwd, env: { HOME: home } });

	// --- ReadableStream: fed by stdout data events ---
	let readableController!: ReadableStreamDefaultController<Uint8Array>;
	const readable = new ReadableStream<Uint8Array>({
		start(controller) {
			readableController = controller;
		},
		cancel() {
			// nothing to clean up — command lifecycle drives this
		},
	});

	const enc = new TextEncoder();

	// --- WritableStream: writes to child stdin ---
	let childRef: { write: (data: number[]) => Promise<void> } | null = null;
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			return childRef?.write(Array.from(chunk)) ?? Promise.resolve();
		},
	});

	// Register stdout listener before spawn so no bytes are missed.
	// Tauri delivers stdout as string lines (newline stripped), so re-add the
	// newline before encoding to bytes for ndJsonStream.
	command.stdout.on("data", (data: string) => {
		try {
			readableController.enqueue(enc.encode(`${data}\n`));
		} catch {
			// controller may already be closed
		}
	});

	command.on("close", () => {
		try {
			readableController.close();
		} catch {
			// already closed
		}
	});

	command.on("error", (err) => {
		try {
			readableController.error(new Error(err));
		} catch {
			// already errored
		}
	});

	const child = await command.spawn();
	childRef = {
		write: (data: number[]) => child.write(data),
	};

	const stream = ndJsonStream(writable, readable);

	let handleRef!: AcpSessionHandleImpl;

	const conn = new ClientSideConnection((agent) => {
		// Build the Client implementation that handles inbound requests from the agent
		const client: Client = {
			// Required: session update notifications (streaming output)
			async sessionUpdate(notification: SessionNotification): Promise<void> {
				const events = notificationToEvents(notification);
				for (const event of events) {
					handleRef.emit({ sessionId: notification.sessionId, event });
				}
			},

			// Required: surface permission requests to the user
			async requestPermission(params) {
				const requestId = crypto.randomUUID();
				const toolCallInfo = params.toolCall as unknown as { title?: string; name?: string };
				const toolTitle = toolCallInfo?.title ?? toolCallInfo?.name ?? "tool";

				return new Promise((resolve) => {
					handleRef.pendingPermissions.set(requestId, (optionId: string) => {
						resolve({
							outcome: { outcome: "selected" as const, optionId },
						});
					});
					handleRef.emit({
						sessionId: handleRef.sessionId,
						event: {
							type: "permission_request",
							id: requestId,
							toolTitle,
							options: params.options.map((o) => ({
								optionId: o.optionId,
								kind: o.kind as
									| "allow_once"
									| "allow_always"
									| "reject_once"
									| "reject_always",
								name: o.name,
							})),
						},
					});
				});
			},

			// Optional: file system access
			async readTextFile(params) {
				const content = await readTextFile(params.path);
				return { content };
			},

			async writeTextFile(params) {
				await writeTextFile(params.path, params.content);
				return {};
			},

			// Optional: terminal execution (delegates to ptyService)
			async createTerminal(params) {
				// Use a unique terminal ID scoped to this connection
				const terminalId = `acp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				// Spawn a PTY with a minimal size; it runs headlessly for the agent
				await ptySpawn(terminalId, params.command, params.args ?? [], params.cwd ?? cwd, 24, 80);
				return { terminalId };
			},

			async terminalOutput(params) {
				// Collect all buffered output from ptyService events
				// Since ptyService is event-based, we accumulate output via a promise
				return new Promise((resolve) => {
					let output = "";
					let settled = false;

					const unlisten = ptyOnData(params.terminalId, (data) => {
						output += new TextDecoder().decode(data);
					});

					// ptyOnClose signals exit — resolve then
					const unlistenClose = ptyOnClose(params.terminalId, () => {
						if (!settled) {
							settled = true;
							Promise.all([unlisten, unlistenClose]).then(([ul, ulc]) => {
								ul();
								ulc();
							});
							resolve({ output, truncated: false, exitStatus: { exitCode: 0 } });
						}
					});

					// Fallback: if close never fires, resolve after a short poll
					setTimeout(() => {
						if (!settled) {
							settled = true;
							Promise.all([unlisten, unlistenClose]).then(([ul, ulc]) => {
								ul();
								ulc();
							});
							resolve({ output, truncated: false });
						}
					}, 100);
				});
			},

			async waitForTerminalExit(params) {
				return new Promise((resolve) => {
					ptyOnClose(params.terminalId, () => {
						resolve({ exitCode: 0 });
					}).then((unlisten) => {
						// The unlisten is captured when needed
						void unlisten;
					});
				});
			},

			async killTerminal(params) {
				await ptyKill(params.terminalId);
				return {};
			},

			async releaseTerminal(params) {
				await ptyKill(params.terminalId);
			},
		};

		void agent; // agent reference is not used by client implementations
		return client;
	}, stream);

	handleRef = new AcpSessionHandleImpl(conn, child);

	// Initialize + authenticate
	const initResponse = await conn.initialize({
		protocolVersion: 1,
		clientInfo: { name: "orchestrator", version: "0.1.0" },
		clientCapabilities: {
			fs: { readTextFile: true, writeTextFile: true },
			terminal: true,
		},
	});

	void initResponse; // authentication is not implemented by claude-code-acp

	return handleRef;
}

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

function resolveCommand(agentCmd: string, agentArgs: string[]): [string, string[]] {
	if (agentCmd === "node") {
		// __ACP_SCRIPT_PATH__ is injected by Vite — path to claude-code-acp dist/index.js
		return ["node", [__ACP_SCRIPT_PATH__, ...agentArgs]];
	}
	return [agentCmd, agentArgs];
}

// ---------------------------------------------------------------------------
// Map ACP SessionNotification → internal AgentEventKind[]
// ---------------------------------------------------------------------------

function notificationToEvents(notification: SessionNotification): AgentEventKind[] {
	const update = notification.update;
	if (!update) return [];

	switch (update.sessionUpdate) {
		case "agent_message_chunk": {
			// ContentChunk.content is a single ContentBlock (not an array)
			const block = (update as unknown as { content?: { type: string; text?: string } }).content;
			const text = block?.type === "text" ? (block.text ?? "") : "";
			return text ? [{ type: "message_chunk", text }] : [];
		}

		case "tool_call": {
			const tc = update as unknown as {
				toolCallId?: string;
				title?: string;
				status?: string;
			};
			return [
				{
					type: "tool_call",
					id: tc.toolCallId ?? "",
					title: tc.title ?? "",
					status: mapToolStatus(tc.status),
				},
			];
		}

		case "tool_call_update": {
			const tcu = update as unknown as {
				toolCallId?: string;
				status?: string;
			};
			return [
				{
					type: "tool_call_update",
					id: tcu.toolCallId ?? "",
					status: mapToolStatus(tcu.status),
				},
			];
		}

		case "plan": {
			const p = update as unknown as {
				entries?: Array<{ content?: string; status?: string; priority?: string }>;
			};
			const entries: PlanEntry[] = (p.entries ?? []).map((e) => ({
				title: e.content ?? "",
				status: e.status ?? "pending",
				priority: (e.priority ?? "medium") as PlanEntry["priority"],
			}));
			return [{ type: "plan", entries }];
		}

		case "current_mode_update": {
			const cmu = update as unknown as { currentModeId?: string };
			return cmu.currentModeId ? [{ type: "mode_update", modeId: cmu.currentModeId }] : [];
		}

		default:
			return [];
	}
}

function mapToolStatus(status: string | undefined): ToolCallStatus {
	if (status === "in_progress") return "in_progress";
	if (status === "completed") return "completed";
	return "pending";
}

// ---------------------------------------------------------------------------
// Extract models/modes from session responses
// ---------------------------------------------------------------------------

type SessionResponse = { models?: { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string }> } | null; modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name: string }> } | null } | undefined | void;

function extractCurrentModelId(response: SessionResponse): string {
	return (response as { models?: { currentModelId?: string } | null } | null)?.models?.currentModelId ?? "";
}

function extractCurrentModeId(response: SessionResponse): string {
	return (response as { modes?: { currentModeId?: string } | null } | null)?.modes?.currentModeId ?? "";
}

function extractModels(response: SessionResponse): AgentModelInfo[] {
	return (response as { models?: { availableModels?: Array<{ modelId: string; name: string }> } | null } | null)?.models?.availableModels?.map((m) => ({ modelId: m.modelId, name: m.name })) ?? [];
}

function extractModes(response: SessionResponse): AgentModeInfo[] {
	return (response as { modes?: { availableModes?: Array<{ id: string; name: string }> } | null } | null)?.modes?.availableModes?.map((m) => ({ id: m.id, name: m.name })) ?? [];
}
