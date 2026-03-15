import { create } from "zustand";

type Theme = "dark" | "light";

const THEME_KEY = "theme";

function getInitialTheme(): Theme {
	if (typeof localStorage === "undefined") return "dark";
	const stored = localStorage.getItem(THEME_KEY);
	if (stored === "dark" || stored === "light") return stored;
	if (typeof window === "undefined" || !window.matchMedia) return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("dark", theme === "dark");
}

const initialTheme = getInitialTheme();
applyTheme(initialTheme);

interface UIState {
	theme: Theme;
	sidebarCollapsed: boolean;
	toggleDark: () => void;
	toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
	theme: initialTheme,
	sidebarCollapsed: false,
	toggleDark: () =>
		set((state) => {
			const next: Theme = state.theme === "dark" ? "light" : "dark";
			localStorage.setItem(THEME_KEY, next);
			applyTheme(next);
			return { theme: next };
		}),
	toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
