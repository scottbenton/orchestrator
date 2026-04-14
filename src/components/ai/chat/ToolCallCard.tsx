import { CheckCircle2, ChevronRight, Clock, Loader2, Terminal } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolCallStatus } from "@/types/acp";

interface ToolCallCardProps {
	title: string;
	status: ToolCallStatus;
	output?: string;
}

export function ToolCallCard({ title, status, output }: ToolCallCardProps) {
	const [expanded, setExpanded] = useState(false);

	const StatusIcon =
		status === "completed" ? CheckCircle2 : status === "in_progress" ? Loader2 : Clock;

	const statusColor =
		status === "completed"
			? "text-green-500"
			: status === "in_progress"
				? "text-blue-500"
				: "text-muted-foreground";

	return (
		<div className="mx-4 my-1 rounded-lg border border-border overflow-hidden">
			<button
				type="button"
				className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
				onClick={() => output && setExpanded((v) => !v)}
			>
				<StatusIcon
					className={cn(
						"size-3.5 shrink-0",
						statusColor,
						status === "in_progress" && "animate-spin"
					)}
				/>
				<Terminal className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="flex-1 font-mono text-xs truncate text-foreground">{title}</span>
				{output && (
					<ChevronRight
						className={cn(
							"size-3.5 shrink-0 text-muted-foreground transition-transform",
							expanded && "rotate-90"
						)}
					/>
				)}
			</button>

			{expanded && output && (
				<div className="border-t border-border bg-muted/30 px-3 py-2 max-h-48 overflow-y-auto">
					<pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/80">
						{output}
					</pre>
				</div>
			)}
		</div>
	);
}
