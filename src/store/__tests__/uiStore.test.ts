import { beforeEach, expect, test } from "bun:test";
import { useUIStore } from "../uiStore";

beforeEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove("dark");
	// Reset store to a known state
	useUIStore.setState({ theme: "dark", sidebarCollapsed: false });
	document.documentElement.classList.add("dark");
});

test("toggleDark switches from dark to light", () => {
	useUIStore.getState().toggleDark();
	expect(useUIStore.getState().theme).toBe("light");
	expect(document.documentElement.classList.contains("dark")).toBe(false);
	expect(localStorage.getItem("theme")).toBe("light");
});

test("toggleDark switches from light to dark", () => {
	useUIStore.setState({ theme: "light" });
	useUIStore.getState().toggleDark();
	expect(useUIStore.getState().theme).toBe("dark");
	expect(document.documentElement.classList.contains("dark")).toBe(true);
	expect(localStorage.getItem("theme")).toBe("dark");
});

test("toggleDark persists to localStorage", () => {
	useUIStore.getState().toggleDark(); // dark → light
	expect(localStorage.getItem("theme")).toBe("light");
	useUIStore.getState().toggleDark(); // light → dark
	expect(localStorage.getItem("theme")).toBe("dark");
});

test("toggleSidebar collapses sidebar", () => {
	expect(useUIStore.getState().sidebarCollapsed).toBe(false);
	useUIStore.getState().toggleSidebar();
	expect(useUIStore.getState().sidebarCollapsed).toBe(true);
});

test("toggleSidebar expands sidebar", () => {
	useUIStore.setState({ sidebarCollapsed: true });
	useUIStore.getState().toggleSidebar();
	expect(useUIStore.getState().sidebarCollapsed).toBe(false);
});
