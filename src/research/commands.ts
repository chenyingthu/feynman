import { getResearchApisEnvPath } from "../config/paths.js";
import { printInfo, printPanel, printSection } from "../ui/terminal.js";
import { loadResearchApiConfig, summarizeResearchApiStatus } from "./apis.js";
import { writeCandidatePoolFile } from "./candidate-pool.js";

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

function parseCandidatePoolArgs(args: string[]): { query: string; slug?: string } {
	const queryParts: string[] = [];
	let slug: string | undefined;
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
		queryParts.push(arg);
	}
	return { query: queryParts.join(" ").trim(), slug };
}

export async function handleResearchCommand(subcommand: string | undefined, args: string[], workingDir = process.cwd()): Promise<void> {
	if (!subcommand || subcommand === "status") {
		printResearchStatus();
		return;
	}

	if (subcommand === "candidate-pool") {
		const { query, slug: explicitSlug } = parseCandidatePoolArgs(args);
		if (!query) {
			throw new Error("Usage: feynman research candidate-pool [--slug <slug>] <query>");
		}
		const slug = explicitSlug ?? slugify(query);
		const result = await writeCandidatePoolFile(query, slug, workingDir);
		console.log(`Candidate pool written: ${result.path}`);
		console.log(`Candidates: ${result.pool.entries.length}`);
		if (result.pool.warnings.length > 0) {
			console.log(`Warnings: ${result.pool.warnings.length}`);
		}
		return;
	}

	throw new Error(`Unknown research command: ${subcommand}${args.length > 0 ? ` ${args.join(" ")}` : ""}`);
}
