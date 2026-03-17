import { useEffect, useState } from "react";
import { TabBar } from "@/components/ai/TabBar";
import { TmuxBanner } from "@/components/ai/TmuxBanner";
import { Terminal } from "@/components/Terminal";
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

	// Use `tmux new-session -A` — attach to existing session if present, create
	// a new one with the agent command if not. This is atomic: no pre-creation
	// step, no race between session creation and attachment.
	function getSpawnArgs(tab: PersistedTab): { program: string; args: string[] } {
		if (!tmuxAvailable) {
			return { program: agent.command, args: agent.args };
		}
		const name = sessionName(workspace?.id ?? "", tab.id);
		return {
			program: "tmux",
			args: ["new-session", "-A", "-s", name, "-c", tab.cwd, "--", agent.command, ...agent.args],
		};
	}

	// Tracks which tabs have ever been shown. Updated synchronously in event
	// handlers so Terminal mounts in the same React commit as tab activation —
	// no extra paint cycle with an empty container.
	const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(new Set());

	function mountTab(tabId: string) {
		setMountedTabIds((prev) => {
			if (prev.has(tabId)) return prev;
			const next = new Set(prev);
			next.add(tabId);
			return next;
		});
	}

	// Mount the initially-active tab once tabs finish loading
	useEffect(() => {
		if (isLoaded && activeTabId) mountTab(activeTabId);
	}, [isLoaded, activeTabId]);

	function handleActivateTab(tabId: string) {
		setActiveTab(tabId);
		mountTab(tabId);
	}

	function handleAddTab() {
		if (!workspace) return;
		const tab = addTab(workspace.id, workspace.path);
		// Mount synchronously — Terminal will use new-session -A to create+attach
		mountTab(tab.id);
	}

	async function handleCloseTab(tabId: string) {
		if (!workspace) return;
		await ptyKill(tabId);
		if (tmuxAvailable) {
			const name = sessionName(workspace.id, tabId);
			runCommand("tmux", ["kill-session", "-t", name]).catch(() => {});
		}
		closeTab(workspace.id, tabId);
		setMountedTabIds((prev) => {
			const next = new Set(prev);
			next.delete(tabId);
			return next;
		});
	}

	// Wait for tmux check before rendering terminals to avoid wrong spawn args
	if (!workspace || !isLoaded || tmuxAvailable === null) return null;

	return (
		<div className="flex flex-col h-full min-h-0">
			{tmuxAvailable === false && <TmuxBanner />}

			<TabBar
				tabs={tabs}
				activeTabId={activeTabId}
				onActivate={handleActivateTab}
				onClose={handleCloseTab}
				onRename={(tabId, title) => updateTabTitle(workspace.id, tabId, title)}
				onAdd={handleAddTab}
			/>

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
