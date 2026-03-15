import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test-utils";

mock.module("@/services/workspaceListService", () => ({
	getWorkspaces: mock(() => Promise.resolve([])),
	getActiveWorkspacePath: mock(() => Promise.resolve(null)),
	setActiveWorkspacePath: mock(() => Promise.resolve()),
	createWorkspace: mock(() => Promise.resolve({ path: "/ws", name: "ws" })),
	addWorkspace: mock(() => Promise.resolve()),
	removeWorkspace: mock(() => Promise.resolve()),
	clearActiveWorkspace: mock(() => Promise.resolve()),
}));

const { useUIStore } = await import("@/store/uiStore");
const { Sidebar } = await import("../Sidebar");

beforeEach(() => {
	useUIStore.setState({ theme: "dark", sidebarCollapsed: false });
	document.documentElement.classList.add("dark");
	localStorage.clear();
});

afterEach(cleanup);

test("renders nav items", async () => {
	renderWithProviders(<Sidebar />);
	expect(await screen.findByText("Tasks")).toBeDefined();
	expect(await screen.findByText("AI")).toBeDefined();
	expect(await screen.findByText("Settings")).toBeDefined();
});

test("collapse toggle hides nav labels", async () => {
	const user = userEvent.setup();
	renderWithProviders(<Sidebar />);

	// Labels visible initially
	expect(await screen.findByText("Tasks")).toBeDefined();

	// Click collapse
	const collapseBtn = await screen.findByRole("button", { name: "Collapse sidebar" });
	await user.click(collapseBtn);

	// Sidebar is now collapsed — expand button appears, collapse button is gone
	expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeDefined();
	expect(screen.queryByRole("button", { name: "Collapse sidebar" })).toBeNull();
});

test("collapse toggle expands sidebar again", async () => {
	const user = userEvent.setup();
	useUIStore.setState({ sidebarCollapsed: true });
	renderWithProviders(<Sidebar />);

	const expandBtn = await screen.findByRole("button", { name: "Expand sidebar" });
	await user.click(expandBtn);

	expect(await screen.findByText("Tasks")).toBeDefined();
});

test("dark mode toggle switches theme", async () => {
	const user = userEvent.setup();
	renderWithProviders(<Sidebar />);

	const toggleBtn = await screen.findByRole("button", { name: "Light mode" });
	await user.click(toggleBtn);

	expect(useUIStore.getState().theme).toBe("light");
	expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("dark mode toggle shows correct icon label based on current theme", async () => {
	useUIStore.setState({ theme: "light" });
	renderWithProviders(<Sidebar />);

	expect(await screen.findByRole("button", { name: "Dark mode" })).toBeDefined();
});
