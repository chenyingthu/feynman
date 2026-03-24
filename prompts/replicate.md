---
description: Plan or execute a replication workflow for a paper, claim, or benchmark.
args: <paper>
section: Research Workflows
topLevelCli: true
---
Design a replication plan for: $@

## Workflow

1. **Extract** — Use the `researcher` subagent to pull implementation details from the target paper and any linked code.
2. **Plan** — Determine what code, datasets, metrics, and environment are needed. Be explicit about what is verified, what is inferred, what is still missing, and which checks or test oracles will be used to decide whether the replication succeeded.
3. **Environment** — Before running anything, ask the user where to execute:
   - **Local** — run in the current working directory
   - **Virtual environment** — create an isolated venv/conda env first
   - **Docker** — run experiment code inside an isolated Docker container
   - **Plan only** — produce the replication plan without executing
4. **Execute** — If the user chose an execution environment, implement and run the replication steps there. Save notes, scripts, raw outputs, and results to disk in a reproducible layout. Do not call the outcome replicated unless the planned checks actually passed.
5. **Report** — End with a `Sources` section containing paper and repository URLs.

Do not install packages, run training, or execute experiments without confirming the execution environment first.
