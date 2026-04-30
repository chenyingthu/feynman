---
name: capabilities
description: Show installed packages, discovery entrypoints, and runtime capability counts.
workflow: inline
---

# Capabilities

Display runtime capabilities and package status.

## Activation

- When: User wants to check what's available in the current environment
- Input: None
- Flags: None

## Workflow

Executes directly via CLI:
1. List installed Pi packages
2. Show discovery entrypoints (agents, tools, skills)
3. Count runtime capabilities by category

## Output

- **Display**: Capability summary with counts
- **Categories**: Agents, Tools, Skills, Packages

## Notes

This is a diagnostic utility; no persistent output generated.
