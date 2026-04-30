import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

function makeWorkspace(slug: string): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-fulltext-e2e-"));
	const draftDir = join(root, "outputs", ".drafts");
	mkdirSync(draftDir, { recursive: true });
	writeFileSync(
		join(draftDir, `${slug}-candidate-pool.md`),
		[
			"# Candidate Pool",
			"",
			"| ID | Title | Venue | Year | URL | Status |",
			"|----|-------|-------|------|-----|--------|",
			"| C1 | E2E Paper One | Test | 2026 | https://example.org/c1.pdf | Pending |",
			"| C10 | E2E Paper Ten | Test | 2026 | https://example.org/c10 | Pending |",
			"",
		].join("\n"),
		"utf8",
	);
	writeFileSync(join(draftDir, `${slug}-evidence-matrix.md`), "# Evidence Matrix\n\nExisting.\n", "utf8");
	return root;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
			cwd: process.cwd(),
			env,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", rejectPromise);
		child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
	});
}

function waitForSessionUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			rejectPromise(new Error(`Timed out waiting for session URL. stdout=${stdout} stderr=${stderr}`));
		}, 5000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			const match = stdout.match(/Full-text acquisition session:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
			if (match) {
				clearTimeout(timeout);
				resolvePromise(match[1]);
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			rejectPromise(error);
		});
		child.on("exit", (code) => {
			if (code !== null && code !== 0) {
				clearTimeout(timeout);
				rejectPromise(new Error(`Session exited before URL. code=${code} stdout=${stdout} stderr=${stderr}`));
			}
		});
	});
}

async function stopSession(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null) return;
	await new Promise<void>((resolvePromise) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			resolvePromise();
		}, 2000);
		child.once("close", () => {
			clearTimeout(timeout);
			resolvePromise();
		});
		child.kill("SIGINT");
	});
}

test("CLI e2e runs fulltext-fetch dry-run with documented dashed flags", async () => {
	const slug = "fetch-e2e";
	const root = makeWorkspace(slug);
	const home = mkdtempSync(join(tmpdir(), "feynman-home-e2e-"));

	const startedAt = Date.now();
	const result = await runCli(
		["--cwd", root, "research", "fulltext-fetch", `slug=${slug}`, "--dry-run", "--delay-ms", "30000"],
		{
			...process.env,
			FEYNMAN_HOME: home,
		},
	);
	const elapsedMs = Date.now() - startedAt;

	assert.equal(result.code, 0, result.stderr);
	assert.ok(elapsedMs < 5000, `dry-run unexpectedly waited ${elapsedMs}ms`);
	assert.match(result.stdout, /Full-text fetch log written:/);
	assert.match(result.stdout, /Downloaded PDFs: 0/);
	assert.match(result.stdout, /Automatic OA retry\/preview queue: 1/);
	assert.match(result.stdout, /Browser\/manual campus queue: 1/);

	const queuePath = join(root, "outputs", ".drafts", `${slug}-browser-queue.md`);
	assert.equal(existsSync(queuePath), true);
	const queue = readFileSync(queuePath, "utf8");
	assert.doesNotMatch(queue, /\| C1 \|/);
	assert.match(queue, /\| C10 \|/);
	assert.match(queue, /No OA PDF URL/);
	assert.equal(existsSync(join(root, "outputs", ".pdfs", slug, "01-C1-e2e-paper-one.pdf")), false);
});

test("CLI e2e serves fulltext-session and rejects fake PDF imports", async () => {
	const slug = "session-e2e";
	const root = makeWorkspace(slug);
	const home = mkdtempSync(join(tmpdir(), "feynman-home-e2e-"));
	const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "--cwd", root, "research", "fulltext-session", `slug=${slug}`, "limit=2", "host=0.0.0.0"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			FEYNMAN_HOME: home,
		},
	});

	try {
		const url = await waitForSessionUrl(child);
		const page = await fetch(url).then((response) => response.text());
		assert.doesNotMatch(page, /E2E Paper One/);
		assert.match(page, /E2E Paper Ten/);

		const badPath = join(root, "not-a-pdf.pdf");
		writeFileSync(badPath, "<html>not a pdf</html>", "utf8");
		const badImport = await fetch(new URL("/api/import-path", url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ candidate: "C10", path: badPath }),
		});
		assert.equal(badImport.ok, false);
		assert.match(await badImport.text(), /uploaded file is not a PDF/);

		const upload = await fetch(new URL("/api/upload?candidate=C10&filename=ten.pdf", url), {
			method: "POST",
			headers: { "content-type": "application/pdf" },
			body: pdfBytes,
		});
		assert.equal(upload.ok, true, await upload.text());

		const state = await fetch(new URL("/api/state", url)).then((response) => response.json()) as {
			imported: Array<{ id: string }>;
		};
		assert.deepEqual(state.imported.map((item) => item.id), ["C10"]);
		assert.equal(existsSync(join(root, "outputs", ".pdfs", slug, "C10-ten.pdf")), true);
	} finally {
		await stopSession(child);
	}
});

test("CLI e2e acquire runs candidate pool and fulltext fetch from one command", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-acquire-e2e-"));
	const home = mkdtempSync(join(tmpdir(), "feynman-home-e2e-"));

	const result = await runCli(
		[
			"--cwd",
			root,
			"research",
			"acquire",
			"slug=acquire-e2e",
			"limit=3",
			"fetch-limit=3",
			"--dry-run",
			"--no-session",
			"small signal stability power electronics",
		],
		{
			...process.env,
			FEYNMAN_HOME: home,
			OPENALEX_API_KEY: "",
			SEMANTIC_SCHOLAR_API_KEY: "",
			IEEE_XPLORE_API_KEY: "",
			ELSEVIER_API_KEY: "",
			FIRECRAWL_API_KEY: "",
		},
	);

	assert.equal(result.code, 0, result.stderr);
	assert.match(result.stdout, /Research acquisition slug: acquire-e2e/);
	assert.match(result.stdout, /Candidate pool written:/);
	assert.match(result.stdout, /Full-text fetch log written:/);
	assert.equal(existsSync(join(root, "outputs", ".drafts", "acquire-e2e-candidate-pool.md")), true);
	assert.equal(existsSync(join(root, "outputs", ".drafts", "acquire-e2e-fulltext-log.md")), true);
	assert.equal(existsSync(join(root, "outputs", ".drafts", "acquire-e2e-browser-queue.md")), true);
});
