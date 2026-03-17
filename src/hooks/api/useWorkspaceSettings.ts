import { useQuery } from "@tanstack/react-query";
import { getResolvedConfig } from "@/services/configService";
import type { WorkspaceListEntry } from "@/types/config";

export function workspaceSettingsQueryKey(workspacePath: string) {
	return ["workspaceSettings", workspacePath] as const;
}

export function useWorkspaceSettings(workspace: WorkspaceListEntry | undefined) {
	return useQuery({
		queryKey: workspaceSettingsQueryKey(workspace?.path ?? ""),
		queryFn: () => getResolvedConfig(workspace?.path ?? ""),
		enabled: !!workspace,
	});
}
