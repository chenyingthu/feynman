import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { basename, extname, isAbsolute, resolve } from "node:path";
import type { AddressInfo } from "node:net";

import {
	getFullTextPdfDir,
	getFullTextDraftDir,
	importFullTextPdf,
	readFullTextCandidates,
	writeFullTextSessionArtifacts,
	type FullTextFetchCandidate,
	type FullTextImportedPdf,
} from "./fulltext-fetch.js";

export type FullTextSessionOptions = {
	port?: number;
	host?: string;
	limit?: number;
	watchDownloads?: string;
};

export type FullTextSessionHandle = {
	url: string;
	close: () => Promise<void>;
};

type SessionState = {
	slug: string;
	workingDir: string;
	candidates: FullTextFetchCandidate[];
	imported: FullTextImportedPdf[];
	watchDownloads?: string;
};

function escapeHtml(value: string | undefined): string {
	return (value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function jsonResponse(response: ServerResponse, status: number, payload: unknown): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(payload));
}

function textResponse(response: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
	response.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
	});
	response.end(body);
}

function readRequestBody(request: IncomingMessage, maxBytes = 100 * 1024 * 1024): Promise<Buffer> {
	return new Promise((resolvePromise, rejectPromise) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on("data", (chunk: Buffer) => {
			size += chunk.byteLength;
			if (size > maxBytes) {
				rejectPromise(new Error(`Request body too large (${size} bytes)`));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => resolvePromise(Buffer.concat(chunks)));
		request.on("error", rejectPromise);
	});
}

function parseJsonBody(body: Buffer): Record<string, unknown> {
	const parsed = JSON.parse(body.toString("utf8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Expected a JSON object");
	}
	return parsed as Record<string, unknown>;
}

function findCandidate(state: SessionState, id: string | null): FullTextFetchCandidate {
	const candidate = state.candidates.find((item) => item.id === id);
	if (!candidate) {
		throw new Error(`Unknown candidate: ${id ?? ""}`);
	}
	return candidate;
}

function serializeState(state: SessionState): object {
	return {
		slug: state.slug,
		watchDownloads: state.watchDownloads,
		candidates: state.candidates.map((candidate) => {
			const imported = state.imported.find((item) => item.candidate.id === candidate.id);
			return {
				...candidate,
				imported: imported ? {
					path: imported.path,
					bytes: imported.bytes,
					textChars: imported.textChars,
				} : undefined,
			};
		}),
		imported: state.imported.map((item) => ({
			id: item.candidate.id,
			title: item.candidate.title,
			path: item.path,
			bytes: item.bytes,
			textChars: item.textChars,
		})),
	};
}

function upsertImported(state: SessionState, imported: FullTextImportedPdf): void {
	const existingIndex = state.imported.findIndex((item) => item.candidate.id === imported.candidate.id);
	if (existingIndex >= 0) {
		state.imported[existingIndex] = imported;
	} else {
		state.imported.push(imported);
	}
	writeFullTextSessionArtifacts(state.slug, state.workingDir, state.imported);
}

function renderPage(state: SessionState): string {
	const rows = state.candidates.map((candidate) => {
		const imported = state.imported.find((item) => item.candidate.id === candidate.id);
		const links = [
			candidate.url ? `<a href="${escapeHtml(candidate.url)}" target="_blank" rel="noreferrer">Open source</a>` : "",
			candidate.doi ? `<a href="https://doi.org/${escapeHtml(candidate.doi)}" target="_blank" rel="noreferrer">DOI</a>` : "",
			candidate.oaPdfUrl ? `<a href="${escapeHtml(candidate.oaPdfUrl)}" target="_blank" rel="noreferrer">OA PDF</a>` : "",
		].filter(Boolean).join(" · ");
		return `<article class="paper" data-id="${escapeHtml(candidate.id)}">
			<div class="meta">
				<div class="id">${escapeHtml(candidate.id)}</div>
				<div>
					<h2>${escapeHtml(candidate.title)}</h2>
					<p>${links || "No URL available"}</p>
					<p class="status">${imported ? `Imported: ${escapeHtml(imported.path)} (${imported.textChars} chars)` : "Waiting for PDF"}</p>
				</div>
			</div>
			<form class="upload" data-id="${escapeHtml(candidate.id)}">
				<input name="pdf" type="file" accept="application/pdf,.pdf" required />
				<button type="submit">Upload PDF</button>
			</form>
		</article>`;
	}).join("\n");
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Feynman Full-text Session - ${escapeHtml(state.slug)}</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 0; background: #f7f7f4; color: #1f2520; }
		header { position: sticky; top: 0; background: #ffffff; border-bottom: 1px solid #d8ddd4; padding: 16px 24px; }
		main { max-width: 1120px; margin: 0 auto; padding: 20px; }
		h1 { font-size: 22px; margin: 0 0 6px; }
		h2 { font-size: 16px; margin: 0 0 6px; }
		p { margin: 0 0 6px; color: #4c574f; }
		.paper { background: #fff; border: 1px solid #d8ddd4; border-radius: 8px; padding: 14px; margin-bottom: 12px; }
		.meta { display: grid; grid-template-columns: 52px 1fr; gap: 12px; align-items: start; }
		.id { font-weight: 700; background: #1f6f5b; color: white; border-radius: 6px; padding: 8px; text-align: center; }
		.upload { display: flex; gap: 10px; margin-top: 10px; align-items: center; }
		button { background: #2a5caa; color: white; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
		button:disabled { background: #9aa6b2; cursor: wait; }
		.status { font-size: 13px; }
		.topline { display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; color: #4c574f; }
		a { color: #1f5f9f; }
	</style>
</head>
<body>
	<header>
		<h1>Full-text Acquisition: ${escapeHtml(state.slug)}</h1>
		<div class="topline">
			<span>${state.imported.length}/${state.candidates.length} PDFs imported</span>
			<span>PDF dir: ${escapeHtml(getFullTextPdfDir(state.workingDir, state.slug))}</span>
			${state.watchDownloads ? `<span>Watching: ${escapeHtml(state.watchDownloads)}</span>` : ""}
		</div>
	</header>
	<main>${rows}</main>
	<script>
		for (const form of document.querySelectorAll("form.upload")) {
			form.addEventListener("submit", async (event) => {
				event.preventDefault();
				const button = form.querySelector("button");
				const input = form.querySelector("input[type=file]");
				const file = input.files[0];
				if (!file) return;
				button.disabled = true;
				const bytes = await file.arrayBuffer();
				const response = await fetch("/api/upload?candidate=" + encodeURIComponent(form.dataset.id) + "&filename=" + encodeURIComponent(file.name), {
					method: "POST",
					headers: { "content-type": "application/pdf" },
					body: bytes,
				});
				const payload = await response.json();
				if (!response.ok) {
					alert(payload.error || "Upload failed");
					button.disabled = false;
					return;
				}
				location.reload();
			});
		}
	</script>
</body>
</html>`;
}

function candidateIdFromFilename(filename: string, candidates: FullTextFetchCandidate[]): string | undefined {
	const normalized = basename(filename).toLowerCase();
	return candidates.find((candidate) => {
		const id = candidate.id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(^|[^a-z0-9])${id}($|[^a-z0-9])`, "i").test(normalized);
	})?.id;
}

function hasLocalPdf(candidate: FullTextFetchCandidate, pdfDir: string): boolean {
	if (!existsSync(pdfDir)) return false;
	return readdirSync(pdfDir).some((filename) => {
		if (extname(filename).toLowerCase() !== ".pdf") return false;
		return candidateIdFromFilename(filename, [candidate]) === candidate.id;
	});
}

function parseBrowserQueueCandidateIds(slug: string, workingDir: string): string[] | undefined {
	const queuePath = resolve(getFullTextDraftDir(workingDir), `${slug}-browser-queue.md`);
	if (!existsSync(queuePath)) return undefined;
	const ids: string[] = [];
	for (const line of readFileSync(queuePath, "utf8").split(/\r?\n/)) {
		const cells = line
			.trim()
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((cell) => cell.trim());
		if (cells.length < 4 || cells[0].toLowerCase() === "candidate id" || /^-+$/.test(cells[0])) continue;
		if (cells[0].toLowerCase() === "none") continue;
		if (/^[A-Z]{0,4}\d+$/i.test(cells[0])) ids.push(cells[0]);
	}
	return ids;
}

function parseExistingSessionImports(slug: string, workingDir: string, candidates: FullTextFetchCandidate[]): FullTextImportedPdf[] {
	const sessionPath = resolve(getFullTextDraftDir(workingDir), `${slug}-fulltext-session.md`);
	if (!existsSync(sessionPath)) return [];
	const imported: FullTextImportedPdf[] = [];
	for (const line of readFileSync(sessionPath, "utf8").split(/\r?\n/)) {
		if (!line.startsWith("|")) continue;
		const cells = line
			.trim()
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((cell) => cell.trim());
		if (cells.length < 5 || cells[0].toLowerCase() === "candidate id" || /^-+$/.test(cells[0])) continue;
		const candidate = candidates.find((item) => item.id === cells[0]);
		if (!candidate) continue;
		const pdfPath = isAbsolute(cells[2]) ? cells[2] : resolve(workingDir, cells[2]);
		if (!existsSync(pdfPath)) continue;
		const bytes = Number.parseInt(cells[3], 10);
		const textChars = Number.parseInt(cells[4], 10);
		imported.push({
			candidate,
			path: pdfPath,
			bytes: Number.isFinite(bytes) ? bytes : readFileSync(pdfPath).byteLength,
			textChars: Number.isFinite(textChars) ? textChars : 0,
		});
	}
	return imported;
}

function startDownloadWatcher(state: SessionState, directory: string): FSWatcher | undefined {
	if (!existsSync(directory)) return undefined;
	return watch(directory, { persistent: true }, (eventType, filename) => {
		if (eventType !== "rename" && eventType !== "change") return;
		if (!filename || extname(filename).toLowerCase() !== ".pdf") return;
		const candidateId = candidateIdFromFilename(filename, state.candidates);
		if (!candidateId) return;
		const candidate = findCandidate(state, candidateId);
		const sourcePath = resolve(directory, filename);
		if (!existsSync(sourcePath)) return;
		try {
			const imported = importFullTextPdf(state.slug, state.workingDir, candidate, readFileSync(sourcePath), filename);
			upsertImported(state, imported);
		} catch {
			// Ignore transient incomplete browser downloads; explicit upload remains available.
		}
	});
}

export async function startFullTextSession(slug: string, workingDir: string, options: FullTextSessionOptions = {}): Promise<FullTextSessionHandle> {
	const host = options.host ?? "127.0.0.1";
	const pdfDir = getFullTextPdfDir(workingDir, slug);
	mkdirSync(pdfDir, { recursive: true });
	const { candidates: allCandidates } = readFullTextCandidates(slug, workingDir);
	const existingImports = parseExistingSessionImports(slug, workingDir, allCandidates);
	const browserQueueIds = parseBrowserQueueCandidateIds(slug, workingDir);
	const candidates = (browserQueueIds
		? browserQueueIds.map((id) => allCandidates.find((candidate) => candidate.id === id)).filter((candidate): candidate is FullTextFetchCandidate => Boolean(candidate))
		: allCandidates.filter((candidate) => !candidate.oaPdfUrl))
		.filter((candidate) => !hasLocalPdf(candidate, pdfDir))
		.slice(0, options.limit ?? Number.POSITIVE_INFINITY);
	const state: SessionState = {
		slug,
		workingDir,
		candidates,
		imported: existingImports,
		watchDownloads: options.watchDownloads ? resolve(options.watchDownloads) : undefined,
	};
	const sessionPath = resolve(getFullTextDraftDir(workingDir), `${slug}-fulltext-session.md`);
	if (!existsSync(sessionPath)) {
		writeFullTextSessionArtifacts(slug, workingDir, state.imported);
	}

	const watcher = state.watchDownloads ? startDownloadWatcher(state, state.watchDownloads) : undefined;
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (request.method === "GET" && url.pathname === "/") {
				textResponse(response, 200, renderPage(state), "text/html; charset=utf-8");
				return;
			}
			if (request.method === "GET" && url.pathname === "/api/state") {
				jsonResponse(response, 200, serializeState(state));
				return;
			}
			if (request.method === "POST" && url.pathname === "/api/upload") {
				const candidate = findCandidate(state, url.searchParams.get("candidate"));
				const filename = url.searchParams.get("filename") ?? undefined;
				const body = await readRequestBody(request);
				const imported = importFullTextPdf(state.slug, state.workingDir, candidate, body, filename);
				upsertImported(state, imported);
				jsonResponse(response, 200, { ok: true, imported: serializeState(state) });
				return;
			}
			if (request.method === "POST" && url.pathname === "/api/import-path") {
				const body = parseJsonBody(await readRequestBody(request, 1024 * 1024));
				const candidate = findCandidate(state, typeof body.candidate === "string" ? body.candidate : null);
				const path = typeof body.path === "string" ? body.path : "";
				if (!path || !existsSync(path)) throw new Error(`PDF not found: ${path}`);
				const imported = importFullTextPdf(state.slug, state.workingDir, candidate, readFileSync(path), basename(path));
				upsertImported(state, imported);
				jsonResponse(response, 200, { ok: true, imported: serializeState(state) });
				return;
			}
			textResponse(response, 404, "Not found");
		} catch (error) {
			jsonResponse(response, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	});

	await new Promise<void>((resolvePromise) => server.listen(options.port ?? 0, host, resolvePromise));
	const address = server.address() as AddressInfo;
	const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
	return {
		url: `http://${displayHost}:${address.port}/`,
		close: async () => {
			watcher?.close();
			await new Promise<void>((resolvePromise, rejectPromise) => {
				server.close((error) => error ? rejectPromise(error) : resolvePromise());
			});
		},
	};
}
