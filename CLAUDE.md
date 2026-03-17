# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local Tauri desktop app that manages AI agent workspaces. Agents fetch tickets from project boards, plan and execute work in git worktrees, open PRs, and can be triggered by PR comments. The app surfaces logs, task state, and cost tracking in a UI.

## Commands

```bash
bun run tauri:dev       # Full Tauri dev (launches Vite on :1420 + native window)
bun run dev             # Vite dev server only (no native shell)
bun run build           # Type-check + Vite build
bun run lint            # Biome lint
bun run format          # Biome format (writes)
bun run check           # Biome lint + format (writes)
bun test                # All tests
bun run test:services   # Services, stores, lib tests only
bun run test:ui         # Component and page tests only
bun test src/services/__tests__/configService.test.ts   # Single test file
```

## Architecture

**Tech stack:** React 19 + TypeScript, Tauri 2.x, TanStack Router + Query, Zustand, Tailwind CSS v4, shadcn/ui, Zod, Biome, Bun.

**Key principle:** All business logic lives in `src/services/` as TypeScript. `src-tauri/src/lib.rs` is ~15 lines of plugin registration and is never touched.

### Source layout

- `src/lib/` — thin wrappers around Tauri plugins (`db.ts` for SQLite, `fs.ts` for file system, `shell.ts` for process execution)
- `src/services/` — business logic (`configService`, `logStreamService`, `workspaceListService`)
- `src/store/` — Zustand stores (`uiStore` for dark mode/UI state, `logsStore` for live log buffer)
- `src/types/` — Zod schemas (`config.ts` for settings, `logs.ts` for log types)
- `src/hooks/api/` — React Query hooks over services
- `src/pages/` — route-level components
- `src/components/ui/` — shadcn/ui primitives

### Config hierarchy

Settings are resolved: defaults → workspace `settings.toml` → repo-level `_repositories/_settings/{owner}/{repo}.toml`. `configService.ts` handles merging.

### Log architecture

Logs have two sources merged in `LogViewer.tsx`:
1. **Historical** — fetched from SQLite via `logStreamService`
2. **Live** — streamed into Zustand `logsStore` buffer

### Database

SQLite via `@tauri-apps/plugin-sql`. Migrations use `PRAGMA user_version` for versioned, append-only runner (see `src/lib/db.ts`). Schema: `task_logs`, `task_interactions`. SQLite stores only data that doesn't exist elsewhere (logs, costs, task history) — never caches external state.

### Workspace folder structure

```
my-workspace/
  settings.toml
  _memory/
    corrections.md              # always loaded
    corrections/{language}.md   # loaded per language
    repos/{owner}/{repo}/
      corrections.md            # always loaded for this repo
      modules/*.md              # lazy-loaded by keyword/path match
    skills/*.md                 # matched by trigger keywords
  _repositories/
    _settings/{owner}/{repo}.toml
  _worktrees/{owner}/{repo}/{task-id}/
```

### AI backend interface

```typescript
interface AIBackend {
  run(prompt: string, cwd: string, taskId: string, onLine: (line: LogLine) => void): Promise<void>
}
```

### Task state machine

```
pending → planning → awaiting_review → executing → pushing → pr_open → done
                   ↘ (plan_review=false, skip)
Any state → failed
```

## Testing

- Tests use Bun as the runner with happy-dom globals (configured in `src/test-setup.ts`, preloaded via `bunfig.toml`)
- Test files live in `__tests__/` subdirectories alongside the code they test
- `src/test-utils.tsx` provides shared React testing utilities

## Tauri plugins in use

`plugin-shell` (process spawning), `plugin-fs` (file system), `plugin-sql` (SQLite), `plugin-store` (key-value persistence), `plugin-dialog`, `plugin-opener`, `plugin-notification` (planned).
