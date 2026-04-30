---
name: feynman-model
description: Open Feynman model menu (main + per-subagent overrides).
workflow: inline
---

# Feynman Model

Interactive model selection and configuration.

## Activation

- When: User wants to change the active model or configure subagent models
- Input: None (opens interactive menu)
- Flags: None

## Workflow

Executes directly via UI:
1. Show current model configuration
2. List available models from configured providers
3. Allow setting main model and per-subagent overrides
4. Save preferences to settings

## Output

- **Display**: Model configuration interface
- **Config**: Updates `feynman.json` with model preferences

## Side Effects

- Modifies local configuration
- Affects subsequent AI requests
