import { useQuery } from "@tanstack/react-query";
import { getWorkspaces } from "@/services/workspaceListService";

export const workspacesQueryKey = ["workspaces"] as const;

export function useWorkspaces() {
	return useQuery({
		queryKey: workspacesQueryKey,
		queryFn: getWorkspaces,
	});
}
