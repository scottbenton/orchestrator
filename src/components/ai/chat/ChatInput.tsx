import { Send, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { AgentModeInfo, AgentModelInfo } from "@/hooks/useAcpSession";
import { cn } from "@/lib/utils";

interface ChatInputProps {
	isRunning: boolean;
	onSend: (prompt: string) => void;
	onStop: () => void;
	model: string | undefined;
	onModelChange: (model: string) => void;
	availableModels: AgentModelInfo[];
	permissionMode: string | undefined;
	onPermissionModeChange: (mode: string) => void;
	availableModes: AgentModeInfo[];
}

export function ChatInput({
	isRunning,
	onSend,
	onStop,
	model,
	onModelChange,
	availableModels,
	permissionMode,
	onPermissionModeChange,
	availableModes,
}: ChatInputProps) {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function submit() {
		const trimmed = value.trim();
		if (!trimmed || isRunning) return;
		onSend(trimmed);
		setValue("");
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}
	}

	function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setValue(e.target.value);
		const el = e.target;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	}

	return (
		<div className="border-t border-border px-3 py-2 shrink-0">
			<div
				className={cn(
					"rounded-xl border border-input bg-background px-3 py-2 transition-colors focus-within:border-ring"
				)}
			>
				<textarea
					ref={textareaRef}
					value={value}
					onChange={handleInput}
					onKeyDown={handleKeyDown}
					placeholder="Message Claude…"
					rows={1}
					className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground min-h-[24px]"
				/>
				<div className="flex items-center justify-end gap-1.5 pt-1">
					{availableModels.length > 0 && (
						<Select value={model} onValueChange={onModelChange}>
							<SelectTrigger size="sm" className="h-7 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								{availableModels.map((m) => (
									<SelectItem key={m.modelId} value={m.modelId}>
										{m.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{availableModes.length > 0 && (
						<Select value={permissionMode} onValueChange={onPermissionModeChange}>
							<SelectTrigger size="sm" className="h-7 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								{availableModes.map((m) => (
									<SelectItem key={m.id} value={m.id}>
										{m.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{isRunning ? (
						<Button
							type="button"
							size="icon"
							variant="ghost"
							className="size-7 shrink-0 text-destructive hover:text-destructive"
							onClick={onStop}
							aria-label="Stop"
						>
							<Square className="size-4 fill-current" />
						</Button>
					) : (
						<Button
							type="button"
							size="icon"
							variant="ghost"
							className="size-7 shrink-0"
							onClick={submit}
							disabled={!value.trim()}
							aria-label="Send"
						>
							<Send className="size-4" />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
