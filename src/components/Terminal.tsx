import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import {
	ptyKill,
	ptyOnClose,
	ptyOnData,
	ptyResize,
	ptySpawn,
	ptyWrite,
} from "@/services/ptyService";
import { useUIStore } from "@/store/uiStore";

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

const DARK_THEME: ITheme = {
	background: "#1e1e1e",
	foreground: "#d4d4d4",
	cursor: "#d4d4d4",
	selectionBackground: "#264f78",
	black: "#1e1e1e",
	red: "#f44747",
	green: "#608b4e",
	yellow: "#dcdcaa",
	blue: "#569cd6",
	magenta: "#c678dd",
	cyan: "#4ec9b0",
	white: "#d4d4d4",
	brightBlack: "#808080",
	brightRed: "#f44747",
	brightGreen: "#b5cea8",
	brightYellow: "#dcdcaa",
	brightBlue: "#9cdcfe",
	brightMagenta: "#c678dd",
	brightCyan: "#4ec9b0",
	brightWhite: "#ffffff",
};

const LIGHT_THEME: ITheme = {
	background: "#ffffff",
	foreground: "#1e1e1e",
	cursor: "#1e1e1e",
	selectionBackground: "#add6ff",
	black: "#000000",
	red: "#cd3131",
	green: "#00bc00",
	yellow: "#949800",
	blue: "#0451a5",
	magenta: "#bc05bc",
	cyan: "#0598bc",
	white: "#555555",
	brightBlack: "#666666",
	brightRed: "#cd3131",
	brightGreen: "#14ce14",
	brightYellow: "#b5ba00",
	brightBlue: "#0451a5",
	brightMagenta: "#bc05bc",
	brightCyan: "#0598bc",
	brightWhite: "#a5a5a5",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TerminalProps {
	id: string;
	program: string;
	args: string[];
	cwd: string;
	isActive: boolean;
}

export function Terminal({ id, program, args, cwd, isActive }: TerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	// Set to true once ptySpawn resolves — guards resize calls and listeners
	const ptyReadyRef = useRef(false);
	// Unlisten fns stored in refs so the mount cleanup can reach them
	const unlistenDataRef = useRef<(() => void) | null>(null);
	const unlistenCloseRef = useRef<(() => void) | null>(null);
	const theme = useUIStore((s) => s.theme);

	// Mount: open xterm and wire keyboard input only — no fit, no spawn.
	// Fit and spawn happen in the active effect below so there is a single,
	// ordered code path and no risk of ptyResize racing ptySpawn.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-once effect
	useEffect(() => {
		if (!containerRef.current) return;

		const term = new XTerm({
			theme: theme === "dark" ? DARK_THEME : LIGHT_THEME,
			fontFamily: '"JetBrains Mono Variable", "Menlo", monospace',
			fontSize: 13,
			scrollback: 5000,
			cursorBlink: true,
		});
		const fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();

		term.loadAddon(fitAddon);
		term.loadAddon(webLinksAddon);
		term.open(containerRef.current);

		termRef.current = term;
		fitRef.current = fitAddon;

		const disposeOnData = term.onData((data) => {
			ptyWrite(id, new TextEncoder().encode(data));
		});

		return () => {
			disposeOnData.dispose();
			unlistenDataRef.current?.();
			unlistenCloseRef.current?.();
			ptyKill(id);
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
			ptyReadyRef.current = false;
		};
	}, []);

	// Theme changes: update without remounting
	useEffect(() => {
		if (termRef.current) {
			termRef.current.options.theme = theme === "dark" ? DARK_THEME : LIGHT_THEME;
		}
	}, [theme]);

	// Active effect: owns fit, spawn (first activation), and resize (subsequent).
	// The ResizeObserver is also gated on ptyReadyRef so it never calls ptyResize
	// before the PTY exists.
	useEffect(() => {
		if (!isActive) return;
		const container = containerRef.current;
		if (!container) return;

		const observer = new ResizeObserver(() => {
			if (!ptyReadyRef.current || !fitRef.current || !termRef.current) return;
			fitRef.current.fit();
			ptyResize(id, termRef.current.rows, termRef.current.cols);
		});
		observer.observe(container);

		const raf = requestAnimationFrame(() => {
			if (!fitRef.current || !termRef.current) return;
			fitRef.current.fit();
			const { rows, cols } = termRef.current;

			if (!ptyReadyRef.current) {
				// First activation: spawn the PTY with correct dimensions
				ptySpawn(id, program, args, cwd, rows, cols).then(() => {
					ptyReadyRef.current = true;
					ptyOnData(id, (data) => termRef.current?.write(data)).then((fn) => {
						unlistenDataRef.current = fn;
					});
					ptyOnClose(id, () => {
						termRef.current?.writeln("\r\n\x1b[2m[Process exited]\x1b[0m");
					}).then((fn) => {
						unlistenCloseRef.current = fn;
					});
				});
			} else {
				// Subsequent activations: resize and repaint
				ptyResize(id, rows, cols);
				termRef.current.refresh(0, rows - 1);
			}
		});

		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
		};
	}, [id, isActive]);

	return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
