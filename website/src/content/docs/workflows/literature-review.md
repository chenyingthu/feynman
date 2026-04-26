---
title: Literature Review
description: Run a structured literature review with consensus mapping and gap analysis.
section: Workflows
order: 2
---

The literature review workflow produces a structured survey of the academic landscape on a given topic. Unlike deep research which aims for a comprehensive brief, the literature review focuses specifically on mapping the state of the field -- what researchers agree on, where they disagree, and what remains unexplored.

## Usage

From the REPL:

```
/lit Scaling laws for language model performance
```

From the CLI:

```bash
feynman lit "Scaling laws for language model performance"
```

You can also steer the review depth:

```bash
feynman lit "--quick scenario generation for renewable power"
feynman lit "--deep complex operating scenario generation for new power systems"
```

## How it works

The literature review workflow starts by choosing a mode and writing a plan. Quick scans are labeled as quick or partial when the available source set is small. Deep reviews use higher quality gates: the workflow should consider at least 20 candidate sources, accept at least 12 sources, and directly fetch/read at least 8 full-text or abstract sources before presenting the result as a deep review.

Before synthesis, Feynman writes a taxonomy and evidence matrix. The taxonomy defines the review axes, such as method families, datasets, evaluation metrics, constraints, and downstream tasks. The evidence matrix records each accepted source with a stable ID, source quality, URL or DOI, key claim, limitations, and confidence. The synthesis step then writes from those artifacts rather than from memory.

Quick scans use a reading budget. They prefer metadata, abstract, conclusion or discussion, limitations, method overview, evaluation metrics, and key table captions instead of loading entire article bodies. Per-source notes should stay compact, usually around 800-1500 words, and provenance labels partial reads as `abstract+conclusion` or `full-text-sampled`. Deep reviews may read full text, but still write concise source notes before synthesis.

The output is organized chronologically and thematically, showing how ideas evolved over time and how different research groups approach the problem differently. Citation counts, publication venues, source quality, and direct-read coverage are used as signals for weighting claims, though the review explicitly notes when influential work contradicts the mainstream view or when the available evidence is too thin.

## Output format

The literature review produces:

- **Scope and Methodology** -- What was searched and how papers were selected
- **Taxonomy** -- The conceptual axes used to organize the topic
- **Evidence Matrix** -- Source-by-source claims, methods, limitations, and confidence
- **Consensus** -- Claims that most papers agree on, with supporting citations
- **Disagreements** -- Active debates where papers present conflicting evidence or interpretations
- **Open Questions** -- Topics that the literature has not adequately addressed
- **Timeline** -- Key milestones and how the field evolved
- **References** -- Complete bibliography organized by relevance
- **Provenance Sidecar** -- Source quality counts, rejected sources, verification status, and intermediate artifact paths

## When to use it

Use `/lit` when you need a map of the research landscape rather than a deep dive into a specific question. It is particularly useful at the start of a new research project when you need to understand what has already been done, or when preparing a related work section for a paper.
