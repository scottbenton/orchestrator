import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { router } from "./router";
// Side-effect: reads localStorage and applies dark class on import
import "./store/uiStore";
import "./index.css";
import { getDb } from "./lib/db";

// Run DB migration on startup
getDb().catch(console.error);

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
			{import.meta.env.DEV && <ReactQueryDevtools />}
		</QueryClientProvider>
	</React.StrictMode>
);
