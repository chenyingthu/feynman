import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleResearchCommand } from "../src/research/commands.js";
import { getDefaultFullTextFetchTimeoutMs, importFullTextPdf, isProbablyPdf, runFullTextFetch } from "../src/research/fulltext-fetch.js";

test("fulltext-fetch does not import undeclared undici directly", async () => {
	const source = readFileSync(join(process.cwd(), "src", "research", "fulltext-fetch.ts"), "utf8");
	assert.doesNotMatch(source, /from "undici"/);
});

const candidatePoolMarkdown = `# Candidate Pool — test

## Candidates

| ID | Score | Year | Title | Venue | DOI | APIs | OA | Quality hint | Best query | Source queries | Why |
|---|---:|---:|---|---|---|---|---|---|---|---|---|
| C1 | 10 | 2024 | Open PDF Paper | Journal | 10.1234/open | OpenAlex | yes | abstract+conclusion | test | test | oa-pdf |
| C2 | 8 | 2023 | DOI Only Paper | Journal | 10.1234/doi-only | Crossref | yes | metadata | test | test | doi |

## Links

- C1: https://example.org/open (OA PDF: https://example.org/open.pdf)
- C2: https://doi.org/10.1234/doi-only

## Access Fallback Notes

- C1: DOI landing: https://doi.org/10.1234/open | OA PDF candidate: https://example.org/open.pdf; cite as read only after successful fetch/parse
- C2: DOI landing: https://doi.org/10.1234/doi-only
`;

function makeWorkspace(slug = "test-slug"): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(join(draftDir, `${slug}-candidate-pool.md`), candidatePoolMarkdown, "utf8");
	writeFileSync(join(draftDir, `${slug}-evidence-matrix.md`), "# Evidence Matrix\n\nExisting evidence.\n", "utf8");
	return root;
}

function fakeFetch(input: string | URL | Request): Promise<Response> {
	const url = input instanceof URL ? input : new URL(String(input));
	if (url.hostname === "api.unpaywall.org") {
		return Promise.resolve({
			ok: true,
			json: async () => ({
				is_oa: true,
				best_oa_location: {
					url_for_landing_page: "https://oa.example.org/doi-only",
					url_for_pdf: "https://oa.example.org/doi-only.pdf",
				},
			}),
		} as Response);
	}
	if (url.href === "https://example.org/open.pdf" || url.href === "https://oa.example.org/doi-only.pdf") {
		return Promise.resolve(new Response(Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"), {
			status: 200,
			headers: { "content-type": "application/pdf" },
		}));
	}
	throw new Error(`Unexpected URL ${url.href}`);
}

test("runFullTextFetch downloads OA PDFs, writes logs and updates evidence matrix", async () => {
	const slug = "test-slug";
	const root = makeWorkspace(slug);

	const result = await runFullTextFetch(slug, root, {
		config: { unpaywallEmail: "user@example.com" },
		fetch: fakeFetch as typeof fetch,
		sleep: async () => {},
		delayMs: 0,
		now: () => new Date("2026-04-28T00:00:00.000Z"),
	});

	assert.equal(result.downloaded.length, 2);
	assert.equal(result.automaticQueue.length, 0);
	assert.equal(result.queued.length, 0);
	assert.equal(existsSync(result.logPath), true);
	assert.equal(existsSync(result.extractsPath), true);
	assert.equal(existsSync(result.browserQueuePath), true);

	const log = readFileSync(result.logPath, "utf8");
	assert.match(log, /Downloaded PDFs: 2/);
	assert.match(log, /outputs\/\.pdfs\/test-slug/);
	assert.doesNotMatch(log, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

	const evidence = readFileSync(join(root, "outputs", ".drafts", `${slug}-evidence-matrix.md`), "utf8");
	assert.match(evidence, /Full-Text Fetch Updates/);
	assert.match(evidence, /full-text-sampled/);
	assert.match(evidence, /outputs\/\.pdfs\/test-slug/);
});

test("runFullTextFetch creates evidence matrix updates when none exists yet", async () => {
	const slug = "new-evidence";
	const root = makeWorkspace(slug);
	const evidencePath = join(root, "outputs", ".drafts", `${slug}-evidence-matrix.md`);
	rmSync(evidencePath);

	const result = await runFullTextFetch(slug, root, {
		config: { unpaywallEmail: "user@example.com" },
		fetch: fakeFetch as typeof fetch,
		sleep: async () => {},
		delayMs: 0,
		now: () => new Date("2026-04-28T00:00:00.000Z"),
	});

	assert.equal(result.downloaded.length, 2);
	assert.equal(existsSync(evidencePath), true);
	const evidence = readFileSync(evidencePath, "utf8");
	assert.match(evidence, /Generated from full-text acquisition artifacts/);
	assert.match(evidence, /Full-Text Fetch Updates/);
	assert.match(evidence, /full-text-sampled/);
});

test("runFullTextFetch dry-run queues PDF candidates without downloading", async () => {
	const slug = "dry-run";
	const root = makeWorkspace(slug);
	const sleepCalls: number[] = [];

	const result = await runFullTextFetch(slug, root, {
		config: { unpaywallEmail: "user@example.com" },
		fetch: fakeFetch as typeof fetch,
		sleep: async (ms) => {
			sleepCalls.push(ms);
		},
		delayMs: 30_000,
		dryRun: true,
	});

	assert.equal(result.downloaded.length, 0);
	assert.equal(result.automaticQueue.length, 2);
	assert.equal(result.queued.length, 0);
	assert.deepEqual(sleepCalls, []);

	const queue = readFileSync(result.browserQueuePath, "utf8");
	assert.match(queue, /Browser-Assisted Campus Full-Text Queue/);
	assert.doesNotMatch(queue, /dry-run OA PDF candidate/);
});

test("importFullTextPdf rejects non-PDF bytes even when the caller supplied a PDF filename", () => {
	const slug = "reject-html";
	const root = makeWorkspace(slug);

	assert.throws(
		() => importFullTextPdf(slug, root, { id: "C1", title: "Wrong Bytes" }, Buffer.from("<html>not a pdf</html>"), "wrong.pdf"),
		/uploaded file is not a PDF/,
	);
});

test("isProbablyPdf validates bytes instead of trusting content-type", () => {
	assert.equal(isProbablyPdf(Buffer.from("<html>not a pdf</html>"), "application/pdf"), false);
	assert.equal(isProbablyPdf(Buffer.from("%PDF-1.4\n"), "text/html"), true);
});

test("fulltext-fetch default PDF timeout is patient enough for slow OA downloads", () => {
	assert.equal(getDefaultFullTextFetchTimeoutMs(), 60_000);
});

test("handleResearchCommand wires fulltext-fetch options into the CLI command surface", async () => {
	const slug = "cli-slug";
	const root = makeWorkspace(slug);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = fakeFetch as typeof fetch;
	try {
		await handleResearchCommand("fulltext-fetch", [`slug=${slug}`, "limit=1", "delay-ms=0", "--dry-run"], root);
	} finally {
		globalThis.fetch = originalFetch;
	}

	const queuePath = join(root, "outputs", ".drafts", `${slug}-browser-queue.md`);
	assert.equal(existsSync(queuePath), true);
	const queue = readFileSync(queuePath, "utf8");
	assert.doesNotMatch(queue, /C1/);
	assert.doesNotMatch(queue, /C2/);
});

test("runFullTextFetch parses grouped hand-authored candidate pool tables", async () => {
	const slug = "grouped";
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-grouped-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool: grouped",
			"",
			"| ID | Title | Venue | Year | URL | Status |",
			"|----|-------|-------|------|-----|--------|",
			"| R1 | Review Paper | IEEE | 2026 | https://example.org/review.pdf | Pending |",
			"| S1 | State Space Paper | NREL | 2024 | https://example.org/state-space | Pending |",
			"",
		].join("\n"),
		"utf8",
	);

	const result = await runFullTextFetch(slug, root, {
		config: {},
		fetch: fakeFetch as typeof fetch,
		sleep: async () => {},
		delayMs: 0,
		dryRun: true,
	});

	assert.equal(result.automaticQueue.length, 1);
	assert.equal(result.queued.length, 1);
	assert.equal(result.automaticQueue[0].candidate.id, "R1");
	assert.equal(result.automaticQueue[0].url, "https://example.org/review.pdf");
	assert.equal(result.queued[0].candidate.id, "S1");
});

test("runFullTextFetch parses lit-generated DOI/URL candidate pool tables", async () => {
	const slug = "doi-url";
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-doi-url-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Title | Authors | Year | Venue | DOI/URL | Source Quality |",
			"|----|-------|---------|------|-------|---------|----------------|",
			"| R1 | DOI Paper | Example | 2026 | Test | 10.1234/doi-only | abstract |",
			"| A1 | Arxiv Paper | Example | 2026 | arXiv | 2602.19522 | abstract |",
			"| A2 | Legacy Arxiv Paper | Example | 2017 | arXiv | arXiv:1707.09676 | abstract |",
			"| X1 | Missing Paper | Example | 2026 | Test | — | abstract |",
			"",
		].join("\n"),
		"utf8",
	);

	const result = await runFullTextFetch(slug, root, {
		config: {},
		fetch: fakeFetch as typeof fetch,
		sleep: async () => {},
		delayMs: 0,
		dryRun: true,
	});

	const arxiv = result.automaticQueue.find((item) => item.candidate.id === "A1");
	const legacyArxiv = result.automaticQueue.find((item) => item.candidate.id === "A2");
	const doiOnly = result.queued.find((item) => item.candidate.id === "R1");
	const missing = result.queued.find((item) => item.candidate.id === "X1");
	assert.equal(arxiv?.candidate.oaPdfUrl, "https://arxiv.org/pdf/2602.19522");
	assert.equal(arxiv?.url, "https://arxiv.org/pdf/2602.19522");
	assert.equal(legacyArxiv?.candidate.oaPdfUrl, "https://arxiv.org/pdf/1707.09676");
	assert.equal(legacyArxiv?.url, "https://arxiv.org/pdf/1707.09676");
	assert.equal(doiOnly?.candidate.doi, "10.1234/doi-only");
	assert.equal(doiOnly?.url, "https://doi.org/10.1234/doi-only");
	assert.equal(missing?.candidate.doi, undefined);
	assert.equal(missing?.url, undefined);
});

test("runFullTextFetch does not treat access fallback prose as a source URL", async () => {
	const slug = "fallback-notes";
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-fallback-notes-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Score | Year | Title | Venue | DOI | APIs | OA | Quality hint | Best query | Source queries | Why |",
			"|---|---:|---:|---|---|---|---|---|---|---|---|---|",
			"| C1 | 10 | 2026 | Campus Paper | Journal | 10.1234/campus | OpenAlex | no | metadata | test | test | doi |",
			"",
			"## Access Fallback Notes",
			"",
			"- C1: DOI landing: https://doi.org/10.1234/campus | Landing page: https://doi.org/10.1234/campus | Fallback if full text is blocked: metadata-only",
			"",
		].join("\n"),
		"utf8",
	);

	const result = await runFullTextFetch(slug, root, {
		config: {},
		fetch: fakeFetch as typeof fetch,
		sleep: async () => {},
		delayMs: 0,
		dryRun: true,
	});

	assert.equal(result.queued[0].candidate.url, "https://doi.org/10.1234/campus");
	assert.equal(result.queued[0].url, "https://doi.org/10.1234/campus");
	assert.doesNotMatch(readFileSync(result.browserQueuePath, "utf8"), /\|\s*DOI\s*\|/);
});

test("runFullTextFetch defaults PDF downloads to direct fetch instead of global fetch", async () => {
	const server = createServer((request, response) => {
		if (request.url !== "/paper.pdf") {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": "application/pdf" });
		response.end(Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"));
	});
	await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
	try {
		const address = server.address();
		assert.equal(typeof address, "object");
		const pdfUrl = `http://127.0.0.1:${(address as AddressInfo).port}/paper.pdf`;
		const slug = "direct";
		const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-direct-"));
		const draftDir = join(root, "outputs", ".drafts");
		mkdirSync(draftDir, { recursive: true });
		writeFileSync(
			join(draftDir, `${slug}-candidate-pool.md`),
			[
				"# Candidate Pool: direct",
				"",
				"| ID | Title | Venue | Year | URL | Status |",
				"|----|-------|-------|------|-----|--------|",
				`| R1 | Direct PDF Paper | Local | 2026 | ${pdfUrl} | Pending |`,
				"",
			].join("\n"),
			"utf8",
		);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error("global fetch should not be used for PDF downloads");
		}) as typeof fetch;
		try {
			const result = await runFullTextFetch(slug, root, {
				sleep: async () => {},
				delayMs: 0,
			});
			assert.equal(result.downloaded.length, 1);
			assert.equal(result.warnings.length, 0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	} finally {
		await new Promise<void>((resolvePromise, rejectPromise) => {
			server.close((error) => error ? rejectPromise(error) : resolvePromise());
		});
	}
});

test("runFullTextFetch times out stalled PDF downloads and queues them", async () => {
	const slug = "timeout";
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-timeout-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Title | Venue | Year | URL | Status |",
			"|----|-------|-------|------|-----|--------|",
			"| T1 | Timeout Paper | Test | 2026 | https://example.org/slow.pdf | Pending |",
			"",
		].join("\n"),
		"utf8",
	);

	const result = await runFullTextFetch(slug, root, {
		config: {},
		fetch: (() => new Promise<Response>(() => {})) as typeof fetch,
		sleep: async () => {},
		delayMs: 0,
		timeoutMs: 5,
	});

	assert.equal(result.downloaded.length, 0);
	assert.equal(result.automaticQueue.length, 1);
	assert.equal(result.queued.length, 0);
	assert.equal(result.automaticQueue[0].reason, "OA PDF download failed; retry automatic fetch later or with proxy");
	assert.match(result.warnings.join("\n"), /timed out after 5ms/);
});
