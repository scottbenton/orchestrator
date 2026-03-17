import type { AIAgentDefinition } from "@/types/agents";
import type { AIBackend } from "@/types/config";

export const AGENT_DEFINITIONS: Partial<Record<AIBackend, AIAgentDefinition>> = {
	"claude-code": {
		id: "claude-code",
		name: "Claude Code",
		command: "claude",
		args: [],
		description: "Anthropic's Claude Code CLI agent",
		resumeFlag: "--resume",
	},
};

const DEFAULT_AGENT = AGENT_DEFINITIONS["claude-code"] as AIAgentDefinition;

export function getAgentDefinition(backend: AIBackend): AIAgentDefinition {
	return AGENT_DEFINITIONS[backend] ?? DEFAULT_AGENT;
}
