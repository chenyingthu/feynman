import test from "node:test";
import assert from "node:assert/strict";

import { patchPiSubagentsSource, stripPiSubagentBuiltinModelSource } from "../scripts/lib/pi-subagents-patch.mjs";

const CASES = [
	{
		name: "index.ts config path",
		file: "index.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");',
			"",
		].join("\n"),
		original: 'const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");',
		expected: 'const configPath = path.join(resolvePiAgentDir(), "extensions", "subagent", "config.json");',
	},
	{
		name: "agents.ts user agents dir",
		file: "agents.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const userDir = path.join(os.homedir(), ".pi", "agent", "agents");',
			"",
		].join("\n"),
		original: 'const userDir = path.join(os.homedir(), ".pi", "agent", "agents");',
		expected: 'const userDir = path.join(resolvePiAgentDir(), "agents");',
	},
	{
		name: "artifacts.ts sessions dir",
		file: "artifacts.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");',
			"",
		].join("\n"),
		original: 'const sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");',
		expected: 'const sessionsBase = path.join(resolvePiAgentDir(), "sessions");',
	},
	{
		name: "run-history.ts history file",
		file: "run-history.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const HISTORY_PATH = path.join(os.homedir(), ".pi", "agent", "run-history.jsonl");',
			"",
		].join("\n"),
		original: 'const HISTORY_PATH = path.join(os.homedir(), ".pi", "agent", "run-history.jsonl");',
		expected: 'const HISTORY_PATH = path.join(resolvePiAgentDir(), "run-history.jsonl");',
	},
	{
		name: "skills.ts agent dir",
		file: "skills.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");',
			"",
		].join("\n"),
		original: 'const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");',
		expected: "const AGENT_DIR = resolvePiAgentDir();",
	},
	{
		name: "chain-clarify.ts chain save dir",
		file: "chain-clarify.ts",
		input: [
			'import * as os from "node:os";',
			'import * as path from "node:path";',
			'const dir = path.join(os.homedir(), ".pi", "agent", "agents");',
			"",
		].join("\n"),
		original: 'const dir = path.join(os.homedir(), ".pi", "agent", "agents");',
		expected: 'const dir = path.join(resolvePiAgentDir(), "agents");',
	},
];

for (const scenario of CASES) {
	test(`patchPiSubagentsSource rewrites ${scenario.name}`, () => {
		const patched = patchPiSubagentsSource(scenario.file, scenario.input);

		assert.match(patched, /function resolvePiAgentDir\(\): string \{/);
		assert.match(patched, /process\.env\.FEYNMAN_CODING_AGENT_DIR\?\.trim\(\) \|\| process\.env\.PI_CODING_AGENT_DIR\?\.trim\(\)/);
		assert.ok(patched.includes(scenario.expected));
		assert.ok(!patched.includes(scenario.original));
	});
}

test("patchPiSubagentsSource is idempotent", () => {
	const input = [
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		'const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");',
		"",
	].join("\n");

	const once = patchPiSubagentsSource("index.ts", input);
	const twice = patchPiSubagentsSource("index.ts", once);

	assert.equal(twice, once);
});

test("patchPiSubagentsSource rewrites modern agents.ts discovery paths", () => {
	const input = [
		'import * as fs from "node:fs";',
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		'export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {',
		'\tconst userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst userAgentsOld = scope === "project" ? [] : loadAgentsFromDir(userDirOld, "user");',
		'\tconst userAgentsNew = scope === "project" ? [] : loadAgentsFromDir(userDirNew, "user");',
		'\tconst userAgents = [...userAgentsOld, ...userAgentsNew];',
		'}',
		'export function discoverAgentsAll(cwd: string) {',
		'\tconst userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst user = [',
		'\t\t...loadAgentsFromDir(userDirOld, "user"),',
		'\t\t...loadAgentsFromDir(userDirNew, "user"),',
		'\t];',
		'\tconst chains = [',
		'\t\t...loadChainsFromDir(userDirOld, "user"),',
		'\t\t...loadChainsFromDir(userDirNew, "user"),',
		'\t\t...(projectDir ? loadChainsFromDir(projectDir, "project") : []),',
		'\t];',
		'\tconst userDir = fs.existsSync(userDirNew) ? userDirNew : userDirOld;',
		'}',
	].join("\n");

	const patched = patchPiSubagentsSource("agents.ts", input);

	assert.match(patched, /function resolvePiAgentDir\(\): string \{/);
	assert.match(patched, /const userDir = path\.join\(resolvePiAgentDir\(\), "agents"\);/);
	assert.match(patched, /const userAgents = scope === "project" \? \[\] : loadAgentsFromDir\(userDir, "user"\);/);
	assert.ok(!patched.includes('loadAgentsFromDir(userDirOld, "user")'));
	assert.ok(!patched.includes('loadChainsFromDir(userDirNew, "user")'));
	assert.ok(!patched.includes('fs.existsSync(userDirNew) ? userDirNew : userDirOld'));
});

test("patchPiSubagentsSource declares userDir before discoverAgentsAll uses it", () => {
	const input = [
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		'export function discoverAgentsAll(cwd: string): {',
		'\tbuiltin: AgentConfig[];',
		'\tuser: AgentConfig[];',
		'\tproject: AgentConfig[];',
		'\tchains: ChainConfig[];',
		'\tuserDir: string;',
		'\tprojectDir: string | null;',
		'\tuserSettingsPath: string;',
		'\tprojectSettingsPath: string | null;',
		'} {',
		'\tconst userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");',
		'\tconst userDirNew = path.join(os.homedir(), ".agents");',
		'\tconst { readDirs: projectDirs, preferredDir: projectDir } = resolveNearestProjectAgentDirs(cwd);',
		'\tconst userSettingsPath = getUserAgentSettingsPath();',
		'\tconst projectSettingsPath = getProjectAgentSettingsPath(cwd);',
		'\tconst builtin = loadAgentsFromDir(BUILTIN_AGENTS_DIR, "builtin");',
		'\tconst user = loadAgentsFromDir(userDir, "user");',
		'\tconst projectMap = new Map<string, AgentConfig>();',
		'\tconst project = Array.from(projectMap.values());',
		'\tconst chainMap = new Map<string, ChainConfig>();',
		'\tconst chains = [',
		'\t\t...loadChainsFromDir(userDirOld, "user"),',
		'\t\t...loadChainsFromDir(userDirNew, "user"),',
		'\t\t...Array.from(chainMap.values()),',
		'\t];',
		'\tconst userDir = path.join(resolvePiAgentDir(), "agents");',
		'\treturn { builtin, user, project, chains, userDir, projectDir, userSettingsPath, projectSettingsPath };',
		'}',
	].join("\n");

	const patched = patchPiSubagentsSource("agents.ts", input);
	const declarationIndex = patched.indexOf('const userDir = path.join(resolvePiAgentDir(), "agents");');
	const firstUseIndex = patched.indexOf("loadAgentsFromDir(userDir");

	assert.ok(declarationIndex >= 0);
	assert.ok(firstUseIndex > declarationIndex);
	assert.ok(!patched.includes("userDirOld"));
	assert.ok(!patched.includes("userDirNew"));
	assert.match(patched, /loadChainsFromDir\(userDir, "user"\)/);
});

test("patchPiSubagentsSource preserves output on top-level parallel tasks", () => {
	const input = [
		"interface TaskParam {",
		"\tagent: string;",
		"\ttask: string;",
		"\tcwd?: string;",
		"\tcount?: number;",
		"\tmodel?: string;",
		"\tskill?: string | string[] | boolean;",
		"}",
		"function run(params: { tasks: TaskParam[] }) {",
		"\tconst modelOverrides = params.tasks.map(() => undefined);",
		"\tconst skillOverrides = params.tasks.map(() => undefined);",
		"\tconst parallelTasks = params.tasks.map((task, index) => ({",
		"\t\tagent: task.agent,",
		"\t\ttask: params.context === \"fork\" ? wrapForkTask(task.task) : task.task,",
		"\t\tcwd: task.cwd,",
		"\t\t...(modelOverrides[index] ? { model: modelOverrides[index] } : {}),",
		"\t\t...(skillOverrides[index] !== undefined ? { skill: skillOverrides[index] } : {}),",
		"\t}));",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("subagent-executor.ts", input);

	assert.match(patched, /output\?: string \| false;/);
	assert.match(patched, /\n\t\toutput: task\.output,/);
	assert.doesNotMatch(patched, /resolvePiAgentDir/);
});

test("patchPiSubagentsSource preserves output in async parallel task handoff", () => {
	const input = [
		"function run(tasks: TaskParam[]) {",
		"\tconst modelOverrides = tasks.map(() => undefined);",
		"\tconst skillOverrides = tasks.map(() => undefined);",
		"\tconst parallelTasks = tasks.map((t, i) => ({",
		"\t\tagent: t.agent,",
		"\t\ttask: params.context === \"fork\" ? wrapForkTask(taskTexts[i]!) : taskTexts[i]!,",
		"\t\tcwd: t.cwd,",
		"\t\t...(modelOverrides[i] ? { model: modelOverrides[i] } : {}),",
		"\t\t...(skillOverrides[i] !== undefined ? { skill: skillOverrides[i] } : {}),",
		"\t}));",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("subagent-executor.ts", input);

	assert.match(patched, /\n\t\toutput: t\.output,/);
});

test("patchPiSubagentsSource uses task output when resolving foreground parallel behavior", () => {
	const input = [
		"async function run(tasks: TaskParam[]) {",
		"\tconst skillOverrides = tasks.map((t) => normalizeSkillInput(t.skill));",
		"\tif (params.clarify === true && ctx.hasUI) {",
		"\t\tconst behaviors = agentConfigs.map((c, i) =>",
		"\t\t\tresolveStepBehavior(c, { skills: skillOverrides[i] }),",
		"\t\t);",
		"\t}",
		"\tconst behaviors = agentConfigs.map((config) => resolveStepBehavior(config, {}));",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("subagent-executor.ts", input);

	assert.match(patched, /resolveStepBehavior\(c, \{ output: tasks\[i\]\?\.output, skills: skillOverrides\[i\] \}\)/);
	assert.match(patched, /resolveStepBehavior\(config, \{ output: tasks\[i\]\?\.output, skills: skillOverrides\[i\] \}\)/);
	assert.doesNotMatch(patched, /resolveStepBehavior\(config, \{\}\)/);
});

test("patchPiSubagentsSource passes foreground parallel output paths into runSync", () => {
	const input = [
		"async function runForegroundParallelTasks(input: ForegroundParallelRunInput): Promise<SingleResult[]> {",
		"\treturn mapConcurrent(input.tasks, input.concurrencyLimit, async (task, index) => {",
		"\t\tconst overrideSkills = input.skillOverrides[index];",
		"\t\tconst effectiveSkills = overrideSkills === undefined ? input.behaviors[index]?.skills : overrideSkills;",
		"\t\tconst taskCwd = resolveParallelTaskCwd(task, input.paramsCwd, input.worktreeSetup, index);",
		"\t\treturn runSync(input.ctx.cwd, input.agents, task.agent, input.taskTexts[index]!, {",
		"\t\t\tcwd: taskCwd,",
		"\t\t\tsignal: input.signal,",
		"\t\t\tmaxOutput: input.maxOutput,",
		"\t\t\tmaxSubagentDepth: input.maxSubagentDepths[index],",
		"\t\t});",
		"\t});",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("subagent-executor.ts", input);

	assert.match(patched, /const outputPath = typeof input\.behaviors\[index\]\?\.output === "string"/);
	assert.match(patched, /const taskText = injectSingleOutputInstruction\(input\.taskTexts\[index\]!, outputPath\)/);
	assert.match(patched, /runSync\(input\.ctx\.cwd, input\.agents, task\.agent, taskText, \{/);
	assert.match(patched, /\n\t\t\toutputPath,/);
});

test("patchPiSubagentsSource documents output in top-level task schema", () => {
	const input = [
		"export const TaskItem = Type.Object({ ",
		"\tagent: Type.String(), ",
		"\ttask: Type.String(), ",
		"\tcwd: Type.Optional(Type.String()),",
		"\tcount: Type.Optional(Type.Integer({ minimum: 1, description: \"Repeat this parallel task N times with the same settings.\" })),",
		"\tmodel: Type.Optional(Type.String({ description: \"Override model for this task (e.g. 'google/gemini-3-pro')\" })),",
		"\tskill: Type.Optional(SkillOverride),",
		"});",
		"export const SubagentParams = Type.Object({",
		"\ttasks: Type.Optional(Type.Array(TaskItem, { description: \"PARALLEL mode: [{agent, task, count?}, ...]\" })),",
		"});",
	].join("\n");

	const patched = patchPiSubagentsSource("schemas.ts", input);

	assert.match(patched, /output: Type\.Optional\(Type\.Any/);
	assert.match(patched, /count\?, output\?/);
	assert.doesNotMatch(patched, /resolvePiAgentDir/);
});

test("patchPiSubagentsSource documents output in top-level parallel help", () => {
	const input = [
		'import * as os from "node:os";',
		'import * as path from "node:path";',
		"const help = `",
		"• PARALLEL: { tasks: [{agent,task,count?}, ...], concurrency?: number, worktree?: true } - concurrent execution (worktree: isolate each task in a git worktree)",
		"`;",
	].join("\n");

	const patched = patchPiSubagentsSource("index.ts", input);

	assert.match(patched, /output\?/);
	assert.match(patched, /per-task file target/);
	assert.doesNotMatch(patched, /function resolvePiAgentDir/);
});

test("patchPiSubagentsSource makes pi-spawn prefer the real Pi CLI over Feynman wrapper", () => {
	const input = [
		"export function resolveWindowsPiCliScript(deps: PiSpawnDeps = {}): string | undefined {",
		"\tconst existsSync = deps.existsSync ?? fs.existsSync;",
		'\tconst readFileSync = deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));',
		"\tconst argv1 = deps.argv1 ?? process.argv[1];",
		"",
		"\tif (argv1) {",
		"\t\tconst argvPath = normalizePath(argv1);",
		"\t\tif (isRunnableNodeScript(argvPath, existsSync)) {",
		"\t\t\treturn argvPath;",
		"\t\t}",
		"\t}",
		"}",
	].join("\n");

	const patched = patchPiSubagentsSource("pi-spawn.ts", input);

	assert.match(patched, /process\.env\.FEYNMAN_PI_CLI_PATH/);
	assert.match(patched, /path\.basename\(argvPath\) !== "pi-cli-wrapper\.js"/);
	assert.doesNotMatch(patched, /resolvePiAgentDir/);
});

test("stripPiSubagentBuiltinModelSource removes built-in model pins", () => {
	const input = [
		"---",
		"name: researcher",
		"description: Web researcher",
		"model: anthropic/claude-sonnet-4-6",
		"tools: read, web_search",
		"---",
		"",
		"Body",
	].join("\n");

	const patched = stripPiSubagentBuiltinModelSource(input);

	assert.ok(!patched.includes("model: anthropic/claude-sonnet-4-6"));
	assert.match(patched, /name: researcher/);
	assert.match(patched, /tools: read, web_search/);
});
