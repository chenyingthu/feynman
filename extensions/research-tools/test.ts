import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { APP_ROOT } from "./shared.js";

type CommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

function getFeynmanRoot(cwd: string): string {
	// If running from source, use current dir
	if (existsSync(join(cwd, "package.json"))) {
		return cwd;
	}
	// Otherwise use APP_ROOT
	return APP_ROOT;
}

function runTests(args: string[], cwd: string): Promise<{
	code: number | null;
	stdout: string;
	stderr: string;
}> {
	return new Promise((resolvePromise, rejectPromise) => {
		const feynmanRoot = getFeynmanRoot(cwd);
		const testCmd = process.execPath;
		const testArgs = ["--import", "tsx", "--test", ...args];

		const child = spawn(testCmd, testArgs, {
			cwd: feynmanRoot,
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

function formatTestResult(result: {
	code: number | null;
	stdout: string;
	stderr: string;
}): string {
	const lines = result.stdout.split("\n");
	const summary = lines.filter((line) =>
		line.startsWith("# tests") ||
		line.startsWith("# pass") ||
		line.startsWith("# fail") ||
		line.startsWith("ok") ||
		line.startsWith("not ok"),
	);

	return [
		"## Test Results",
		"",
		`Exit code: ${result.code ?? "unknown"}`,
		"",
		"### Summary",
		...summary,
		"",
		result.stderr.trim() ? ["### Errors", "", "```", result.stderr.trim(), "```"].join("\n") : "",
	].filter(Boolean).join("\n");
}

export function registerTestCommand(pi: ExtensionAPI): void {
	pi.registerCommand("test", {
		description: "Run Feynman test suite.",
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);

			// Parse test options
			const testArgs: string[] = [];
			let pattern: string | undefined;

			for (let i = 0; i < tokens.length; i += 1) {
				const token = tokens[i];

				if (token === "--watch" || token === "-w") {
					testArgs.push("--watch");
					continue;
				}

				if (token === "--concurrency" || token === "-c") {
					testArgs.push("--test-concurrency", tokens[i + 1] ?? "1");
					i += 1;
					continue;
				}

				if (token === "--timeout" || token === "-t") {
					testArgs.push("--test-timeout", tokens[i + 1] ?? "60000");
					i += 1;
					continue;
				}

				if (token === "policy") {
					pattern = "tests/content-policy.test.ts";
					continue;
				}

				if (token === "guard") {
					pattern = "tests/lit-artifact-guard.test.ts";
					continue;
				}

				if (token === "research") {
					pattern = "tests/research-*.test.ts";
					continue;
				}

				if (token === "e2e") {
					pattern = "tests/research-fulltext-e2e.test.ts";
					continue;
				}

				// Treat as test file pattern
				if (!pattern && (token.endsWith(".test.ts") || token.includes("*"))) {
					pattern = token;
					continue;
				}

				// Pass through to Node test runner
				testArgs.push(token);
			}

			// Default to all tests if no pattern specified
			if (!pattern) {
				testArgs.push("tests/*.test.ts");
			} else {
				testArgs.push(pattern);
			}

			// Ensure concurrency is set to avoid parallel execution issues
			if (!testArgs.includes("--test-concurrency")) {
				testArgs.push("--test-concurrency", "1");
			}

			ctx.ui.notify("Running Feynman tests...", "info");

			try {
				const result = await runTests(testArgs, ctx.cwd);
				const formatted = formatTestResult(result);

				pi.sendMessage({
					customType: "feynman-test",
					content: formatted,
					display: true,
				});

				if (result.code !== 0) {
					ctx.ui.notify(`Tests failed (${result.code}). See details above.`, "error");
				} else {
					ctx.ui.notify("All tests passed!", "success");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Test execution failed: ${message}`, "error");
				pi.sendMessage({
					customType: "feynman-test",
					content: `# Test Execution Error\n\n${message}`,
					display: true,
				});
			}
		},
	});
}
