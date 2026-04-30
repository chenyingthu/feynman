---
name: acquire
description: Run candidate discovery, OA full-text fetch, and browser-assisted PDF upload for a research topic.
workflow: inline
---

# Acquire

Run the `/acquire` workflow for one-shot research acquisition.

## Activation

- When: User needs to gather research candidates and fetch full-text papers
- Input: Research topic with optional constraints
- CLI: `feynman acquire [slug=<slug>] [limit=<n>] <topic> [--dry-run] [--save]`
- REPL: `/acquire [slug=<slug>] [limit=<n>] <topic> [--dry-run] [--save]`
- Flags: `slug=<slug>`, `limit=<n>`, `fetch-limit=<n>`, `query=<search>`, `--no-session`, `--dry-run`, `--save`

## Workflow

Executes directly via CLI integration:
1. Run candidate pool discovery across academic APIs
2. Download OA PDFs automatically
3. Start browser-assisted upload session for non-OA papers (unless `--no-session`)

Note: This workflow runs inline without Subagent delegation for efficiency.

## Output

- **Primary**: `outputs/.drafts/<slug>-candidate-pool.md` - Discovered candidates
- **Logs**: `outputs/.drafts/<slug>-fulltext-log.md` - Fetch operations log
- **Extracts**: `outputs/.drafts/<slug>-fulltext-extracts.md` - Sampled text extracts
- **Queue**: `outputs/.drafts/<slug>-fulltext-browser-queue.md` - Manual upload queue (if any)
- **Session** (with `--save`): `outputs/.sessions/<slug>-acquire-session.md` - Command output record

## Side Effects

- May spawn HTTP server on `port=18766` for browser-assisted uploads
- Writes PDFs to `outputs/.pdfs/<slug>/`
- Updates evidence matrix with full-text status
