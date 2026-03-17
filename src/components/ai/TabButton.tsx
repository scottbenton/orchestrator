import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PersistedTab } from "@/store/tabsStore";

interface TabButtonProps {
	tab: PersistedTab;
	isActive: boolean;
	onActivate: () => void;
	onClose: () => void;
	onRename: (title: string) => void;
}

export function TabButton({ tab, isActive, onActivate, onClose, onRename }: TabButtonProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(tab.title);
	const inputRef = useRef<HTMLInputElement>(null);

	const startEditing = useCallback(() => {
		setDraft(tab.title);
		setEditing(true);
	}, [tab.title]);

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
