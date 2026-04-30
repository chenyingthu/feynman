---
name: service-tier
description: View or set the provider service tier override for supported models.
workflow: inline
---

# Service Tier

Manage model provider service tier preferences.

## Activation

- When: User wants to control API request priority/throughput
- Input: Optional tier value
- Flags: `auto`, `default`, `flex`, `priority`, `standard_only`, `unset`

## Workflow

Executes directly via CLI:
1. Read current tier configuration
2. Display available tiers with descriptions
3. Set new tier if specified

## Output

- **Display**: Current tier status and available options
- **Config**: Updates `feynman.json` with tier preference

## Side Effects

- Modifies local configuration file
- Affects subsequent model API requests
