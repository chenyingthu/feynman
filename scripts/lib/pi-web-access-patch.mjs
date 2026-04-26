export const PI_WEB_ACCESS_PATCH_TARGETS = [
	"index.ts",
	"exa.ts",
	"extract.ts",
	"pdf-extract.ts",
	"gemini-api.ts",
	"gemini-search.ts",
	"gemini-web.ts",
	"github-extract.ts",
	"perplexity.ts",
	"video-extract.ts",
	"youtube-extract.ts",
];

const LEGACY_CONFIG_EXPR = 'join(homedir(), ".pi", "web-search.json")';
const PATCHED_CONFIG_EXPR =
	'process.env.FEYNMAN_WEB_SEARCH_CONFIG ?? process.env.PI_WEB_SEARCH_CONFIG ?? join(homedir(), ".pi", "web-search.json")';

export function patchPiWebAccessSource(relativePath, source) {
	let patched = source;
	let changed = false;

	if (!patched.includes(PATCHED_CONFIG_EXPR)) {
		patched = patched.split(LEGACY_CONFIG_EXPR).join(PATCHED_CONFIG_EXPR);
		changed = patched !== source;
	}

	if (relativePath === "index.ts") {
		const workflowDefaultOriginal = 'const workflow = resolveWorkflow(params.workflow ?? configWorkflow, ctx?.hasUI !== false);';
		const workflowDefaultPatched = 'const workflow = resolveWorkflow(params.workflow ?? configWorkflow ?? "none", ctx?.hasUI !== false);';
		if (patched.includes(workflowDefaultOriginal)) {
			patched = patched.replace(workflowDefaultOriginal, workflowDefaultPatched);
			changed = true;
		}
		if (patched.includes('summary-review = open curator with auto summary draft (default)')) {
			patched = patched.replace(
				'summary-review = open curator with auto summary draft (default)',
				'summary-review = open curator with auto summary draft (opt-in)',
			);
			changed = true;
		}
		const urlListOriginal = "const urlList = params.urls ?? (params.url ? [params.url] : []);";
		const urlListPatched = "const urlList = params.urls?.length ? params.urls : (params.url ? [params.url] : []);";
		if (patched.includes(urlListOriginal)) {
			patched = patched.replace(urlListOriginal, urlListPatched);
			changed = true;
		}
	}

	if (relativePath === "index.ts" && changed) {
		patched = patched.replace('import { join } from "node:path";', 'import { dirname, join } from "node:path";');
		patched = patched.replace('const dir = join(homedir(), ".pi");', "const dir = dirname(WEB_SEARCH_CONFIG_PATH);");
	}

	if (relativePath === "extract.ts") {
		const helper = [
			"function shouldExtractFrames(url: string, frames: unknown, timestamp?: string): frames is number {",
			'\tif (timestamp || typeof frames !== "number" || !Number.isInteger(frames) || frames <= 0) return false;',
			"\tconst ytInfo = isYouTubeURL(url);",
			"\tif (ytInfo.isYouTube && ytInfo.videoId) return true;",
			"\tconst localVideo = safeVideoInfo(url);",
			"\treturn !!localVideo.info;",
			"}",
		].join("\n");
		if (!patched.includes("function shouldExtractFrames(")) {
			patched = patched.replace(
				"function safeVideoInfo(url: string): { info: ReturnType<typeof isVideoFile>; error?: string } {",
				`${helper}\n\nfunction safeVideoInfo(url: string): { info: ReturnType<typeof isVideoFile>; error?: string } {`,
			);
		}
		const before = "if (options?.frames && !options.timestamp) {";
		const after = "if (shouldExtractFrames(url, options?.frames, options?.timestamp)) {";
		if (patched.includes(before)) {
			patched = patched.replace(before, after);
			changed = true;
		}
	}

	if (relativePath === "pdf-extract.ts" && !patched.includes("function ensurePromiseTryCompat()")) {
		patched = patched.replace('import { getDocumentProxy } from "unpdf";\n', "");
		const polyfill = [
			"function ensurePromiseTryCompat(): void {",
			'\tconst promiseCtor = Promise as typeof Promise & { try?: <T>(fn: () => T | PromiseLike<T>) => Promise<T> };',
			"\tif (typeof promiseCtor.try === \"function\") return;",
			"\tpromiseCtor.try = <T>(fn: () => T | PromiseLike<T>) => Promise.resolve().then(fn);",
			"}",
			"",
		].join("\n");
		patched = patched.replace(
			'const DEFAULT_MAX_PAGES = 100;',
			`${polyfill}const DEFAULT_MAX_PAGES = 100;`,
		);
		patched = patched.replace(
			"  const pdf = await getDocumentProxy(new Uint8Array(buffer));",
			'  ensurePromiseTryCompat();\n\n  const { getDocumentProxy } = await import("unpdf");\n  const pdf = await getDocumentProxy(new Uint8Array(buffer));',
		);
		changed = true;
	}

	return patched;
}
