import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { getExtensionCommandSpec } from "../../metadata/commands.mjs";
import { APP_ROOT } from "./shared.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

type CliResult = {
	code: number | null;
	stdout: string;
	stderr: string;
};

let activeSession: { slug?: string; url?: string; child: ChildProcess } | undefined;

function splitArgs(args: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaping = false;
	for (const char of args.trim()) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

function hasFlag(tokens: string[], flag: string): boolean {
	return tokens.some((token) => token === flag || token === `${flag}=true` || token.startsWith(`${flag}=`));
}

function parseOption(tokens: string[], name: string): string | undefined {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === `--${name}`) return tokens[index + 1];
		if (token.startsWith(`--${name}=`)) return token.slice(token.indexOf("=") + 1);
		if (token.startsWith(`${name}=`)) return token.slice(token.indexOf("=") + 1);
	}
	return undefined;
}

function getFeynmanBin(): string {
	const bin = join(APP_ROOT, "bin", "feynman.js");
	if (!existsSync(bin)) {
		throw new Error(`Feynman CLI not found: ${bin}`);
	}
	return bin;
}

function runFeynmanCli(args: string[], cwd: string): Promise<CliResult> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(process.execPath, [getFeynmanBin(), ...args], {
			cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
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

function appendCommandResult(pi: ExtensionAPI, title: string, result: CliResult, extraLines: string[] = []): void {
	const body = [
		`# ${title}`,
		"",
		`Exit code: ${result.code ?? "unknown"}`,
		...extraLines,
		"",
		"## Output",
		"",
		"```text",
		result.stdout.trim() || "(no stdout)",
		"```",
		result.stderr.trim() ? ["", "## Errors", "", "```text", result.stderr.trim(), "```"].join("\n") : "",
	].filter(Boolean).join("\n");
	pi.sendMessage({
		customType: "feynman-acquire",
		content: body,
		display: true,
	});
}

function stopActiveSession(): void {
	if (!activeSession) return;
	activeSession.child.kill("SIGINT");
	activeSession = undefined;
}

function saveSessionOutput(
	cwd: string,
	slug: string,
	command: string,
	result: CliResult,
	extraLines: string[] = [],
): string {
	const sessionsDir = join(cwd, "outputs", ".sessions");
	mkdirSync(sessionsDir, { recursive: true });

	const timestamp = new Date().toISOString();
	const filename = `${slug}-${command}-session.md`;
	const filepath = join(sessionsDir, filename);

	const content = [
		"---",
		`command: ${command}`,
		`slug: ${slug}`,
		`timestamp: ${timestamp}`,
		`exit_code: ${result.code ?? "unknown"}`,
		"---",
		"",
		`# Session Record: ${command}`,
		"",
		`Slug: ${slug}`,
		`Time: ${timestamp}`,
		`Exit code: ${result.code ?? "unknown"}`,
		...extraLines,
		"",
		"## Output",
		"",
		"```text",
		result.stdout.trim() || "(no stdout)",
		"```",
		...(result.stderr.trim()
			? ["", "## Errors", "", "```text", result.stderr.trim(), "```"]
			: []),
		"",
		"---",
		"",
		"*This session was recorded with `--save` flag.*",
	].join("\n");

	writeFileSync(filepath, content, "utf8");
	return filepath;
}

async function startFullTextSession(pi: ExtensionAPI, tokens: string[], ctx: CommandContext): Promise<void> {
	if (activeSession) {
		ctx.ui.notify(`Full-text session already running: ${activeSession.url ?? activeSession.slug ?? "unknown"}`, "info");
		return;
	}

	const child = spawn(process.execPath, [getFeynmanBin(), "research", "fulltext-session", ...tokens], {
		cwd: ctx.cwd,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	activeSession = { slug: parseOption(tokens, "slug") ?? tokens.find((token) => !token.startsWith("-") && !token.includes("=")), child };

	let stdout = "";
	let stderr = "";
	const url = await new Promise<string | undefined>((resolvePromise) => {
		const timeout = setTimeout(() => resolvePromise(undefined), 5000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			const match = stdout.match(/Full-text acquisition session:\s+(http:\/\/[^\s]+)/);
			if (match) {
				clearTimeout(timeout);
				resolvePromise(match[1]);
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("exit", () => {
			clearTimeout(timeout);
			resolvePromise(undefined);
		});
	});

	child.once("exit", () => {
		if (activeSession?.child === child) activeSession = undefined;
	});

	if (!url) {
		activeSession = undefined;
		pi.sendMessage({
			customType: "feynman-acquire",
			content: [
				"# Full-text Session Failed",
				"",
				"```text",
				(stdout + stderr).trim() || "(no output)",
				"```",
			].join("\n"),
			display: true,
		});
		return;
	}

	const session = activeSession;
	if (!session) return;
	session.url = url;
	pi.sendMessage({
		customType: "feynman-acquire",
		content: [
			"# Full-text Upload Session",
			"",
			`Open: ${url}`,
			"",
			"Use your browser to download PDFs normally, then upload them on this page.",
			"",
			"Stop the server later with `/fulltext-stop`.",
		].join("\n"),
		display: true,
	});
	ctx.ui.notify(`Full-text upload session started: ${url}`, "info");
}

export function registerAcquireCommands(pi: ExtensionAPI): void {
	pi.registerCommand("acquire", {
		description:
			getExtensionCommandSpec("acquire")?.description ??
			"Run candidate discovery, OA full-text fetch, and start browser-assisted upload when needed.",
		handler: async (args, ctx) => {
			const tokens = splitArgs(args);
			if (tokens.length === 0) {
				ctx.ui.notify("Usage: /acquire [slug=<slug>] [limit=<n>] [fetch-limit=<n>] [query=<search-query> ...] [--save] [--no-session] [--dry-run] <topic>", "error");
				return;
			}
			const shouldSave = hasFlag(tokens, "--save") || hasFlag(tokens, "save");
			const cliTokens = hasFlag(tokens, "--no-session") || hasFlag(tokens, "no-session") ? tokens : [...tokens, "--no-session"];
			ctx.ui.notify("Running Feynman acquisition. This may take a while for live OA PDF fetches.", "info");
			const result = await runFeynmanCli(["research", "acquire", ...cliTokens], ctx.cwd);
			const slug = result.stdout.match(/Research acquisition slug:\s+([^\s]+)/)?.[1];
			const manualQueue = Number.parseInt(result.stdout.match(/Browser\/manual campus queue:\s+(\d+)/)?.[1] ?? "0", 10);
			appendCommandResult(pi, "Research Acquisition", result, slug ? [`Slug: ${slug}`] : []);

			// Persist session if --save flag is set
			if (shouldSave && slug) {
				const savePath = saveSessionOutput(ctx.cwd, slug, "acquire", result, [
					`Manual queue: ${manualQueue}`,
					`CLI tokens: ${cliTokens.join(" ")}`,
				]);
				ctx.ui.notify(`Session saved: ${savePath}`, "info");
			}

			if (result.code !== 0) {
				ctx.ui.notify("Feynman acquisition failed. See the command output card.", "error");
				return;
			}
			if (manualQueue > 0 && slug && !hasFlag(tokens, "--no-session") && !hasFlag(tokens, "no-session") && !hasFlag(tokens, "--dry-run") && !hasFlag(tokens, "dry-run")) {
				const port = parseOption(tokens, "port");
				const host = parseOption(tokens, "host");
				const watchDownloads = parseOption(tokens, "watch-downloads");
				await startFullTextSession(pi, [
					`slug=${slug}`,
					`limit=${manualQueue}`,
					...(port ? [`port=${port}`] : ["port=18766"]),
					...(host ? [`host=${host}`] : []),
					...(watchDownloads ? [`watch-downloads=${watchDownloads}`] : []),
				], ctx);
			}
		},
	});

	pi.registerCommand("fulltext-session", {
		description:
			getExtensionCommandSpec("fulltext-session")?.description ??
			"Start the browser-assisted full-text upload page for an existing acquisition slug.",
		handler: async (args, ctx) => {
			const tokens = splitArgs(args);
			if (tokens.length === 0) {
				ctx.ui.notify("Usage: /fulltext-session slug=<slug> [limit=<n>] [port=<n>]", "error");
				return;
			}
			await startFullTextSession(pi, tokens, ctx);
		},
	});

	pi.registerCommand("fulltext-stop", {
		description: getExtensionCommandSpec("fulltext-stop")?.description ?? "Stop the active full-text upload page.",
		handler: async (_args, ctx) => {
			if (!activeSession) {
				ctx.ui.notify("No full-text upload session is running.", "info");
				return;
			}
			const label = activeSession.url ?? activeSession.slug ?? "session";
			stopActiveSession();
			ctx.ui.notify(`Stopped full-text upload ${label}.`, "info");
		},
	});
}
