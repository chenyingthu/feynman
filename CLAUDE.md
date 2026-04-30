# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Feynman is a research-first CLI agent built on [Pi](https://github.com/badlogic/pi-mono) and [alphaXiv](https://www.alphaxiv.org/). It provides slash commands for deep research, literature review, paper auditing, replication, and other scientific workflows.

## Development Commands

```bash
# Setup (Node.js 22.x required, see .nvmrc)
nvm use || nvm install
npm install

# Development (run CLI locally)
npm run dev
npm start

# Build (compiles TypeScript to dist/)
npm run build

# Type checking
npm run typecheck

# Testing
npm test                    # Run all tests
npm test -- tests/content-policy.test.ts   # Run single test file

# Website (docs site, Astro-based)
cd website
npm install
npm run build
```

## Architecture

### Runtime Architecture
- **Entry**: `src/index.ts` → `src/cli.ts` (main command dispatcher)
- **Pi Integration**: `src/pi/` handles the Pi runtime, settings, packages, and web access
- **Commands**: Slash commands dispatched via `src/research/commands.ts`, `src/model/commands.ts`, etc.
- **Workflows**: Complex workflows (e.g., lit artifact guard) in `src/workflows/`

### Code Organization
- **src/cli.ts**: Main CLI dispatcher, handles all top-level commands
- **src/pi/**: Pi runtime integration (launch, settings, packages, web access, runtime patches)
- **src/research/**: Research API integration and command handling
- **src/model/**: Model registry, catalog, service tier management
- **src/config/**: Path resolution and configuration
- **src/system/**: System utilities (node version, open URL, executables)
- **src/ui/**: Terminal output utilities
- **src/workflows/**: Complex multi-step workflow implementations
- **src/bootstrap/**: Asset synchronization

### Bundled Assets
- **skills/**: Pi skills (Markdown with frontmatter) defining reusable capabilities
- **prompts/**: Workflow prompt templates (e.g., `deepresearch.md`, `lit.md`)
- **.feynman/agents/**: Subagent prompts (researcher, reviewer, writer, verifier)

### Research Workflow Conventions

Every workflow producing artifacts derives a **slug** (lowercase, hyphens, ≤5 words, no filler words) from the topic:

- Plan: `outputs/.plans/<slug>.md`
- Draft: `outputs/.drafts/<slug>-draft.md`
- Cited brief: `outputs/.drafts/<slug>-cited.md`
- Final output: `outputs/<slug>.md` or `papers/<slug>.md`
- Provenance: `<slug>.provenance.md` (sidecar next to final output)

Never use generic names like `research.md` or `draft.md`.

### Workspace Conventions

- **CHANGELOG.md**: Lab notebook for substantial work (not release notes). Append entries after meaningful progress, failures, or verification results.
- **outputs/, papers/, notes/**: Generated research artifacts
- **Provenance**: All `/deepresearch` and `/lit` outputs must include `.provenance.md` sidecars recording source accounting and verification status.
- **Verification**: Claims labeled `verified`, `unverified`, `blocked`, or `inferred` must match actual evidence.

### Key Technical Details

- Node.js range: `>=20.19.0 <25` (see `.nvmrc` for preferred local version)
- Module system: ES modules (`"type": "module"`)
- TypeScript config: `tsconfig.json` (dev), `tsconfig.build.json` (production)
- Test framework: Node.js built-in test runner with `tsx` for TypeScript
- Output: Compiled to `dist/`, entry at `bin/feynman.js`

### Environment Variables

See `.env.example` for optional runtime configuration:
- `FEYNMAN_MODEL`, `FEYNMAN_THINKING`: Default model and thinking level
- Provider API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.
- Compute: `RUNPOD_API_KEY`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`

### Agent System

Four bundled Pi subagents (in `.feynman/agents/`):
- `researcher`: Evidence gathering across papers, web, repos
- `reviewer`: Simulated peer review with severity-graded feedback
- `writer`: Structured drafts from research notes
- `verifier`: Inline citations, source verification, dead link cleanup

Subagents are invoked via Pi's `subagent` tool. Do not modify agent behavior in `AGENTS.md`; edit `.feynman/agents/*.md` instead.
