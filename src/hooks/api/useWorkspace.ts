import { useParams } from "@tanstack/react-router";
import type { WorkspaceListEntry } from "@/types/config";
import { useWorkspaces } from "./useWorkspaces";

/**
 * Returns the WorkspaceListEntry for the workspace currently in the URL,
 * or undefined while the workspace list is still loading.
 */
export function useWorkspace(): WorkspaceListEntry | undefined {
	const { workspaceId } = useParams({ from: "/$workspaceId" });
	const { data: workspaces } = useWorkspaces();
	return workspaces?.find((w) => w.id === workspaceId);
}
