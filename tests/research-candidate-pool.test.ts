import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCandidatePool, formatCandidatePoolMarkdown, writeCandidatePoolFile } from "../src/research/candidate-pool.js";

const openAlexPayload = {
	results: [
		{
			title: "Power system scenario generation for renewable integration",
			publication_year: 2024,
			doi: "https://doi.org/10.1234/scenario",
			cited_by_count: 42,
			authorships: [{ author: { display_name: "Ada Researcher" } }],
			primary_location: {
				landing_page_url: "https://example.org/scenario",
				source: { display_name: "Energy Journal" },
			},
			open_access: { is_oa: true },
		},
		{
			title: "Unrelated planning note",
			publication_year: 2010,
			cited_by_count: 1,
			authorships: [],
			primary_location: { landing_page_url: "https://example.org/other" },
			open_access: { is_oa: false },
		},
	],
};

const crossrefPayload = {
	message: {
		items: [
			{
				title: ["Power system scenario generation for renewable integration"],
				DOI: "10.1234/scenario",
				URL: "https://doi.org/10.1234/scenario",
				"container-title": ["Energy Journal"],
				published: { "date-parts": [[2024]] },
				author: [{ given: "Ada", family: "Researcher" }],
			},
		],
	},
};

const unpaywallPayload = {
	is_oa: true,
	best_oa_location: {
		url_for_landing_page: "https://oa.example.org/scenario",
		url_for_pdf: "https://oa.example.org/scenario.pdf",
	},
};

function fakeFetch(input: string | URL | Request): Promise<Response> {
	const url = input instanceof URL ? input : new URL(String(input));
	if (url.hostname === "api.openalex.org") {
		return Promise.resolve({ ok: true, json: async () => openAlexPayload } as Response);
	}
	if (url.hostname === "api.crossref.org") {
		return Promise.resolve({ ok: true, json: async () => crossrefPayload } as Response);
	}
	if (url.hostname === "api.unpaywall.org") {
		return Promise.resolve({ ok: true, json: async () => unpaywallPayload } as Response);
	}
	throw new Error(`Unexpected URL ${url}`);
}

test("buildCandidatePool includes IEEE Xplore and Semantic Scholar candidates when configured", async () => {
	function multiProviderFetch(input: string | URL | Request): Promise<Response> {
		const url = input instanceof URL ? input : new URL(String(input));
		if (url.hostname === "api.openalex.org") {
			return Promise.resolve({ ok: true, json: async () => ({ results: [] }) } as Response);
		}
		if (url.hostname === "api.crossref.org") {
			return Promise.resolve({ ok: true, json: async () => ({ message: { items: [] } }) } as Response);
		}
		if (url.hostname === "ieeexploreapi.ieee.org") {
			return Promise.resolve({
				ok: true,
				json: async () => ({
					articles: [
						{
							title: "Scenario generation for renewable-rich power systems",
							doi: "10.1109/scenario",
							publication_year: "2024",
							publication_title: "IEEE Transactions on Power Systems",
							citing_paper_count: 12,
							authors: { authors: [{ full_name: "Grace Engineer" }] },
							html_url: "https://ieeexplore.ieee.org/document/1",
							abstract: "Scenario generation method.",
						},
					],
				}),
			} as Response);
		}
		if (url.hostname === "api.semanticscholar.org") {
			return Promise.resolve({
				ok: true,
				json: async () => ({
					data: [
						{
							title: "Scenario generation for renewable-rich power systems",
							year: 2024,
							venue: "IEEE Transactions on Power Systems",
							citationCount: 12,
							externalIds: { DOI: "10.1109/scenario" },
							openAccessPdf: { url: "https://example.org/scenario.pdf" },
							url: "https://semanticscholar.org/paper/1",
							abstract: "Scenario generation method.",
							authors: [{ name: "Grace Engineer" }],
						},
					],
				}),
			} as Response);
		}
		if (url.hostname === "api.unpaywall.org") {
			return Promise.resolve({ ok: true, json: async () => ({ is_oa: true }) } as Response);
		}
		throw new Error(`Unexpected URL ${url}`);
	}

	const pool = await buildCandidatePool("power system scenario generation", {
		config: {
			openAlexEmail: "user@example.com",
			crossrefMailto: "user@example.com",
			unpaywallEmail: "user@example.com",
			ieeeXploreApiKey: "ieee-secret",
			semanticScholarApiKey: "semantic-secret",
		},
		fetch: multiProviderFetch as typeof fetch,
	});

	assert.equal(pool.entries.length, 1);
	assert.deepEqual(pool.entries[0].sourceApis.sort(), ["IEEE Xplore", "Semantic Scholar", "Unpaywall"].sort());
	assert.equal(pool.entries[0].sourceQualityHint, "abstract");
	assert.match(pool.entries[0].scoreReasons.join(","), /ieee/);
	assert.match(pool.entries[0].scoreReasons.join(","), /semantic-scholar/);
});

test("buildCandidatePool merges results from multiple taxonomy-derived search queries", async () => {
	const seenSearches: string[] = [];
	function multiQueryFetch(input: string | URL | Request): Promise<Response> {
		const url = input instanceof URL ? input : new URL(String(input));
		const search = url.searchParams.get("search") ?? url.searchParams.get("query") ?? "";
		if (search) seenSearches.push(search);
		if (url.hostname === "api.openalex.org") {
			return Promise.resolve({
				ok: true,
				json: async () => ({
					results: [
						{
							title: search.includes("impedance") ? "Impedance based stability analysis" : "Modal small signal analysis",
							publication_year: 2024,
							doi: search.includes("impedance") ? "https://doi.org/10.1234/impedance" : "https://doi.org/10.1234/modal",
							primary_location: { landing_page_url: "https://example.org/paper" },
							open_access: { is_oa: false },
						},
					],
				}),
			} as Response);
		}
		if (url.hostname === "api.crossref.org") {
			return Promise.resolve({ ok: true, json: async () => ({ message: { items: [] } }) } as Response);
		}
		throw new Error(`Unexpected URL ${url}`);
	}

	const pool = await buildCandidatePool("stability analysis", {
		config: { openAlexEmail: "user@example.com", crossrefMailto: "user@example.com" },
		searchQueries: ["impedance stability", "modal stability"],
		fetch: multiQueryFetch as typeof fetch,
	});

	assert.deepEqual(pool.searchQueries, ["stability analysis", "impedance stability", "modal stability"]);
	assert.equal(pool.entries.length, 2);
	assert.ok(seenSearches.includes("stability analysis"));
	assert.ok(seenSearches.includes("impedance stability"));
	assert.ok(seenSearches.includes("modal stability"));
	assert.match(formatCandidatePoolMarkdown(pool), /## Search Queries/);
});

test("buildCandidatePool scores candidates against the best matching search query", async () => {
	function bestQueryFetch(input: string | URL | Request): Promise<Response> {
		const url = input instanceof URL ? input : new URL(String(input));
		const search = url.searchParams.get("search") ?? url.searchParams.get("query") ?? "";
		if (url.hostname === "api.openalex.org") {
			return Promise.resolve({
				ok: true,
				json: async () => ({
					results: [
						{
							title: search.includes("impedance")
								? "Impedance based stability analysis of inverter based resources"
								: "Generic stability analysis",
							publication_year: 2024,
							doi: search.includes("impedance") ? "https://doi.org/10.1234/specific" : "https://doi.org/10.1234/generic",
							primary_location: { landing_page_url: "https://example.org/paper" },
							open_access: { is_oa: false },
						},
					],
				}),
			} as Response);
		}
		if (url.hostname === "api.crossref.org") {
			return Promise.resolve({ ok: true, json: async () => ({ message: { items: [] } }) } as Response);
		}
		throw new Error(`Unexpected URL ${url}`);
	}

	const pool = await buildCandidatePool("中文主题", {
		config: { openAlexEmail: "user@example.com", crossrefMailto: "user@example.com" },
		searchQueries: ["impedance based stability analysis inverter based resources"],
		fetch: bestQueryFetch as typeof fetch,
	});

	assert.equal(pool.entries[0].title, "Impedance based stability analysis of inverter based resources");
	assert.match(pool.entries[0].scoreReasons.join(","), /title-relevance/);
});

test("buildCandidatePool merges API records and enriches OA locations", async () => {
	const pool = await buildCandidatePool("power system scenario generation", {
		config: {
			openAlexEmail: "user@example.com",
			crossrefMailto: "user@example.com",
			unpaywallEmail: "user@example.com",
		},
		fetch: fakeFetch as typeof fetch,
	});

	assert.equal(pool.entries.length, 2);
	const first = pool.entries[0];
	assert.equal(first.title, "Power system scenario generation for renewable integration");
	assert.equal(first.doi, "10.1234/scenario");
	assert.deepEqual(first.sourceApis.sort(), ["Crossref", "OpenAlex", "Unpaywall"].sort());
	assert.equal(first.openAccess, true);
	assert.equal(first.oaPdfUrl, "https://oa.example.org/scenario.pdf");
	assert.equal(first.sourceQualityHint, "abstract+conclusion");
	assert.ok(first.score > pool.entries[1].score);
});

test("buildCandidatePool ranks Chinese title relevance above unrelated OA metadata", async () => {
	function chineseFetch(input: string | URL | Request): Promise<Response> {
		const url = input instanceof URL ? input : new URL(String(input));
		if (url.hostname === "api.openalex.org") {
			return Promise.resolve({
				ok: true,
				json: async () => ({
					results: [
						{
							title: "The climate impact paradox of artificial intelligence",
							publication_year: 2026,
							doi: "https://doi.org/10.9999/unrelated",
							cited_by_count: 200,
							primary_location: { landing_page_url: "https://example.org/unrelated" },
							open_access: { is_oa: true },
						},
					],
				}),
			} as Response);
		}
		if (url.hostname === "api.crossref.org") {
			return Promise.resolve({
				ok: true,
				json: async () => ({
					message: {
						items: [
							{
								title: ["新型电力系统复杂运行场景生成方法综述"],
								DOI: "10.1234/relevant-cn",
								URL: "https://doi.org/10.1234/relevant-cn",
								"container-title": ["电力系统自动化"],
								published: { "date-parts": [[2025]] },
							},
						],
					},
				}),
			} as Response);
		}
		if (url.hostname === "api.unpaywall.org") {
			return Promise.resolve({ ok: true, json: async () => ({ is_oa: true }) } as Response);
		}
		throw new Error(`Unexpected URL ${url}`);
	}

	const pool = await buildCandidatePool("新型电力系统复杂运行场景生成", {
		config: {
			openAlexEmail: "user@example.com",
			crossrefMailto: "user@example.com",
			unpaywallEmail: "user@example.com",
		},
		fetch: chineseFetch as typeof fetch,
	});

	assert.equal(pool.entries[0].title, "新型电力系统复杂运行场景生成方法综述");
	assert.match(pool.entries[0].scoreReasons.join(","), /title-relevance/);
	assert.match(pool.entries[1].scoreReasons.join(","), /title-mismatch/);
});

test("buildCandidatePool downranks broad English one-token matches", async () => {
	function broadFetch(input: string | URL | Request): Promise<Response> {
		const url = input instanceof URL ? input : new URL(String(input));
		if (url.hostname === "api.openalex.org") {
			return Promise.resolve({
				ok: true,
				json: async () => ({
					results: [
						{
							title: "Second-generation PLINK: rising to the challenge of larger datasets",
							publication_year: 2015,
							doi: "https://doi.org/10.1234/plink",
							cited_by_count: 10000,
							primary_location: { landing_page_url: "https://example.org/plink" },
							open_access: { is_oa: true },
						},
						{
							title: "Scenario generation for renewable-rich power systems",
							publication_year: 2025,
							doi: "https://doi.org/10.1234/power-scenario",
							cited_by_count: 5,
							primary_location: { landing_page_url: "https://example.org/power-scenario" },
							open_access: { is_oa: false },
						},
					],
				}),
			} as Response);
		}
		if (url.hostname === "api.crossref.org") {
			return Promise.resolve({ ok: true, json: async () => ({ message: { items: [] } }) } as Response);
		}
		if (url.hostname === "api.unpaywall.org") {
			return Promise.resolve({ ok: true, json: async () => ({ is_oa: true }) } as Response);
		}
		throw new Error(`Unexpected URL ${url}`);
	}

	const pool = await buildCandidatePool("new power system complex operating scenario generation", {
		config: {
			openAlexEmail: "user@example.com",
			crossrefMailto: "user@example.com",
			unpaywallEmail: "user@example.com",
		},
		fetch: broadFetch as typeof fetch,
	});

	assert.equal(pool.entries[0].title, "Scenario generation for renewable-rich power systems");
	assert.match(pool.entries[1].scoreReasons.join(","), /weak-title-match/);
});

test("formatCandidatePoolMarkdown writes candidate table and OA links", async () => {
	const pool = await buildCandidatePool("power system scenario generation", {
		config: {
			openAlexEmail: "user@example.com",
			crossrefMailto: "user@example.com",
			unpaywallEmail: "user@example.com",
		},
		fetch: fakeFetch as typeof fetch,
	});

	const markdown = formatCandidatePoolMarkdown(pool);

	assert.match(markdown, /# Candidate Pool/);
	assert.match(markdown, /Power system scenario generation for renewable integration/);
	assert.match(markdown, /OpenAlex\+Crossref\+Unpaywall|Crossref\+OpenAlex\+Unpaywall|OpenAlex\+Unpaywall\+Crossref/);
	assert.match(markdown, /https:\/\/oa\.example\.org\/scenario\.pdf/);
});

test("writeCandidatePoolFile writes outputs/.drafts/<slug>-candidate-pool.md", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-candidate-pool-"));

	const result = await writeCandidatePoolFile("power system scenario generation", "scenario-test", root, {
		config: {
			openAlexEmail: "user@example.com",
			crossrefMailto: "user@example.com",
			unpaywallEmail: "user@example.com",
		},
		fetch: fakeFetch as typeof fetch,
	});

	assert.ok(existsSync(result.path));
	assert.equal(result.path.endsWith("outputs/.drafts/scenario-test-candidate-pool.md"), true);
	assert.match(readFileSync(result.path, "utf8"), /Candidate Pool/);
});
