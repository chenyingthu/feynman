import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { relative, resolve } from "node:path";

import { loadResearchApiConfig, lookupUnpaywallDoi, type ResearchApiConfig, type ResearchApiFetch } from "./apis.js";
import { resolveExecutable, BROWSER_FALLBACK_PATHS } from "../system/executables.js";

export type FullTextFetchCandidate = {
	id: string;
	title: string;
	doi?: string;
	url?: string;
	oaPdfUrl?: string;
	qualityHint?: string;
};

export type FullTextFetchResult = {
	slug: string;
	candidatesPath: string;
	pdfDir: string;
	logPath: string;
	extractsPath: string;
	browserQueuePath: string;
	downloaded: Array<{ candidate: FullTextFetchCandidate; path: string; bytes: number; textChars: number }>;
	automaticQueue: Array<{ candidate: FullTextFetchCandidate; reason: string; url?: string }>;
	queued: Array<{ candidate: FullTextFetchCandidate; reason: string; url?: string }>;
	warnings: string[];
};

export type FullTextImportedPdf = {
	candidate: FullTextFetchCandidate;
	path: string;
	bytes: number;
	textChars: number;
};

type FullTextFetchOptions = {
	limit?: number;
	delayMs?: number;
	timeoutMs?: number;
	assistedBrowser?: boolean;
	dryRun?: boolean;
	config?: ResearchApiConfig;
	fetch?: ResearchApiFetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => Date;
};

const DEFAULT_FULLTEXT_LIMIT = 12;
const DEFAULT_FETCH_DELAY_MS = 30_000;
const DEFAULT_PDF_TIMEOUT_MS = 60_000;
const MAX_PDF_BYTES = 80 * 1024 * 1024;

type PdfFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

async function directPdfFetch(input: string | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? new URL(input) : input;
	const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
	const headers = new Headers(init?.headers);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), DEFAULT_PDF_TIMEOUT_MS);
	init?.signal?.addEventListener("abort", () => controller.abort(), { once: true });

	return new Promise<Response>((resolvePromise, rejectPromise) => {
		const request = requestImpl(url, {
			method: init?.method ?? "GET",
			headers: Object.fromEntries(headers.entries()),
			agent: false,
			signal: controller.signal,
		}, (incoming) => {
			const chunks: Buffer[] = [];
			incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
			incoming.on("end", () => {
				clearTimeout(timeout);
				resolvePromise(new Response(Buffer.concat(chunks), {
					status: incoming.statusCode ?? 0,
					statusText: incoming.statusMessage,
					headers: incoming.headers as HeadersInit,
				}));
			});
		});
		request.on("error", (error) => {
			clearTimeout(timeout);
			rejectPromise(error);
		});
		request.end();
	});
}

function splitMarkdownRow(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function cleanMarkdownCell(value: string): string {
	return value.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

function normalizeDoi(value: string | undefined): string | undefined {
	const raw = value?.trim();
	if (!raw || /^[-—]+$/.test(raw) || raw.toLowerCase() === "n/a") return undefined;
	if (/^https?:\/\//i.test(raw) && !/^https?:\/\/(?:dx\.)?doi\.org\//i.test(raw)) return undefined;
	const doi = raw
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
		.replace(/^doi:\s*/i, "")
		.trim()
		.toLowerCase();
	return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : undefined;
}

function normalizeArxivId(value: string | undefined): string | undefined {
	const raw = value?.trim();
	if (!raw || /^[-—]+$/.test(raw) || raw.toLowerCase() === "n/a") return undefined;
	const cleaned = raw
		.replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
		.replace(/^arxiv:/i, "")
		.replace(/\.pdf$/i, "")
		.trim();
	return /^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(cleaned) || /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$/i.test(cleaned)
		? cleaned
		: undefined;
}

function normalizeUrl(value: string | undefined): string | undefined {
	const raw = value?.trim();
	if (!raw || /^—+$/.test(raw) || raw.toLowerCase() === "n/a") return undefined;
	if (/^https?:\/\//i.test(raw)) return raw;
	const arxivId = normalizeArxivId(raw);
	if (arxivId) return `https://arxiv.org/pdf/${arxivId}`;
	const doi = normalizeDoi(raw);
	return doi ? `https://doi.org/${doi}` : undefined;
}

function looksLikePdfUrl(value: string | undefined): boolean {
	if (!value) return false;
	try {
		const url = new URL(value);
		return /\.pdf$/i.test(url.pathname) || /\/pdf(?:\/|$)/i.test(url.pathname);
	} catch {
		return /\.pdf(?:[?#].*)?$/i.test(value);
	}
}

export function sanitizeFullTextFilename(value: string): string {
	const ascii = value
		.toLowerCase()
		.replace(/https?:\/\//g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return ascii || "paper";
}

export function isProbablyPdf(buffer: Uint8Array, contentType: string | null): boolean {
	void contentType;
	const header = Buffer.from(buffer.slice(0, 8)).toString("utf8");
	return header.startsWith("%PDF-");
}

function hasPdfHeader(buffer: Uint8Array): boolean {
	const header = Buffer.from(buffer.slice(0, 8)).toString("utf8");
	return header.startsWith("%PDF-");
}

export function extractPdfText(pdfPath: string): string {
	try {
		return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
			encoding: "utf8",
			maxBuffer: 20 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		const raw = readFileSync(pdfPath);
		return raw
			.toString("latin1")
			.replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 30_000);
	}
}

export function excerptFullTextSections(text: string): string {
	const normalized = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
	const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
	const head = lines.slice(0, 80).join("\n");
	const lower = lines.map((line) => line.toLowerCase());
	const wanted = ["abstract", "introduction", "method", "methodology", "conclusion", "discussion", "limitations"];
	const sections: string[] = [];
	for (const label of wanted) {
		const index = lower.findIndex((line) => line === label || line.startsWith(`${label} `) || line.startsWith(`${label}.`));
		if (index >= 0) {
			sections.push(`## ${label}\n${lines.slice(index, index + 35).join("\n")}`);
		}
	}
	return [`## Leading Text\n${head}`, ...sections].join("\n\n").slice(0, 20_000);
}

export function parseCandidatePoolMarkdown(markdown: string): FullTextFetchCandidate[] {
	const candidates = new Map<string, FullTextFetchCandidate>();
	let currentHeader: string[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const cells = splitMarkdownRow(line);
		if (cells.length < 2) continue;
		if (cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))) continue;
		const cleaned = cells.map(cleanMarkdownCell);
		const lowered = cleaned.map((cell) => cell.toLowerCase());
		if (lowered.includes("id") && lowered.includes("title")) {
			currentHeader = lowered;
			continue;
		}
		const idIndex = currentHeader.indexOf("id") >= 0 ? currentHeader.indexOf("id") : 0;
		const titleIndex = currentHeader.indexOf("title") >= 0 ? currentHeader.indexOf("title") : (cleaned.length >= 10 ? 3 : 1);
		const doiIndex = currentHeader.indexOf("doi");
		const urlIndex = currentHeader.indexOf("url");
		const doiUrlIndex = currentHeader.indexOf("doi/url");
		const qualityIndex = currentHeader.indexOf("quality hint");
		const id = cleaned[idIndex] ?? "";
		const title = cleaned[titleIndex] ?? "";
		if (!/^[A-Z]{0,4}\d+$/i.test(id) || !title || /^id$/i.test(id)) continue;
		const doiOrUrl = doiUrlIndex >= 0 ? cleaned[doiUrlIndex] : undefined;
		const doi = doiIndex >= 0 ? normalizeDoi(cleaned[doiIndex]) : normalizeDoi(doiOrUrl);
		const urlValue = urlIndex >= 0 ? cleaned[urlIndex] : doiOrUrl;
		const arxivId = normalizeArxivId(urlValue);
		const url = normalizeUrl(urlValue);
		const qualityHint = qualityIndex >= 0 ? cleaned[qualityIndex] : undefined;
		const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : looksLikePdfUrl(url) ? url : undefined;
		candidates.set(id, {
			id,
			title,
			doi,
			url,
			oaPdfUrl: pdfUrl,
			qualityHint: qualityHint || undefined,
		});
	}
	for (const line of markdown.split(/\r?\n/)) {
		const match = line.match(/^- ([A-Z]{0,4}\d+):\s+(\S+|no URL)(?:\s+\(OA PDF:\s+([^)]+)\))?/i);
		if (!match) continue;
		const [, id, url, oaPdfUrl] = match;
		const existing = candidates.get(id);
		if (!existing) continue;
		const normalizedUrl = normalizeUrl(url);
		if (normalizedUrl) existing.url = normalizedUrl;
		if (oaPdfUrl) existing.oaPdfUrl = oaPdfUrl.trim();
	}
	for (const line of markdown.split(/\r?\n/)) {
		const match = line.match(/^- ([A-Z]{0,4}\d+):.*?DOI landing:\s+https?:\/\/doi\.org\/([^\s|]+)/i);
		if (!match) continue;
		const existing = candidates.get(match[1]);
		if (existing && !existing.doi) existing.doi = normalizeDoi(match[2]);
		if (existing && !existing.url && existing.doi) existing.url = `https://doi.org/${existing.doi}`;
	}
	return Array.from(candidates.values());
}

function selectCandidates(candidates: FullTextFetchCandidate[], limit: number): FullTextFetchCandidate[] {
	return [...candidates]
		.sort((left, right) => {
			const leftPdf = left.oaPdfUrl ? 1 : 0;
			const rightPdf = right.oaPdfUrl ? 1 : 0;
			if (leftPdf !== rightPdf) return rightPdf - leftPdf;
			const leftIndex = Number(left.id.replace(/\D/g, ""));
			const rightIndex = Number(right.id.replace(/\D/g, ""));
			if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex) && leftIndex !== rightIndex) {
				return leftIndex - rightIndex;
			}
			return left.id.localeCompare(right.id);
		})
		.slice(0, limit);
}

async function enrichCandidatesWithUnpaywall(
	candidates: FullTextFetchCandidate[],
	config: ResearchApiConfig,
	fetchImpl?: ResearchApiFetch,
): Promise<string[]> {
	const warnings: string[] = [];
	if (!config.unpaywallEmail) return warnings;
	for (const candidate of candidates) {
		if (candidate.oaPdfUrl || !candidate.doi) continue;
		try {
			const payload = await lookupUnpaywallDoi(candidate.doi, { config, fetch: fetchImpl });
			const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
			const best = record.best_oa_location && typeof record.best_oa_location === "object"
				? record.best_oa_location as Record<string, unknown>
				: {};
			const pdf = typeof best.url_for_pdf === "string" ? best.url_for_pdf.trim() : undefined;
			const landing = typeof best.url_for_landing_page === "string" ? best.url_for_landing_page.trim() : undefined;
			candidate.oaPdfUrl = pdf || candidate.oaPdfUrl;
			candidate.url = landing || candidate.url;
		} catch (error) {
			warnings.push(`${candidate.id}: Unpaywall lookup failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return warnings;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutPromise = new Promise<never>((_, rejectPromise) => {
			timeout = setTimeout(() => rejectPromise(new Error(message)), timeoutMs);
		});
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function downloadPdf(candidate: FullTextFetchCandidate, pdfUrl: string, outputPath: string, fetchImpl: PdfFetch, timeoutMs: number): Promise<number> {
	const controller = new AbortController();
	try {
		const response = await withTimeout(fetchImpl(pdfUrl, {
			headers: {
				"user-agent": "Feynman fulltext-fetch/0.1 (+assisted academic review; respectful rate limited)",
				accept: "application/pdf,*/*;q=0.8",
			},
			signal: controller.signal,
		}), timeoutMs, `${candidate.id}: PDF request timed out after ${timeoutMs}ms`);
		if (!response.ok) {
			throw new Error(`${candidate.id}: PDF request failed ${response.status}`);
		}
		const contentLength = Number(response.headers.get("content-length") ?? "0");
		if (contentLength > MAX_PDF_BYTES) {
			throw new Error(`${candidate.id}: PDF too large (${contentLength} bytes)`);
		}
		const arrayBuffer = await withTimeout(response.arrayBuffer(), timeoutMs, `${candidate.id}: PDF body timed out after ${timeoutMs}ms`);
		const bytes = new Uint8Array(arrayBuffer);
		if (bytes.byteLength > MAX_PDF_BYTES) {
			throw new Error(`${candidate.id}: PDF too large (${bytes.byteLength} bytes)`);
		}
		if (!isProbablyPdf(bytes, response.headers.get("content-type"))) {
			throw new Error(`${candidate.id}: response is not a PDF`);
		}
		writeFileSync(outputPath, bytes);
		return bytes.byteLength;
	} finally {
		controller.abort();
	}
}

function displayPath(path: string, workingDir: string): string {
	const relativePath = relative(workingDir, path);
	return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}

function formatLog(result: FullTextFetchResult, now: Date, workingDir: string): string {
	const lines = [
		`# Full-Text Fetch Log — ${result.slug}`,
		"",
		`Date: ${now.toISOString()}`,
		"",
		"## Summary",
		"",
		`- Downloaded PDFs: ${result.downloaded.length}`,
		`- Automatic OA retry/preview queue: ${result.automaticQueue.length}`,
		`- Browser/manual campus queue: ${result.queued.length}`,
		`- Warnings: ${result.warnings.length}`,
		`- PDF directory: ${displayPath(result.pdfDir, workingDir)}`,
		"",
		"## Downloaded",
		"",
	];
	if (result.downloaded.length === 0) {
		lines.push("- none", "");
	} else {
		for (const item of result.downloaded) {
			lines.push(`- ${item.candidate.id}: ${item.candidate.title} -> ${displayPath(item.path, workingDir)} (${item.bytes} bytes, extracted ${item.textChars} chars)`);
		}
		lines.push("");
	}
	lines.push("## Automatic OA Retry / Preview Queue", "");
	if (result.automaticQueue.length === 0) {
		lines.push("- none", "");
	} else {
		for (const item of result.automaticQueue) {
			lines.push(`- ${item.candidate.id}: ${item.reason}${item.url ? ` — ${item.url}` : ""}`);
		}
		lines.push("");
	}
	lines.push("## Browser / Manual Queue", "");
	if (result.queued.length === 0) {
		lines.push("- none", "");
	} else {
		for (const item of result.queued) {
			lines.push(`- ${item.candidate.id}: ${item.reason}${item.url ? ` — ${item.url}` : ""}`);
		}
		lines.push("");
	}
	if (result.warnings.length > 0) {
		lines.push("## Warnings", "", ...result.warnings.map((warning) => `- ${warning}`), "");
	}
	lines.push(
		"## Policy",
		"",
		"- This command does not bypass paywalls, captchas, SSO, or publisher anti-bot controls.",
		"- Browser-assisted entries are for human-supervised campus-network access only.",
		"- Cite PDFs as read only after successful download and extraction.",
		"",
	);
	return `${lines.join("\n")}\n`;
}

function formatBrowserQueue(result: FullTextFetchResult, now: Date): string {
	const lines = [
		`# Browser-Assisted Campus Full-Text Queue — ${result.slug}`,
		"",
		`Date: ${now.toISOString()}`,
		"",
		"Use this queue only for non-OA items that need slow, human-supervised campus-network access. OA PDFs are handled by automatic fetch/retry, including proxy-capable runs.",
		"",
		"| Candidate ID | Title | Reason | URL |",
		"|---|---|---|---|",
	];
	if (result.queued.length === 0) {
		lines.push("| none | none | no queued items | |");
	} else {
		for (const item of result.queued) {
			lines.push(`| ${item.candidate.id} | ${item.candidate.title.replace(/\|/g, "\\|")} | ${item.reason.replace(/\|/g, "\\|")} | ${item.url ?? ""} |`);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

function formatExtractedPdf(candidate: FullTextFetchCandidate, pdfPath: string, workingDir: string): string {
	const text = extractPdfText(pdfPath);
	return [
		`# ${candidate.id}: ${candidate.title}`,
		"",
		`- PDF: ${displayPath(pdfPath, workingDir)}`,
		`- DOI: ${candidate.doi ?? "unknown"}`,
		`- Source URL: ${candidate.oaPdfUrl ?? candidate.url ?? "unknown"}`,
		`- Source quality upgrade: full-text-sampled`,
		"",
		excerptFullTextSections(text),
		"",
		"---",
		"",
	].join("\n");
}

function formatExtracts(result: FullTextFetchResult, workingDir: string): string {
	const lines = [`# Full-Text Extracts — ${result.slug}`, ""];
	for (const item of result.downloaded) {
		lines.push(formatExtractedPdf(item.candidate, item.path, workingDir));
	}
	if (result.downloaded.length === 0) {
		lines.push("No PDFs were downloaded in this run.", "");
	}
	return `${lines.join("\n")}\n`;
}

function appendEvidenceMatrixUpdates(evidencePath: string, result: FullTextFetchResult, workingDir: string): void {
	if (result.downloaded.length === 0) return;
	const existing = existsSync(evidencePath)
		? readFileSync(evidencePath, "utf8")
		: [
			"# Evidence Matrix",
			"",
			"Generated from full-text acquisition artifacts. A later literature-review pass should expand these rows with method, task, metric, limitation, confidence, and reference-list decisions.",
			"",
		].join("\n");
	const marker = "\n## Full-Text Fetch Updates\n";
	const base = existing.includes(marker) ? existing.slice(0, existing.indexOf(marker)).trimEnd() : existing.trimEnd();
	const lines = [
		base,
		"",
		"## Full-Text Fetch Updates",
		"",
		"These updates record successfully fetched local PDFs. Treat affected sources as `full-text-sampled` unless a later human/agent pass reads the full paper.",
		"",
		"| Candidate ID | Title | Local PDF | Quality Update |",
		"|---|---|---|---|",
		...result.downloaded.map((item) => `| ${item.candidate.id} | ${item.candidate.title.replace(/\|/g, "\\|")} | ${displayPath(item.path, workingDir)} | full-text-sampled |`),
		"",
	];
	writeFileSync(evidencePath, `${lines.join("\n")}\n`, "utf8");
}

export function getFullTextDraftDir(workingDir: string): string {
	return resolve(workingDir, "outputs", ".drafts");
}

export function getFullTextPdfDir(workingDir: string, slug: string): string {
	return resolve(workingDir, "outputs", ".pdfs", slug);
}

export function readFullTextCandidates(slug: string, workingDir: string, limit = Number.POSITIVE_INFINITY): {
	candidatesPath: string;
	candidates: FullTextFetchCandidate[];
} {
	const draftDir = getFullTextDraftDir(workingDir);
	const candidatesPath = resolve(draftDir, `${slug}-candidate-pool.md`);
	if (!existsSync(candidatesPath)) {
		throw new Error(`Candidate pool not found: ${candidatesPath}`);
	}
	const candidates = selectCandidates(parseCandidatePoolMarkdown(readFileSync(candidatesPath, "utf8")), limit);
	return { candidatesPath, candidates };
}

export function importFullTextPdf(slug: string, workingDir: string, candidate: FullTextFetchCandidate, bytes: Uint8Array, originalFilename?: string): FullTextImportedPdf {
	if (!hasPdfHeader(bytes)) {
		throw new Error(`${candidate.id}: uploaded file is not a PDF`);
	}
	const pdfDir = getFullTextPdfDir(workingDir, slug);
	mkdirSync(pdfDir, { recursive: true });
	const basename = originalFilename && originalFilename.toLowerCase().endsWith(".pdf")
		? sanitizeFullTextFilename(originalFilename.replace(/\.pdf$/i, ""))
		: sanitizeFullTextFilename(candidate.title);
	const outputPath = resolve(pdfDir, `${candidate.id}-${basename}.pdf`);
	writeFileSync(outputPath, bytes);
	const textChars = extractPdfText(outputPath).length;
	return {
		candidate,
		path: outputPath,
		bytes: bytes.byteLength,
		textChars,
	};
}

export function writeFullTextSessionArtifacts(slug: string, workingDir: string, imported: FullTextImportedPdf[], now = new Date()): {
	importsPath: string;
	extractsPath: string;
	evidencePath: string;
} {
	const draftDir = getFullTextDraftDir(workingDir);
	mkdirSync(draftDir, { recursive: true });
	const importsPath = resolve(draftDir, `${slug}-fulltext-session.md`);
	const extractsPath = resolve(draftDir, `${slug}-fulltext-extracts.md`);
	const evidencePath = resolve(draftDir, `${slug}-evidence-matrix.md`);
	const sessionLines = [
		`# Full-Text Acquisition Session — ${slug}`,
		"",
		`Updated: ${now.toISOString()}`,
		"",
		`- Imported PDFs: ${imported.length}`,
		"",
		"| Candidate ID | Title | PDF | Bytes | Extracted Chars |",
		"|---|---|---|---:|---:|",
		...imported.map((item) => `| ${item.candidate.id} | ${item.candidate.title.replace(/\|/g, "\\|")} | ${displayPath(item.path, workingDir)} | ${item.bytes} | ${item.textChars} |`),
		"",
	];
	writeFileSync(importsPath, `${sessionLines.join("\n")}\n`, "utf8");

	const marker = "\n# Full-Text Session Imports\n";
	const existingExtracts = existsSync(extractsPath) ? readFileSync(extractsPath, "utf8") : `# Full-Text Extracts — ${slug}\n`;
	const extractsBase = existingExtracts.includes(marker) ? existingExtracts.slice(0, existingExtracts.indexOf(marker)).trimEnd() : existingExtracts.trimEnd();
	const extractLines = [
		extractsBase,
		"",
		"# Full-Text Session Imports",
		"",
		...imported.map((item) => formatExtractedPdf(item.candidate, item.path, workingDir)),
	];
	writeFileSync(extractsPath, `${extractLines.join("\n")}\n`, "utf8");

	if (imported.length > 0) {
		const existingEvidence = existsSync(evidencePath)
			? readFileSync(evidencePath, "utf8")
			: [
				"# Evidence Matrix",
				"",
				"Generated from full-text acquisition artifacts. A later literature-review pass should expand these rows with method, task, metric, limitation, confidence, and reference-list decisions.",
				"",
			].join("\n");
		const evidenceMarker = "\n## Full-Text Session Imports\n";
		const evidenceBase = existingEvidence.includes(evidenceMarker)
			? existingEvidence.slice(0, existingEvidence.indexOf(evidenceMarker)).trimEnd()
			: existingEvidence.trimEnd();
		const evidenceLines = [
			evidenceBase,
			"",
			"## Full-Text Session Imports",
			"",
			"These rows record user-supplied PDFs acquired through normal browser/campus-network access.",
			"",
			"| Candidate ID | Title | Local PDF | Quality Update |",
			"|---|---|---|---|",
			...imported.map((item) => `| ${item.candidate.id} | ${item.candidate.title.replace(/\|/g, "\\|")} | ${displayPath(item.path, workingDir)} | full-text-sampled |`),
			"",
		];
		writeFileSync(evidencePath, `${evidenceLines.join("\n")}\n`, "utf8");
	}

	return { importsPath, extractsPath, evidencePath };
}

function maybeLaunchBrowserQueue(result: FullTextFetchResult): void {
	if (result.queued.length === 0) return;
	const browser = process.env.PUPPETEER_EXECUTABLE_PATH ?? resolveExecutable("google-chrome", BROWSER_FALLBACK_PATHS);
	if (!browser) {
		result.warnings.push("Assisted browser requested, but no Chrome/Chromium executable was found.");
		return;
	}
	const userDataDir = resolve(result.pdfDir, ".browser-profile");
	mkdirSync(userDataDir, { recursive: true });
	const urls = result.queued.map((item) => item.url).filter((url): url is string => Boolean(url)).slice(0, 5);
	if (urls.length === 0) return;
	const child = spawn(browser, [
		`--user-data-dir=${userDataDir}`,
		`--download-default-directory=${result.pdfDir}`,
		"--no-first-run",
		"--new-window",
		...urls,
	], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	result.warnings.push(`Opened assisted browser for ${urls.length} queued URLs. Complete any login/captcha/download manually; files should be saved under ${result.pdfDir}.`);
}

export function getDefaultFullTextFetchDelayMs(): number {
	return DEFAULT_FETCH_DELAY_MS;
}

export function getDefaultFullTextFetchTimeoutMs(): number {
	return DEFAULT_PDF_TIMEOUT_MS;
}

export async function runFullTextFetch(slug: string, workingDir: string, options: FullTextFetchOptions = {}): Promise<FullTextFetchResult> {
	const limit = options.limit ?? DEFAULT_FULLTEXT_LIMIT;
	const delayMs = options.delayMs ?? DEFAULT_FETCH_DELAY_MS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms)));
	const metadataFetch = options.fetch ?? fetch;
	const pdfFetch: PdfFetch = options.fetch ?? directPdfFetch;
	const config = options.config ?? loadResearchApiConfig();
	const now = options.now ?? (() => new Date());
	const draftDir = resolve(workingDir, "outputs", ".drafts");
	const candidatesPath = resolve(draftDir, `${slug}-candidate-pool.md`);
	if (!existsSync(candidatesPath)) {
		throw new Error(`Candidate pool not found: ${candidatesPath}`);
	}
	const pdfDir = resolve(workingDir, "outputs", ".pdfs", slug);
	mkdirSync(pdfDir, { recursive: true });
	const logPath = resolve(draftDir, `${slug}-fulltext-log.md`);
	const extractsPath = resolve(draftDir, `${slug}-fulltext-extracts.md`);
	const browserQueuePath = resolve(draftDir, `${slug}-browser-queue.md`);
	const warnings: string[] = [];
	const candidates = selectCandidates(parseCandidatePoolMarkdown(readFileSync(candidatesPath, "utf8")), limit);
	warnings.push(...await enrichCandidatesWithUnpaywall(candidates, config, metadataFetch));
	const result: FullTextFetchResult = {
		slug,
		candidatesPath,
		pdfDir,
		logPath,
		extractsPath,
		browserQueuePath,
		downloaded: [],
		automaticQueue: [],
		queued: [],
		warnings,
	};
	for (const [index, candidate] of candidates.entries()) {
		if (candidate.oaPdfUrl) {
			const filename = `${String(index + 1).padStart(2, "0")}-${candidate.id}-${sanitizeFullTextFilename(candidate.title)}.pdf`;
			const outputPath = resolve(pdfDir, filename);
			if (options.dryRun) {
				result.automaticQueue.push({ candidate, reason: "dry-run OA PDF candidate; automatic fetch will try this URL", url: candidate.oaPdfUrl });
			} else {
				try {
					const bytes = await downloadPdf(candidate, candidate.oaPdfUrl, outputPath, pdfFetch, timeoutMs);
					const textChars = extractPdfText(outputPath).length;
					result.downloaded.push({ candidate, path: outputPath, bytes, textChars });
				} catch (error) {
					result.warnings.push(`${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
					result.automaticQueue.push({ candidate, reason: "OA PDF download failed; retry automatic fetch later or with proxy", url: candidate.oaPdfUrl ?? candidate.url });
				}
			}
			if (!options.dryRun && delayMs > 0 && index < candidates.length - 1) {
				await sleep(delayMs);
			}
			continue;
		}
		result.queued.push({
			candidate,
			reason: "No OA PDF URL; use campus-network browser access if needed",
			url: candidate.url ?? (candidate.doi ? `https://doi.org/${candidate.doi}` : undefined),
		});
	}
	writeFileSync(result.extractsPath, formatExtracts(result, workingDir), "utf8");
	writeFileSync(result.logPath, formatLog(result, now(), workingDir), "utf8");
	writeFileSync(result.browserQueuePath, formatBrowserQueue(result, now()), "utf8");
	appendEvidenceMatrixUpdates(resolve(draftDir, `${slug}-evidence-matrix.md`), result, workingDir);
	if (options.assistedBrowser) {
		maybeLaunchBrowserQueue(result);
		writeFileSync(result.logPath, formatLog(result, now(), workingDir), "utf8");
		writeFileSync(result.browserQueuePath, formatBrowserQueue(result, now()), "utf8");
	}
	return result;
}
