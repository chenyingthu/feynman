import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLitArtifactRecoveryPrompt, deriveSlugFromTopicParts, runLitArtifactGuard } from "../src/workflows/lit-artifact-guard.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-lit-guard-"));
	mkdirSync(join(root, "outputs", ".plans"), { recursive: true });
	mkdirSync(join(root, "outputs", ".drafts"), { recursive: true });
	return root;
}

test("deriveSlugFromTopicParts ignores workflow flags and keeps first five ASCII words", () => {
	assert.equal(deriveSlugFromTopicParts(["power", "electronics", "small", "signal", "stability", "--deep"]), "power-electronics-small-signal-stability");
	assert.equal(deriveSlugFromTopicParts(["电力电子化系统小干扰稳定分析方法", "--deep"]), undefined);
});

test("lit artifact guard passes when manifest-required artifacts exist", () => {
	const root = makeWorkspace();
	const manifestPath = join(root, "outputs", ".plans", "stability-review.manifest.json");
	writeFileSync(
		manifestPath,
		JSON.stringify({
			workflow: "lit",
			slug: "stability-review",
			mode: "deep",
			requiredArtifacts: ["outputs/stability-review.md", "outputs/stability-review.provenance.md"],
			currentStage: "deliver",
			status: "done",
		}),
		"utf8",
	);
	writeFileSync(join(root, "outputs", "stability-review.md"), "# done\n", "utf8");
	writeFileSync(join(root, "outputs", "stability-review.provenance.md"), "# provenance\n", "utf8");

	const result = runLitArtifactGuard({ command: "lit", rest: ["power"], workingDir: root, exitCode: 0 });

	assert.equal(result.ok, true);
	assert.equal(result.checked, true);
	assert.equal(result.slug, "stability-review");
});

test("lit artifact guard writes blocked artifacts and fails when final outputs are missing", () => {
	const root = makeWorkspace();
	writeFileSync(
		join(root, "outputs", ".plans", "stability-review.manifest.json"),
		JSON.stringify({
			workflow: "lit",
			slug: "stability-review",
			mode: "deep",
			requiredArtifacts: ["outputs/stability-review.md", "outputs/stability-review.provenance.md"],
			currentStage: "synthesize",
			status: "running",
		}),
		"utf8",
	);

	const result = runLitArtifactGuard({ command: "lit", rest: ["power"], workingDir: root, exitCode: 0 });

	assert.equal(result.ok, false);
	assert.equal(result.checked, true);
	assert.deepEqual(result.missing?.map((path) => path.endsWith("stability-review.md") || path.endsWith("stability-review.provenance.md")), [true, true]);
	assert.ok(result.blockedOutputPath);
	assert.ok(result.blockedProvenancePath);
	assert.equal(existsSync(result.blockedOutputPath), true);
	assert.match(readFileSync(result.blockedOutputPath, "utf8"), /Last recorded stage: synthesize/);
});

test("lit artifact guard can report recoverable missing artifacts without writing blocked files", () => {
	const root = makeWorkspace();
	writeFileSync(
		join(root, "outputs", ".plans", "stability-review.manifest.json"),
		JSON.stringify({
			workflow: "lit",
			slug: "stability-review",
			mode: "deep",
			requiredArtifacts: ["outputs/stability-review.md", "outputs/stability-review.provenance.md"],
			currentStage: "synthesize",
			status: "running",
		}),
		"utf8",
	);

	const result = runLitArtifactGuard({
		command: "lit",
		rest: ["power"],
		workingDir: root,
		exitCode: 0,
		writeBlockedArtifacts: false,
	});

	assert.equal(result.ok, false);
	assert.equal(result.recoverable, true);
	assert.equal(result.blockedOutputPath, undefined);
	assert.equal(existsSync(join(root, "outputs", "stability-review.blocked.md")), false);
});

test("lit artifact guard can recover a non-zero Pi exit when fresh lit artifacts identify the slug", () => {
	const root = makeWorkspace();
	const startedAtMs = Date.now() - 1000;
	writeFileSync(
		join(root, "outputs", ".plans", "stability-review.manifest.json"),
		JSON.stringify({
			workflow: "lit",
			slug: "stability-review",
			mode: "deep",
			requiredArtifacts: ["outputs/stability-review.md", "outputs/stability-review.provenance.md"],
			currentStage: "synthesize",
			status: "running",
		}),
		"utf8",
	);

	const result = runLitArtifactGuard({
		command: "lit",
		rest: ["power"],
		workingDir: root,
		exitCode: 1,
		startedAtMs,
		writeBlockedArtifacts: false,
	});

	assert.equal(result.checked, true);
	assert.equal(result.ok, false);
	assert.equal(result.recoverable, true);
	assert.equal(result.slug, "stability-review");
	assert.match(result.message ?? "", /Pi exited non-zero/);
	assert.equal(result.blockedOutputPath, undefined);
});

test("lit artifact guard treats stale final artifacts as missing for the current run", () => {
	const root = makeWorkspace();
	const startedAtMs = Date.now() - 1000;
	const manifestPath = join(root, "outputs", ".plans", "stability-review.manifest.json");
	writeFileSync(
		manifestPath,
		JSON.stringify({
			workflow: "lit",
			slug: "stability-review",
			mode: "deep",
			requiredArtifacts: ["outputs/stability-review.md", "outputs/stability-review.provenance.md"],
			currentStage: "synthesize",
			status: "running",
		}),
		"utf8",
	);
	const outputPath = join(root, "outputs", "stability-review.md");
	const provenancePath = join(root, "outputs", "stability-review.provenance.md");
	writeFileSync(outputPath, "# stale final\n", "utf8");
	writeFileSync(provenancePath, "# stale provenance\n", "utf8");
	const oldDate = new Date("2020-01-01T00:00:00Z");
	utimesSync(outputPath, oldDate, oldDate);
	utimesSync(provenancePath, oldDate, oldDate);

	const result = runLitArtifactGuard({
		command: "lit",
		rest: ["power"],
		workingDir: root,
		exitCode: 0,
		startedAtMs,
		writeBlockedArtifacts: false,
	});

	assert.equal(result.ok, false);
	assert.equal(result.recoverable, true);
	assert.deepEqual(result.missing?.map((path) => path.endsWith("stability-review.md") || path.endsWith("stability-review.provenance.md")), [true, true]);
});

test("buildLitArtifactRecoveryPrompt instructs a full required-artifact recovery pass from existing artifacts", () => {
	const prompt = buildLitArtifactRecoveryPrompt({
		command: "lit",
		checked: true,
		ok: false,
		recoverable: true,
		slug: "stability-review",
		missing: [
			"/repo/outputs/stability-review.md",
			"/repo/outputs/stability-review.provenance.md",
			"/repo/outputs/.drafts/stability-review-method-comparison.md",
		],
		manifestPath: "/repo/outputs/.plans/stability-review.manifest.json",
	});

	assert.match(prompt, /Recover incomplete \/lit run/i);
	assert.match(prompt, /Do not restart broad research/i);
	assert.match(prompt, /Write every missing artifact listed below/i);
	assert.match(prompt, /Do not treat embedded sections in another file as satisfying a missing standalone required artifact/i);
	assert.match(prompt, /Write the final literature review to `outputs\/<slug>\.md`/i);
	assert.match(prompt, /Write the provenance sidecar to `outputs\/<slug>\.provenance\.md`/i);
	assert.match(prompt, /method-comparison\.md` is missing, create it as a standalone method comparison artifact/i);
	assert.match(prompt, /Do not answer with a plan/i);
});

test("lit artifact guard can infer a non-ASCII topic slug from latest plan when manifest is missing", () => {
	const root = makeWorkspace();
	writeFileSync(join(root, "outputs", ".plans", "pe-systems-small-signal-stability.md"), "# plan\n", "utf8");
	writeFileSync(join(root, "outputs", ".drafts", "pe-systems-small-signal-stability-evidence-matrix.md"), "# matrix\n", "utf8");

	const result = runLitArtifactGuard({
		command: "lit",
		rest: ["电力电子化系统小干扰稳定分析方法", "--deep"],
		workingDir: root,
		exitCode: 0,
	});

	assert.equal(result.ok, false);
	assert.equal(result.slug, "pe-systems-small-signal-stability");
	assert.equal(existsSync(join(root, "outputs", "pe-systems-small-signal-stability.blocked.md")), true);
});

test("lit artifact guard does not infer slug from stale plans before the workflow start", () => {
	const root = makeWorkspace();
	const planPath = join(root, "outputs", ".plans", "old-review.md");
	writeFileSync(planPath, "# old\n", "utf8");
	const oldDate = new Date("2020-01-01T00:00:00Z");
	utimesSync(planPath, oldDate, oldDate);

	const result = runLitArtifactGuard({
		command: "lit",
		rest: ["电力电子化系统小干扰稳定分析方法", "--deep"],
		workingDir: root,
		exitCode: 0,
		startedAtMs: Date.now(),
	});

	assert.equal(result.ok, false);
	assert.equal(result.message, "Unable to determine a valid lit slug for final artifact verification.");
	assert.equal(existsSync(join(root, "outputs", "old-review.blocked.md")), false);
});

test("lit artifact guard skips non-lit commands and non-zero Pi exits", () => {
	const root = makeWorkspace();

	assert.deepEqual(runLitArtifactGuard({ command: "chat", rest: ["hello"], workingDir: root, exitCode: 0 }), {
		command: "other",
		checked: false,
		ok: true,
	});

	const failed = runLitArtifactGuard({ command: "lit", rest: [], workingDir: root, exitCode: 1 });
	assert.equal(failed.checked, true);
	assert.equal(failed.ok, false);
	assert.match(failed.message ?? "", /Pi exited non-zero/);
});
