import { Send, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
	isRunning: boolean;
	onSend: (prompt: string) => void;
	onStop: () => void;
}

export function ChatInput({ isRunning, onSend, onStop }: ChatInputProps) {
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
		// Reset textarea height
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}
	}

	function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setValue(e.target.value);
		// Auto-grow textarea
		const el = e.target;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	}

	return (
		<div className="border-t border-border px-3 py-2 shrink-0">
			<div
				className={cn(
					"flex items-end gap-2 rounded-xl border border-input bg-background px-3 py-2 transition-colors focus-within:border-ring"
				)}
			>
				<textarea
					ref={textareaRef}
					value={value}
					onChange={handleInput}
					onKeyDown={handleKeyDown}
					placeholder="Message Claude…"
					rows={1}
					disabled={false}
					className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground min-h-[24px]"
				/>
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
			<p className="text-xs text-muted-foreground mt-1 px-1">
				Enter to send · Shift+Enter for new line
			</p>
		</div>
	);
}
