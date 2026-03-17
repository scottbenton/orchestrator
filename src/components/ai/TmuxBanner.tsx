import { X, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function TmuxBanner() {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) return null;

	return (
		<Alert variant="warning" className="rounded-none border-x-0 border-t-0 shrink-0">
			<AlertTriangle className="size-4" />
			<AlertDescription className="flex items-center justify-between">
				<span>
					Install <code className="font-mono">tmux</code> to enable session persistence across app
					restarts.
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-6 shrink-0 -mr-1"
					onClick={() => setDismissed(true)}
					aria-label="Dismiss"
				>
					<X className="size-3.5" />
				</Button>
			</AlertDescription>
		</Alert>
	);
}
