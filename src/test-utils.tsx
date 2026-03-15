import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
