import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PersistedTab } from "@/store/tabsStore";
import { TabButton } from "./TabButton";

interface TabBarProps {
	tabs: PersistedTab[];
	activeTabId: string | null;
	onActivate: (tabId: string) => void;
	onClose: (tabId: string) => void;
	onRename: (tabId: string, title: string) => void;
	onAdd: () => void;
}

export function TabBar({ tabs, activeTabId, onActivate, onClose, onRename, onAdd }: TabBarProps) {
	return (
		<div className="flex items-center gap-1 px-2 pt-1 border-b border-border shrink-0 overflow-x-auto">
			{tabs.map((tab) => (
				<TabButton
					key={tab.id}
					tab={tab}
					isActive={tab.id === activeTabId}
					onActivate={() => onActivate(tab.id)}
					onClose={() => onClose(tab.id)}
					onRename={(title) => onRename(tab.id, title)}
				/>
			))}
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-7 shrink-0"
				onClick={onAdd}
				aria-label="New session"
			>
				<Plus className="size-4" />
			</Button>
		</div>
	);
}
