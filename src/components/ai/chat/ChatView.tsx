import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ConversationMessage } from "@/hooks/useAcpSession";
import { AssistantMessage } from "./AssistantMessage";
import { PermissionRequestCard } from "./PermissionRequestCard";
import { PlanCard } from "./PlanCard";
import { ToolCallCard } from "./ToolCallCard";
import { UserMessage } from "./UserMessage";

interface ChatViewProps {
	messages: ConversationMessage[];
	isRunning: boolean;
	resolvePermission: (requestId: string, optionId: string) => void;
}

export function ChatView({ messages, isRunning, resolvePermission }: ChatViewProps) {
	const bottomRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: deps are needed to trigger scroll on new messages and state changes
	useEffect(() => {
		if (!scrollContainerRef.current || !bottomRef.current) return;

		const container = scrollContainerRef.current;
		const isNearBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight < 100;

		// Only auto-scroll if user is already near the bottom
		if (isNearBottom) {
			bottomRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [messages, isRunning]);

	const lastMessage = messages[messages.length - 1];
	const showThinking =
		isRunning &&
		!(lastMessage?.type === "assistant" && lastMessage.streaming) &&
		!(lastMessage?.type === "permission_request" && !lastMessage.resolved);

	return (
		<div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto py-4">
			{messages.length === 0 && !isRunning && (
				<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
					Start a conversation
				</div>
			)}

			{messages.map((msg, i) => {
				switch (msg.type) {
					case "user":
						// biome-ignore lint/suspicious/noArrayIndexKey: user messages have no stable id
						return <UserMessage key={i} text={msg.text} />;

					case "assistant":
						return <AssistantMessage key={msg.id} chunks={msg.chunks} streaming={msg.streaming} />;

					case "tool_call":
						return (
							<ToolCallCard
								key={msg.id}
								title={msg.title}
								status={msg.status}
								output={msg.output}
							/>
						);

					case "plan":
						return <PlanCard key={msg.id} entries={msg.entries} />;

					case "permission_request":
						return (
							<PermissionRequestCard
								key={msg.id}
								toolTitle={msg.toolTitle}
								options={msg.options}
								resolved={msg.resolved}
								selectedOptionId={msg.selectedOptionId}
								onResolve={(optionId) => resolvePermission(msg.id, optionId)}
							/>
						);
					default:
						return null;
				}
			})}

			{showThinking && (
				<div className="flex items-center gap-2 mx-4 my-1 px-3 py-2 text-xs text-muted-foreground">
					<Loader2 className="size-3.5 shrink-0 animate-spin" />
					<span>Thinking…</span>
				</div>
			)}

			<div ref={bottomRef} />
		</div>
	);
}
