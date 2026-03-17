import { CheckCircle2, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PermissionOption } from "@/types/acp";

interface PermissionRequestCardProps {
	toolTitle: string;
	options: PermissionOption[];
	resolved: boolean;
	selectedOptionId?: string;
	onResolve: (optionId: string) => void;
}

const KIND_STYLES: Record<PermissionOption["kind"], string> = {
	allow_once: "text-green-600 border-green-600/40 hover:bg-green-500/10 dark:text-green-400",
	allow_always: "text-green-600 border-green-600/40 hover:bg-green-500/10 dark:text-green-400",
	reject_once: "text-destructive border-destructive/40 hover:bg-destructive/10",
	reject_always: "text-destructive border-destructive/40 hover:bg-destructive/10",
};

export function PermissionRequestCard({
	toolTitle,
	options,
	resolved,
	selectedOptionId,
	onResolve,
}: PermissionRequestCardProps) {
	const selectedOption = options.find((o) => o.optionId === selectedOptionId);

	return (
		<div className="mx-4 my-1 rounded-lg border border-border overflow-hidden">
			<div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
				{resolved ? (
					<CheckCircle2 className="size-3.5 shrink-0 text-green-500" />
				) : (
					<ShieldQuestion className="size-3.5 shrink-0 text-amber-500" />
				)}
				<span className="text-xs font-medium text-foreground">
					{resolved ? "Permission granted" : "Permission required"}
				</span>
				<span className="text-xs text-muted-foreground font-mono truncate">{toolTitle}</span>
			</div>

			{resolved ? (
				<div className="px-3 py-2 text-xs text-muted-foreground">
					{selectedOption?.name ?? selectedOptionId}
				</div>
			) : (
				<div className="flex flex-wrap gap-1.5 px-3 py-2">
					{options.map((option) => (
						<Button
							key={option.optionId}
							type="button"
							variant="outline"
							size="sm"
							className={cn("h-7 text-xs", KIND_STYLES[option.kind])}
							onClick={() => onResolve(option.optionId)}
						>
							{option.name}
						</Button>
					))}
				</div>
			)}
		</div>
	);
}
