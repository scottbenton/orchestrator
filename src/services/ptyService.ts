import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export async function ptySpawn(
	id: string,
	program: string,
	args: string[],
	cwd: string,
	rows: number,
	cols: number
): Promise<void> {
	await invoke("pty_spawn", { payload: { id, program, args, cwd, rows, cols } });
}

export async function ptyWrite(id: string, data: Uint8Array): Promise<void> {
	await invoke("pty_write", { id, data: Array.from(data) });
}

export async function ptyResize(id: string, rows: number, cols: number): Promise<void> {
	await invoke("pty_resize", { id, rows, cols });
}

export async function ptyKill(id: string): Promise<void> {
	await invoke("pty_kill", { id });
}

export async function ptyOnData(id: string, cb: (data: Uint8Array) => void): Promise<() => void> {
	return listen<{ id: string; data: number[] }>("pty-data", (event) => {
		if (event.payload.id === id) {
			cb(new Uint8Array(event.payload.data));
		}
	});
}

// ---------------------------------------------------------------------------
// ptyOnClose — buffered so late registrations still fire
//
// Commands spawned via /bin/sh -c can complete before waitForTerminalExit
// registers its Tauri event listener.  A single module-level listener buffers
// close events so that any callback registered after the close still fires.
// ---------------------------------------------------------------------------

const closedPtyIds = new Set<string>();
const closeCallbackRegistry = new Map<string, Set<() => void>>();

// Eagerly register the single global listener.
// Tauri events fire on the main thread; module-level side effects are fine here.
listen<{ id: string }>("pty-close", (event) => {
	const id = event.payload.id;
	closedPtyIds.add(id);
	const callbacks = closeCallbackRegistry.get(id);
	if (callbacks) {
		closeCallbackRegistry.delete(id);
		for (const cb of callbacks) cb();
	}
});

export async function ptyOnClose(id: string, cb: () => void): Promise<() => void> {
	if (closedPtyIds.has(id)) {
		// Already closed — invoke the callback asynchronously to keep callers consistent.
		queueMicrotask(cb);
		return () => {};
	}
	let set = closeCallbackRegistry.get(id);
	if (!set) {
		set = new Set();
		closeCallbackRegistry.set(id, set);
	}
	set.add(cb);
	return () => {
		closeCallbackRegistry.get(id)?.delete(cb);
	};
}
