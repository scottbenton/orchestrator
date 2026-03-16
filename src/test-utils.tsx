import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	Outlet,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

export function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
}

/**
 * Renders a component wrapped in QueryClientProvider and a minimal router.
 * The component is rendered as the content of the root route at "/".
 */
export function renderWithProviders(ui: ReactNode, { queryClient = createTestQueryClient() } = {}) {
	const rootRoute = createRootRoute({ component: () => <>{ui}</> });
	const routeTree = rootRoute.addChildren([
		createRoute({ getParentRoute: () => rootRoute, path: "/" }),
	]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<RouterProvider router={router} />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

/**
 * Renders a component inside a `/$workspaceId` route context.
 * Use this for components that call `useParams({ from: "/$workspaceId" })`.
 */
export function renderWithWorkspace(
	ui: ReactNode,
	{ workspaceId = "test-workspace-id", queryClient = createTestQueryClient() } = {}
) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "$workspaceId",
		component: () => <>{ui}</>,
	});
	const routeTree = rootRoute.addChildren([workspaceRoute]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [`/${workspaceId}`] }),
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<RouterProvider router={router} />
			</TooltipProvider>
		</QueryClientProvider>
	);
}
