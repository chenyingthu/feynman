import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";

import { buildPiArgs, buildPiEnv, type PiRuntimeOptions, resolvePiPaths, toNodeImportSpecifier } from "./runtime.js";
import { ensureSupportedNodeVersion } from "../system/node-version.js";

export function exitCodeFromSignal(signal: NodeJS.Signals): number {
	const signalNumber = constants.signals[signal];
	return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

export async function launchPiChat(options: PiRuntimeOptions): Promise<void> {
	ensureSupportedNodeVersion();

	const { piCliPath, promisePolyfillPath, promisePolyfillSourcePath, tsxLoaderPath } = resolvePiPaths(options.appRoot);
	if (!existsSync(piCliPath)) {
		throw new Error(`Pi CLI not found: ${piCliPath}`);
	}

	const useBuiltPolyfill = existsSync(promisePolyfillPath);
	const useDevPolyfill = !useBuiltPolyfill && existsSync(promisePolyfillSourcePath) && existsSync(tsxLoaderPath);
	if (!useBuiltPolyfill && !useDevPolyfill) {
		throw new Error(`Promise polyfill not found: ${promisePolyfillPath}`);
	}

	if (process.stdout.isTTY) {
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
	}

	const importArgs = useDevPolyfill
		? ["--import", toNodeImportSpecifier(tsxLoaderPath), "--import", toNodeImportSpecifier(promisePolyfillSourcePath)]
		: ["--import", toNodeImportSpecifier(promisePolyfillPath)];

	const child = spawn(process.execPath, [...importArgs, piCliPath, ...buildPiArgs(options)], {
		cwd: options.workingDir,
		stdio: "inherit",
		env: buildPiEnv(options),
	});

	await new Promise<void>((resolvePromise, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (signal) {
				console.error(`feynman terminated because the Pi child exited with ${signal}.`);
				process.exitCode = exitCodeFromSignal(signal);
				resolvePromise();
				return;
			}
			process.exitCode = code ?? 0;
			resolvePromise();
		});
	});
}
