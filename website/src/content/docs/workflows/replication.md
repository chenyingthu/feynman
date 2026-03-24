---
title: Replication
description: Plan replications of papers and claims
section: Workflows
order: 5
---

## Usage

```
/replicate <paper or claim>
```

## What it does

Extracts key implementation details from a paper, identifies what's needed to replicate the results, and asks where to run before executing anything.

Before running code, Feynman asks you to choose an execution environment:

- **Local** — run in the current working directory
- **Virtual environment** — create an isolated venv/conda env first
- **Docker** — run experiment code inside an isolated Docker container
- **Plan only** — produce the replication plan without executing

## Example

```
/replicate "chain-of-thought prompting improves math reasoning"
```

## Output

A replication plan covering:

- Key claims to verify
- Required resources (compute, data, models)
- Implementation details extracted from the paper
- Potential pitfalls and underspecified details
- Step-by-step replication procedure
- Success criteria

If an execution environment is selected, also produces runnable scripts and captured results.
