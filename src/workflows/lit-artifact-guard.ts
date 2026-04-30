import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export type LitArtifactManifest = {
	slug?: string;
	mode?: string;
	requiredArtifacts?: string[];
	currentStage?: string;
	status?: string;
};

export type LitArtifactGuardResult = {
	command: "lit" | "other";
	checked: boolean;
	ok: boolean;
	recoverable?: boolean;
	slug?: string;
	manifestPath?: string;
	missing?: string[];
	blockedOutputPath?: string;
	blockedProvenancePath?: string;
	message?: string;
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;

function isLitCommand(command: string | undefined): command is "lit" {
	return command === "lit";
}

export function deriveSlugFromTopicParts(parts: string[]): string | undefined {
	const text = parts
		.join(" ")
		.replace(/--[a-z0-9-]+(?:=\S+)?/gi, " ")
		.toLowerCase();
	const asciiWords = text.match(/[a-z0-9]+/g) ?? [];
	if (asciiWords.length > 0) {
		return asciiWords.slice(0, 5).join("-");
	}
	return undefined;
}

function readManifest(path: string): LitArtifactManifest | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		return JSON.parse(readFileSync(path, "utf8")) as LitArtifactManifest;
	} catch {
		return undefined;
	}
}

function isRecentEnough(path: string, minMtimeMs: number | undefined): boolean {
	return minMtimeMs === undefined || statSync(path).mtimeMs >= minMtimeMs;
}

function isPresentAndRecentEnough(path: string, minMtimeMs: number | undefined): boolean {
	return existsSync(path) && isRecentEnough(path, minMtimeMs);
}

function discoverManifest(
	workingDir: string,
	expectedSlug: string | undefined,
	minMtimeMs: number | undefined,
): { path?: string; manifest?: LitArtifactManifest } {
	if (expectedSlug) {
		const expectedPath = join(workingDir, "outputs", ".plans", `${expectedSlug}.manifest.json`);
		const expected = existsSync(expectedPath) && isRecentEnough(expectedPath, minMtimeMs) ? readManifest(expectedPath) : undefined;
		if (expected) {
			return { path: expectedPath, manifest: expected };
		}
	}

	const plansDir = join(workingDir, "outputs", ".plans");
	try {
		const candidates = readdirSync(plansDir)
			.filter((name) => name.endsWith(".manifest.json"))
			.map((name) => join(plansDir, name))
			.filter((path) => isRecentEnough(path, minMtimeMs))
			.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
		for (const candidate of candidates) {
			const manifest = readManifest(candidate);
			if (manifest?.slug) {
				return { path: candidate, manifest };
			}
		}
	} catch {
		// Missing outputs/.plans is handled by the fallback below.
	}
	return {};
}

function discoverPlanSlug(workingDir: string, minMtimeMs: number | undefined): string | undefined {
	const plansDir = join(workingDir, "outputs", ".plans");
	try {
		const candidates = readdirSync(plansDir)
			.filter((name) => name.endsWith(".md"))
			.map((name) => join(plansDir, name))
			.filter((path) => isRecentEnough(path, minMtimeMs))
			.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
		for (const candidate of candidates) {
			const slug = basename(candidate, ".md");
			if (SLUG_PATTERN.test(slug)) {
				return slug;
			}
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function normalizeRequiredArtifacts(workingDir: string, manifest: LitArtifactManifest, slug: string): string[] {
	const fromManifest = Array.isArray(manifest.requiredArtifacts) ? manifest.requiredArtifacts : [];
	const required = fromManifest.length > 0 ? fromManifest : [`outputs/${slug}.md`, `outputs/${slug}.provenance.md`];
	return Array.from(new Set(required.map((artifact) => resolve(workingDir, artifact))));
}

function writeBlockedArtifacts(options: {
	workingDir: string;
	slug: string;
	missing: string[];
	manifestPath?: string;
	manifest?: LitArtifactManifest;
}): { outputPath: string; provenancePath: string } {
	const outputsDir = join(options.workingDir, "outputs");
	mkdirSync(outputsDir, { recursive: true });
	const outputPath = join(outputsDir, `${options.slug}.blocked.md`);
	const provenancePath = join(outputsDir, `${options.slug}.blocked.provenance.md`);
	const missingRelative = options.missing.map((path) => path.replace(`${options.workingDir}/`, ""));
	const now = new Date().toISOString();
	writeFileSync(
		outputPath,
		[
			`# BLOCKED Literature Review: ${options.slug}`,
			"",
			"Feynman stopped before producing the required final literature-review artifact.",
			"",
			"## Missing Required Artifacts",
			...missingRelative.map((path) => `- ${path}`),
			"",
			"## Existing Recovery Context",
			`- Manifest: ${options.manifestPath ? options.manifestPath.replace(`${options.workingDir}/`, "") : "not found or unreadable"}`,
			`- Last recorded stage: ${options.manifest?.currentStage ?? "unknown"}`,
			`- Manifest status: ${options.manifest?.status ?? "unknown"}`,
			"",
			"Resume by reading the plan, taxonomy, evidence matrix, and method comparison, then write the final report and provenance sidecar.",
			"",
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		provenancePath,
		[
			`# Provenance — BLOCKED ${options.slug}`,
			"",
			`Date: ${now}`,
			"Workflow: lit",
			"Quality-gate status: BLOCKED",
			`Manifest: ${options.manifestPath ? options.manifestPath.replace(`${options.workingDir}/`, "") : "not found or unreadable"}`,
			`Last recorded stage: ${options.manifest?.currentStage ?? "unknown"}`,
			"",
			"Missing artifacts:",
			...missingRelative.map((path) => `- ${path}`),
			"",
			"Verification status: final artifact guard failed after Pi exited.",
			"",
		].join("\n"),
		"utf8",
	);
	return { outputPath, provenancePath };
}

export function runLitArtifactGuard(options: {
	command: string | undefined;
	rest: string[];
	workingDir: string;
	exitCode?: number | string | null;
	startedAtMs?: number;
	writeBlockedArtifacts?: boolean;
}): LitArtifactGuardResult {
	if (!isLitCommand(options.command)) {
		return { command: "other", checked: false, ok: true };
	}
	const piExitedNonZero = (options.exitCode ?? 0) !== 0;

	const expectedSlug = deriveSlugFromTopicParts(options.rest);
	const discovered = discoverManifest(options.workingDir, expectedSlug, options.startedAtMs);
	const manifest = discovered.manifest;
	const slug = manifest?.slug ?? expectedSlug ?? discoverPlanSlug(options.workingDir, options.startedAtMs);
	if (!slug || !SLUG_PATTERN.test(slug)) {
		return {
			command: "lit",
			checked: true,
			ok: false,
			message: piExitedNonZero
				? "Pi exited non-zero and the lit artifact guard could not determine a valid slug for final artifact verification."
				: "Unable to determine a valid lit slug for final artifact verification.",
		};
	}

	const required = normalizeRequiredArtifacts(options.workingDir, manifest ?? {}, slug);
	const missing = required.filter((artifact) => !isPresentAndRecentEnough(artifact, options.startedAtMs));
	if (missing.length === 0) {
		return { command: "lit", checked: true, ok: true, slug, manifestPath: discovered.path };
	}

	if (options.writeBlockedArtifacts === false) {
		return {
			command: "lit",
			checked: true,
			ok: false,
			recoverable: true,
			slug,
			manifestPath: discovered.path,
			missing,
			message: piExitedNonZero
				? `Pi exited non-zero and the literature review did not produce required final artifacts for ${basename(slug)}.`
				: `Literature review did not produce required final artifacts for ${basename(slug)}.`,
		};
	}

	const blocked = writeBlockedArtifacts({
		workingDir: options.workingDir,
		slug,
		missing,
		manifestPath: discovered.path,
		manifest,
	});
	return {
		command: "lit",
		checked: true,
		ok: false,
		recoverable: true,
		slug,
		manifestPath: discovered.path,
		missing,
		blockedOutputPath: blocked.outputPath,
		blockedProvenancePath: blocked.provenancePath,
		message: piExitedNonZero
			? `Pi exited non-zero and the literature review did not produce required final artifacts for ${basename(slug)}.`
			: `Literature review did not produce required final artifacts for ${basename(slug)}.`,
	};
}

export function buildLitArtifactRecoveryPrompt(result: LitArtifactGuardResult): string {
	if (result.command !== "lit" || !result.slug || !result.missing || result.missing.length === 0) {
		throw new Error("Cannot build lit artifact recovery prompt without a lit slug and missing artifacts.");
	}
	const manifestLine = result.manifestPath ? `- Manifest: ${result.manifestPath}` : "- Manifest: not found or unreadable";
	const missingLines = result.missing.map((path) => `- ${path}`).join("\n");
	return [
		`Recover incomplete /lit run for slug \`${result.slug}\`.`,
		"",
		"The previous run stopped before satisfying the durable /lit artifact contract. Do not restart broad research unless an existing artifact is unreadable. Use the durable files already on disk as source material.",
		"",
		"Required action:",
		`- Read the plan, taxonomy, evidence matrix, method comparison, candidate pool, and researcher notes for slug \`${result.slug}\` when they exist.`,
		"- Write every missing artifact listed below. Do not treat embedded sections in another file as satisfying a missing standalone required artifact.",
		"- Write the final literature review to `outputs/<slug>.md`.",
		"- Write the provenance sidecar to `outputs/<slug>.provenance.md`.",
		"- If `outputs/.drafts/<slug>-method-comparison.md` is missing, create it as a standalone method comparison artifact from the evidence matrix and final draft.",
		"- If the evidence is insufficient for a full review, label the final report `PARTIAL` or `BLOCKED`, but still write all required files.",
		"- Include a References section covering accepted evidence-matrix sources that are marked for final references.",
		"- Update `outputs/.plans/<slug>.manifest.json` to `status: \"done\"` and `currentStage: \"deliver\"` if that manifest exists or can be created safely.",
		"",
		"Missing or stale artifacts detected by the guard:",
		missingLines,
		"",
		manifestLine,
		"",
		"Do not answer with a plan. The next visible result must be durable file writes followed by a brief completion note.",
	].join("\n");
}
