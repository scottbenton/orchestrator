import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getTaskLogs } from "@/services/logStreamService";
import { useLogsStore } from "@/store/logsStore";
import type { LogLine } from "@/types/logs";
import { Button } from "./ui/button";

interface LogViewerProps {
	taskId: string;
	live?: boolean;
}

export function LogViewer({ taskId, live = false }: LogViewerProps) {
	const lines = useLogsStore((s) => s.logs[taskId] ?? []);
	const setLogs = useLogsStore((s) => s.setLogs);

	const bottomRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [autoScroll, setAutoScroll] = useState(true);

	useEffect(() => {
		getTaskLogs(taskId).then((loaded) => setLogs(taskId, loaded));
	}, [taskId, setLogs]);

	useEffect(() => {
		if (autoScroll) {
			bottomRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [lines, autoScroll]);

	const handleScroll = () => {
		const el = containerRef.current;
		if (!el) return;
		const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
		setAutoScroll(atBottom);
	};

	const handleCopyAll = () => {
		navigator.clipboard.writeText(lines.map((l) => l.line).join("\n"));
	};

	return (
		<div className="flex flex-col h-full min-h-0">
			<div className="flex items-center justify-between px-3 py-1 border-b border-border shrink-0">
				{live && (
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
						Live
					</span>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto h-6 text-xs"
					onClick={handleCopyAll}
				>
					Copy all
				</Button>
			</div>
			<div
				ref={containerRef}
				onScroll={handleScroll}
				className="flex-1 overflow-y-auto p-3 font-mono text-sm min-h-0"
			>
				{lines.length === 0 && (
					<p className="text-muted-foreground italic text-xs">No output yet.</p>
				)}
				{lines.map((line) => (
					<LogLineRow key={line.id} line={line} />
				))}
				<div ref={bottomRef} />
			</div>
		</div>
	);
}

function LogLineRow({ line }: { line: LogLine }) {
	return (
		<div
			className={cn("whitespace-pre-wrap break-all leading-5", {
				"text-red-400": line.stream === "stderr",
				"text-muted-foreground italic": line.stream === "system",
			})}
		>
			{line.line}
		</div>
	);
}
