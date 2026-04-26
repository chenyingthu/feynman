import { existsSync, readFileSync } from "node:fs";

import { getResearchApisEnvPath } from "../config/paths.js";

export type ResearchApiName = "openalex" | "semantic-scholar" | "crossref" | "unpaywall" | "ieee-xplore" | "elsevier";

export type ResearchApiConfig = {
	openAlexApiKey?: string;
	openAlexEmail?: string;
	semanticScholarApiKey?: string;
	crossrefMailto?: string;
	unpaywallEmail?: string;
	ieeeXploreApiKey?: string;
	elsevierApiKey?: string;
};

export type ResearchApiStatus = {
	name: ResearchApiName;
	label: string;
	configured: boolean;
	detail: string;
};

export type ResearchApiFetch = typeof fetch;

const ENV_KEY_MAP: Record<keyof ResearchApiConfig, string> = {
	openAlexApiKey: "OPENALEX_API_KEY",
	openAlexEmail: "OPENALEX_EMAIL",
	semanticScholarApiKey: "SEMANTIC_SCHOLAR_API_KEY",
	crossrefMailto: "CROSSREF_MAILTO",
	unpaywallEmail: "UNPAYWALL_EMAIL",
	ieeeXploreApiKey: "IEEE_XPLORE_API_KEY",
	elsevierApiKey: "ELSEVIER_API_KEY",
};

function parseEnvFile(contents: string): Record<string, string> {
	const parsed: Record<string, string> = {};
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const equalsIndex = line.indexOf("=");
		if (equalsIndex <= 0) continue;
		const name = line.slice(0, equalsIndex).trim();
		let value = line.slice(equalsIndex + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		parsed[name] = value;
	}
	return parsed;
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function loadResearchApiConfig(envPath = getResearchApisEnvPath(), env: NodeJS.ProcessEnv = process.env): ResearchApiConfig {
	const fileEnv = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
	const read = (key: keyof ResearchApiConfig): string | undefined => nonEmpty(env[ENV_KEY_MAP[key]] ?? fileEnv[ENV_KEY_MAP[key]]);
	return {
		openAlexApiKey: read("openAlexApiKey"),
		openAlexEmail: read("openAlexEmail"),
		semanticScholarApiKey: read("semanticScholarApiKey"),
		crossrefMailto: read("crossrefMailto"),
		unpaywallEmail: read("unpaywallEmail"),
		ieeeXploreApiKey: read("ieeeXploreApiKey"),
		elsevierApiKey: read("elsevierApiKey"),
	};
}

export function summarizeResearchApiStatus(config = loadResearchApiConfig()): ResearchApiStatus[] {
	return [
		{
			name: "openalex",
			label: "OpenAlex",
			configured: Boolean(config.openAlexApiKey || config.openAlexEmail),
			detail: config.openAlexApiKey ? "api key configured" : config.openAlexEmail ? "polite email configured" : "missing",
		},
		{
			name: "semantic-scholar",
			label: "Semantic Scholar",
			configured: Boolean(config.semanticScholarApiKey),
			detail: config.semanticScholarApiKey ? "api key configured" : "missing",
		},
		{
			name: "crossref",
			label: "Crossref",
			configured: Boolean(config.crossrefMailto),
			detail: config.crossrefMailto ? "mailto configured" : "missing mailto",
		},
		{
			name: "unpaywall",
			label: "Unpaywall",
			configured: Boolean(config.unpaywallEmail),
			detail: config.unpaywallEmail ? "email configured" : "missing email",
		},
		{
			name: "ieee-xplore",
			label: "IEEE Xplore",
			configured: Boolean(config.ieeeXploreApiKey),
			detail: config.ieeeXploreApiKey ? "api key configured" : "missing",
		},
		{
			name: "elsevier",
			label: "Elsevier",
			configured: Boolean(config.elsevierApiKey),
			detail: config.elsevierApiKey ? "api key configured" : "missing",
		},
	];
}

function buildUrl(baseUrl: string, params: Record<string, string | number | undefined>): URL {
	const url = new URL(baseUrl);
	for (const [name, value] of Object.entries(params)) {
		if (value === undefined || value === "") continue;
		url.searchParams.set(name, String(value));
	}
	return url;
}

export function buildOpenAlexWorksSearchUrl(query: string, config = loadResearchApiConfig()): URL {
	const url = buildUrl("https://api.openalex.org/works", {
		search: query,
		per_page: 25,
		mailto: config.openAlexEmail,
	});
	if (config.openAlexApiKey) {
		url.searchParams.set("api_key", config.openAlexApiKey);
	}
	return url;
}

export function buildCrossrefWorksSearchUrl(query: string, config = loadResearchApiConfig()): URL {
	return buildUrl("https://api.crossref.org/works", {
		query,
		rows: 20,
		mailto: config.crossrefMailto,
	});
}

export function buildUnpaywallDoiUrl(doi: string, config = loadResearchApiConfig()): URL {
	return buildUrl(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`, {
		email: config.unpaywallEmail,
	});
}

export function buildIeeeXploreSearchUrl(query: string, config = loadResearchApiConfig()): URL {
	return buildUrl("https://ieeexploreapi.ieee.org/api/v1/search/articles", {
		querytext: query,
		max_records: 25,
		apikey: config.ieeeXploreApiKey,
	});
}

export function buildSemanticScholarSearchRequest(query: string, config = loadResearchApiConfig()): {
	url: URL;
	headers: Record<string, string>;
} {
	const url = buildUrl("https://api.semanticscholar.org/graph/v1/paper/search", {
		query,
		limit: 20,
		fields: "title,authors,year,venue,abstract,citationCount,influentialCitationCount,externalIds,openAccessPdf,url",
	});
	const headers: Record<string, string> = {};
	if (config.semanticScholarApiKey) {
		headers["x-api-key"] = config.semanticScholarApiKey;
	}
	return { url, headers };
}

async function fetchJson(fetchImpl: ResearchApiFetch, url: URL, init?: RequestInit): Promise<unknown> {
	const response = await fetchImpl(url, init);
	if (!response.ok) {
		throw new Error(`Research API request failed (${response.status}) for ${url.origin}${url.pathname}`);
	}
	return response.json() as Promise<unknown>;
}

export async function searchOpenAlexWorks(query: string, options: {
	config?: ResearchApiConfig;
	fetch?: ResearchApiFetch;
} = {}): Promise<unknown> {
	const config = options.config ?? loadResearchApiConfig();
	return fetchJson(options.fetch ?? fetch, buildOpenAlexWorksSearchUrl(query, config));
}

export async function searchCrossrefWorks(query: string, options: {
	config?: ResearchApiConfig;
	fetch?: ResearchApiFetch;
} = {}): Promise<unknown> {
	const config = options.config ?? loadResearchApiConfig();
	return fetchJson(options.fetch ?? fetch, buildCrossrefWorksSearchUrl(query, config));
}

export async function lookupUnpaywallDoi(doi: string, options: {
	config?: ResearchApiConfig;
	fetch?: ResearchApiFetch;
} = {}): Promise<unknown> {
	const config = options.config ?? loadResearchApiConfig();
	return fetchJson(options.fetch ?? fetch, buildUnpaywallDoiUrl(doi, config));
}

export async function searchIeeeXplore(query: string, options: {
	config?: ResearchApiConfig;
	fetch?: ResearchApiFetch;
} = {}): Promise<unknown> {
	const config = options.config ?? loadResearchApiConfig();
	return fetchJson(options.fetch ?? fetch, buildIeeeXploreSearchUrl(query, config));
}

export async function searchSemanticScholarPapers(query: string, options: {
	config?: ResearchApiConfig;
	fetch?: ResearchApiFetch;
} = {}): Promise<unknown> {
	const config = options.config ?? loadResearchApiConfig();
	const request = buildSemanticScholarSearchRequest(query, config);
	return fetchJson(options.fetch ?? fetch, request.url, { headers: request.headers });
}
