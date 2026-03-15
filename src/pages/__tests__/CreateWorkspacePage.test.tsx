import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test-utils";

const mockCreateWorkspace = mock(() =>
	Promise.resolve({ path: "/home/user/my-ws", name: "my-ws" })
);
const mockSetActive = mock(() => Promise.resolve());
const mockOpen = mock(() => Promise.resolve("/home/user/my-ws"));

mock.module("@/services/workspaceListService", () => ({
	createWorkspace: mockCreateWorkspace,
	setActiveWorkspacePath: mockSetActive,
	getWorkspaces: mock(() => Promise.resolve([])),
	getActiveWorkspacePath: mock(() => Promise.resolve(null)),
	addWorkspace: mock(() => Promise.resolve()),
	removeWorkspace: mock(() => Promise.resolve()),
	clearActiveWorkspace: mock(() => Promise.resolve()),
}));

mock.module("@tauri-apps/plugin-dialog", () => ({
	open: mockOpen,
}));

const { CreateWorkspacePage } = await import("../CreateWorkspacePage");

beforeEach(() => {
	mockCreateWorkspace.mockReset();
	mockSetActive.mockReset();
	mockOpen.mockReset();
	mockCreateWorkspace.mockImplementation(() =>
		Promise.resolve({ path: "/home/user/my-ws", name: "my-ws" })
	);
	mockSetActive.mockImplementation(() => Promise.resolve());
	mockOpen.mockImplementation(() => Promise.resolve("/home/user/my-ws"));
});

afterEach(cleanup);

test("renders the form fields", async () => {
	renderWithProviders(<CreateWorkspacePage />);
	expect(await screen.findByLabelText("Folder")).toBeDefined();
	expect(await screen.findByRole("button", { name: /create workspace/i })).toBeDefined();
});

test("shows error when submitting with no path", async () => {
	const user = userEvent.setup();
	renderWithProviders(<CreateWorkspacePage />);

	const submitBtn = await screen.findByRole("button", { name: /create workspace/i });
	await user.click(submitBtn);

	expect(await screen.findByRole("alert")).toBeDefined();
	expect(screen.getByRole("alert").textContent).toContain("choose a workspace folder");
});

test("browse button populates path field", async () => {
	const user = userEvent.setup();
	renderWithProviders(<CreateWorkspacePage />);

	const browseBtn = await screen.findByRole("button", { name: /browse/i });
	await user.click(browseBtn);

	await waitFor(() => {
		const input = screen.getByLabelText("Folder") as HTMLInputElement;
		expect(input.value).toBe("/home/user/my-ws");
	});
});

test("browse button pre-fills name from folder name", async () => {
	const user = userEvent.setup();
	renderWithProviders(<CreateWorkspacePage />);

	const browseBtn = await screen.findByRole("button", { name: /browse/i });
	await user.click(browseBtn);

	await waitFor(() => {
		const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
		expect(nameInput.value).toBe("my-ws");
	});
});

test("submit calls createWorkspace with path and name", async () => {
	const user = userEvent.setup();
	renderWithProviders(<CreateWorkspacePage />);

	const pathInput = await screen.findByLabelText("Folder");
	await user.type(pathInput, "/home/user/test-ws");

	const submitBtn = await screen.findByRole("button", { name: /create workspace/i });
	await user.click(submitBtn);

	await waitFor(() => {
		expect(mockCreateWorkspace).toHaveBeenCalledWith(
			"/home/user/test-ws",
			expect.objectContaining({})
		);
	});
});

test("shows error message when createWorkspace fails", async () => {
	mockCreateWorkspace.mockImplementation(() => Promise.reject(new Error("permission denied")));
	const user = userEvent.setup();
	renderWithProviders(<CreateWorkspacePage />);

	const pathInput = await screen.findByLabelText("Folder");
	await user.type(pathInput, "/System/restricted");

	const submitBtn = await screen.findByRole("button", { name: /create workspace/i });
	await user.click(submitBtn);

	expect(await screen.findByRole("alert")).toBeDefined();
	expect(screen.getByRole("alert").textContent).toContain("permission denied");
});
