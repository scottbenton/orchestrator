import { useNavigate, useParams } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaces } from "@/hooks/api/useWorkspaces";
import { setActiveWorkspacePath } from "@/services/workspaceListService";

const NEW_WORKSPACE_SENTINEL = "__new_workspace__";

interface WorkspaceDropdownProps {
	collapsed: boolean;
}

export function WorkspaceDropdown({ collapsed }: WorkspaceDropdownProps) {
	const navigate = useNavigate();
	const { data: workspaces = [] } = useWorkspaces();
	const { workspaceId } = useParams({ from: "/$workspaceId" });

	const activeWorkspace = workspaces.find((w) => w.id === workspaceId);

	async function handleValueChange(value: string) {
		if (value === NEW_WORKSPACE_SENTINEL) {
			navigate({ to: "/create-workspace" });
			return;
		}
		const workspace = workspaces.find((w) => w.id === value);
		if (!workspace) return;
		// Remember the last active workspace for the next app launch
		await setActiveWorkspacePath(workspace.path);
		navigate({ to: "/$workspaceId/tasks", params: { workspaceId: value } });
	}

	if (collapsed) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div className="flex items-center justify-center px-2 py-1.5">
						<FolderOpen className="size-4 text-muted-foreground" />
					</div>
				</TooltipTrigger>
				<TooltipContent side="right">{activeWorkspace?.name ?? "No workspace"}</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<div className="px-2">
			<Select value={workspaceId} onValueChange={handleValueChange}>
				<SelectTrigger className="w-full" size="sm" aria-label="Active workspace">
					<SelectValue placeholder="Select workspace" />
				</SelectTrigger>
				<SelectContent>
					{workspaces.length > 0 && (
						<SelectGroup>
							{workspaces.map((w) => (
								<SelectItem key={w.id} value={w.id}>
									{w.name}
								</SelectItem>
							))}
						</SelectGroup>
					)}
					{workspaces.length > 0 && <SelectSeparator />}
					<SelectGroup>
						<SelectItem value={NEW_WORKSPACE_SENTINEL}>New workspace…</SelectItem>
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	);
}
