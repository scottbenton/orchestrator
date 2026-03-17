export type ClaudeModel = "claude-sonnet-4-6" | "claude-opus-4-6" | "claude-haiku-4-5-20251001";

export const CLAUDE_MODELS: { value: ClaudeModel; label: string }[] = [
	{ value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
	{ value: "claude-opus-4-6", label: "Opus 4.6" },
	{ value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
	{ value: "default", label: "Default" },
	{ value: "acceptEdits", label: "Accept Edits" },
	{ value: "plan", label: "Plan Mode" },
	{ value: "bypassPermissions", label: "Bypass Permissions" },
];

