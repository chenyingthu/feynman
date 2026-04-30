import test from "node:test";
import assert from "node:assert/strict";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import researchTools from "../extensions/research-tools.js";
import { extensionCommandSpecs } from "../metadata/commands.mjs";

test("research extension registers acquisition slash commands for the REPL", () => {
	const commands = new Map<string, unknown>();
	const pi = {
		on: () => {},
		registerTool: () => {},
		registerCommand: (name: string, options: unknown) => {
			commands.set(name, options);
		},
		registerShortcut: () => {},
		registerFlag: () => {},
		registerMessageRenderer: () => {},
		getFlag: () => undefined,
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		getCommands: () => [],
		setModel: () => {},
		getThinkingLevel: () => undefined,
		setThinkingLevel: () => {},
		registerProvider: () => {},
		unregisterProvider: () => {},
		events: {},
	} as unknown as ExtensionAPI;

	researchTools(pi);

	assert.equal(commands.has("acquire"), true);
	assert.equal(commands.has("fulltext-session"), true);
	assert.equal(commands.has("fulltext-stop"), true);
	assert.match((commands.get("acquire") as { description?: string }).description ?? "", /candidate discovery/i);
});

test("acquisition slash commands are listed in public command metadata", () => {
	const publicNames = new Set(extensionCommandSpecs.filter((entry) => entry.publicDocs).map((entry) => entry.name));

	assert.equal(publicNames.has("acquire"), true);
	assert.equal(publicNames.has("fulltext-session"), true);
	assert.equal(publicNames.has("fulltext-stop"), true);
});
