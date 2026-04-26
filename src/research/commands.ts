import { getResearchApisEnvPath } from "../config/paths.js";
import { printInfo, printPanel, printSection } from "../ui/terminal.js";
import { loadResearchApiConfig, summarizeResearchApiStatus } from "./apis.js";

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

export function handleResearchCommand(subcommand: string | undefined, args: string[]): void {
	if (!subcommand || subcommand === "status") {
		printResearchStatus();
		return;
	}

	throw new Error(`Unknown research command: ${subcommand}${args.length > 0 ? ` ${args.join(" ")}` : ""}`);
}
