import { create } from "zustand";
import type {
	InteractionRequest,
	InteractionResolution,
	LogLine,
	ProcessHandle,
} from "@/types/logs";

interface LogsState {
	logs: Record<string, LogLine[]>;
	interactions: Record<string, InteractionRequest[]>;
	handles: Record<string, ProcessHandle>;

	appendLine: (line: LogLine) => void;
	setLogs: (taskId: string, lines: LogLine[]) => void;
	clearLogs: (taskId: string) => void;

	upsertInteraction: (interaction: InteractionRequest) => void;
	resolveInteraction: (taskId: string, id: string, resolution: InteractionResolution) => void;

	setHandle: (taskId: string, handle: ProcessHandle) => void;
	clearHandle: (taskId: string) => void;
}

export const useLogsStore = create<LogsState>((set) => ({
	logs: {},
	interactions: {},
	handles: {},

	appendLine: (line) =>
		set((state) => ({
			logs: {
				...state.logs,
				[line.taskId]: [...(state.logs[line.taskId] ?? []), line],
			},
		})),

	setLogs: (taskId, lines) => set((state) => ({ logs: { ...state.logs, [taskId]: lines } })),

	clearLogs: (taskId) =>
		set((state) => {
			const logs = { ...state.logs };
			delete logs[taskId];
			return { logs };
		}),

	upsertInteraction: (interaction) =>
		set((state) => {
			const existing = state.interactions[interaction.taskId] ?? [];
			const idx = existing.findIndex((i) => i.id === interaction.id);
			const updated =
				idx >= 0
					? existing.map((i, j) => (j === idx ? interaction : i))
					: [...existing, interaction];
			return {
				interactions: {
					...state.interactions,
					[interaction.taskId]: updated,
				},
			};
		}),

	resolveInteraction: (taskId, id, resolution) =>
		set((state) => {
			const existing = state.interactions[taskId] ?? [];
			const updated = existing.map((i) =>
				i.id === id ? { ...i, status: "resolved" as const, resolution } : i
			);
			return { interactions: { ...state.interactions, [taskId]: updated } };
		}),

	setHandle: (taskId, handle) =>
		set((state) => ({ handles: { ...state.handles, [taskId]: handle } })),

	clearHandle: (taskId) =>
		set((state) => {
			const handles = { ...state.handles };
			delete handles[taskId];
			return { handles };
		}),
}));
