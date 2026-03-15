import { Link, useRouterState } from "@tanstack/react-router";
import { Bot, CheckSquare, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUIStore } from "@/store/uiStore";
import { WorkspaceDropdown } from "./WorkspaceDropdown";

interface NavItemProps {
	to: string;
	icon: React.ReactNode;
	label: string;
	collapsed: boolean;
}

function NavItem({ to, icon, label, collapsed }: NavItemProps) {
	const { location } = useRouterState();
	const isActive = location.pathname === to;

	if (collapsed) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						asChild
						variant={isActive ? "secondary" : "ghost"}
						size="icon"
						className="w-full"
					>
						<Link to={to}>
							{icon}
							<span className="sr-only">{label}</span>
						</Link>
					</Button>
				</TooltipTrigger>
				<TooltipContent side="right">{label}</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<Button
			asChild
			variant={isActive ? "secondary" : "ghost"}
			className="w-full justify-start"
		>
			<Link to={to}>
				{icon}
				{label}
			</Link>
		</Button>
	);
}

interface SidebarActionProps {
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
	collapsed: boolean;
}

function SidebarAction({ onClick, icon, label, collapsed }: SidebarActionProps) {
	if (collapsed) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="w-full"
						onClick={onClick}
					>
						{icon}
						<span className="sr-only">{label}</span>
					</Button>
				</TooltipTrigger>
				<TooltipContent side="right">{label}</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<Button
			type="button"
			variant="ghost"
			className="w-full justify-start"
			onClick={onClick}
		>
			{icon}
			{label}
		</Button>
	);
}

export function Sidebar() {
	const { theme, sidebarCollapsed, toggleDark, toggleSidebar } = useUIStore();
	const collapsed = sidebarCollapsed;

	return (
		<aside
			style={{
				width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
			}}
			className="flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200"
		>
			{/* Workspace selector */}
			<div className="py-2">
				<WorkspaceDropdown collapsed={collapsed} />
			</div>
			<Separator />

			{/* Main nav */}
			<nav className="flex-1 p-2 flex flex-col gap-0.5">
				<NavItem
					to="/tasks"
					icon={<CheckSquare data-icon="inline-start" />}
					label="Tasks"
					collapsed={collapsed}
				/>
				<NavItem
					to="/ai"
					icon={<Bot data-icon="inline-start" />}
					label="AI"
					collapsed={collapsed}
				/>
			</nav>

			<Separator />
			{/* Bottom controls */}
			<div className="p-2 flex flex-col gap-0.5">
				<NavItem
					to="/settings"
					icon={<Settings data-icon="inline-start" />}
					label="Settings"
					collapsed={collapsed}
				/>
				<SidebarAction
					onClick={toggleDark}
					icon={
						theme === "dark" ? (
							<Sun data-icon="inline-start" />
						) : (
							<Moon data-icon="inline-start" />
						)
					}
					label={theme === "dark" ? "Light mode" : "Dark mode"}
					collapsed={collapsed}
				/>
				<SidebarAction
					onClick={toggleSidebar}
					icon={
						collapsed ? (
							<PanelLeftOpen data-icon="inline-start" />
						) : (
							<PanelLeftClose data-icon="inline-start" />
						)
					}
					label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					collapsed={collapsed}
				/>
			</div>
		</aside>
	);
}
