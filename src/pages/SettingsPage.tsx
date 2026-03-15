import { openPath } from "@tauri-apps/plugin-opener";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { activeWorkspaceQueryKey, useActiveWorkspace } from "@/hooks/api/useActiveWorkspace";
import { workspacesQueryKey, useWorkspaces } from "@/hooks/api/useWorkspaces";
import { addWorkspace, removeWorkspace } from "@/services/workspaceListService";

export function SettingsPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: activePath } = useActiveWorkspace();
	const { data: workspaces = [] } = useWorkspaces();

	const workspace = workspaces.find((w) => w.path === activePath);
	const currentName = workspace?.name ?? "";

	const [name, setName] = useState(currentName);
	const [saving, setSaving] = useState(false);
	const [removing, setRemoving] = useState(false);

	// Keep local name in sync when workspace changes
	if (name !== currentName && !saving) {
		setName(currentName);
	}

	async function handleSaveName(e: React.FormEvent) {
		e.preventDefault();
		if (!activePath || !name.trim()) return;
		setSaving(true);
		try {
			await addWorkspace({ path: activePath, name: name.trim() });
			await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
		} finally {
			setSaving(false);
		}
	}

	async function handleOpenFolder() {
		if (!activePath) return;
		await openPath(activePath);
	}

	async function handleRemove() {
		if (!activePath) return;
		setRemoving(true);
		try {
			await removeWorkspace(activePath);
			await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
			await queryClient.invalidateQueries({ queryKey: activeWorkspaceQueryKey });
			navigate({ to: "/tasks" });
		} finally {
			setRemoving(false);
		}
	}

	if (!workspace) {
		return (
			<div className="p-6">
				<h1 className="text-lg font-semibold">Settings</h1>
				<p className="mt-2 text-sm text-muted-foreground">No workspace selected.</p>
			</div>
		);
	}

	return (
		<div className="p-6 max-w-lg flex flex-col gap-6">
			<div>
				<h1 className="text-lg font-semibold">Settings</h1>
				<p className="mt-1 text-sm text-muted-foreground font-mono">{activePath}</p>
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
								disabled={saving || name.trim() === currentName}
							>
								{saving ? "Saving…" : "Save"}
							</Button>
						</div>
					</Field>
				</form>

				<Button
					type="button"
					variant="outline"
					className="w-fit"
					onClick={handleOpenFolder}
				>
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
