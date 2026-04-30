import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startFullTextSession } from "../src/research/fulltext-session.js";

const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

function makeWorkspace(slug: string): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-session-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Title | Venue | Year | URL | Status |",
			"|----|-------|-------|------|-----|--------|",
			"| R1 | Session Paper One | Test | 2026 | https://example.org/r1 | Pending |",
			"| R2 | Session Paper Two | Test | 2026 | https://example.org/r2 | Pending |",
			"",
		].join("\n"),
		"utf8",
	);
	writeFileSync(join(draftDir, `${slug}-evidence-matrix.md`), "# Evidence Matrix\n\nExisting.\n", "utf8");
	return root;
}

function makeWorkspaceWithoutEvidence(slug: string): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-session-no-evidence-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Title | Venue | Year | URL | Status |",
			"|----|-------|-------|------|-----|--------|",
			"| R1 | Session Paper One | Test | 2026 | https://example.org/r1 | Pending |",
			"",
		].join("\n"),
		"utf8",
	);
	return root;
}

function makePrefixWorkspace(slug: string): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-prefix-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Title | Venue | Year | URL | Status |",
			"|----|-------|-------|------|-----|--------|",
			"| C1 | Prefix Paper One | Test | 2026 | https://example.org/c1 | Pending |",
			"| C10 | Prefix Paper Ten | Test | 2026 | https://example.org/c10 | Pending |",
			"",
		].join("\n"),
		"utf8",
	);
	return root;
}

function makeOaWorkspace(slug: string): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-oa-session-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Title | Venue | Year | DOI/URL | Status |",
			"|----|-------|-------|------|---------|--------|",
			"| OA1 | Open Access Paper | arXiv | 2026 | 2602.19522 | Pending |",
			"| N1 | Non OA Paper | IEEE | 2026 | 10.1109/example | Pending |",
			"",
		].join("\n"),
		"utf8",
	);
	return root;
}

function makeBrowserQueueWorkspace(slug: string): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-queue-session-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Title | Venue | Year | DOI/URL | Status |",
			"|----|-------|-------|------|---------|--------|",
			"| C1 | Unpaywall OA DOI Paper | Test | 2026 | 10.1234/oa-after-fetch | Pending |",
			"| C2 | Campus Needed Paper | Test | 2026 | 10.1234/non-oa | Pending |",
			"",
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		join(draftDir, `${slug}-browser-queue.md`),
		[
			"# Browser-Assisted Campus Full-Text Queue",
			"",
			"| Candidate ID | Title | Reason | URL |",
			"|---|---|---|---|",
			"| C2 | Campus Needed Paper | No OA PDF URL; use campus-network browser access if needed | https://doi.org/10.1234/non-oa |",
			"",
		].join("\n"),
		"utf8",
	);
	return root;
}

test("fulltext session serves candidates and imports uploaded PDFs", async () => {
	const slug = "session-test";
	const root = makeWorkspace(slug);
	const session = await startFullTextSession(slug, root, { limit: 2 });
	try {
		const page = await fetch(session.url).then((response) => response.text());
		assert.match(page, /Full-text Acquisition/);
		assert.match(page, /Session Paper One/);

		const uploadResponse = await fetch(new URL("/api/upload?candidate=R1&filename=session-paper.pdf", session.url), {
			method: "POST",
			headers: { "content-type": "application/pdf" },
			body: pdfBytes,
		});
		assert.equal(uploadResponse.ok, true);

		const state = await fetch(new URL("/api/state", session.url)).then((response) => response.json()) as {
			imported: Array<{ id: string; textChars: number }>;
		};
		assert.equal(state.imported.length, 1);
		assert.equal(state.imported[0].id, "R1");
		assert.ok(state.imported[0].textChars > 0);

		assert.equal(existsSync(join(root, "outputs", ".pdfs", slug, "R1-session-paper.pdf")), true);
		const extracts = readFileSync(join(root, "outputs", ".drafts", `${slug}-fulltext-extracts.md`), "utf8");
		assert.match(extracts, /Full-Text Session Imports/);
		assert.match(extracts, /Session Paper One/);

		const evidence = readFileSync(join(root, "outputs", ".drafts", `${slug}-evidence-matrix.md`), "utf8");
		assert.match(evidence, /Full-Text Session Imports/);
		assert.match(evidence, /full-text-sampled/);
	} finally {
		await session.close();
	}
});

test("fulltext session creates evidence matrix when none exists yet", async () => {
	const slug = "session-new-evidence";
	const root = makeWorkspaceWithoutEvidence(slug);
	const session = await startFullTextSession(slug, root, { limit: 1 });
	try {
		const uploadResponse = await fetch(new URL("/api/upload?candidate=R1&filename=session-paper.pdf", session.url), {
			method: "POST",
			headers: { "content-type": "application/pdf" },
			body: pdfBytes,
		});
		assert.equal(uploadResponse.ok, true);

		const evidence = readFileSync(join(root, "outputs", ".drafts", `${slug}-evidence-matrix.md`), "utf8");
		assert.match(evidence, /Generated from full-text acquisition artifacts/);
		assert.match(evidence, /Full-Text Session Imports/);
		assert.match(evidence, /full-text-sampled/);
	} finally {
		await session.close();
	}
});

test("fulltext session resume preserves existing imported artifacts", async () => {
	const slug = "resume-session";
	const root = makeWorkspace(slug);
	let session = await startFullTextSession(slug, root, { limit: 2 });
	try {
		const uploadResponse = await fetch(new URL("/api/upload?candidate=R1&filename=session-paper.pdf", session.url), {
			method: "POST",
			headers: { "content-type": "application/pdf" },
			body: pdfBytes,
		});
		assert.equal(uploadResponse.ok, true);
	} finally {
		await session.close();
	}

	const before = readFileSync(join(root, "outputs", ".drafts", `${slug}-fulltext-session.md`), "utf8");
	assert.match(before, /R1/);
	assert.match(before, /Session Paper One/);

	session = await startFullTextSession(slug, root, { limit: 2 });
	try {
		const state = await fetch(new URL("/api/state", session.url)).then((response) => response.json()) as {
			imported: Array<{ id: string }>;
		};
		assert.deepEqual(state.imported.map((item) => item.id), ["R1"]);
		const after = readFileSync(join(root, "outputs", ".drafts", `${slug}-fulltext-session.md`), "utf8");
		assert.equal(after, before);
	} finally {
		await session.close();
	}
});

test("download watcher matches candidate IDs without prefix collisions", async () => {
	const slug = "prefix-test";
	const root = makePrefixWorkspace(slug);
	const downloads = mkdtempSync(join(tmpdir(), "feynman-downloads-"));
	const session = await startFullTextSession(slug, root, { limit: 2, watchDownloads: downloads });
	try {
		writeFileSync(join(downloads, "download-C10-paper.pdf"), pdfBytes);

		let imported: Array<{ id: string }> = [];
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const state = await fetch(new URL("/api/state", session.url)).then((response) => response.json()) as {
				imported: Array<{ id: string }>;
			};
			imported = state.imported;
			if (imported.length > 0) break;
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
		}

		assert.deepEqual(imported.map((item) => item.id), ["C10"]);
		assert.equal(existsSync(join(root, "outputs", ".pdfs", slug, "C10-download-c10-paper.pdf")), true);
		assert.equal(existsSync(join(root, "outputs", ".pdfs", slug, "C1-download-c10-paper.pdf")), false);
	} finally {
		await session.close();
	}
});

test("fulltext session can bind to all interfaces for LAN access", async () => {
	const slug = "lan-session";
	const root = makeWorkspace(slug);
	const session = await startFullTextSession(slug, root, { host: "0.0.0.0", limit: 1 });
	try {
		assert.match(session.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
		const page = await fetch(session.url).then((response) => response.text());
		assert.match(page, /Session Paper One/);
	} finally {
		await session.close();
	}
});

test("fulltext session hides candidates that already have local PDFs", async () => {
	const slug = "skip-local";
	const root = makeWorkspace(slug);
	const pdfDir = join(root, "outputs", ".pdfs", slug);
	mkdirSync(pdfDir, { recursive: true });
	writeFileSync(join(pdfDir, "R1-existing-paper.pdf"), pdfBytes);
	const session = await startFullTextSession(slug, root, { limit: 2 });
	try {
		const page = await fetch(session.url).then((response) => response.text());
		assert.doesNotMatch(page, /Session Paper One/);
		assert.match(page, /Session Paper Two/);
	} finally {
		await session.close();
	}
});

test("fulltext session hides OA PDF candidates because they should be fetched automatically", async () => {
	const slug = "skip-oa";
	const root = makeOaWorkspace(slug);
	const session = await startFullTextSession(slug, root, { limit: 2 });
	try {
		const page = await fetch(session.url).then((response) => response.text());
		assert.doesNotMatch(page, /Open Access Paper/);
		assert.match(page, /Non OA Paper/);
	} finally {
		await session.close();
	}
});

test("fulltext session prefers fetch browser queue so Unpaywall-discovered OA items are not sent to campus workflow", async () => {
	const slug = "fetch-queue";
	const root = makeBrowserQueueWorkspace(slug);
	const session = await startFullTextSession(slug, root, { limit: 2 });
	try {
		const page = await fetch(session.url).then((response) => response.text());
		assert.doesNotMatch(page, /Unpaywall OA DOI Paper/);
		assert.match(page, /Campus Needed Paper/);
	} finally {
		await session.close();
	}
});
