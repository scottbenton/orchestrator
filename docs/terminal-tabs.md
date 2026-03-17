# Terminal Tabs — Implementation Plan

## Goal

Replace the current AI page (which tried to build a custom log-streaming wrapper around agent CLIs) with a proper terminal tab interface. Each tab is a real PTY terminal that auto-launches the workspace's configured AI agent. Tabs persist across app restarts, and with tmux, sessions survive app close and resume on reopen.

---

## The `AIAgentDefinition` Interface

The core abstraction for describing an agent backend. Lives in `src/types/agents.ts`.

```typescript
export interface AIAgentDefinition {
  /** Matches the `ai_backend` value in settings.toml */
  id: AIBackend;

  /** Human-readable name shown in the UI */
  name: string;

  /** The binary to invoke (must be on PATH) */
  command: string;

  /** Arguments passed before any user-provided args */
  args: string[];

  /** One-line description for UI tooltips / settings page */
  description: string;

  /**
   * Flag to pass a session ID to resume a previous conversation.
   * e.g., "--resume" for claude. undefined = no resume support.
   * Used when reconnecting to an existing tmux session that has exited
   * and we want to restart the agent in the same conversation.
   */
  resumeFlag?: string;
}
```

The registry lives alongside the type:

```typescript
// src/lib/agents.ts
import type { AIAgentDefinition } from "@/types/agents";
import type { AIBackend } from "@/types/config";

export const AGENT_DEFINITIONS: Record<AIBackend, AIAgentDefinition> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    args: [],
    description: "Anthropic's Claude Code CLI agent",
    resumeFlag: "--resume",
  },
  // Future: codex, ollama, etc.
};

export function getAgentDefinition(backend: AIBackend): AIAgentDefinition {
  return AGENT_DEFINITIONS[backend];
}
```

When workspace settings are loaded (`readWorkspaceSettings`), `getAgentDefinition(settings.ai_backend)` produces the full definition. UI components receive the definition object — not raw strings — so they have access to `name`, `description`, etc.

---

## Session Resumption via tmux

### Why tmux

A PTY process dies when the app closes. True session persistence — where the agent keeps running and you reconnect to it — requires a process supervisor that outlives the app. `tmux` is the standard solution: it runs as a server, keeps sessions alive, and allows multiple clients to attach and detach.

### How it works

**On tab creation:**
- Generate a UUID as the tab/session ID
- Instead of spawning the agent directly, spawn:
  ```
  tmux new-session -d -s {tab-uuid} -c {cwd} -- {command} {args}
  ```
  (`-d` = detached, starts in background)
- Then attach the PTY to that session:
  ```
  tmux attach-session -t {tab-uuid}
  ```
  This is what the xterm.js terminal actually runs — it connects to the tmux session.

**On tab switch / hide:**
- The xterm.js terminal is CSS-hidden. The PTY connection is kept alive. The tmux session continues running in the background.

**On app close:**
- The app window closes. The PTY connections (attach-session processes) die, but the tmux sessions themselves keep running.
- The tab list (UUIDs + metadata) is persisted to `plugin-store`.

**On app reopen:**
- Tab list is reloaded from `plugin-store`.
- For each tab, check if the tmux session still exists: `tmux has-session -t {tab-uuid}`
- If it exists: spawn `tmux attach-session -t {tab-uuid}` — the user reconnects to their running session
- If it's gone (agent exited): spawn `tmux new-session -d -s {tab-uuid} ... && tmux attach-session ...` — starts a fresh session

**Session naming:**
- Session names are the tab UUIDs. Since tmux session names have a character limit and can't contain certain characters, strip hyphens: `tab-uuid.replace(/-/g, "").slice(0, 32)`.

### Fallback if tmux is not installed

Check for tmux at startup using `which tmux`. If not found:
- Show a one-time dismissible banner: "Install tmux to enable session resumption"
- Fall back to spawning the agent directly without tmux
- Sessions still work; they just don't survive app close

### What the user sees

From the user's perspective:
1. They open a tab, Claude starts, they have a conversation
2. They close the app
3. They reopen the app — their Claude session is exactly where they left it, scroll history and all
4. If Claude had finished and exited, the tab reopens with a fresh Claude session

---

## Tab State

Tabs are persisted per workspace using `plugin-store`. Shape:

```typescript
interface PersistedTab {
  id: string;        // UUID — also the tmux session name (stripped of hyphens)
  title: string;     // Display name, e.g. "claude 1" or auto-named from first response
  cwd: string;       // Working directory at time of creation
  model?: string;    // Only for backends where requiresModel is true (ollama)
  createdAt: string; // ISO timestamp
}
```

Store key: `tabs_${workspaceId}` → `PersistedTab[]`

The Zustand store (`src/store/tabsStore.ts`) wraps this with runtime state:

```typescript
interface TabsState {
  tabs: PersistedTab[];
  activeTabId: string | null;
  isLoaded: boolean;

  loadTabs: (workspaceId: string, defaultCwd: string) => Promise<void>;
  addTab: (workspaceId: string, cwd: string, model?: string) => PersistedTab;
  closeTab: (workspaceId: string, tabId: string) => void;
  setActiveTab: (id: string) => void;
  updateTabTitle: (id: string, title: string) => void;
}
```

`addTab` creates a tab, persists it, and returns it. The caller is responsible for killing the tmux session on close via `ptyKill`.

---

## Architecture

### Rust PTY layer (`src-tauri/src/lib.rs`)

Four Tauri commands backed by a `Mutex<HashMap<String, PtyHandle>>` managed state:

```rust
struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child:  Box<dyn Child + Send + Sync>,
}
```

| Command | Args | What it does |
|---------|------|-------------|
| `pty_spawn` | `id, program, args, cwd, rows, cols` | Opens PTY, spawns process, starts reader thread emitting `pty-data` events |
| `pty_write` | `id, data` | Writes bytes to the PTY master (user keystrokes) |
| `pty_resize` | `id, rows, cols` | Calls `master.resize(PtySize {...})` |
| `pty_kill` | `id` | Removes from state map, kills child process |

The reader thread emits `{ id, data }` payloads on the `"pty-data"` Tauri event. Callers filter by `id`. A `"pty-close"` event is emitted when the reader loop ends.

The parent process environment is inherited by passing `std::env::vars()` to the `CommandBuilder` — this ensures `claude`, `codex`, etc. are found on `PATH` without needing shell scope configuration.

**Cargo.toml addition:**
```toml
portable-pty = "0.8"
```

### JS PTY service (`src/services/ptyService.ts`)

Thin wrappers:
```typescript
ptySpawn(id, program, args, cwd, rows, cols): Promise<void>
ptyWrite(id, data): Promise<void>
ptyResize(id, rows, cols): Promise<void>
ptyKill(id): Promise<void>
ptyOnData(id, cb): Promise<() => void>   // returns unlisten fn
ptyOnClose(id, cb): Promise<() => void>  // returns unlisten fn
```

All are direct `invoke`/`listen` calls — no state, no abstraction.

### Terminal component (`src/components/Terminal.tsx`)

```typescript
interface TerminalProps {
  id: string;
  program: string;    // "tmux" (or direct command if tmux unavailable)
  args: string[];     // ["attach-session", "-t", sessionName] (or direct args)
  cwd: string;
  isActive: boolean;
}
```

Mount sequence:
1. Create `XTerm` instance with theme from `useUIStore`
2. Load `FitAddon` and `WebLinksAddon`
3. `term.open(containerRef.current)`
4. `fitAddon.fit()`
5. Call `ptySpawn(...)`, wire data/close listeners
6. Wire `term.onData → ptyWrite`

Theme: separate `useEffect` watching `theme` calls `term.options.theme = ...` without remounting.

Resize: `ResizeObserver` on the container → `fitAddon.fit()` → `ptyResize(id, term.rows, term.cols)`. Only resize when `isActive` to avoid zero-dimension resize when hidden.

Unmount: `ptyKill(id)`, unlisten all, `term.dispose()`.

xterm themes:
```typescript
const DARK_THEME: ITheme = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#264f78",
  // ANSI colors matching VS Code dark+
};

const LIGHT_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#1e1e1e",
  cursor: "#1e1e1e",
  selectionBackground: "#add6ff",
  // ANSI colors matching VS Code light+
};
```

### AiPage (`src/pages/AiPage.tsx`)

```
┌──────────────────────────────────────────────┐
│ [Claude 1 ×]  [Claude 2 ×]  [+]             │  ← tab bar
├──────────────────────────────────────────────┤
│                                              │
│          xterm.js terminal                   │  ← flex-1, min-h-0
│                                              │
└──────────────────────────────────────────────┘
```

- Reads workspace via `useWorkspace()`
- Reads settings via `useWorkspaceSettings(workspace.path)` → `getAgentDefinition(settings.ai_backend)` → `{ command, args, requiresModel }`
- Checks tmux availability on mount (cached in a ref)
- On add tab: creates tmux session, adds to store
- All tabs rendered simultaneously, inactive ones `display: none`
- On close tab: removes from store, calls `ptyKill` to end the tmux attach process (but the underlying tmux session keeps running until the agent exits or the user explicitly destroys it)

---

## File Manifest

| File | Action |
|------|--------|
| `src/types/agents.ts` | **Create** — `AIAgentDefinition` interface |
| `src/lib/agents.ts` | **Create** — `AGENT_DEFINITIONS` registry + `getAgentDefinition()` |
| `src-tauri/Cargo.toml` | **Modify** — add `portable-pty = "0.8"` |
| `src-tauri/src/lib.rs` | **Modify** — add PTY state + 4 commands |
| `src/services/ptyService.ts` | **Create** — invoke/listen wrappers |
| `src/hooks/api/useWorkspaceSettings.ts` | **Create** — React Query wrapper |
| `src/store/tabsStore.ts` | **Create** — Zustand + plugin-store tab state |
| `src/components/Terminal.tsx` | **Create** — xterm.js + PTY component |
| `src/pages/AiPage.tsx` | **Rewrite** — tab bar + terminal shell |

No other files need to change. The existing `aiBackend.ts`, `logStreamService.ts`, and `LogViewer.tsx` are left intact for the task automation pipeline — this page is a separate interface.

---

## Implementation Order

1. **`src/types/agents.ts` + `src/lib/agents.ts`** — pure TypeScript, no dependencies, testable immediately
2. **`Cargo.toml` + `lib.rs`** — Rust PTY commands; verify the app still compiles with `bun run tauri:dev`
3. **`src/services/ptyService.ts`** — JS wrappers; can smoke-test from browser console
4. **`src/hooks/api/useWorkspaceSettings.ts`** — trivial hook, follows existing pattern
5. **`src/store/tabsStore.ts`** — tab state; test store actions in isolation
6. **`src/components/Terminal.tsx`** — start with a hardcoded `echo "hello"` to verify PTY end-to-end before wiring agent commands
7. **`src/pages/AiPage.tsx`** — assemble everything; add tmux detection + session logic last

---

## Open Questions

- **tmux session cleanup:** Should closing a tab also kill the tmux session (killing the agent)? Or leave it running? Proposal: killing the tab kills the session. A future "detach" option could leave it running.
- **Tab title auto-naming:** The first assistant response could seed the tab title. This would require parsing PTY output, breaking the clean separation. Simpler: let users rename tabs by double-clicking (standard browser tab UX). Default title: `Claude {n}`.
- **Multiple workspaces:** tmux session names are global to the user's tmux server. Prefix session names with a short workspace hash to avoid collisions: `{workspaceId.slice(0,8)}-{tabUUID.slice(0,8)}`.
- **Additional backends:** `codex`, `ollama`, and others can be added to `AGENT_DEFINITIONS` and `AI_BACKENDS` independently when needed. The `requiresModel` field on the interface is reserved for backends like Ollama that need a model name argument at spawn time.
