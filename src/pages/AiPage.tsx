import { X, Plus, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@/components/Terminal";
import { Button } from "@/components/ui/button";
import { useWorkspaceSettings } from "@/hooks/api/useWorkspaceSettings";
import { getAgentDefinition } from "@/lib/agents";
import { runCommand } from "@/lib/shell";
import { ptyKill } from "@/services/ptyService";
import { useTabsStore, type PersistedTab } from "@/store/tabsStore";
import { useWorkspace } from "@/hooks/api/useWorkspace";

// ---------------------------------------------------------------------------
// tmux session name from workspace + tab IDs
// ---------------------------------------------------------------------------

function sessionName(workspaceId: string, tabId: string): string {
	return `${workspaceId.slice(0, 8)}-${tabId.replace(/-/g, "").slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Module-level tmux cache — persists across route navigation / remounts
// ---------------------------------------------------------------------------

let tmuxCache: boolean | null = null;

// ---------------------------------------------------------------------------
// AiPage
// ---------------------------------------------------------------------------

export function AiPage() {
	const workspace = useWorkspace();
	const { data: settings } = useWorkspaceSettings(workspace);

	const { tabs, activeTabId, isLoaded, loadTabs, addTab, closeTab, setActiveTab, updateTabTitle } =
		useTabsStore();

	// tmux availability: seeded from module cache so route navigation is instant
	const [tmuxAvailable, setTmuxAvailable] = useState<boolean | null>(tmuxCache);
	const [tmuxBannerDismissed, setTmuxBannerDismissed] = useState(false);

	// Load tabs on workspace change
	useEffect(() => {
		if (!workspace) return;
		loadTabs(workspace.id, workspace.path);
	}, [workspace?.id, workspace?.path, workspace, loadTabs]);

	// Check tmux once per process lifetime (cache survives route navigation)
	useEffect(() => {
		if (tmuxCache !== null) {
			setTmuxAvailable(tmuxCache);
			return;
		}
		runCommand("which", ["tmux"]).then(({ code }) => {
			tmuxCache = code === 0;
			setTmuxAvailable(tmuxCache);
		});
	}, []);

	const agent =
		settings ? getAgentDefinition(settings.ai_backend) : getAgentDefinition("claude-code");

	function getSpawnArgs(tab: PersistedTab): { program: string; args: string[] } {
		// tmuxAvailable is never null here — we gate rendering below
		if (!tmuxAvailable) {
			return { program: agent.command, args: agent.args };
		}
		const name = sessionName(workspace?.id ?? "", tab.id);
		return {
			program: "tmux",
			args: ["attach-session", "-t", name],
		};
	}

	async function handleAddTab() {
		if (!workspace) return;
		const tab = addTab(workspace.id, workspace.path);

		if (tmuxAvailable) {
			const name = sessionName(workspace.id, tab.id);
			try {
				await runCommand("tmux", [
					"new-session",
					"-d",
					"-s",
					name,
					"-c",
					tab.cwd,
					"--",
					agent.command,
					...agent.args,
				]);
			} catch {
				// tmux create failed — Terminal will spawn agent directly
			}
		}
	}

	async function handleCloseTab(tabId: string) {
		if (!workspace) return;

		// Kill the PTY attach process
		await ptyKill(tabId);

		// Kill the tmux session too (stops the agent)
		if (tmuxAvailable) {
			const name = sessionName(workspace.id, tabId);
			runCommand("tmux", ["kill-session", "-t", name]).catch(() => {});
		}

		closeTab(workspace.id, tabId);
	}

	// When tabs load (or tmux availability resolves), ensure each tmux session exists.
	// Sessions may have survived an app close; if gone, create fresh ones.
	useEffect(() => {
		if (!isLoaded || !workspace || !settings || tmuxAvailable === null) return;
		if (!tmuxAvailable) return;

		for (const tab of tabs) {
			const name = sessionName(workspace.id, tab.id);
			runCommand("tmux", ["has-session", "-t", name]).then(({ code }) => {
				if (code !== 0) {
					runCommand("tmux", [
						"new-session",
						"-d",
						"-s",
						name,
						"-c",
						tab.cwd,
						"--",
						agent.command,
						...agent.args,
					]).catch(() => {});
				}
			});
		}
	}, [isLoaded, tmuxAvailable, workspace?.id, workspace, settings, tabs, agent]);

	// Track which tabs have ever been activated so we lazy-mount terminals.
	// A terminal only mounts the first time its tab is made active, ensuring
	// xterm.js always initialises against a visible, measurable container.
	const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(new Set());
	useEffect(() => {
		if (!activeTabId) return;
		setMountedTabIds((prev) => {
			if (prev.has(activeTabId)) return prev;
			const next = new Set(prev);
			next.add(activeTabId);
			return next;
		});
	}, [activeTabId]);

	// Wait for tmux check before rendering terminals to avoid wrong spawn args
	if (!workspace || !isLoaded || tmuxAvailable === null) return null;

	return (
		<div className="flex flex-col h-full min-h-0">
			{/* tmux missing banner */}
			{tmuxAvailable === false && !tmuxBannerDismissed && (
				<div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border-b border-yellow-500/20 text-sm text-yellow-600 dark:text-yellow-400 shrink-0">
					<AlertCircle className="size-4 shrink-0" />
					<span className="flex-1">
						Install <code className="font-mono">tmux</code> to enable session persistence across
						app restarts.
					</span>
					<button
						type="button"
						className="shrink-0 hover:opacity-70"
						onClick={() => setTmuxBannerDismissed(true)}
					>
						<X className="size-4" />
					</button>
				</div>
			)}

			{/* Tab bar */}
			<div className="flex items-center gap-1 px-2 pt-1 border-b border-border shrink-0 overflow-x-auto">
				{tabs.map((tab) => (
					<TabButton
						key={tab.id}
						tab={tab}
						isActive={tab.id === activeTabId}
						onActivate={() => setActiveTab(tab.id)}
						onClose={() => handleCloseTab(tab.id)}
						onRename={(title) => updateTabTitle(workspace.id, tab.id, title)}
					/>
				))}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-7 shrink-0"
					onClick={handleAddTab}
					aria-label="New session"
				>
					<Plus className="size-4" />
				</Button>
			</div>

			{/* Terminals — lazily mounted on first activation, then kept alive but hidden */}
			<div className="flex-1 min-h-0 relative">
				{tabs.map((tab) => (
					<div
						key={tab.id}
						className="absolute inset-0"
						style={{ display: tab.id === activeTabId ? "block" : "none" }}
					>
						{mountedTabIds.has(tab.id) && (
							<Terminal
								id={tab.id}
								{...getSpawnArgs(tab)}
								cwd={tab.cwd}
								isActive={tab.id === activeTabId}
							/>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// TabButton — with double-click inline renaming
// ---------------------------------------------------------------------------

interface TabButtonProps {
	tab: PersistedTab;
	isActive: boolean;
	onActivate: () => void;
	onClose: () => void;
	onRename: (title: string) => void;
}

function TabButton({ tab, isActive, onActivate, onClose, onRename }: TabButtonProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(tab.title);
	const inputRef = useRef<HTMLInputElement>(null);

	const startEditing = useCallback(() => {
		setDraft(tab.title);
		setEditing(true);
	}, [tab.title]);

	// Focus input when editing starts
	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	const commitRename = useCallback(() => {
		const trimmed = draft.trim();
		if (trimmed && trimmed !== tab.title) {
			onRename(trimmed);
		}
		setEditing(false);
	}, [draft, tab.title, onRename]);

	const cancelEditing = useCallback(() => {
		setDraft(tab.title);
		setEditing(false);
	}, [tab.title]);

	return (
		<div
			className={`group flex items-center rounded-t text-sm shrink-0 ${
				isActive
					? "bg-background border border-b-background border-border -mb-px"
					: "text-muted-foreground"
			}`}
		>
			{editing ? (
				<input
					ref={inputRef}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commitRename}
					onKeyDown={(e) => {
						if (e.key === "Enter") commitRename();
						if (e.key === "Escape") cancelEditing();
					}}
					className="px-3 py-1.5 w-32 bg-transparent text-sm outline-none border-none focus:ring-0"
					aria-label="Rename tab"
				/>
			) : (
				<button
					type="button"
					className="px-3 py-1.5 max-w-32 truncate cursor-pointer hover:text-foreground"
					onClick={onActivate}
					onDoubleClick={startEditing}
				>
					{tab.title}
				</button>
			)}
			<button
				type="button"
				className="opacity-0 group-hover:opacity-100 mr-1 rounded hover:bg-muted p-0.5"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				aria-label={`Close ${tab.title}`}
			>
				<X className="size-3" />
			</button>
		</div>
	);
}
