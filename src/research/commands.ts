import { getResearchApisEnvPath } from "../config/paths.js";
import { printInfo, printPanel, printSection } from "../ui/terminal.js";
import { loadResearchApiConfig, summarizeResearchApiStatus } from "./apis.js";
import { DEFAULT_CANDIDATE_POOL_LIMIT, writeCandidatePoolFile } from "./candidate-pool.js";
import { getDefaultFullTextFetchDelayMs, getDefaultFullTextFetchTimeoutMs, runFullTextFetch } from "./fulltext-fetch.js";
import { startFullTextSession } from "./fulltext-session.js";

const DEFAULT_ACQUIRE_PORT = 18766;

export function printResearchStatus(envPath = getResearchApisEnvPath()): void {
	const config = loadResearchApiConfig(envPath);
	const status = summarizeResearchApiStatus(config);

	printPanel("Research APIs", [
		"Academic metadata and open-access discovery providers.",
		"Secrets are loaded locally and never printed.",
	]);
	printSection("Configured Providers");
	for (const provider of status) {
		printInfo(`${provider.label}: ${provider.configured ? "configured" : "missing"} (${provider.detail})`);
	}
	printSection("Config");
	printInfo(`Path: ${envPath}`);
	printInfo("Expected variables:");
	printInfo("  OPENALEX_API_KEY, OPENALEX_EMAIL");
	printInfo("  SEMANTIC_SCHOLAR_API_KEY");
	printInfo("  CROSSREF_MAILTO, UNPAYWALL_EMAIL");
	printInfo("  IEEE_XPLORE_API_KEY, ELSEVIER_API_KEY");
	printInfo("  FIRECRAWL_API_KEY, FIRECRAWL_API_URL");
}

function slugify(value: string): string {
	const words = value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0)
		.slice(0, 5);
	return words.length > 0 ? words.join("-") : "candidate-pool";
}

function parsePositiveInteger(value: string | undefined, usage: string): number {
	if (!value) {
		throw new Error(usage);
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
		throw new Error(usage);
	}
	return parsed;
}

function parseNonNegativeInteger(value: string | undefined, usage: string): number {
	if (!value) {
		throw new Error(usage);
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
		throw new Error(usage);
	}
	return parsed;
}

function parseCandidatePoolArgs(args: string[]): { query: string; slug?: string; searchQueries: string[]; limit?: number } {
	const queryParts: string[] = [];
	const searchQueries: string[] = [];
	let slug: string | undefined;
	let limit: number | undefined;
	const usage = "Usage: feynman research candidate-pool [slug=<slug>] [limit=<n>] [query=<search-query> ...] <topic>";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--slug") {
			const value = args[index + 1]?.trim();
			if (!value) {
				throw new Error("Usage: feynman research candidate-pool [--slug <slug>] <query>");
			}
			slug = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--slug=") || arg.startsWith("slug=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) {
				throw new Error("Usage: feynman research candidate-pool [--slug <slug>] <query>");
			}
			slug = value;
			continue;
		}
		if (arg === "--limit") {
			limit = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--limit=") || arg.startsWith("limit=")) {
			limit = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--query") {
			const value = args[index + 1]?.trim();
			if (!value) {
				throw new Error(usage);
			}
			searchQueries.push(value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--query=") || arg.startsWith("query=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) {
				throw new Error(usage);
			}
			searchQueries.push(value);
			continue;
		}
		queryParts.push(arg);
	}
	return { query: queryParts.join(" ").trim(), slug, searchQueries, limit };
}

function parseFullTextFetchArgs(args: string[]): {
	slug?: string;
	limit?: number;
	delayMs?: number;
	timeoutMs?: number;
	assistedBrowser: boolean;
	dryRun: boolean;
} {
	let slug: string | undefined;
	let limit: number | undefined;
	let delayMs: number | undefined;
	let timeoutMs: number | undefined;
	let assistedBrowser = false;
	let dryRun = false;
	const usage = "Usage: feynman research fulltext-fetch slug=<slug> [limit=<n>] [delay-ms=<ms>] [timeout-ms=<ms>] [--assisted-browser] [--dry-run]";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--slug") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error(usage);
			slug = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--slug=") || arg.startsWith("slug=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) throw new Error(usage);
			slug = value;
			continue;
		}
		if (arg === "--limit") {
			limit = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--limit=") || arg.startsWith("limit=")) {
			limit = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--delay-ms") {
			delayMs = parseNonNegativeInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--delay-ms=") || arg.startsWith("delay-ms=")) {
			delayMs = parseNonNegativeInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--timeout-ms") {
			timeoutMs = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--timeout-ms=") || arg.startsWith("timeout-ms=")) {
			timeoutMs = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--assisted-browser" || arg === "assisted-browser=true") {
			assistedBrowser = true;
			continue;
		}
		if (arg === "--dry-run" || arg === "dry-run=true") {
			dryRun = true;
			continue;
		}
		if (!slug && !arg.startsWith("-")) {
			slug = arg.trim();
			continue;
		}
		throw new Error(usage);
	}
	return { slug, limit, delayMs, timeoutMs, assistedBrowser, dryRun };
}

function parseFullTextSessionArgs(args: string[]): {
	slug?: string;
	limit?: number;
	port?: number;
	host?: string;
	watchDownloads?: string;
} {
	let slug: string | undefined;
	let limit: number | undefined;
	let port: number | undefined;
	let host: string | undefined;
	let watchDownloads: string | undefined;
	const usage = "Usage: feynman research fulltext-session slug=<slug> [limit=<n>] [port=<n>] [host=<host>] [watch-downloads=<dir>]";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--slug") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error(usage);
			slug = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--slug=") || arg.startsWith("slug=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) throw new Error(usage);
			slug = value;
			continue;
		}
		if (arg === "--limit") {
			limit = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--limit=") || arg.startsWith("limit=")) {
			limit = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--port") {
			port = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--port=") || arg.startsWith("port=")) {
			port = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--host") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error(usage);
			host = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--host=") || arg.startsWith("host=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) throw new Error(usage);
			host = value;
			continue;
		}
		if (arg === "--watch-downloads") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error(usage);
			watchDownloads = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--watch-downloads=") || arg.startsWith("watch-downloads=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) throw new Error(usage);
			watchDownloads = value;
			continue;
		}
		if (!slug && !arg.startsWith("-")) {
			slug = arg.trim();
			continue;
		}
		throw new Error(usage);
	}
	return { slug, limit, port, host, watchDownloads };
}

function parseAcquireArgs(args: string[]): {
	topic: string;
	slug?: string;
	searchQueries: string[];
	candidateLimit?: number;
	fetchLimit?: number;
	delayMs?: number;
	timeoutMs?: number;
	port?: number;
	host?: string;
	watchDownloads?: string;
	noSession: boolean;
	dryRun: boolean;
} {
	const topicParts: string[] = [];
	const searchQueries: string[] = [];
	let slug: string | undefined;
	let candidateLimit: number | undefined;
	let fetchLimit: number | undefined;
	let delayMs: number | undefined;
	let timeoutMs: number | undefined;
	let port: number | undefined;
	let host: string | undefined;
	let watchDownloads: string | undefined;
	let noSession = false;
	let dryRun = false;
	const usage = "Usage: feynman research acquire [slug=<slug>] [limit=<n>] [fetch-limit=<n>] [query=<search-query> ...] [--no-session] <topic>";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--slug") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error(usage);
			slug = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--slug=") || arg.startsWith("slug=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) throw new Error(usage);
			slug = value;
			continue;
		}
		if (arg === "--limit") {
			candidateLimit = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--limit=") || arg.startsWith("limit=")) {
			candidateLimit = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--fetch-limit") {
			fetchLimit = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--fetch-limit=") || arg.startsWith("fetch-limit=")) {
			fetchLimit = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--query") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error(usage);
			searchQueries.push(value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--query=") || arg.startsWith("query=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) throw new Error(usage);
			searchQueries.push(value);
			continue;
		}
		if (arg === "--delay-ms") {
			delayMs = parseNonNegativeInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--delay-ms=") || arg.startsWith("delay-ms=")) {
			delayMs = parseNonNegativeInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--timeout-ms") {
			timeoutMs = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--timeout-ms=") || arg.startsWith("timeout-ms=")) {
			timeoutMs = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--port") {
			port = parsePositiveInteger(args[index + 1]?.trim(), usage);
			index += 1;
			continue;
		}
		if (arg.startsWith("--port=") || arg.startsWith("port=")) {
			port = parsePositiveInteger(arg.slice(arg.indexOf("=") + 1).trim(), usage);
			continue;
		}
		if (arg === "--host") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error(usage);
			host = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--host=") || arg.startsWith("host=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) throw new Error(usage);
			host = value;
			continue;
		}
		if (arg === "--watch-downloads") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error(usage);
			watchDownloads = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--watch-downloads=") || arg.startsWith("watch-downloads=")) {
			const value = arg.slice(arg.indexOf("=") + 1).trim();
			if (!value) throw new Error(usage);
			watchDownloads = value;
			continue;
		}
		if (arg === "--no-session" || arg === "no-session=true") {
			noSession = true;
			continue;
		}
		if (arg === "--dry-run" || arg === "dry-run=true") {
			dryRun = true;
			continue;
		}
		topicParts.push(arg);
	}
	return {
		topic: topicParts.join(" ").trim(),
		slug,
		searchQueries,
		candidateLimit,
		fetchLimit,
		delayMs,
		timeoutMs,
		port,
		host,
		watchDownloads,
		noSession,
		dryRun,
	};
}

function waitForInterrupt(): Promise<void> {
	return new Promise((resolvePromise) => {
		const stop = () => resolvePromise();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
}

export async function handleResearchCommand(subcommand: string | undefined, args: string[], workingDir = process.cwd()): Promise<void> {
	if (!subcommand || subcommand === "status") {
		printResearchStatus();
		return;
	}

	if (subcommand === "candidate-pool") {
		const { query, slug: explicitSlug, searchQueries, limit } = parseCandidatePoolArgs(args);
		if (!query) {
			throw new Error("Usage: feynman research candidate-pool [slug=<slug>] [limit=<n>] [query=<search-query> ...] <topic>");
		}
		const slug = explicitSlug ?? slugify(query);
		const result = await writeCandidatePoolFile(query, slug, workingDir, { searchQueries, limit: limit ?? DEFAULT_CANDIDATE_POOL_LIMIT });
		console.log(`Candidate pool written: ${result.path}`);
		console.log(`Candidates: ${result.pool.entries.length}`);
		console.log(`Search queries: ${result.pool.searchQueries.length}`);
		if (result.pool.warnings.length > 0) {
			console.log(`Warnings: ${result.pool.warnings.length}`);
		}
		return;
	}

	if (subcommand === "fulltext-fetch") {
		const { slug, limit, delayMs, timeoutMs, assistedBrowser, dryRun } = parseFullTextFetchArgs(args);
		if (!slug) {
			throw new Error("Usage: feynman research fulltext-fetch slug=<slug> [limit=<n>] [delay-ms=<ms>] [timeout-ms=<ms>] [--assisted-browser] [--dry-run]");
		}
		const result = await runFullTextFetch(slug, workingDir, {
			limit,
			delayMs: delayMs ?? getDefaultFullTextFetchDelayMs(),
			timeoutMs: timeoutMs ?? getDefaultFullTextFetchTimeoutMs(),
			assistedBrowser,
			dryRun,
		});
		console.log(`Full-text fetch log written: ${result.logPath}`);
		console.log(`Full-text extracts written: ${result.extractsPath}`);
		console.log(`Browser queue written: ${result.browserQueuePath}`);
		console.log(`PDF directory: ${result.pdfDir}`);
		console.log(`Downloaded PDFs: ${result.downloaded.length}`);
		console.log(`Automatic OA retry/preview queue: ${result.automaticQueue.length}`);
		console.log(`Browser/manual campus queue: ${result.queued.length}`);
		if (result.warnings.length > 0) {
			console.log(`Warnings: ${result.warnings.length}`);
		}
		return;
	}

	if (subcommand === "fulltext-session") {
		const { slug, limit, port, host, watchDownloads } = parseFullTextSessionArgs(args);
		if (!slug) {
			throw new Error("Usage: feynman research fulltext-session slug=<slug> [limit=<n>] [port=<n>] [host=<host>] [watch-downloads=<dir>]");
		}
		const session = await startFullTextSession(slug, workingDir, { limit, port, host, watchDownloads });
		console.log(`Full-text acquisition session: ${session.url}`);
		if (host === "0.0.0.0" || host === "::") {
			console.log(`Listening on ${host}; use this machine's LAN IP from another device.`);
		}
		console.log("Open this URL in your browser. Press Ctrl-C to stop.");
		await waitForInterrupt();
		await session.close();
		console.log("Full-text acquisition session stopped.");
		return;
	}

	if (subcommand === "acquire") {
		const options = parseAcquireArgs(args);
		if (!options.topic) {
			throw new Error("Usage: feynman research acquire [slug=<slug>] [limit=<n>] [fetch-limit=<n>] [query=<search-query> ...] [--no-session] <topic>");
		}
		const slug = options.slug ?? slugify(options.topic);
		console.log(`Research acquisition slug: ${slug}`);
		const candidate = await writeCandidatePoolFile(options.topic, slug, workingDir, {
			searchQueries: options.searchQueries,
			limit: options.candidateLimit ?? DEFAULT_CANDIDATE_POOL_LIMIT,
		});
		console.log(`Candidate pool written: ${candidate.path}`);
		console.log(`Candidates: ${candidate.pool.entries.length}`);
		console.log(`Search queries: ${candidate.pool.searchQueries.length}`);
		if (candidate.pool.warnings.length > 0) {
			console.log(`Candidate warnings: ${candidate.pool.warnings.length}`);
		}

		const fetchResult = await runFullTextFetch(slug, workingDir, {
			limit: options.fetchLimit ?? options.candidateLimit,
			delayMs: options.delayMs ?? getDefaultFullTextFetchDelayMs(),
			timeoutMs: options.timeoutMs ?? getDefaultFullTextFetchTimeoutMs(),
			dryRun: options.dryRun,
		});
		console.log(`Full-text fetch log written: ${fetchResult.logPath}`);
		console.log(`Full-text extracts written: ${fetchResult.extractsPath}`);
		console.log(`Evidence matrix: ${workingDir}/outputs/.drafts/${slug}-evidence-matrix.md`);
		console.log(`Browser queue written: ${fetchResult.browserQueuePath}`);
		console.log(`PDF directory: ${fetchResult.pdfDir}`);
		console.log(`Downloaded PDFs: ${fetchResult.downloaded.length}`);
		console.log(`Automatic OA retry/preview queue: ${fetchResult.automaticQueue.length}`);
		console.log(`Browser/manual campus queue: ${fetchResult.queued.length}`);
		if (fetchResult.warnings.length > 0) {
			console.log(`Fetch warnings: ${fetchResult.warnings.length}`);
		}
		if (fetchResult.queued.length === 0 || options.noSession || options.dryRun) {
			if (fetchResult.queued.length > 0) {
				console.log(`Manual queue is ready. Start uploads later with: feynman research fulltext-session slug=${slug}`);
			}
			return;
		}
		const session = await startFullTextSession(slug, workingDir, {
			limit: fetchResult.queued.length,
			port: options.port ?? DEFAULT_ACQUIRE_PORT,
			host: options.host,
			watchDownloads: options.watchDownloads,
		});
		console.log(`Full-text acquisition session: ${session.url}`);
		if (options.host === "0.0.0.0" || options.host === "::") {
			console.log(`Listening on ${options.host}; use this machine's LAN IP from another device.`);
		}
		console.log("Open this URL in your browser, download PDFs normally, then upload them on the page. Press Ctrl-C to stop.");
		await waitForInterrupt();
		await session.close();
		console.log("Full-text acquisition session stopped.");
		return;
	}

	throw new Error(`Unknown research command: ${subcommand}${args.length > 0 ? ` ${args.join(" ")}` : ""}`);
}
