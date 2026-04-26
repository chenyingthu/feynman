import test from "node:test";
import assert from "node:assert/strict";

import { patchPiWebAccessSource } from "../scripts/lib/pi-web-access-patch.mjs";

test("patchPiWebAccessSource rewrites legacy Pi web-search config paths", () => {
	const input = [
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		'const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("perplexity.ts", input);

	assert.match(patched, /FEYNMAN_WEB_SEARCH_CONFIG/);
	assert.match(patched, /PI_WEB_SEARCH_CONFIG/);
});

test("patchPiWebAccessSource updates index.ts directory handling", () => {
	const input = [
		'import { existsSync, mkdirSync } from "node:fs";',
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		'const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		'const dir = join(homedir(), ".pi");',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /import \{ dirname, join \} from "node:path";/);
	assert.match(patched, /const dir = dirname\(WEB_SEARCH_CONFIG_PATH\);/);
});

test("patchPiWebAccessSource defaults workflow to none for index.ts without disabling explicit summary-review", () => {
	const input = [
		'function resolveWorkflow(input: unknown, hasUI: boolean): WebSearchWorkflow {',
		'\tif (!hasUI) return "none";',
		'\tif (typeof input === "string" && input.trim().toLowerCase() === "none") return "none";',
		'\treturn "summary-review";',
		'}',
		'const configWorkflow = loadConfigForExtensionInit().workflow;',
		'const workflow = resolveWorkflow(params.workflow ?? configWorkflow, ctx?.hasUI !== false);',
		'workflow: Type.Optional(',
		'\tStringEnum(["none", "summary-review"], {',
		'\t\tdescription: "Search workflow mode: none = no curator, summary-review = open curator with auto summary draft (default)",',
		'\t}),',
		'),',
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /params\.workflow \?\? configWorkflow \?\? "none"/);
	assert.match(patched, /return "summary-review";/);
	assert.match(patched, /summary-review = open curator with auto summary draft \(opt-in\)/);
});

test("patchPiWebAccessSource falls back to url when urls is an empty array", () => {
	const input = "const urlList = params.urls ?? (params.url ? [params.url] : []);\n";

	const patched = patchPiWebAccessSource("index.ts", input);

	assert.match(patched, /params\.urls\?\.length \? params\.urls : \(params\.url \? \[params\.url\] : \[\]\)/);
	assert.doesNotMatch(patched, /params\.urls \?\?/);
});

test("patchPiWebAccessSource prevents frames from hijacking normal URLs", () => {
	const input = [
		"function safeVideoInfo(url: string): { info: ReturnType<typeof isVideoFile>; error?: string } {",
		"\treturn { info: isVideoFile(url) };",
		"}",
		"export async function extractContent(url: string, signal?: AbortSignal, options?: ExtractOptions) {",
		"\tif (options?.frames && !options.timestamp) {",
		"\t\treturn { url, title: \"\", content: \"\", error: \"Frame extraction only works with YouTube and local video files\" };",
		"\t}",
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("extract.ts", input);

	assert.match(patched, /function shouldExtractFrames\(url: string, frames: unknown, timestamp\?: string\): frames is number/);
	assert.match(patched, /if \(shouldExtractFrames\(url, options\?\.frames, options\?\.timestamp\)\) \{/);
	assert.doesNotMatch(patched, /if \(options\?\.frames && !options\.timestamp\) \{/);
});

test("patchPiWebAccessSource adds Promise.try compatibility for PDF extraction", () => {
	const input = [
		'import { getDocumentProxy } from "unpdf";',
		"const DEFAULT_MAX_PAGES = 100;",
		"export async function extractPDFToMarkdown(buffer: ArrayBuffer) {",
		"  const pdf = await getDocumentProxy(new Uint8Array(buffer));",
		"  return pdf;",
		"}",
		"",
	].join("\n");

	const patched = patchPiWebAccessSource("pdf-extract.ts", input);

	assert.match(patched, /function ensurePromiseTryCompat\(\): void/);
	assert.match(patched, /promiseCtor\.try = <T>\(fn: \(\) => T \| PromiseLike<T>\) => Promise\.resolve\(\)\.then\(fn\);/);
	assert.match(patched, /ensurePromiseTryCompat\(\);\n\n  const \{ getDocumentProxy \} = await import\("unpdf"\);/);
	assert.doesNotMatch(patched, /import \{ getDocumentProxy \} from "unpdf";/);
});

test("patchPiWebAccessSource is idempotent", () => {
	const input = [
		'import { join } from "node:path";',
		'import { homedir } from "node:os";',
		'const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");',
		"",
	].join("\n");

	const once = patchPiWebAccessSource("perplexity.ts", input);
	const twice = patchPiWebAccessSource("perplexity.ts", once);

	assert.equal(twice, once);
});
