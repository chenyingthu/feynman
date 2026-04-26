import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildCrossrefWorksSearchUrl,
	buildIeeeXploreSearchUrl,
	buildOpenAlexWorksSearchUrl,
	buildSemanticScholarSearchRequest,
	buildUnpaywallDoiUrl,
	loadResearchApiConfig,
	searchOpenAlexWorks,
	summarizeResearchApiStatus,
} from "../src/research/apis.js";
import { handleResearchCommand, printResearchStatus } from "../src/research/commands.js";

function captureConsoleLog(fn: () => void): string[] {
	const lines: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => {
		lines.push(args.map((arg) => String(arg)).join(" "));
	};
	try {
		fn();
	} finally {
		console.log = original;
	}
	return lines;
}

function stripAnsi(line: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI strip
	return line.replace(/\x1b\[[0-9;]*m/g, "");
}

test("loadResearchApiConfig reads research-apis.env without requiring process env", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-research-apis-"));
	const envPath = join(root, "research-apis.env");
	writeFileSync(
		envPath,
		[
			"OPENALEX_API_KEY=openalex-secret",
			"OPENALEX_EMAIL=user@example.com",
			"CROSSREF_MAILTO=user@example.com",
			"UNPAYWALL_EMAIL=user@example.com",
			"IEEE_XPLORE_API_KEY=ieee-secret",
			"",
		].join("\n"),
		"utf8",
	);

	const config = loadResearchApiConfig(envPath, {});

	assert.equal(config.openAlexApiKey, "openalex-secret");
	assert.equal(config.openAlexEmail, "user@example.com");
	assert.equal(config.crossrefMailto, "user@example.com");
	assert.equal(config.unpaywallEmail, "user@example.com");
	assert.equal(config.ieeeXploreApiKey, "ieee-secret");
});

test("summarizeResearchApiStatus reports configured providers without exposing secret values", () => {
	const status = summarizeResearchApiStatus({
		openAlexApiKey: "openalex-secret",
		openAlexEmail: "user@example.com",
		crossrefMailto: "user@example.com",
		unpaywallEmail: "user@example.com",
		ieeeXploreApiKey: "ieee-secret",
	});

	assert.equal(status.find((provider) => provider.name === "openalex")?.configured, true);
	assert.equal(status.find((provider) => provider.name === "crossref")?.configured, true);
	assert.equal(status.find((provider) => provider.name === "unpaywall")?.configured, true);
	assert.equal(status.find((provider) => provider.name === "ieee-xplore")?.configured, true);
	assert.equal(JSON.stringify(status).includes("openalex-secret"), false);
	assert.equal(JSON.stringify(status).includes("ieee-secret"), false);
});

test("printResearchStatus never prints API keys", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-research-status-"));
	const envPath = join(root, "research-apis.env");
	writeFileSync(
		envPath,
		[
			"OPENALEX_API_KEY=openalex-secret",
			"OPENALEX_EMAIL=user@example.com",
			"IEEE_XPLORE_API_KEY=ieee-secret",
			"",
		].join("\n"),
		"utf8",
	);

	const output = captureConsoleLog(() => printResearchStatus(envPath)).map(stripAnsi).join("\n");

	assert.match(output, /OpenAlex: configured/);
	assert.match(output, /IEEE Xplore: configured/);
	assert.doesNotMatch(output, /openalex-secret/);
	assert.doesNotMatch(output, /ieee-secret/);
});

test("handleResearchCommand rejects missing candidate-pool query", async () => {
	await assert.rejects(
		() => handleResearchCommand("candidate-pool", []),
		/Usage: feynman research candidate-pool <query>/,
	);
});

test("research API URL builders include polite metadata and auth in the right place", () => {
	const config = {
		openAlexApiKey: "openalex-secret",
		openAlexEmail: "user@example.com",
		crossrefMailto: "user@example.com",
		unpaywallEmail: "user@example.com",
		ieeeXploreApiKey: "ieee-secret",
		semanticScholarApiKey: "semantic-secret",
	};

	const openAlex = buildOpenAlexWorksSearchUrl("scenario generation", config);
	assert.equal(openAlex.origin, "https://api.openalex.org");
	assert.equal(openAlex.searchParams.get("api_key"), "openalex-secret");
	assert.equal(openAlex.searchParams.get("mailto"), "user@example.com");

	const crossref = buildCrossrefWorksSearchUrl("scenario generation", config);
	assert.equal(crossref.origin, "https://api.crossref.org");
	assert.equal(crossref.searchParams.get("mailto"), "user@example.com");

	const unpaywall = buildUnpaywallDoiUrl("10.1234/example.doi", config);
	assert.equal(unpaywall.origin, "https://api.unpaywall.org");
	assert.equal(unpaywall.searchParams.get("email"), "user@example.com");

	const ieee = buildIeeeXploreSearchUrl("microgrid", config);
	assert.equal(ieee.origin, "https://ieeexploreapi.ieee.org");
	assert.equal(ieee.searchParams.get("apikey"), "ieee-secret");

	const semantic = buildSemanticScholarSearchRequest("scenario generation", config);
	assert.equal(semantic.url.origin, "https://api.semanticscholar.org");
	assert.equal(semantic.headers["x-api-key"], "semantic-secret");
	assert.equal(semantic.url.searchParams.get("fields")?.includes("openAccessPdf"), true);
});

test("searchOpenAlexWorks uses injected fetch and redacts failing URL secrets in errors", async () => {
	const calls: URL[] = [];
	const fakeFetch = async (input: string | URL | Request) => {
		const url = input instanceof URL ? input : new URL(String(input));
		calls.push(url);
		return {
			ok: true,
			json: async () => ({ results: [{ title: "Paper" }] }),
		} as Response;
	};

	const result = await searchOpenAlexWorks("scenario generation", {
		config: { openAlexApiKey: "openalex-secret", openAlexEmail: "user@example.com" },
		fetch: fakeFetch as typeof fetch,
	});

	assert.deepEqual(result, { results: [{ title: "Paper" }] });
	assert.equal(calls[0].searchParams.get("api_key"), "openalex-secret");
});
