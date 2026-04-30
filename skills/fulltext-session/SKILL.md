---
name: fulltext-session
description: Start a browser-assisted full-text upload page for manual PDF acquisition.
workflow: inline
---

# Full-text Session

Start the `/fulltext-session` for browser-assisted PDF uploads.

## Activation

- When: Non-OA papers require manual download and upload
- Input: Existing acquisition slug with queued candidates
- Flags: `slug=<slug>`, `limit=<n>`, `port=<n>`, `host=<host>`, `watch-downloads=<dir>`

## Workflow

Executes directly via HTTP server:
1. Start local HTTP server on specified port
2. Serve upload interface for queued candidates
3. Watch download directory for automatic imports (optional)
4. Track import progress via session state API

Note: This is an interactive session; use `/fulltext-stop` to terminate.

## Output

- **Session**: HTTP endpoint at `http://<host>:<port>/`
- **State**: `outputs/.drafts/<slug>-fulltext-session.md` - Import tracking
- **Imported**: PDFs moved to `outputs/.pdfs/<slug>/`

## Side Effects

- Spawns persistent HTTP server
- Requires manual browser interaction
- Updates candidate pool status on each import
