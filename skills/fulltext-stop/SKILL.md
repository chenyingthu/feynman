---
name: fulltext-stop
description: Stop the active full-text upload page.
workflow: inline
---

# Full-text Stop

Terminate the running full-text acquisition session.

## Activation

- When: User wants to stop the browser-assisted upload server
- Input: None
- Flags: None

## Workflow

Executes directly via CLI:
1. Find active session by PID/reference
2. Send termination signal
3. Clean up session state

## Output

- **Display**: Confirmation of session termination
- **Log**: Session closure timestamp

## Side Effects

- Terminates HTTP server process
- Releases port binding
- Clears active session reference

## Notes

This is a control command; no persistent output generated.
