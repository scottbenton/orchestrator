import type { AIBackend } from "@/types/config";

export interface AIAgentDefinition {
	/** Matches the `ai_backend` value in settings.toml */
	id: AIBackend;

	/** Human-readable name shown in the UI */
	name: string;

	/**
	 * The ACP adapter command to invoke.
	 * Use 'node' for npm-based adapters; acpService resolves __ACP_SCRIPT_PATH__ automatically.
	 * Future standalone binaries can specify their own command directly.
	 */
	acpCommand: string;

	/** Additional arguments passed to the ACP adapter (after any script path resolution) */
	acpArgs: string[];

	/** One-line description for UI tooltips / settings page */
	description: string;
}
