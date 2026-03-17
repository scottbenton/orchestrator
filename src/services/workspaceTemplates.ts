// ---------------------------------------------------------------------------
// Workspace scaffold templates
// ---------------------------------------------------------------------------
// These strings are written verbatim when a new workspace is created.
// Keep them concise — agents read them on every session.

export const AGENT_INSTRUCTIONS_TEMPLATE = `# Agent Instructions

This workspace is managed by Orchestrator. Follow all instructions in this file before beginning any work.

---

## Repository Management

- Repositories are cloned into \`_repositories/{owner}/{repo}/\`
- **Before starting any work**, always fetch and pull the default branch (usually \`main\` or \`master\`):
  \`\`\`
  git fetch origin
  git checkout main && git pull
  \`\`\`
- Never commit directly to the default branch.

## Working with Feature Branches (Worktrees)

All work happens in isolated worktrees. To begin work on a task:

\`\`\`bash
git -C _repositories/{owner}/{repo} worktree add \
  _worktrees/{owner}/{repo}/{branch-name} \
  -b {branch-name}
\`\`\`

This keeps the main clone clean and allows parallel tasks across branches. When done, open a PR from the worktree branch and remove the worktree after merging.

---

## Memory Files

### Repository Memory: \`_memory/repos/{owner}/{repo}/\`

Each repo has a dedicated memory folder:

- \`MEMORY.md\` — Core facts: architecture, tech stack, key conventions, important patterns, known gotchas. **Read this before working in the repo.**
- \`modules/\` — Topic-specific files (e.g., \`auth.md\`, \`database.md\`). Only load the files relevant to your current task.

**When to update repo memory:**
- You discover an architectural decision not obvious from the code
- You learn a convention the team follows that isn't documented
- You hit a non-obvious gotcha or footgun
- There's an important relationship between systems worth remembering

Only add information that would save future context. Do not record things that are already clear from reading the code or commit history.

### Global Memory: \`_memory/MEMORY.md\`

Workspace-wide context — things that apply across all repos (e.g., shared infrastructure, cross-cutting conventions). Update sparingly.

---

## Corrections

Corrections are behavioral rules and lessons learned. They take priority over general judgment.

- \`_memory/CORRECTIONS.md\` — Universal corrections applying to all repos in this workspace. **Read in full before starting any work.**
- \`_memory/repos/{owner}/{repo}/corrections.md\` — Repo-specific corrections. **Read in full before working in that repo.**

**When to add a correction:**
- You made a mistake and were corrected by the user
- A behavior conflicts with how this workspace operates
- The user gives explicit behavioral guidance

Be specific: record what went wrong, why, and exactly what to do instead.

---

## Context Discipline

Keep context lean:
- Load only the memory files relevant to your current task
- Add to memory files only when the information is genuinely useful across future sessions
- Do not duplicate information already in code, docs, or commit history
- Do not summarize completed work into memory — that belongs in commit messages and PRs
`;

export const CORRECTIONS_TEMPLATE = `# Corrections

Universal behavioral corrections for this workspace. Read this file in its entirety before starting any work.

---

<!-- Add corrections below. Format: what went wrong, why, and what to do instead. -->
`;

export const MEMORY_TEMPLATE = `# Workspace Memory

Global context that applies across all repositories in this workspace.

---

<!-- Add workspace-wide context here. Keep it to things not derivable from the code. -->
`;
