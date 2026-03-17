import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistedTab {
	id: string;
	title: string;
	cwd: string;
	createdAt: string;
}

interface TabsState {
	tabs: PersistedTab[];
	activeTabId: string | null;
	isLoaded: boolean;

	loadTabs: (workspaceId: string, defaultCwd: string) => Promise<void>;
	addTab: (workspaceId: string, cwd: string) => PersistedTab;
	closeTab: (workspaceId: string, tabId: string) => void;
	setActiveTab: (id: string) => void;
	updateTabTitle: (workspaceId: string, tabId: string, title: string) => void;
}

// ---------------------------------------------------------------------------
// Store key helpers
// ---------------------------------------------------------------------------

function storeKey(workspaceId: string) {
	return `tabs_${workspaceId}`;
}

function getStore(workspaceId: string) {
	return new LazyStore(`${storeKey(workspaceId)}.json`, {
		defaults: { tabs: [] as PersistedTab[] },
		autoSave: true,
	});
}

async function persist(workspaceId: string, tabs: PersistedTab[]) {
	try {
		const store = getStore(workspaceId);
		await store.set("tabs", tabs);
	} catch {
		// ignore
	}
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

export const useTabsStore = create<TabsState>((set, get) => ({
	tabs: [],
	activeTabId: null,
	isLoaded: false,

	loadTabs: async (workspaceId, defaultCwd) => {
		set({ isLoaded: false, tabs: [], activeTabId: null });
		try {
			const store = getStore(workspaceId);
			const raw = await store.get<PersistedTab[]>("tabs");
			if (Array.isArray(raw) && raw.length > 0) {
				set({ tabs: raw, activeTabId: raw[0].id, isLoaded: true });
				return;
			}
		} catch {
			// fall through to default
		}
		const initial = makeTab(1, defaultCwd);
		set({ tabs: [initial], activeTabId: initial.id, isLoaded: true });
		await persist(workspaceId, [initial]);
	},

	addTab: (workspaceId, cwd) => {
		const { tabs } = get();
		const tab = makeTab(tabs.length + 1, cwd);
		const next = [...tabs, tab];
		set({ tabs: next, activeTabId: tab.id });
		persist(workspaceId, next);
		return tab;
	},

	closeTab: (workspaceId, tabId) => {
		const { tabs, activeTabId } = get();
		if (tabs.length === 1) {
			// Replace with a fresh tab rather than leaving empty
			const fresh = makeTab(1, tabs[0].cwd);
			set({ tabs: [fresh], activeTabId: fresh.id });
			persist(workspaceId, [fresh]);
			return;
		}
		const next = tabs.filter((t) => t.id !== tabId);
		const newActive =
			activeTabId === tabId ? (next[next.length - 1]?.id ?? null) : activeTabId;
		set({ tabs: next, activeTabId: newActive });
		persist(workspaceId, next);
	},

	setActiveTab: (id) => {
		set({ activeTabId: id });
	},

	updateTabTitle: (workspaceId, tabId, title) => {
		const { tabs } = get();
		const next = tabs.map((t) => (t.id === tabId ? { ...t, title } : t));
		set({ tabs: next });
		persist(workspaceId, next);
	},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTab(n: number, cwd: string): PersistedTab {
	return {
		id: crypto.randomUUID(),
		title: `Claude ${n}`,
		cwd,
		createdAt: new Date().toISOString(),
	};
}
