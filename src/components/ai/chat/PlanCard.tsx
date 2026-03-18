import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanEntry } from "@/types/acp";

interface PlanCardProps {
	entries: PlanEntry[];
}

export function PlanCard({ entries }: PlanCardProps) {
	return (
		<div className="mx-4 my-1 rounded-lg border border-border overflow-hidden">
			<div className="px-3 py-2 border-b border-border bg-muted/30">
				<span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
					Plan
				</span>
			</div>
			<ul className="divide-y divide-border">
				{entries.map((entry, i) => {
					const StatusIcon =
						entry.status === "completed"
							? CheckCircle2
							: entry.status === "in_progress"
								? Loader2
								: Circle;

					const color =
						entry.status === "completed"
							? "text-green-500"
							: entry.status === "in_progress"
								? "text-blue-500"
								: "text-muted-foreground";

					return (
						<li key={`${entry.title}-${i}`} className="flex items-start gap-2.5 px-3 py-2">
							<StatusIcon
								className={cn(
									"size-3.5 mt-0.5 shrink-0",
									color,
									entry.status === "in_progress" && "animate-spin"
								)}
							/>
							<span
								className={cn(
									"text-sm",
									entry.status === "completed" && "text-muted-foreground line-through"
								)}
							>
								{entry.title}
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
