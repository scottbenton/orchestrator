import { Command } from "@tauri-apps/plugin-shell";
import { v4 as uuid } from "uuid";
import { getDb } from "@/lib/db";
import type { InteractionResolution, LogLine, ProcessEvent, ProcessHandle } from "@/types/logs";

export type {
	InteractionRequest,
	InteractionResolution,
	LogLine,
	ProcessEvent,
	ProcessHandle,
} from "@/types/logs";

export async function runProcess(
	program: string,
	args: string[],
	options: {
		cwd: string;
		taskId: string;
		onEvent: (event: ProcessEvent) => void;
	}
): Promise<{ handle: ProcessHandle; done: Promise<number> }> {
	const db = await getDb();
	const cmd = Command.create(program, args, { cwd: options.cwd });

	const persistLog = (stream: LogLine["stream"], line: string): void => {
		const entry: LogLine = {
			id: uuid(),
			taskId: options.taskId,
			timestamp: new Date().toISOString(),
			stream,
			line,
		};
		db.execute("INSERT INTO task_logs VALUES (?, ?, ?, ?, ?)", [
			entry.id,
			entry.taskId,
			entry.timestamp,
			entry.stream,
			entry.line,
		]).catch(console.error);
		options.onEvent({ type: "log", data: entry });
	};

	cmd.stdout.on("data", (line) => persistLog("stdout", line));
	cmd.stderr.on("data", (line) => persistLog("stderr", line));

	const done = new Promise<number>((resolve) => {
		cmd.on("close", (data) => {
			const exitCode = data.code ?? 0;
			options.onEvent({ type: "done", data: { exitCode } });
			resolve(exitCode);
		});
		cmd.on("error", (error) => {
			persistLog("system", `Process error: ${error}`);
			options.onEvent({ type: "done", data: { exitCode: 1 } });
			resolve(1);
		});
	});

	const child = await cmd.spawn();

	const handle: ProcessHandle = {
		respond: async (interactionId: string, resolution: InteractionResolution) => {
			await child.write(`${JSON.stringify({ interactionId, resolution })}\n`);
		},
		kill: async () => {
			await child.kill();
		},
	};

	return { handle, done };
}

export async function emitSystemLog(
	taskId: string,
	line: string,
	onEvent?: (event: ProcessEvent) => void
): Promise<void> {
	const db = await getDb();
	const entry: LogLine = {
		id: uuid(),
		taskId,
		timestamp: new Date().toISOString(),
		stream: "system",
		line,
	};
	await db.execute("INSERT INTO task_logs VALUES (?, ?, ?, ?, ?)", [
		entry.id,
		entry.taskId,
		entry.timestamp,
		entry.stream,
		entry.line,
	]);
	onEvent?.({ type: "log", data: entry });
}

export async function getTaskLogs(taskId: string): Promise<LogLine[]> {
	const db = await getDb();
	const rows = await db.select<
		Array<{
			id: string;
			task_id: string;
			timestamp: string;
			stream: string;
			line: string;
		}>
	>(
		"SELECT id, task_id, timestamp, stream, line FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC",
		[taskId]
	);
	return rows.map((row) => ({
		id: row.id,
		taskId: row.task_id,
		timestamp: row.timestamp,
		stream: row.stream as LogLine["stream"],
		line: row.line,
	}));
}
