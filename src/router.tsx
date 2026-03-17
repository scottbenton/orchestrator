import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { Sidebar } from "@/components/layout/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AiPage } from "@/pages/AiPage";
import { CreateWorkspacePage } from "@/pages/CreateWorkspacePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TasksPage } from "@/pages/TasksPage";
import { getActiveWorkspacePath, getWorkspaces } from "@/services/workspaceListService";

function RootLayout() {
	return (
		<TooltipProvider>
			<div className="flex h-screen overflow-hidden bg-background text-foreground">
				<Outlet />
				{import.meta.env.DEV && <TanStackRouterDevtools />}
			</div>
		</TooltipProvider>
	);
}

function WorkspaceLayout() {
	return (
		<>
			<Sidebar />
			<main className="flex-1 overflow-hidden">
				<Outlet />
			</main>
		</>
	);
}

const rootRoute = createRootRoute({ component: RootLayout });

// Redirect to last active workspace, or /create-workspace if none exist
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: async () => {
		const workspaces = await getWorkspaces();
		if (workspaces.length === 0) {
			throw redirect({ to: "/create-workspace" });
		}
		const activePath = await getActiveWorkspacePath();
		const target = workspaces.find((w) => w.path === activePath) ?? workspaces[0];
		throw redirect({
			to: "/$workspaceId/tasks",
			params: { workspaceId: target.id },
		});
	},
});

const createWorkspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/create-workspace",
	component: CreateWorkspacePage,
});

// Workspace layout route — validates workspaceId, redirects to / if not found
export const workspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "$workspaceId",
	component: WorkspaceLayout,
	beforeLoad: async ({ params }) => {
		const workspaces = await getWorkspaces();
		const exists = workspaces.some((w) => w.id === params.workspaceId);
		if (!exists) {
			throw redirect({ to: "/" });
		}
	},
});

const tasksRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: "tasks",
	component: TasksPage,
});

const aiRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: "ai",
	component: AiPage,
});

const settingsRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: "settings",
	component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	createWorkspaceRoute,
	workspaceRoute.addChildren([tasksRoute, aiRoute, settingsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
