import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bannedPatterns = [/ValiChord/i, /Harmony Record/i, /harmony_record_/i];

function collectMarkdownFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectMarkdownFiles(fullPath));
			continue;
		}
		if (entry.isFile() && fullPath.endsWith(".md")) {
			files.push(fullPath);
		}
	}
	return files;
}

test("bundled prompts and skills do not contain blocked promotional product content", () => {
	for (const filePath of [...collectMarkdownFiles(join(repoRoot, "prompts")), ...collectMarkdownFiles(join(repoRoot, "skills"))]) {
		const content = readFileSync(filePath, "utf8");
		for (const pattern of bannedPatterns) {
			assert.doesNotMatch(content, pattern, `${filePath} contains blocked promotional pattern ${pattern}`);
		}
	}
});

test("research writing prompts forbid fabricated results and unproven figures", () => {
	const draftPrompt = readFileSync(join(repoRoot, "prompts", "draft.md"), "utf8");
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const writerPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "writer.md"), "utf8");
	const verifierPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "verifier.md"), "utf8");

	for (const [label, content] of [
		["system prompt", systemPrompt],
	] as const) {
		assert.match(content, /Never (invent|fabricate)/i, `${label} must explicitly forbid invented or fabricated results`);
		assert.match(content, /(figure|chart|image|table)/i, `${label} must cover visual/table provenance`);
		assert.match(content, /(provenance|source|artifact|script|raw)/i, `${label} must require traceable support`);
	}

	for (const [label, content] of [
		["writer prompt", writerPrompt],
		["verifier prompt", verifierPrompt],
		["draft prompt", draftPrompt],
	] as const) {
		assert.match(content, /system prompt.*provenance rule/i, `${label} must point back to the system provenance rule`);
	}

	assert.match(draftPrompt, /system prompt's provenance rules/i);
	assert.match(draftPrompt, /placeholder or proposed experimental plan/i);
	assert.match(draftPrompt, /source-backed quantitative data/i);
});

test("deepresearch workflow requires durable artifacts even when blocked", () => {
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(systemPrompt, /Do not claim you are only a static model/i);
	assert.match(systemPrompt, /write the requested durable artifact/i);
	assert.match(deepResearchPrompt, /not a request to explain or implement/i);
	assert.match(deepResearchPrompt, /Do not answer by describing the protocol/i);
	assert.match(deepResearchPrompt, /degraded mode/i);
	assert.match(deepResearchPrompt, /Verification: BLOCKED/i);
	assert.match(deepResearchPrompt, /Never end with only an explanation in chat after plan approval/i);
});

test("research workflows use real web-search tool names and grant them to evidence agents", () => {
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");
	const researcherPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "researcher.md"), "utf8");
	const verifierPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "verifier.md"), "utf8");

	assert.match(systemPrompt, /call `web_search`/i);
	assert.match(systemPrompt, /do not call non-existent aliases such as `google:search`/i);
	assert.match(deepResearchPrompt, /call `web_search`/i);
	assert.match(deepResearchPrompt, /never call `google:search`/i);

	for (const [label, content] of [
		["researcher prompt", researcherPrompt],
		["verifier prompt", verifierPrompt],
	] as const) {
		assert.match(content, /^tools: .*web_search/m, `${label} must grant web_search`);
		assert.match(content, /^tools: .*fetch_content/m, `${label} must grant fetch_content`);
		assert.match(content, /^tools: .*get_search_content/m, `${label} must grant get_search_content`);
	}
});

test("deepresearch asks for confirmation after planning before execution", () => {
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(deepResearchPrompt, /stop and ask for explicit confirmation before gathering evidence/i);
	assert.match(deepResearchPrompt, /Proceed with this deep research plan\?/i);
	assert.match(deepResearchPrompt, /Do not run searches, fetch sources, spawn subagents, draft, cite, review, or deliver final artifacts until the user confirms/i);
	assert.match(deepResearchPrompt, /update `outputs\/\.plans\/<slug>\.md` first, then ask for confirmation again/i);
});

test("deepresearch citation and review stages are sequential and avoid giant edits", () => {
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(deepResearchPrompt, /must complete before any reviewer runs/i);
	assert.match(deepResearchPrompt, /Do not run the `verifier` and `reviewer` in the same parallel `subagent` call/i);
	assert.match(deepResearchPrompt, /outputs\/\.drafts\/<slug>-cited\.md/i);
	assert.match(deepResearchPrompt, /do not issue one giant `edit` tool call/i);
	assert.match(deepResearchPrompt, /outputs\/\.drafts\/<slug>-revised\.md/i);
	assert.match(deepResearchPrompt, /The final candidate is `outputs\/\.drafts\/<slug>-revised\.md` if it exists/i);
});

test("deepresearch requires post-edit verification before claiming fixes landed", () => {
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(systemPrompt, /Do not say a file edit, patch, correction, or reviewer fix was applied/i);
	assert.match(systemPrompt, /write\/edit tool succeeded/i);
	assert.match(systemPrompt, /old unsupported content is gone and the corrected content exists/i);

	assert.match(deepResearchPrompt, /After applying reviewer, verifier, audit, or PI-style fixes/i);
	assert.match(deepResearchPrompt, /run an explicit on-disk verification/i);
	assert.match(deepResearchPrompt, /If an `edit` or `write` tool call fails, do not describe the fix as applied/i);
	assert.match(deepResearchPrompt, /Provenance may only say an issue was fixed when this post-edit verification passed/i);
	assert.match(deepResearchPrompt, /verify that any fixes claimed in the provenance are reflected in the final candidate/i);
});

test("deepresearch keeps subagent tool calls small and skips subagents for narrow explainers", () => {
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(deepResearchPrompt, /including "what is X" explainers/i);
	assert.match(deepResearchPrompt, /Make the scale decision before assigning owners/i);
	assert.match(deepResearchPrompt, /lead-owned direct search tasks only/i);
	assert.match(deepResearchPrompt, /MUST NOT spawn researcher subagents/i);
	assert.match(deepResearchPrompt, /Do not inflate a simple explainer into a multi-agent survey/i);
	assert.match(deepResearchPrompt, /Skip researcher spawning entirely/i);
	assert.match(deepResearchPrompt, /Use multiple search terms\/angles before drafting/i);
	assert.match(deepResearchPrompt, /Minimum: 3 distinct queries/i);
	assert.match(deepResearchPrompt, /Record the exact search terms used/i);
	assert.match(deepResearchPrompt, /outputs\/\.drafts\/<slug>-research-direct\.md/i);
	assert.match(deepResearchPrompt, /outputs\/\.drafts\/<slug>-verification\.md/i);
	assert.match(deepResearchPrompt, /Do not call `alpha_get_paper`/i);
	assert.match(deepResearchPrompt, /do not fetch `\.pdf` URLs/i);
	assert.match(deepResearchPrompt, /Keep `subagent` tool-call JSON small and valid/i);
	assert.match(deepResearchPrompt, /write a per-researcher brief first/i);
	assert.match(deepResearchPrompt, /Do not place multi-paragraph instructions inside the `subagent` JSON/i);
	assert.match(deepResearchPrompt, /Do not add extra keys such as `artifacts`/i);
	assert.match(deepResearchPrompt, /always set `failFast: false`/i);
	assert.match(deepResearchPrompt, /if a PDF parser or paper fetch fails/i);
});

test("lit workflow enforces evidence-driven quality gates", () => {
	const litPrompt = readFileSync(join(repoRoot, "prompts", "lit.md"), "utf8");

	assert.match(litPrompt, /quick literature scan/i);
	assert.match(litPrompt, /Deep review target: at least 60 candidate sources considered/i);
	assert.match(litPrompt, /at least 25 accepted sources/i);
	assert.match(litPrompt, /source quality/i);
	assert.match(litPrompt, /Scholarly Output Standard/i);
	assert.match(litPrompt, /Artifact Contract/i);
	assert.match(litPrompt, /outputs\/\.plans\/<slug>\.manifest\.json/i);
	assert.match(litPrompt, /requiredArtifacts/i);
	assert.match(litPrompt, /currentStage/i);
	assert.match(litPrompt, /Before every assistant turn that could be the last turn/i);
	assert.match(litPrompt, /If either is missing, the next action must be a file write/i);
	assert.match(litPrompt, /formal literature review article/i);
	assert.match(litPrompt, /title, abstract, keywords, introduction, scope and review method, taxonomy/i);
	assert.match(litPrompt, /complete `References` section/i);
	assert.match(litPrompt, /Every accepted source must appear in a final `References` section/i);
	assert.match(litPrompt, /Narrative and Technical Writing Standard/i);
	assert.match(litPrompt, /one dense opening paragraph that states the main findings/i);
	assert.match(litPrompt, /do not skip heading levels/i);
	assert.match(litPrompt, /Each major section must begin with narrative synthesis/i);
	assert.match(litPrompt, /Prefer prose for argumentation and tables for comparison/i);
	assert.match(litPrompt, /establish the real research object, operating boundary conditions, governing principles, and evaluation criteria/i);
	assert.match(litPrompt, /Do not imply superiority without source-backed validation/i);
	assert.match(litPrompt, /notebook-like artifacts/i);
	assert.match(litPrompt, /Source Selection and Gap-Directed Search/i);
	assert.match(litPrompt, /Prioritize peer-reviewed review papers, high-impact venue papers/i);
	assert.match(litPrompt, /Use an iterative refinement pass before synthesis/i);
	assert.match(litPrompt, /Run 2-4 targeted follow-up queries or source fetches/i);
	assert.match(litPrompt, /Applied Research Logic/i);
	assert.match(litPrompt, /Define the real research object/i);
	assert.match(litPrompt, /Identify the real contradiction/i);
	assert.match(litPrompt, /Optional Knowledge Roadmap/i);
	assert.match(litPrompt, /Knowledge Map and Research Roadmap/i);
	assert.match(litPrompt, /full-text/i);
	assert.match(litPrompt, /abstract\+conclusion/i);
	assert.match(litPrompt, /full-text-sampled/i);
	assert.match(litPrompt, /abstract/i);
	assert.match(litPrompt, /snippet/i);
	assert.match(litPrompt, /metadata/i);
	assert.match(litPrompt, /blocked/i);
	assert.match(litPrompt, /Reading Budget/i);
	assert.match(litPrompt, /metadata, abstract, conclusion\/discussion\/limitations, method overview, evaluation metrics/i);
	assert.match(litPrompt, /800-1500 words/i);
	assert.match(litPrompt, /Do not carry the whole long page forward/i);
	assert.match(litPrompt, /DOI and Access Fallbacks/i);
	assert.match(litPrompt, /Do not make IEEE Xplore or direct PDF access a hard dependency/i);
	assert.match(litPrompt, /Downgrade source quality to `abstract`, `metadata`, or `blocked`/i);
	assert.match(litPrompt, /Do not cite a PDF as read unless its content was fetched or parsed successfully/i);
	assert.match(litPrompt, /outputs\/\.drafts\/<slug>-taxonomy\.md/i);
	assert.match(litPrompt, /feynman research candidate-pool/i);
	assert.match(litPrompt, /limit=80/i);
	assert.match(litPrompt, /outputs\/\.drafts\/<slug>-candidate-pool\.md/i);
	assert.match(litPrompt, /outputs\/\.drafts\/<slug>-evidence-matrix\.md/i);
	assert.match(litPrompt, /perform the gap-directed refinement pass/i);
	assert.match(litPrompt, /outputs\/\.drafts\/<slug>-method-comparison\.md/i);
	assert.match(litPrompt, /Write the draft from the taxonomy and evidence matrix, not from memory/i);
	assert.match(litPrompt, /Apply feasible MAJOR fixes before final delivery/i);
	assert.match(litPrompt, /outputs\/\.drafts\/<slug>-revised\.md/i);
	assert.match(litPrompt, /run targeted on-disk verification/i);
	assert.match(litPrompt, /Provenance may only claim an issue was fixed when this post-edit verification passed/i);
	assert.match(litPrompt, /residual FATAL\/MAJOR\/MINOR issues/i);
	assert.match(litPrompt, /quality-gate status/i);
	assert.match(litPrompt, /candidate pool status/i);
	assert.match(litPrompt, /reference-list completeness status/i);
	assert.match(litPrompt, /source quality counts/i);
	assert.match(litPrompt, /verify on disk that the final output, provenance sidecar, plan, taxonomy, and evidence matrix exist/i);
	assert.match(litPrompt, /every accepted evidence-matrix source appears in the final References/i);
});

test("verifier and reviewer require actionable source fallback fixes", () => {
	const verifierPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "verifier.md"), "utf8");
	const reviewerPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "reviewer.md"), "utf8");

	assert.match(verifierPrompt, /For DOI, PDF, publisher, or paywall failures/i);
	assert.match(verifierPrompt, /OpenAlex metadata, Crossref metadata, Unpaywall OA landing\/PDF location/i);
	assert.match(verifierPrompt, /Do not cite a PDF as read unless its content was successfully fetched or parsed/i);
	assert.match(verifierPrompt, /\*\*Suggested fix:\*\*/i);
	assert.match(verifierPrompt, /\*\*Verification check:\*\*/i);

	assert.match(reviewerPrompt, /classify each weakness as fixable or residual/i);
	assert.match(reviewerPrompt, /\*\*Fixability:\*\*/i);
	assert.match(reviewerPrompt, /\*\*Suggested fix:\*\*/i);
	assert.match(reviewerPrompt, /\*\*Verification check:\*\*/i);
	assert.match(reviewerPrompt, /do not require direct PDF access as the only acceptable fix/i);
});

test("review workflow must write final artifacts instead of stopping after planning", () => {
	const reviewPrompt = readFileSync(join(repoRoot, "prompts", "review.md"), "utf8");

	assert.match(reviewPrompt, /not a request to explain or implement/i);
	assert.match(reviewPrompt, /Do not ask for confirmation/i);
	assert.match(reviewPrompt, /continue immediately/i);
	assert.match(reviewPrompt, /Do not end after planning/i);
	assert.match(reviewPrompt, /outputs\/\.plans\/<slug>-review-plan\.md/i);
	assert.match(reviewPrompt, /outputs\/\.drafts\/<slug>-review-evidence\.md/i);
	assert.match(reviewPrompt, /outputs\/<slug>-review\.md/i);
	assert.match(reviewPrompt, /If PDF parsing fails/i);
	assert.match(reviewPrompt, /Verification: BLOCKED/i);
	assert.match(reviewPrompt, /verify on disk that `outputs\/<slug>-review\.md` exists/i);
	assert.match(reviewPrompt, /Never end with planning-only chat/i);
});

test("workflow prompts except explicit gated workflows do not introduce implicit confirmation gates", () => {
	const workflowPrompts = [
		"audit.md",
		"compare.md",
		"draft.md",
		"lit.md",
		"review.md",
		"summarize.md",
		"watch.md",
	];
	const bannedConfirmationGates = [
		/Do you want to proceed/i,
		/wait for user confirmation/i,
		/give them a brief chance/i,
		/request changes before proceeding/i,
	];

	for (const fileName of workflowPrompts) {
		const content = readFileSync(join(repoRoot, "prompts", fileName), "utf8");
		assert.match(content, /continue (immediately|automatically)/i, `${fileName} should keep running after planning`);
		for (const pattern of bannedConfirmationGates) {
			assert.doesNotMatch(content, pattern, `${fileName} contains confirmation gate ${pattern}`);
		}
	}
});
