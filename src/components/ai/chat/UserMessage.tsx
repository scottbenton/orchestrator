interface UserMessageProps {
	text: string;
}

export function UserMessage({ text }: UserMessageProps) {
	return (
		<div className="flex justify-end px-4 py-1">
			<div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
				{text}
			</div>
		</div>
	);
}
