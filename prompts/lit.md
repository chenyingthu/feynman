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
- Deep review target: at least 60 candidate sources considered, at least 25 accepted sources, at least 12 directly fetched/read full-text or abstract sources, and coverage of the main method families discovered during planning.
- If a gate cannot be met because search, PDF, access, or tool capability is blocked, continue in degraded mode but label the final output `PARTIAL`, `QUICK`, or `BLOCKED` instead of implying a comprehensive review.

## Scholarly Output Standard

The final report must read like a formal literature review article, not a research notebook:
- Use a review-paper structure: title, abstract, keywords, introduction, scope and review method, taxonomy, thematic synthesis, method comparison, evidence gaps, future research agenda, conclusion, and references.
- Write in analytical paragraphs with topic sentences and cross-source synthesis. Do not deliver a list of per-paper notes as the main body.
- Include comparative tables when methods, assumptions, data requirements, stability criteria, or evaluation metrics are central to the topic.
- Every accepted source must appear in a final `References` section with a stable ID, authors when available, year, title, venue or source, DOI and/or URL, and source-quality label.
- The reference list must cover all accepted sources in the evidence matrix, not only the sources cited in prose.
- Citation IDs in the body must match the evidence matrix and reference list.

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

## DOI and Access Fallbacks

Do not make IEEE Xplore or direct PDF access a hard dependency. Prefer DOI landing pages, publisher HTML, OpenAlex metadata, Crossref metadata, Unpaywall OA locations, Semantic Scholar records, author pages, institutional repositories, and stable preprint pages before attempting fragile PDF extraction.

If DOI, PDF, publisher, or search access fails:
- Record the failed path and the fallback path in the evidence matrix or provenance.
- Downgrade source quality to `abstract`, `metadata`, or `blocked` based on what was actually read.
- Do not cite a PDF as read unless its content was fetched or parsed successfully.
- If only metadata/abstract is available, keep bibliographic and positioning claims but weaken or remove method-detail, result, limitation, and comparison claims that require full-text support.

## Workflow

1. **Plan** — Outline the scope, mode choice, key questions, source families, time period, method families expected, expected sections, and a task ledger plus verification log. Write the plan to `outputs/.plans/<slug>.md`. Briefly summarize the plan to the user and continue immediately. Do not ask for confirmation or wait for a proceed response unless the user explicitly requested plan review.
2. **Taxonomy** — Before broad gathering, write `outputs/.drafts/<slug>-taxonomy.md`. Cover the topic axes that define the review: objects being generated, method families, constraints, evaluation metrics, source types, and downstream tasks. End the taxonomy with 3-6 reusable candidate-pool search queries derived from the taxonomy axes. Use this taxonomy to guide search rather than relying on one broad query.
3. **Candidate Pool** — For deep reviews, run `feynman research candidate-pool slug="<slug>" limit=80 query="<taxonomy query 1>" query="<taxonomy query 2>" "<topic>"` after taxonomy and before source acceptance. Include 4-8 `query="..."` arguments from the taxonomy when available, spanning methods, objects, terminology variants, and recent review keywords. Save or verify `outputs/.drafts/<slug>-candidate-pool.md`; use it to choose accepted sources, DOI-normalized records, open-access leads, and citation-network candidates. If the command is unavailable or fails, record the failure in the plan and continue with search/web evidence.
4. **Gather** — Use the `researcher` subagent when the sweep is wide enough to benefit from delegated paper triage before synthesis. For narrow or explicitly constrained topics, search directly. Researcher outputs go to `outputs/.drafts/<slug>-research-*.md`. Do not silently skip assigned questions; mark them `done`, `blocked`, or `superseded`. Apply the reading budget above and write concise per-source notes; do not let one long HTML page dominate the run.
5. **Evidence Matrix** — Write `outputs/.drafts/<slug>-evidence-matrix.md` before synthesis. Each accepted source must have a row with: stable ID, source quality (`full-text`, `abstract`, `snippet`, `metadata`, `blocked`), URL/DOI, method or artifact type, data/task, evaluation metrics, key claim, limitations, confidence, and whether it appears in the final References. Also write `outputs/.drafts/<slug>-method-comparison.md` for deep reviews or when methods are central to the topic.
6. **Synthesize** — Write the draft from the taxonomy and evidence matrix, not from memory. Use the Scholarly Output Standard above. Separate consensus, disagreements, open questions, and evidence gaps. When useful, propose concrete next experiments or follow-up reading. Generate charts with `pi-charts` only when comparable quantitative data are source-backed; otherwise write a table or explicitly say no reliable chart was generated. Mermaid diagrams are acceptable for taxonomies or method pipelines. Before finishing the draft, sweep every strong claim against the evidence matrix and downgrade anything that is inferred or single-source critical.
7. **Cite** — Spawn the `verifier` agent to add inline citations and verify every source URL in the draft. For quick direct-search runs, you may do citation yourself, but you must still verify URLs with available fetch/search tools and write `outputs/.drafts/<slug>-cited.md`. The cited draft must contain a complete `References` section covering every accepted source from the evidence matrix, including sources used only for background, taxonomy, or negative evidence.
8. **Verify** — Spawn the `reviewer` agent for deep reviews. For quick direct-search runs, write `outputs/.drafts/<slug>-verification.md` yourself. Check unsupported claims, logical gaps, zombie sections, missing method families, low-quality-source overreach, and single-source critical findings. The verification artifact must use FATAL / MAJOR / MINOR severity and include suggested fixes. Fix FATAL issues before delivering. Apply feasible MAJOR fixes before final delivery when they affect source validity, citation placement, overclaiming, source-quality downgrades, missing method-family coverage, or stale unsupported text. If a MAJOR issue cannot be fixed with available evidence or access, explicitly list it as residual in Open Questions and in the provenance. If FATAL issues were found, or if MAJOR fixes materially changed the report, run one more targeted verification pass after the fixes.
9. **Fix Loop** — When applying verifier or reviewer fixes, do not issue one giant edit. Use small localized edits for 1-3 simple corrections. For section rewrites, table rewrites, source substitutions, or more than 3 substantive fixes, write a corrected complete candidate to `outputs/.drafts/<slug>-revised.md`. After edits, run targeted on-disk verification with `rg`, `grep`, `diff`, `wc`, `stat`, or a targeted read to prove the old unsupported wording/source is gone and the corrected wording/source exists. Provenance may only claim an issue was fixed when this post-edit verification passed. The final candidate is `outputs/.drafts/<slug>-revised.md` if it exists; otherwise it is `outputs/.drafts/<slug>-cited.md`.
10. **Deliver** — Save the final literature review to `outputs/<slug>.md`. Write a provenance record alongside it as `outputs/<slug>.provenance.md` listing: date, mode, quality-gate status, source quality counts, sources consulted vs. accepted vs. rejected, verification status, candidate pool status, reference-list completeness status, fix ledger, residual FATAL/MAJOR/MINOR issues, and intermediate research files used. Before you stop, verify on disk that the final output, provenance sidecar, plan, taxonomy, and evidence matrix exist; for deep reviews also verify candidate pool existence or recorded failure. Also verify that any fixes claimed in the provenance are reflected in the final candidate, and that every accepted evidence-matrix source appears in the final References. Do not stop at an intermediate cited draft alone.
