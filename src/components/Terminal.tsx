import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { ptyKill, ptyOnClose, ptyOnData, ptyResize, ptySpawn, ptyWrite } from "@/services/ptyService";
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
	const theme = useUIStore((s) => s.theme);

	// Mount: create xterm instance, spawn PTY. id/program/args/cwd are stable per tab instance.
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

		let unlistenData: (() => void) | null = null;
		let unlistenClose: (() => void) | null = null;

		// Defer fit + spawn to next frame so the browser has completed layout
		// and the container has real dimensions before we measure.
		const raf = requestAnimationFrame(() => {
			fitAddon.fit();
			const { rows, cols } = term;

			ptySpawn(id, program, args, cwd, rows, cols).then(() => {
				ptyOnData(id, (data) => term.write(data)).then((fn) => {
					unlistenData = fn;
				});
				ptyOnClose(id, () => {
					term.writeln("\r\n\x1b[2m[Process exited]\x1b[0m");
				}).then((fn) => {
					unlistenClose = fn;
				});
			});
		});

		// Input: terminal → PTY
		const disposeOnData = term.onData((data) => {
			ptyWrite(id, new TextEncoder().encode(data));
		});

		return () => {
			cancelAnimationFrame(raf);
			disposeOnData.dispose();
			unlistenData?.();
			unlistenClose?.();
			ptyKill(id);
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, []);

	// Theme changes: update without remounting
	useEffect(() => {
		if (termRef.current) {
			termRef.current.options.theme = theme === "dark" ? DARK_THEME : LIGHT_THEME;
		}
	}, [theme]);

	// Resize when active or container changes size
	useEffect(() => {
		if (!isActive) return;
		const container = containerRef.current;
		if (!container) return;

		const observer = new ResizeObserver(() => {
			if (!fitRef.current || !termRef.current) return;
			fitRef.current.fit();
			ptyResize(id, termRef.current.rows, termRef.current.cols);
		});
		observer.observe(container);

		// Defer fit until after the browser has applied display:block and laid out
		const raf = requestAnimationFrame(() => {
			if (!fitRef.current || !termRef.current) return;
			fitRef.current.fit();
			ptyResize(id, termRef.current.rows, termRef.current.cols);
			termRef.current.refresh(0, termRef.current.rows - 1);
		});

		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
		};
	}, [id, isActive]);

	return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
