import { LazyStore } from "@tauri-apps/plugin-store";

const TOKEN_KEY = "github_token";

const store = new LazyStore("github-auth.json", { defaults: {}, autoSave: true });

export async function getGitHubToken(): Promise<string | null> {
	try {
		const value = await store.get<string>(TOKEN_KEY);
		return typeof value === "string" ? value : null;
	} catch {
		throw new Error("Failed to read GitHub token from store");
	}
}

export async function setGitHubToken(token: string): Promise<void> {
	try {
		await store.set(TOKEN_KEY, token);
	} catch {
		throw new Error("Failed to save GitHub token to store");
	}
}

export async function hasGitHubToken(): Promise<boolean> {
	try {
		const value = await store.get<string>(TOKEN_KEY);
		return typeof value === "string" && value.length > 0;
	} catch {
		throw new Error("Failed to check GitHub token in store");
	}
}
