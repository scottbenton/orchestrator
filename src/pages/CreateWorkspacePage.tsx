import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { activeWorkspaceQueryKey } from "@/hooks/api/useActiveWorkspace";
import { workspacesQueryKey } from "@/hooks/api/useWorkspaces";
import { createWorkspace, setActiveWorkspacePath } from "@/services/workspaceListService";

export function CreateWorkspacePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [path, setPath] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleBrowse() {
		const selected = await open({ directory: true, multiple: false });
		if (typeof selected === "string") {
			setPath(selected);
			if (!name) {
				setName(selected.split("/").at(-1) ?? "");
			}
		}
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!path) {
			setError("Please choose a workspace folder.");
			return;
		}
		setError(null);
		setLoading(true);
		try {
			await createWorkspace(path, { name: name || undefined });
			await setActiveWorkspacePath(path);
			await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
			await queryClient.invalidateQueries({
				queryKey: activeWorkspaceQueryKey,
			});
			navigate({ to: "/tasks" });
		} catch (err) {
			console.error("Failed to create workspace:", err);
			setError(
				err instanceof Error
					? `Could not create workspace: ${err.message}`
					: "Could not create workspace."
			);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex min-h-full items-center justify-center p-8">
			<div className="w-full max-w-md flex flex-col gap-6">
				<div>
					<h1 className="text-lg font-semibold">Create a workspace</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Choose a folder where Orchestrator will store settings, memory, and worktrees.
					</p>
				</div>

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<Field>
						<FieldLabel htmlFor="workspace-path">Folder</FieldLabel>
						<div className="flex gap-2">
							<Input
								id="workspace-path"
								value={path}
								onChange={(e) => setPath(e.target.value)}
								placeholder="/Users/you/my-workspace"
								className="flex-1 font-mono"
							/>
							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={handleBrowse}
								aria-label="Browse for folder"
							>
								<FolderOpen />
							</Button>
						</div>
					</Field>

					<Field>
						<FieldLabel htmlFor="workspace-name">
							Name{" "}
							<span className="text-muted-foreground font-normal">(optional)</span>
						</FieldLabel>
						<Input
							id="workspace-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="my-workspace"
						/>
					</Field>

					{error && (
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
					)}

					<Button type="submit" className="w-full" disabled={loading}>
						{loading ? "Creating…" : "Create workspace"}
					</Button>
				</form>
			</div>
		</div>
	);
}
