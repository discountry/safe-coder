## Safe Coder

Safe Coder is a configuration package for the [`pi` coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) that adds **safety guardrails** and **project-specific** extensions to reduce risky operations while you code with an AI assistant.

This project is meant to be used as a dependency or a template: you point `pi` at this package, and it will load its extensions and skills automatically.

### Installation

```bash
# install pi coding agent
npm install -g @mariozechner/pi-coding-agent

# install safe coder
pi install npm:safe-coder
```

### Features

- **Permission gate for dangerous shell commands**
  - Intercepts `bash` tool calls that look dangerous, such as:
    - `rm -rf`, recursive remove
    - `sudo` commands
    - `chmod` / `chown` with `777`
  - Prompts for explicit confirmation before allowing these commands to run.
- **Workspace boundary enforcement**
  - Blocks file tools (`read`, `write`, `edit`) when they target paths outside the current working directory where `pi` was started, unless you explicitly allow them.
  - Flags shell commands that appear to touch absolute paths, home-relative paths (`~/`), or `../`-style traversal and asks for confirmation.
- **Protected path guard**
  - Fully protects any `.env` files (no read, write, or edit allowed via tools).
  - Blocks write/edit attempts into common sensitive locations like `.git/` and `node_modules/`.
- **Skill-based workflows**
  - Ships with a `skills/skills.txt` reference that documents how `pi` discovers and uses Agent Skills.
  - Compatible with the [Agent Skills specification](https://agentskills.io/specification).

### Project Layout

- `package.json`
  - Declares this package as `safe-coder`.
  - Configures `pi` to load from:
    - `./extensions`
    - `./skills`
    - `./prompts`
    - `./themes`
- `extensions/permission-gate.ts`
  - A `pi` extension that listens to `tool_call` events and:
    - Detects dangerous shell commands via regex heuristics.
    - Detects file operations that leave the current working directory.
    - Uses `ctx.ui.select` to ask the user whether to allow or block the call.
- `extensions/protected-paths.ts`
  - A `pi` extension that:
    - Completely blocks all access to `.env` paths.
    - Blocks `write` and `edit` tool calls into `.git/` and `node_modules/`.
    - Optionally notifies the user when an operation is blocked.
- `skills/`
  - Currently contains `skills.txt`, which documents how Agent Skills work and how `pi` discovers and validates them.

### Requirements

- Node.js (version compatible with `@mariozechner/pi-coding-agent`).
- `pnpm` as package manager (see `packageManager` field in `package.json`).
- The [`pi` coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) installed and available on your system.

### Installation

You can add this project to another workspace or clone it as a starting point.

```bash
git clone <this-repo-url> safe-coder
cd safe-coder
pnpm install    # if you add dependencies later
```

Because this package primarily provides configuration, there are no runtime scripts defined apart from the default `test` placeholder.

### Using with `pi`

Point `pi` at this project so it can load its extensions and skills. For example, from the project root:

```bash
cd /path/to/safe-coder
pi .
```

When `pi` starts:

- It discovers extensions from the `pi.extensions` entry in `package.json` and loads:
  - `extensions/permission-gate.ts`
  - `extensions/protected-paths.ts`
- It discovers skills via the `pi.skills` entry and any `SKILL.md`/skill files under `skills/`.

You will then see:

- Confirmation prompts when the assistant attempts potentially dangerous or out-of-bounds commands.
- Warnings and blocks when the assistant tries to touch protected paths.

### Customization

- **Adjust dangerous patterns**
  - Edit `extensions/permission-gate.ts` to add or refine regex patterns for dangerous commands or external paths.
- **Change protected paths**
  - Edit `extensions/protected-paths.ts` and update the `protectedPaths` array or the `.env` handling logic.
- **Add skills**
  - Create new skill directories under `skills/` following the Agent Skills format (each with a `SKILL.md` file and optional scripts/docs).
  - Update descriptions so the assistant knows when to use each skill.

### Development Notes

- The TypeScript extensions currently use `// @ts-nocheck` for simplicity. You can progressively add types and strictness as needed.
- Follow the Agent Skills and `pi` extension best practices to keep new skills and extensions small, focused, and easy to review for safety.

