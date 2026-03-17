import type { AIAgentDefinition } from "@/types/agents";
import type { AIBackend } from "@/types/config";

export const AGENT_DEFINITIONS: Record<AIBackend, AIAgentDefinition> = {
	"claude-code": {
		id: "claude-code",
		name: "Claude Code",
		command: "claude",
		args: [],
		description: "Anthropic's Claude Code CLI agent",
		resumeFlag: "--resume",
	},
	codex: {
		id: "codex",
		name: "Codex",
		command: "codex",
		args: [],
		description: "OpenAI Codex CLI agent",
	},
	ollama: {
		id: "ollama",
		name: "Ollama",
		command: "ollama",
		args: [],
		description: "Local Ollama model",
	},
};

export function getAgentDefinition(backend: AIBackend): AIAgentDefinition {
	return AGENT_DEFINITIONS[backend];
}
