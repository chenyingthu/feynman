import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { getExtensionCommandSpec } from "../../metadata/commands.mjs";
import { renderHtmlPreview, renderPdfPreview, openWithDefaultApp, pathExists } from "./preview.js";
import { buildProjectAgentsTemplate, buildSessionLogsReadme } from "./project-scaffold.js";
import { formatToolText } from "./shared.js";
import { searchSessionTranscripts } from "./session-search.js";

export function registerInitCommand(pi: ExtensionAPI): void {
	pi.registerCommand("init", {
		description: getExtensionCommandSpec("init")?.description ?? "Initialize AGENTS.md and session-log folders for a research project.",
		handler: async (_args, ctx) => {
			const agentsPath = resolvePath(ctx.cwd, "AGENTS.md");
			const notesDir = resolvePath(ctx.cwd, "notes");
			const sessionLogsDir = resolvePath(notesDir, "session-logs");
			const sessionLogsReadmePath = resolvePath(sessionLogsDir, "README.md");
			const created: string[] = [];
			const skipped: string[] = [];

			await mkdir(notesDir, { recursive: true });
			await mkdir(sessionLogsDir, { recursive: true });

			if (!(await pathExists(agentsPath))) {
				await writeFile(agentsPath, buildProjectAgentsTemplate(), "utf8");
				created.push("AGENTS.md");
			} else {
				skipped.push("AGENTS.md");
			}

			if (!(await pathExists(sessionLogsReadmePath))) {
				await writeFile(sessionLogsReadmePath, buildSessionLogsReadme(), "utf8");
				created.push("notes/session-logs/README.md");
			} else {
				skipped.push("notes/session-logs/README.md");
			}

			const createdSummary = created.length > 0 ? `created: ${created.join(", ")}` : "created: nothing";
			const skippedSummary = skipped.length > 0 ? `; kept existing: ${skipped.join(", ")}` : "";
			ctx.ui.notify(`${createdSummary}${skippedSummary}`, "info");
		},
	});
}

export function registerSessionSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "session_search",
		label: "Session Search",
		description: "Search prior Feynman session transcripts to recover what was done, said, or written before.",
		parameters: Type.Object({
			query: Type.String({
				description: "Search query to look for in past sessions.",
			}),
			limit: Type.Optional(
				Type.Number({
					description: "Maximum number of sessions to return. Defaults to 3.",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const result = await searchSessionTranscripts(params.query, Math.max(1, Math.min(params.limit ?? 3, 8)));
			return {
				content: [{ type: "text", text: formatToolText(result) }],
				details: result,
			};
		},
	});
}

export function registerPreviewTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "preview_file",
		label: "Preview File",
		description: "Open a markdown, LaTeX, PDF, or code artifact in the browser or a PDF viewer for human review. Rendered HTML/PDF previews are temporary and do not replace the source artifact.",
		parameters: Type.Object({
			path: Type.String({
				description: "Path to the file to preview.",
			}),
			target: Type.Optional(
				Type.String({
					description: "Preview target: browser or pdf. Defaults to browser.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const target = (params.target?.trim().toLowerCase() || "browser");
			if (target !== "browser" && target !== "pdf") {
				throw new Error("target must be browser or pdf");
			}

			const resolvedPath = resolvePath(ctx.cwd, params.path);
			const openedPath =
				resolvePath(resolvedPath).toLowerCase().endsWith(".pdf") && target === "pdf"
					? resolvedPath
					: target === "pdf"
						? await renderPdfPreview(resolvedPath)
						: await renderHtmlPreview(resolvedPath);

			await mkdir(dirname(openedPath), { recursive: true }).catch(() => {});
			await openWithDefaultApp(openedPath);

			const result = {
				sourcePath: resolvedPath,
				target,
				openedPath,
				temporaryPreview: openedPath !== resolvedPath,
			};
			return {
				content: [{ type: "text", text: formatToolText(result) }],
				details: result,
			};
		},
	});
}
