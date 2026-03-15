import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";
import { activeWorkspaceQueryKey, useActiveWorkspace } from "@/hooks/api/useActiveWorkspace";
import { useWorkspaces } from "@/hooks/api/useWorkspaces";
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
import { setActiveWorkspacePath } from "@/services/workspaceListService";

const NEW_WORKSPACE_SENTINEL = "__new_workspace__";

interface WorkspaceDropdownProps {
	collapsed: boolean;
}

export function WorkspaceDropdown({ collapsed }: WorkspaceDropdownProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: workspaces = [] } = useWorkspaces();
	const { data: activePath } = useActiveWorkspace();

	const activeWorkspace = workspaces.find((w) => w.path === activePath) ?? workspaces[0];

	async function handleValueChange(value: string) {
		if (value === NEW_WORKSPACE_SENTINEL) {
			navigate({ to: "/create-workspace" });
			return;
		}
		await setActiveWorkspacePath(value);
		queryClient.invalidateQueries({ queryKey: activeWorkspaceQueryKey });
	}

	if (collapsed) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div className="flex items-center justify-center px-2 py-1.5">
						<FolderOpen className="size-4 text-muted-foreground" />
					</div>
				</TooltipTrigger>
				<TooltipContent side="right">
					{activeWorkspace?.name ?? "No workspace"}
				</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<div className="px-2">
			<Select
				value={activePath ?? activeWorkspace?.path ?? ""}
				onValueChange={handleValueChange}
			>
				<SelectTrigger className="w-full" size="sm" aria-label="Active workspace">
					<SelectValue placeholder="Select workspace" />
				</SelectTrigger>
				<SelectContent>
					{workspaces.length > 0 && (
						<SelectGroup>
							{workspaces.map((w) => (
								<SelectItem key={w.path} value={w.path}>
									{w.name}
								</SelectItem>
							))}
						</SelectGroup>
					)}
					{workspaces.length > 0 && <SelectSeparator />}
					<SelectGroup>
						<SelectItem value={NEW_WORKSPACE_SENTINEL}>
							New workspace…
						</SelectItem>
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	);
}
