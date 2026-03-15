import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaces } from "@/hooks/api/useWorkspaces";
import { AiPage } from "@/pages/AiPage";
import { CreateWorkspacePage } from "@/pages/CreateWorkspacePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TasksPage } from "@/pages/TasksPage";

function RootLayout() {
	const { data: workspaces, isLoading } = useWorkspaces();
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		if (!isLoading && workspaces?.length === 0 && pathname !== "/create-workspace") {
			navigate({ to: "/create-workspace" });
		}
	}, [workspaces, isLoading, pathname, navigate]);

	const showSidebar = pathname !== "/create-workspace" && (workspaces?.length ?? 0) > 0;

	return (
		<TooltipProvider>
			<div className="flex h-screen overflow-hidden bg-background text-foreground">
				{showSidebar && <Sidebar />}
				<main className="flex-1 overflow-auto">
					<Outlet />
				</main>
				{import.meta.env.DEV && <TanStackRouterDevtools />}
			</div>
		</TooltipProvider>
	);
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/tasks" });
	},
});

const tasksRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/tasks",
	component: TasksPage,
});

const aiRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/ai",
	component: AiPage,
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsPage,
});

const createWorkspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/create-workspace",
	component: CreateWorkspacePage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	tasksRoute,
	aiRoute,
	settingsRoute,
	createWorkspaceRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
