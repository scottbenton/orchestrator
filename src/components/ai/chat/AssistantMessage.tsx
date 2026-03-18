import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface AssistantMessageProps {
	chunks: string[];
	streaming: boolean;
}

export function AssistantMessage({ chunks, streaming }: AssistantMessageProps) {
	const content = chunks.join("");

	return (
		<div className="px-4 py-1">
			<div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
				<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
					{content}
				</ReactMarkdown>
				{streaming && (
					<span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse rounded-sm ml-0.5 align-text-bottom" />
				)}
			</div>
		</div>
	);
}
