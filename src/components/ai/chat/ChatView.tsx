import { useEffect, useRef } from "react";
import type { ConversationMessage } from "@/hooks/useAcpSession";
import { AssistantMessage } from "./AssistantMessage";
import { PlanCard } from "./PlanCard";
import { ToolCallCard } from "./ToolCallCard";
import { UserMessage } from "./UserMessage";

interface ChatViewProps {
	messages: ConversationMessage[];
}

export function ChatView({ messages }: ChatViewProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom as messages arrive
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	return (
		<div className="flex-1 min-h-0 overflow-y-auto py-4">
			{messages.length === 0 && (
				<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
					Start a conversation
				</div>
			)}

			{messages.map((msg, i) => {
				switch (msg.type) {
					case "user":
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
				}
			})}

			<div ref={bottomRef} />
		</div>
	);
}
