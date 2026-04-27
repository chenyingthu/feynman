import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	loadResearchApiConfig,
	lookupUnpaywallDoi,
	searchCrossrefWorks,
	searchIeeeXplore,
	searchOpenAlexWorks,
	searchSemanticScholarPapers,
	type ResearchApiConfig,
	type ResearchApiFetch,
} from "./apis.js";

export type CandidatePoolEntry = {
	id: string;
	title: string;
	year?: number;
	venue?: string;
	doi?: string;
	url?: string;
	authors: string[];
	citedByCount?: number;
	sourceApis: string[];
	openAccess?: boolean;
	oaLandingPageUrl?: string;
	oaPdfUrl?: string;
	sourceQualityHint: "metadata" | "abstract" | "abstract+conclusion" | "full-text-sampled";
	sourceSearchQueries: string[];
	bestMatchingQuery?: string;
	accessNotes: string[];
	score: number;
	scoreReasons: string[];
};

export type CandidatePool = {
	query: string;
	searchQueries: string[];
	generatedAt: string;
	entries: CandidatePoolEntry[];
	warnings: string[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
	return value && typeof value === "object" ? value as UnknownRecord : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asYear(value: unknown): number | undefined {
	const number = asNumber(value);
	if (number !== undefined) return number;
	const raw = asString(value);
	if (!raw) return undefined;
	const match = raw.match(/\b(19|20)\d{2}\b/);
	return match ? Number(match[0]) : undefined;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function normalizeDoi(value: unknown): string | undefined {
	const raw = asString(value);
	if (!raw) return undefined;
	return raw
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
		.replace(/^doi:\s*/i, "")
		.trim()
		.toLowerCase();
}

function normalizeTitle(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function addWeightedTerm(terms: Map<string, number>, term: string, weight: number): void {
	if (!term) return;
	terms.set(term, Math.max(terms.get(term) ?? 0, weight));
}

function extractRelevanceTerms(value: string): Map<string, number> {
	const normalized = normalizeTitle(value);
	const terms = new Map<string, number>();
	for (const word of normalized.match(/[a-z0-9]{3,}/g) ?? []) {
		addWeightedTerm(terms, word, 3);
	}
	for (const sequence of normalized.match(/\p{Script=Han}+/gu) ?? []) {
		if (sequence.length < 2) continue;
		if (sequence.length <= 10) {
			addWeightedTerm(terms, sequence, 5);
		}
		for (const size of [2, 3, 4]) {
			if (sequence.length < size) continue;
			for (let index = 0; index <= sequence.length - size; index += 1) {
				addWeightedTerm(terms, sequence.slice(index, index + size), size);
			}
		}
	}
	return terms;
}

function titleRelevanceScore(title: string, query: string): { score: number; matchedTerms: number } {
	const queryTerms = extractRelevanceTerms(query);
	if (queryTerms.size === 0) return { score: 0, matchedTerms: 0 };
	const titleTerms = extractRelevanceTerms(title);
	let rawScore = 0;
	let matchedTerms = 0;
	for (const [term, weight] of queryTerms) {
		if (titleTerms.has(term)) {
			rawScore += weight;
			matchedTerms += 1;
		}
	}
	return { score: Math.min(16, rawScore), matchedTerms };
}

function entryKey(entry: Pick<CandidatePoolEntry, "doi" | "title">): string {
	return entry.doi ? `doi:${entry.doi}` : `title:${normalizeTitle(entry.title)}`;
}

function buildAccessNotes(entry: CandidatePoolEntry): string[] {
	const notes: string[] = [];
	if (entry.doi) {
		notes.push(`DOI landing: https://doi.org/${entry.doi}`);
	}
	const landingPage = entry.oaLandingPageUrl ?? entry.url;
	if (landingPage) {
		notes.push(`Landing page: ${landingPage}`);
	}
	if (entry.oaPdfUrl) {
		notes.push(`OA PDF candidate: ${entry.oaPdfUrl}; cite as read only after successful fetch/parse`);
	}
	if (entry.sourceQualityHint === "metadata") {
		notes.push("Fallback if full text is blocked: metadata-only; avoid method/result claims until more text is read");
	} else if (entry.sourceQualityHint === "abstract") {
		notes.push("Fallback if full text is blocked: abstract-supported claims only");
	} else if (entry.sourceQualityHint === "abstract+conclusion") {
		notes.push("Fallback if full text is blocked: abstract/conclusion-level claims only");
	}
	if (notes.length === 0) {
		notes.push("Access unresolved; mark blocked if no stable landing page or metadata source can be found");
	}
	return Array.from(new Set(notes));
}

function withAccessNotes(entry: CandidatePoolEntry): CandidatePoolEntry {
	return {
		...entry,
		accessNotes: buildAccessNotes(entry),
	};
}

function parseOpenAlexEntries(payload: unknown): CandidatePoolEntry[] {
	const root = asRecord(payload);
	return asArray(root?.results)
		.map((item, index): CandidatePoolEntry | undefined => {
			const record = asRecord(item);
			const title = asString(record?.title);
			if (!record || !title) return undefined;
			const primaryLocation = asRecord(record.primary_location);
			const source = asRecord(primaryLocation?.source);
			const openAccess = asRecord(record.open_access);
			const authors = asArray(record.authorships)
				.map((authorship) => asString(asRecord(asRecord(authorship)?.author)?.display_name))
				.filter((name): name is string => Boolean(name));
			const doi = normalizeDoi(record.doi);
			const oaPdfUrl = asString(asRecord(primaryLocation?.landing_page_url)?.pdf_url) ?? asString(primaryLocation?.pdf_url);
			const oaLandingPageUrl = asString(primaryLocation?.landing_page_url) ?? asString(record.id);
			const isOpenAccess = typeof openAccess?.is_oa === "boolean" ? openAccess.is_oa : undefined;
			return {
				id: `OA${index + 1}`,
				title,
				year: asNumber(record.publication_year),
				venue: asString(source?.display_name),
				doi,
				url: oaLandingPageUrl,
				authors,
				citedByCount: asNumber(record.cited_by_count),
				sourceApis: ["OpenAlex"],
				openAccess: isOpenAccess,
				oaLandingPageUrl,
				oaPdfUrl,
				sourceQualityHint: isOpenAccess ? "abstract+conclusion" : "metadata",
				sourceSearchQueries: [],
				accessNotes: [],
				score: 0,
				scoreReasons: [],
			};
		})
		.filter((entry): entry is CandidatePoolEntry => Boolean(entry));
}

function parseCrossrefEntries(payload: unknown): CandidatePoolEntry[] {
	const message = asRecord(asRecord(payload)?.message);
	return asArray(message?.items)
		.map((item, index): CandidatePoolEntry | undefined => {
			const record = asRecord(item);
			const title = asString(asArray(record?.title)[0]);
			if (!record || !title) return undefined;
			const published = asArray(asRecord(record.published)?.["date-parts"])[0];
			const year = asNumber(asArray(published)[0]);
			const authors = asArray(record.author)
				.map((author) => {
					const authorRecord = asRecord(author);
					return [asString(authorRecord?.given), asString(authorRecord?.family)].filter(Boolean).join(" ");
				})
				.filter(Boolean);
			return {
				id: `CR${index + 1}`,
				title,
				year,
				venue: asString(asArray(record["container-title"])[0]),
				doi: normalizeDoi(record.DOI),
				url: asString(record.URL),
				authors,
				sourceApis: ["Crossref"],
				sourceQualityHint: "metadata",
				sourceSearchQueries: [],
				accessNotes: [],
				score: 0,
				scoreReasons: [],
			};
		})
		.filter((entry): entry is CandidatePoolEntry => Boolean(entry));
}

function parseIeeeEntries(payload: unknown): CandidatePoolEntry[] {
	const root = asRecord(payload);
	return asArray(root?.articles)
		.map((item, index): CandidatePoolEntry | undefined => {
			const record = asRecord(item);
			const title = asString(record?.title);
			if (!record || !title) return undefined;
			const authorsRoot = asRecord(record.authors);
			const authors = asArray(authorsRoot?.authors ?? record.authors)
				.map((author) => asString(asRecord(author)?.full_name) ?? asString(author))
				.filter((name): name is string => Boolean(name));
			const accessType = asString(record.accessType);
			const oaPdfUrl = asString(record.pdf_url);
			const openAccess = accessType ? /open access|ephemera/i.test(accessType) : undefined;
			return {
				id: `IEEE${index + 1}`,
				title,
				year: asYear(record.publication_year ?? record.publication_date),
				venue: asString(record.publication_title),
				doi: normalizeDoi(record.doi),
				url: asString(record.html_url) ?? asString(record.abstract_url),
				authors,
				citedByCount: asNumber(record.citing_paper_count),
				sourceApis: ["IEEE Xplore"],
				openAccess,
				oaPdfUrl,
				sourceQualityHint: asString(record.abstract) ? "abstract" : "metadata",
				sourceSearchQueries: [],
				accessNotes: [],
				score: 0,
				scoreReasons: [],
			};
		})
		.filter((entry): entry is CandidatePoolEntry => Boolean(entry));
}

function parseSemanticScholarEntries(payload: unknown): CandidatePoolEntry[] {
	const root = asRecord(payload);
	return asArray(root?.data)
		.map((item, index): CandidatePoolEntry | undefined => {
			const record = asRecord(item);
			const title = asString(record?.title);
			if (!record || !title) return undefined;
			const externalIds = asRecord(record.externalIds);
			const openAccessPdf = asRecord(record.openAccessPdf);
			const authors = asArray(record.authors)
				.map((author) => asString(asRecord(author)?.name))
				.filter((name): name is string => Boolean(name));
			const oaPdfUrl = asString(openAccessPdf?.url);
			return {
				id: `SS${index + 1}`,
				title,
				year: asYear(record.year),
				venue: asString(record.venue),
				doi: normalizeDoi(externalIds?.DOI),
				url: asString(record.url),
				authors,
				citedByCount: asNumber(record.citationCount),
				sourceApis: ["Semantic Scholar"],
				openAccess: oaPdfUrl ? true : undefined,
				oaPdfUrl,
				sourceQualityHint: asString(record.abstract) ? "abstract" : "metadata",
				sourceSearchQueries: [],
				accessNotes: [],
				score: 0,
				scoreReasons: [],
			};
		})
		.filter((entry): entry is CandidatePoolEntry => Boolean(entry));
}

function tagEntriesWithSearchQuery(entries: CandidatePoolEntry[], searchQuery: string): CandidatePoolEntry[] {
	return entries.map((entry) => ({
		...entry,
		sourceSearchQueries: Array.from(new Set([...entry.sourceSearchQueries, searchQuery])),
	}));
}

function mergeEntries(entries: CandidatePoolEntry[]): CandidatePoolEntry[] {
	const merged = new Map<string, CandidatePoolEntry>();
	for (const entry of entries) {
		const key = entryKey(entry);
		const existing = merged.get(key);
		if (!existing) {
			merged.set(key, { ...entry });
			continue;
		}
		existing.sourceApis = Array.from(new Set([...existing.sourceApis, ...entry.sourceApis]));
		existing.authors = existing.authors.length > 0 ? existing.authors : entry.authors;
		existing.year ??= entry.year;
		existing.venue ??= entry.venue;
		existing.doi ??= entry.doi;
		existing.url ??= entry.url;
		existing.citedByCount ??= entry.citedByCount;
		existing.openAccess ??= entry.openAccess;
		existing.oaLandingPageUrl ??= entry.oaLandingPageUrl;
		existing.oaPdfUrl ??= entry.oaPdfUrl;
		existing.sourceSearchQueries = Array.from(new Set([...existing.sourceSearchQueries, ...entry.sourceSearchQueries]));
		existing.accessNotes = Array.from(new Set([...existing.accessNotes, ...entry.accessNotes]));
		if (existing.sourceQualityHint === "metadata" && entry.sourceQualityHint !== "metadata") {
			existing.sourceQualityHint = entry.sourceQualityHint;
		}
	}
	return Array.from(merged.values());
}

function scoreEntry(entry: CandidatePoolEntry, relevanceQueries: string[]): CandidatePoolEntry {
	const reasons: string[] = [];
	let score = 0;
	const relevanceCandidates = relevanceQueries
		.map((query) => ({
			query,
			termCount: extractRelevanceTerms(query).size,
			...titleRelevanceScore(entry.title, query),
		}))
		.sort((left, right) => right.score - left.score || right.matchedTerms - left.matchedTerms);
	const relevance = relevanceCandidates[0] ?? { score: 0, matchedTerms: 0, termCount: 0 };
	if (relevance.score > 0) {
		score += relevance.score;
		reasons.push(`title-relevance:${relevance.matchedTerms}`);
		reasons.push(`best-query:${relevance.query}`);
		if (relevance.termCount >= 4 && relevance.matchedTerms === 1) {
			score -= 8;
			reasons.push("weak-title-match");
		}
	} else if (relevanceCandidates.some((candidate) => candidate.termCount > 0)) {
		score -= 5;
		reasons.push("title-mismatch");
	}
	if (entry.doi) {
		score += 2;
		reasons.push("doi");
	}
	if (entry.openAccess) {
		score += 2;
		reasons.push("open-access");
	}
	if (entry.oaPdfUrl) {
		score += 1;
		reasons.push("oa-pdf");
	}
	if (entry.citedByCount !== undefined) {
		const citationScore = Math.min(5, Math.floor(Math.log10(entry.citedByCount + 1) * 2));
		score += citationScore;
		if (citationScore > 0) reasons.push(`citations:${entry.citedByCount}`);
	}
	if (entry.sourceApis.length > 1) {
		score += 2;
		reasons.push(`cross-source:${entry.sourceApis.join("+")}`);
	}
	if (entry.year && entry.year >= new Date().getFullYear() - 5) {
		score += 1;
		reasons.push(`recent:${entry.year}`);
	}
	if (entry.sourceApis.includes("IEEE Xplore")) {
		score += 1;
		reasons.push("ieee");
	}
	if (entry.sourceApis.includes("Semantic Scholar")) {
		score += 1;
		reasons.push("semantic-scholar");
	}
	return {
		...entry,
		bestMatchingQuery: relevance.score > 0 ? relevance.query : undefined,
		score,
		scoreReasons: reasons,
	};
}

async function enrichWithUnpaywall(entries: CandidatePoolEntry[], config: ResearchApiConfig, fetchImpl?: ResearchApiFetch): Promise<void> {
	if (!config.unpaywallEmail) return;
	const doiEntries = entries.filter((entry) => entry.doi).slice(0, 20);
	const results = await Promise.allSettled(
		doiEntries.map((entry) => lookupUnpaywallDoi(entry.doi!, { config, fetch: fetchImpl })),
	);
	for (const [index, result] of results.entries()) {
		if (result.status !== "fulfilled") continue;
		const entry = doiEntries[index];
		const record = asRecord(result.value);
		const best = asRecord(record?.best_oa_location);
		const isOpenAccess = typeof record?.is_oa === "boolean" ? record.is_oa : undefined;
		entry.openAccess = isOpenAccess ?? entry.openAccess;
		entry.oaLandingPageUrl = asString(best?.url_for_landing_page) ?? entry.oaLandingPageUrl;
		entry.oaPdfUrl = asString(best?.url_for_pdf) ?? entry.oaPdfUrl;
		if (!entry.sourceApis.includes("Unpaywall")) {
			entry.sourceApis.push("Unpaywall");
		}
		if (entry.openAccess && entry.sourceQualityHint === "metadata") {
			entry.sourceQualityHint = entry.oaPdfUrl ? "full-text-sampled" : "abstract+conclusion";
		}
	}
}

export async function buildCandidatePool(query: string, options: {
	config?: ResearchApiConfig;
	fetch?: ResearchApiFetch;
	limit?: number;
	searchQueries?: string[];
} = {}): Promise<CandidatePool> {
	const config = options.config ?? loadResearchApiConfig();
	const fetchImpl = options.fetch;
	const warnings: string[] = [];
	const entries: CandidatePoolEntry[] = [];
	const searchQueries = Array.from(new Set([query, ...(options.searchQueries ?? [])].map((value) => value.trim()).filter(Boolean)));

	for (const searchQuery of searchQueries) {
		const openAlexResult = await Promise.allSettled([searchOpenAlexWorks(searchQuery, { config, fetch: fetchImpl })]);
		if (openAlexResult[0].status === "fulfilled") {
			entries.push(...tagEntriesWithSearchQuery(parseOpenAlexEntries(openAlexResult[0].value), searchQuery));
		} else {
			warnings.push(`OpenAlex unavailable for "${searchQuery}": ${openAlexResult[0].reason instanceof Error ? openAlexResult[0].reason.message : String(openAlexResult[0].reason)}`);
		}

		const crossrefResult = await Promise.allSettled([searchCrossrefWorks(searchQuery, { config, fetch: fetchImpl })]);
		if (crossrefResult[0].status === "fulfilled") {
			entries.push(...tagEntriesWithSearchQuery(parseCrossrefEntries(crossrefResult[0].value), searchQuery));
		} else {
			warnings.push(`Crossref unavailable for "${searchQuery}": ${crossrefResult[0].reason instanceof Error ? crossrefResult[0].reason.message : String(crossrefResult[0].reason)}`);
		}

		if (config.ieeeXploreApiKey) {
			const ieeeResult = await Promise.allSettled([searchIeeeXplore(searchQuery, { config, fetch: fetchImpl })]);
			if (ieeeResult[0].status === "fulfilled") {
				entries.push(...tagEntriesWithSearchQuery(parseIeeeEntries(ieeeResult[0].value), searchQuery));
			} else {
				warnings.push(`IEEE Xplore unavailable for "${searchQuery}": ${ieeeResult[0].reason instanceof Error ? ieeeResult[0].reason.message : String(ieeeResult[0].reason)}`);
			}
		}

		if (config.semanticScholarApiKey) {
			const semanticScholarResult = await Promise.allSettled([searchSemanticScholarPapers(searchQuery, { config, fetch: fetchImpl })]);
			if (semanticScholarResult[0].status === "fulfilled") {
				entries.push(...tagEntriesWithSearchQuery(parseSemanticScholarEntries(semanticScholarResult[0].value), searchQuery));
			} else {
				warnings.push(`Semantic Scholar unavailable for "${searchQuery}": ${semanticScholarResult[0].reason instanceof Error ? semanticScholarResult[0].reason.message : String(semanticScholarResult[0].reason)}`);
			}
		}
	}

	const merged = mergeEntries(entries);
	await enrichWithUnpaywall(merged, config, fetchImpl);
	const scored = merged
		.map(withAccessNotes)
		.map((entry) => scoreEntry(entry, searchQueries))
		.sort((left, right) => right.score - left.score || (right.citedByCount ?? 0) - (left.citedByCount ?? 0))
		.slice(0, options.limit ?? 30)
		.map((entry, index) => ({ ...entry, id: `C${index + 1}` }));

	return {
		query,
		searchQueries,
		generatedAt: new Date().toISOString(),
		entries: scored,
		warnings,
	};
}

export function formatCandidatePoolMarkdown(pool: CandidatePool): string {
	const lines = [
		`# Candidate Pool — ${pool.query}`,
		"",
		`Generated: ${pool.generatedAt}`,
		"",
		"## Summary",
		"",
		`- Candidates: ${pool.entries.length}`,
		`- Search queries: ${pool.searchQueries.length}`,
		`- Warnings: ${pool.warnings.length}`,
		"",
		"## Search Queries",
		"",
		...pool.searchQueries.map((searchQuery) => `- ${searchQuery}`),
		"",
	];
	if (pool.warnings.length > 0) {
		lines.push("## Warnings", "", ...pool.warnings.map((warning) => `- ${warning}`), "");
	}
	lines.push(
		"## Candidates",
		"",
		"| ID | Score | Year | Title | Venue | DOI | APIs | OA | Quality hint | Best query | Source queries | Why |",
		"|---|---:|---:|---|---|---|---|---|---|---|---|---|",
	);
	for (const entry of pool.entries) {
		lines.push([
			entry.id,
			String(entry.score),
			entry.year ? String(entry.year) : "",
			entry.title.replace(/\|/g, "\\|"),
			entry.venue?.replace(/\|/g, "\\|") ?? "",
			entry.doi ?? "",
			entry.sourceApis.join("+"),
			entry.openAccess === undefined ? "" : entry.openAccess ? "yes" : "no",
			entry.sourceQualityHint,
			entry.bestMatchingQuery?.replace(/\|/g, "\\|") ?? "",
			entry.sourceSearchQueries.join("; ").replace(/\|/g, "\\|"),
			entry.scoreReasons.join(", "),
		].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
	}
	lines.push("", "## Links", "");
	for (const entry of pool.entries) {
		lines.push(`- ${entry.id}: ${entry.url ?? entry.oaLandingPageUrl ?? entry.oaPdfUrl ?? "no URL"}${entry.oaPdfUrl ? ` (OA PDF: ${entry.oaPdfUrl})` : ""}`);
	}
	lines.push("", "## Access Fallback Notes", "");
	for (const entry of pool.entries) {
		lines.push(`- ${entry.id}: ${entry.accessNotes.join(" | ")}`);
	}
	return `${lines.join("\n")}\n`;
}

export async function writeCandidatePoolFile(query: string, slug: string, workingDir: string, options: {
	config?: ResearchApiConfig;
	fetch?: ResearchApiFetch;
	limit?: number;
	searchQueries?: string[];
} = {}): Promise<{ path: string; pool: CandidatePool }> {
	const pool = await buildCandidatePool(query, options);
	const draftDir = resolve(workingDir, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	const path = resolve(draftDir, `${slug}-candidate-pool.md`);
	writeFileSync(path, formatCandidatePoolMarkdown(pool), "utf8");
	return { path, pool };
}
