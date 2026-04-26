---
description: Run a literature review on a topic using paper search and primary-source synthesis.
args: <topic>
section: Research Workflows
topLevelCli: true
---
Investigate the following topic as a literature review: $@

Derive a short slug from the topic (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

This is an execution request, not a request to explain the workflow. Execute the workflow and write durable artifacts. Continue immediately after planning unless the user explicitly asked to review the plan first.

## Modes and Quality Gates

Recognize optional mode hints in the user request:
- `--quick`, "quick", "small trial", or a narrow source constraint means a quick literature scan.
- `--deep`, "deep", "systematic", "formal review", or an unconstrained broad academic topic means a deep literature review.

If no mode is explicit, choose the lightest mode that can honestly answer the request and record the choice in `outputs/.plans/<slug>.md`.

Do not let a quick scan look like a full literature review:
- Quick scan minimum: 5 accepted sources, 3 directly fetched/read sources, a compact evidence matrix, and a final title or methodology note that says "quick literature scan" or "brief literature review".
- Deep review target: at least 20 candidate sources considered, at least 12 accepted sources, at least 8 directly fetched/read full-text or abstract sources, and coverage of the main method families discovered during planning.
- If a gate cannot be met because search, PDF, access, or tool capability is blocked, continue in degraded mode but label the final output `PARTIAL`, `QUICK`, or `BLOCKED` instead of implying a comprehensive review.

Every run must classify source quality in the provenance:
- `full-text`: fetched and read enough of the full source to verify claims.
- `abstract+conclusion`: abstract plus conclusion/discussion/limitations and any visible method or metric summary.
- `abstract`: abstract/metadata page fetched and read.
- `full-text-sampled`: selected method/results/conclusion sections read, but not the whole source.
- `snippet`: search result or short excerpt only.
- `metadata`: title/authors/venue only.
- `blocked`: inaccessible, dead, paywalled, parser failure, or rejected.

## Reading Budget

Use a layered reading strategy instead of dumping whole pages into context:
- For quick scans, default to metadata, abstract, conclusion/discussion/limitations, method overview, evaluation metrics, and key result-table captions. Do not read or retain full article bodies unless the page is short or the user explicitly asks for full-text review.
- For quick scans, cap each source note at roughly 800-1500 words. Extract only claim-supporting evidence into the evidence matrix and discard long page bodies from working memory.
- For deep reviews, full-text reading is allowed, but still write concise per-source notes before synthesis.
- If `fetch_content` or `get_search_content` returns a very long page, immediately extract the abstract, conclusion/discussion/limitations, method overview, metrics, and table/figure captions relevant to the taxonomy. Do not carry the whole long page forward.
- Mark source quality as `abstract+conclusion` or `full-text-sampled` when only selected sections were read.

## Workflow

1. **Plan** — Outline the scope, mode choice, key questions, source families, time period, method families expected, expected sections, and a task ledger plus verification log. Write the plan to `outputs/.plans/<slug>.md`. Briefly summarize the plan to the user and continue immediately. Do not ask for confirmation or wait for a proceed response unless the user explicitly requested plan review.
2. **Taxonomy** — Before broad gathering, write `outputs/.drafts/<slug>-taxonomy.md`. Cover the topic axes that define the review: objects being generated, method families, constraints, evaluation metrics, source types, and downstream tasks. Use this taxonomy to guide search rather than relying on one broad query.
3. **Candidate Pool** — For deep reviews, run `feynman research candidate-pool slug="<slug>" "<topic>"` after taxonomy and before source acceptance. Save or verify `outputs/.drafts/<slug>-candidate-pool.md`; use it to choose accepted sources, DOI-normalized records, open-access leads, and citation-network candidates. If the command is unavailable or fails, record the failure in the plan and continue with search/web evidence.
4. **Gather** — Use the `researcher` subagent when the sweep is wide enough to benefit from delegated paper triage before synthesis. For narrow or explicitly constrained topics, search directly. Researcher outputs go to `outputs/.drafts/<slug>-research-*.md`. Do not silently skip assigned questions; mark them `done`, `blocked`, or `superseded`. Apply the reading budget above and write concise per-source notes; do not let one long HTML page dominate the run.
5. **Evidence Matrix** — Write `outputs/.drafts/<slug>-evidence-matrix.md` before synthesis. Each accepted source must have a row with: stable ID, source quality (`full-text`, `abstract`, `snippet`, `metadata`, `blocked`), URL/DOI, method or artifact type, data/task, evaluation metrics, key claim, limitations, and confidence. Also write `outputs/.drafts/<slug>-method-comparison.md` for deep reviews or when methods are central to the topic.
6. **Synthesize** — Write the draft from the taxonomy and evidence matrix, not from memory. Separate consensus, disagreements, open questions, and evidence gaps. When useful, propose concrete next experiments or follow-up reading. Generate charts with `pi-charts` only when comparable quantitative data are source-backed; otherwise write a table or explicitly say no reliable chart was generated. Mermaid diagrams are acceptable for taxonomies or method pipelines. Before finishing the draft, sweep every strong claim against the evidence matrix and downgrade anything that is inferred or single-source critical.
7. **Cite** — Spawn the `verifier` agent to add inline citations and verify every source URL in the draft. For quick direct-search runs, you may do citation yourself, but you must still verify URLs with available fetch/search tools and write `outputs/.drafts/<slug>-cited.md`.
8. **Verify** — Spawn the `reviewer` agent for deep reviews. For quick direct-search runs, write `outputs/.drafts/<slug>-verification.md` yourself. Check unsupported claims, logical gaps, zombie sections, missing method families, low-quality-source overreach, and single-source critical findings. Fix FATAL issues before delivering. Note MAJOR issues in Open Questions. If FATAL issues were found, run one more verification pass after the fixes.
9. **Deliver** — Save the final literature review to `outputs/<slug>.md`. Write a provenance record alongside it as `outputs/<slug>.provenance.md` listing: date, mode, quality-gate status, source quality counts, sources consulted vs. accepted vs. rejected, verification status, candidate pool status, and intermediate research files used. Before you stop, verify on disk that the final output, provenance sidecar, plan, taxonomy, and evidence matrix exist; for deep reviews also verify candidate pool existence or recorded failure. Do not stop at an intermediate cited draft alone.
