import { open } from "@tauri-apps/plugin-dialog";
import { LazyStore } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, Send, Square, X } from "lucide-react";
import { LogViewer } from "@/components/LogViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { workspaceRoute } from "@/router";
import { type PermissionLevel, getBackend } from "@/services/aiBackend";
import { emitSystemLog } from "@/services/logStreamService";
import { useLogsStore } from "@/store/logsStore";

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

interface AiTab {
	id: string;
	name: string;
	isDefaultName: boolean;
	sessionId?: string;
	cwd: string;
	model: string;
	permissions: PermissionLevel;
}

const MODELS = [
	{ value: "default", label: "Default" },
	{ value: "claude-opus-4-6", label: "Claude Opus 4.6" },
	{ value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
	{ value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
] as const;

const PERMISSIONS: { value: PermissionLevel; label: string }[] = [
	{ value: "default", label: "Default permissions" },
	{ value: "bypass", label: "Bypass permissions" },
];

// ---------------------------------------------------------------------------
// Per-workspace tab persistence via plugin-store
// ---------------------------------------------------------------------------

function getTabStore(workspaceId: string) {
	return new LazyStore(`ai_tabs_${workspaceId}.json`, {
		defaults: { tabs: [] as AiTab[] },
		autoSave: true,
	});
}

async function loadPersistedTabs(workspaceId: string, defaultCwd: string): Promise<AiTab[]> {
	try {
		const store = getTabStore(workspaceId);
		const raw = await store.get<AiTab[]>("tabs");
		if (Array.isArray(raw) && raw.length > 0) {
			return raw;
		}
	} catch {
		// ignore
	}
	return [makeTab(1, defaultCwd)];
}

async function persistTabs(workspaceId: string, tabs: AiTab[]) {
	try {
		const store = getTabStore(workspaceId);
		await store.set("tabs", tabs);
	} catch {
		// ignore
	}
}

function makeTab(n: number, cwd: string): AiTab {
	return {
		id: crypto.randomUUID(),
		name: `Session ${n}`,
		isDefaultName: true,
		sessionId: undefined,
		cwd,
		model: "default",
		permissions: "default",
	};
}

// ---------------------------------------------------------------------------
// AiPage
// ---------------------------------------------------------------------------

export function AiPage() {
	const { workspace } = workspaceRoute.useRouteContext();

	const [tabs, setTabs] = useState<AiTab[]>([]);
	const [activeTabIndex, setActiveTabIndex] = useState(0);
	const [loaded, setLoaded] = useState(false);

	// Load persisted tabs on mount / workspace change
	useEffect(() => {
		setLoaded(false);
		loadPersistedTabs(workspace.id, workspace.path).then((loaded) => {
			setTabs(loaded);
			setActiveTabIndex(0);
			setLoaded(true);
		});
	}, [workspace.id, workspace.path]);

	// Persist tabs whenever they change (after initial load)
	useEffect(() => {
		if (loaded && tabs.length > 0) {
			persistTabs(workspace.id, tabs);
		}
	}, [loaded, tabs, workspace.id]);

	const updateTab = useCallback((id: string, patch: Partial<AiTab>) => {
		setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	}, []);

	const activeTab = tabs[activeTabIndex] ?? tabs[0];

	function addTab() {
		const n = tabs.length + 1;
		const newTab = makeTab(n, workspace.path);
		setTabs((prev) => [...prev, newTab]);
		setActiveTabIndex(tabs.length);
	}

	function closeTab(index: number) {
		if (tabs.length === 1) {
			// Replace with a fresh tab rather than leaving empty
			const fresh = makeTab(1, workspace.path);
			setTabs([fresh]);
			setActiveTabIndex(0);
			return;
		}
		setTabs((prev) => prev.filter((_, i) => i !== index));
		setActiveTabIndex((prev) => Math.min(prev, tabs.length - 2));
	}

	if (!loaded || !activeTab) return null;

	return (
		<div className="flex flex-col h-full min-h-0">
			{/* Tab bar */}
			<div className="flex items-center gap-1 px-2 pt-1 border-b border-border shrink-0 overflow-x-auto">
				{tabs.map((tab, i) => (
					<div
						key={tab.id}
						className={`group flex items-center rounded-t text-sm shrink-0 ${
							i === activeTabIndex
								? "bg-background border border-b-background border-border -mb-px"
								: "text-muted-foreground"
						}`}
					>
						<button
							type="button"
							className="px-3 py-1.5 max-w-32 truncate cursor-pointer hover:text-foreground"
							onClick={() => setActiveTabIndex(i)}
						>
							{tab.name}
						</button>
						<button
							type="button"
							className="opacity-0 group-hover:opacity-100 mr-1 rounded hover:bg-muted p-0.5"
							onClick={() => closeTab(i)}
							aria-label={`Close ${tab.name}`}
						>
							<X className="size-3" />
						</button>
					</div>
				))}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-7 shrink-0"
					onClick={addTab}
					aria-label="New session"
				>
					<Plus className="size-4" />
				</Button>
			</div>

			{/* Log viewer */}
			<div className="flex-1 min-h-0">
				<LogViewer taskId={activeTab.id} live />
			</div>

			{/* Bottom bar */}
			<BottomBar
				tab={activeTab}
				onUpdate={(patch) => updateTab(activeTab.id, patch)}
				onSessionId={(id) => updateTab(activeTab.id, { sessionId: id })}
				onAutoName={(name) => updateTab(activeTab.id, { name, isDefaultName: false })}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// BottomBar
// ---------------------------------------------------------------------------

interface BottomBarProps {
	tab: AiTab;
	onUpdate: (patch: Partial<AiTab>) => void;
	onSessionId: (id: string) => void;
	onAutoName: (name: string) => void;
}

function BottomBar({ tab, onUpdate, onSessionId, onAutoName }: BottomBarProps) {
	const { workspace } = workspaceRoute.useRouteContext();
	const [prompt, setPrompt] = useState("");
	const [running, setRunning] = useState(false);
	const autoNamedRef = useRef(false);

	// Reset auto-name flag when tab changes
	useEffect(() => {
		autoNamedRef.current = !tab.isDefaultName;
	}, [tab.isDefaultName]);

	const handleSend = useCallback(async () => {
		const trimmed = prompt.trim();
		if (!trimmed || running) return;

		setRunning(true);
		setPrompt("");

		const { appendLine, setHandle, clearHandle } = useLogsStore.getState();

		try {
			await emitSystemLog(tab.id, `[You]: ${trimmed}`);

			const backend = getBackend(
				// Use default settings shape — backend type comes from workspace settings
				// but for now we always use ClaudeCodeBackend
				{ name: workspace.name, ai_backend: "claude-code" }
			);

			const { handle } = await backend.run(
				trimmed,
				tab.cwd,
				tab.id,
				tab.sessionId,
				(event) => {
					if (event.type === "log") {
						appendLine(event.data);
						// Auto-name from first assistant text
						if (
							!autoNamedRef.current &&
							tab.isDefaultName &&
							event.data.raw?.type === "assistant"
						) {
							const text = event.data.line.trim();
							if (text) {
								const name = text.slice(0, 32) + (text.length > 32 ? "…" : "");
								onAutoName(name);
								autoNamedRef.current = true;
							}
						}
					}
				},
				(id) => onSessionId(id),
				{ model: tab.model, permissions: tab.permissions }
			);

			setHandle(tab.id, handle);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			await emitSystemLog(tab.id, `[Error]: ${msg}`);
		} finally {
			clearHandle(tab.id);
			setRunning(false);
		}
	}, [prompt, running, tab, workspace.name, onSessionId, onAutoName]);

	const handleStop = useCallback(() => {
		const { handles, clearHandle } = useLogsStore.getState();
		handles[tab.id]?.kill();
		clearHandle(tab.id);
		setRunning(false);
	}, [tab.id]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend]
	);

	async function handleBrowse() {
		const selected = await open({ directory: true, multiple: false });
		if (typeof selected === "string") {
			onUpdate({ cwd: selected });
		}
	}

	function resizeTextarea(el: HTMLTextAreaElement) {
		el.style.height = "auto";
		const maxHeight = 20 * 6 + 16; // 6 rows + padding
		el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
	}

	return (
		<div className="border-t border-border p-3 flex flex-col gap-2 shrink-0">
			{/* Options row */}
			<div className="flex items-center gap-2">
				<Select value={tab.model} onValueChange={(v) => onUpdate({ model: v })} disabled={running}>
					<SelectTrigger size="sm" className="w-48" aria-label="Model">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{MODELS.map((m) => (
								<SelectItem key={m.value} value={m.value}>
									{m.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>

				<Select
					value={tab.permissions}
					onValueChange={(v) => onUpdate({ permissions: v as PermissionLevel })}
					disabled={running}
				>
					<SelectTrigger size="sm" className="w-48" aria-label="Permissions">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{PERMISSIONS.map((p) => (
								<SelectItem key={p.value} value={p.value}>
									{p.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</div>

			{/* CWD row */}
			<div className="flex items-center gap-2">
				<Input
					value={tab.cwd}
					onChange={(e) => onUpdate({ cwd: e.target.value })}
					className="flex-1 font-mono text-xs h-7"
					aria-label="Working directory"
					disabled={running}
				/>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-7 shrink-0"
					onClick={handleBrowse}
					disabled={running}
					aria-label="Browse for directory"
				>
					<FolderOpen className="size-3.5" />
				</Button>
			</div>

			{/* Prompt row */}
			<div className="flex items-end gap-2">
				<textarea
					value={prompt}
					onChange={(e) => {
						setPrompt(e.target.value);
						resizeTextarea(e.target);
					}}
					onKeyDown={handleKeyDown}
					placeholder="Ask Claude… (⌘↵ to send)"
					rows={1}
					disabled={running}
					className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 overflow-hidden min-h-[36px]"
				/>
				{running ? (
					<Button
						type="button"
						variant="destructive"
						size="icon"
						onClick={handleStop}
						aria-label="Stop"
					>
						<Square className="size-4" />
					</Button>
				) : (
					<Button
						type="button"
						size="icon"
						onClick={handleSend}
						disabled={!prompt.trim()}
						aria-label="Send"
					>
						<Send className="size-4" />
					</Button>
				)}
			</div>
		</div>
	);
}
