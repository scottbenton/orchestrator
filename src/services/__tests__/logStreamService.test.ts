import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @/lib/db before importing the service
// ---------------------------------------------------------------------------

const executedParams: unknown[][] = [];
let selectRows: unknown[] = [];

const mockExecute = mock(async (_sql: string, params: unknown[]) => {
	executedParams.push([...params]);
});
const mockSelect = mock(async <T>() => selectRows as T);

mock.module("@/lib/db", () => ({
	getDb: mock(() =>
		Promise.resolve({
			execute: mockExecute,
			select: mockSelect,
		})
	),
}));

// Deterministic UUIDs
let uuidCounter = 0;
mock.module("uuid", () => ({ v4: () => `test-uuid-${++uuidCounter}` }));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

const { emitSystemLog, getTaskLogs } = await import("../logStreamService");

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	uuidCounter = 0;
	executedParams.length = 0;
	selectRows = [];
	mockExecute.mockClear();
	mockSelect.mockClear();
});

// ---------------------------------------------------------------------------
// emitSystemLog
// ---------------------------------------------------------------------------

describe("emitSystemLog", () => {
	test("persists to db with correct fields", async () => {
		await emitSystemLog("task-1", "build started");

		expect(executedParams).toHaveLength(1);
		const [id, taskId, , stream, line] = executedParams[0] as string[];
		expect(id).toBe("test-uuid-1");
		expect(taskId).toBe("task-1");
		expect(stream).toBe("system");
		expect(line).toBe("build started");
	});

	test("fires onEvent callback with log event", async () => {
		const events: unknown[] = [];
		await emitSystemLog("task-1", "hello", (e) => events.push(e));

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "log",
			data: {
				taskId: "task-1",
				stream: "system",
				line: "hello",
			},
		});
	});

	test("does not throw when onEvent is omitted", async () => {
		const result = await emitSystemLog("task-1", "silent");
		expect(result).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// getTaskLogs
// ---------------------------------------------------------------------------

describe("getTaskLogs", () => {
	test("returns empty array when no rows", async () => {
		const logs = await getTaskLogs("task-1");
		expect(logs).toEqual([]);
	});

	test("maps snake_case columns to camelCase fields", async () => {
		selectRows = [
			{
				id: "row-1",
				task_id: "task-1",
				timestamp: "2026-01-01T00:00:00.000Z",
				stream: "stdout",
				line: "hello world",
			},
		];

		const logs = await getTaskLogs("task-1");

		expect(logs).toHaveLength(1);
		expect(logs[0]).toEqual({
			id: "row-1",
			taskId: "task-1",
			timestamp: "2026-01-01T00:00:00.000Z",
			stream: "stdout",
			line: "hello world",
		});
	});

	test("returns multiple rows in order", async () => {
		selectRows = [
			{
				id: "a",
				task_id: "t",
				timestamp: "2026-01-01T00:00:01.000Z",
				stream: "stdout",
				line: "first",
			},
			{
				id: "b",
				task_id: "t",
				timestamp: "2026-01-01T00:00:02.000Z",
				stream: "stderr",
				line: "second",
			},
		];

		const logs = await getTaskLogs("t");
		expect(logs).toHaveLength(2);
		expect(logs[0].line).toBe("first");
		expect(logs[1].stream).toBe("stderr");
	});
});
