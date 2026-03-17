import { openPath } from "@tauri-apps/plugin-opener";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useWorkspace } from "@/hooks/api/useWorkspace";
import { workspacesQueryKey } from "@/hooks/api/useWorkspaces";
import { addWorkspace, removeWorkspace } from "@/services/workspaceListService";

export function SettingsPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const workspace = useWorkspace();

	const [name, setName] = useState(workspace?.name ?? "");
	const [saving, setSaving] = useState(false);
	const [removing, setRemoving] = useState(false);

	if (!workspace) return null;

	const handleSaveName = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		setSaving(true);
		try {
			await addWorkspace({ ...workspace, name: name.trim() });
			await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
		} finally {
			setSaving(false);
		}
	};

	const handleOpenFolder = async () => {
		await openPath(workspace.path);
	};

	const handleRemove = async () => {
		setRemoving(true);
		try {
			await removeWorkspace(workspace.path);
			await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
			navigate({ to: "/" });
		} finally {
			setRemoving(false);
		}
	};

	return (
		<div className="p-6 max-w-lg flex flex-col gap-6">
			<div>
				<h1 className="text-lg font-semibold">Settings</h1>
				<p className="mt-1 text-sm text-muted-foreground font-mono">{workspace.path}</p>
			</div>

			<Separator />

			<section className="flex flex-col gap-4">
				<h2 className="text-sm font-semibold">Workspace</h2>

				<form onSubmit={handleSaveName} className="flex flex-col gap-4">
					<Field>
						<FieldLabel htmlFor="workspace-name">Name</FieldLabel>
						<div className="flex gap-2">
							<Input
								id="workspace-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="my-workspace"
								className="flex-1"
							/>
							<Button
								type="submit"
								variant="outline"
								disabled={saving || name.trim() === workspace.name}
							>
								{saving ? "Saving…" : "Save"}
							</Button>
						</div>
					</Field>
				</form>

				<Button type="button" variant="outline" className="w-fit" onClick={handleOpenFolder}>
					<FolderOpen data-icon="inline-start" />
					Open folder
				</Button>
			</section>

			<Separator />

			<section className="flex flex-col gap-3">
				<h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
				<p className="text-sm text-muted-foreground">
					Remove this workspace from Orchestrator. Your files will not be deleted.
				</p>
				<Button
					type="button"
					variant="destructive"
					className="w-fit"
					onClick={handleRemove}
					disabled={removing}
				>
					<Trash2 data-icon="inline-start" />
					{removing ? "Removing…" : "Remove workspace"}
				</Button>
			</section>
		</div>
	);
}
