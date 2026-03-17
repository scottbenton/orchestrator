import type { AIBackend } from "@/types/config";

export interface AIAgentDefinition {
	/** Matches the `ai_backend` value in settings.toml */
	id: AIBackend;

	/** Human-readable name shown in the UI */
	name: string;

	/** The binary to invoke (must be on PATH) */
	command: string;

	/** Arguments passed before any user-provided args */
	args: string[];

	/** One-line description for UI tooltips / settings page */
	description: string;

	/**
	 * Flag to pass a session ID to resume a previous conversation.
	 * e.g., "--resume" for claude. undefined = no resume support.
	 */
	resumeFlag?: string;
}
