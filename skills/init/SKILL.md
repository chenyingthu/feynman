---
name: init
description: Bootstrap AGENTS.md and session-log folders for a research project.
workflow: inline
---

# Init

Initialize a new research project with Feynman scaffolding.

## Activation

- When: Starting a new research project or folder
- Input: None (uses current directory)
- Flags: None

## Workflow

Executes directly via CLI:
1. Create `AGENTS.md` template with project context
2. Create `session-log/` directory structure
3. Set up outputs, papers, notes, experiments folders

## Output

- **Project**: `AGENTS.md` - Project context template
- **Folders**: `session-log/`, `outputs/`, `papers/`, `notes/`, `experiments/`

## Side Effects

- Modifies project directory structure
- Creates `.gitkeep` files for empty folders
