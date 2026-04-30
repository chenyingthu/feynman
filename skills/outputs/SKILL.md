---
name: outputs
description: Browse all research artifacts (papers, outputs, experiments, notes).
workflow: inline
---

# Outputs

Browse and navigate research artifacts across project folders.

## Activation

- When: User wants to explore generated research files
- Input: None (opens browser interface)
- Flags: None

## Workflow

Executes directly via CLI:
1. Scan `outputs/`, `papers/`, `experiments/`, `notes/` directories
2. Present categorized artifact browser
3. Allow quick navigation and preview

## Output

- **Interface**: Interactive artifact browser
- **Display**: File listings with metadata (size, modified time)

## Notes

This is a utility command for project navigation; no persistent output generated.
