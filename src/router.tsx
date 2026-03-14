import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { HomePage } from "@/pages/HomePage";
import { TestPage } from "@/pages/TestPage";

const rootRoute = createRootRoute({
	component: () => (
		<>
			<Outlet />
			<TanStackRouterDevtools />
		</>
	),
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: HomePage,
});

const testRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/test",
	component: TestPage,
});

const routeTree = rootRoute.addChildren([indexRoute, testRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
