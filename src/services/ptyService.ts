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

export async function ptyOnClose(id: string, cb: () => void): Promise<() => void> {
	return listen<{ id: string }>("pty-close", (event) => {
		if (event.payload.id === id) {
			cb();
		}
	});
}
