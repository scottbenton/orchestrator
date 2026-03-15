import { useQuery } from "@tanstack/react-query";
import { getActiveWorkspacePath } from "@/services/workspaceListService";

export const activeWorkspaceQueryKey = ["activeWorkspace"] as const;

export function useActiveWorkspace() {
	return useQuery({
		queryKey: activeWorkspaceQueryKey,
		queryFn: getActiveWorkspacePath,
	});
}
