import { useEffect, useRef, useState } from "react";
import { ChatInput } from "@/components/ai/chat/ChatInput";
import { ChatView } from "@/components/ai/chat/ChatView";
import { TabBar } from "@/components/ai/TabBar";
import { useWorkspace } from "@/hooks/api/useWorkspace";
import { useWorkspaceSettings } from "@/hooks/api/useWorkspaceSettings";
import { useAcpSession } from "@/hooks/useAcpSession";
import { getAgentDefinition } from "@/lib/agents";
import { type PersistedTab, useTabsStore } from "@/store/tabsStore";

// ---------------------------------------------------------------------------
// Single-tab ACP chat panel
// ---------------------------------------------------------------------------

interface AcpTabProps {
	tab: PersistedTab;
	isActive: boolean;
	workspaceId: string;
	acpCommand: string;
	acpArgs: string[];
	onSessionIdCreated: (tabId: string, sessionId: string) => void;
}

function AcpTab({
	tab,
	isActive,
	workspaceId,
	acpCommand,
	acpArgs,
	onSessionIdCreated,
}: AcpTabProps) {
	const [model, setModel] = useState<string | undefined>(undefined);
	const [permissionMode, setPermissionMode] = useState<string | undefined>(undefined);
	const modelInitialized = useRef(false);
	const modeInitialized = useRef(false);

	const {
		messages,
		isRunning,
		send,
		stop,
		resolvePermission,
		currentModelId,
		currentModeId,
		availableModels,
		availableModes,
	} = useAcpSession({
		existingSessionId: tab.acpSessionId,
		cwd: tab.cwd,
		acpCommand,
		acpArgs,
		workspaceId,
		tabId: tab.id,
		onSessionIdCreated: (sessionId) => onSessionIdCreated(tab.id, sessionId),
		model,
		permissionMode,
	});

	// Initialize model and mode from ACP session on first load
	useEffect(() => {
		if (currentModelId && !modelInitialized.current) {
			modelInitialized.current = true;
			setModel(currentModelId);
		}
	}, [currentModelId]);

	useEffect(() => {
		if (currentModeId && !modeInitialized.current) {
			modeInitialized.current = true;
			setPermissionMode(currentModeId);
		}
	}, [currentModeId]);

	return (
		<div
			className="absolute inset-0 flex flex-col min-h-0"
			style={{ display: isActive ? "flex" : "none" }}
		>
			<ChatView messages={messages} isRunning={isRunning} resolvePermission={resolvePermission} />
			<ChatInput
				isRunning={isRunning}
				onSend={send}
				onStop={stop}
				model={model}
				onModelChange={setModel}
				availableModels={availableModels}
				permissionMode={permissionMode}
				onPermissionModeChange={setPermissionMode}
				availableModes={availableModes}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// AiPage
// ---------------------------------------------------------------------------

export function AiPage() {
	const workspace = useWorkspace();
	const { data: settings } = useWorkspaceSettings(workspace);

	const {
		tabs,
		activeTabId,
		isLoaded,
		loadTabs,
		addTab,
		closeTab,
		setActiveTab,
		updateTabTitle,
		updateTabSessionId,
	} = useTabsStore();

	// Load tabs on workspace change
	useEffect(() => {
		if (!workspace) return;
		loadTabs(workspace.id, workspace.path);
	}, [workspace?.id, workspace?.path, workspace, loadTabs]);

	const agent = settings
		? getAgentDefinition(settings.ai_backend)
		: getAgentDefinition("claude-code");

	function handleAddTab() {
		if (!workspace) return;
		addTab(workspace.id, workspace.path);
	}

	function handleCloseTab(tabId: string) {
		if (!workspace) return;
		closeTab(workspace.id, tabId);
	}

	function handleSessionIdCreated(tabId: string, sessionId: string) {
		if (!workspace) return;
		updateTabSessionId(workspace.id, tabId, sessionId);
	}

	if (!workspace || !isLoaded) return null;

	return (
		<div className="flex flex-col h-full min-h-0">
			<TabBar
				tabs={tabs}
				activeTabId={activeTabId}
				onActivate={setActiveTab}
				onClose={handleCloseTab}
				onRename={(tabId, title) => updateTabTitle(workspace.id, tabId, title)}
				onAdd={handleAddTab}
			/>

			{/* Chat panels — all mounted to preserve React state, hidden when inactive */}
			<div className="flex-1 min-h-0 relative">
				{tabs.map((tab) => (
					<AcpTab
						key={tab.id}
						tab={tab}
						isActive={tab.id === activeTabId}
						workspaceId={workspace.id}
						acpCommand={agent.acpCommand}
						acpArgs={agent.acpArgs}
						onSessionIdCreated={handleSessionIdCreated}
					/>
				))}
			</div>
		</div>
	);
}
