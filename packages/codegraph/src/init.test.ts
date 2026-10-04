import { afterEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import codegraphExtension from "./index";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

type Result = { code: number; stdout: string; stderr: string };
type Execute = (command: string, args: string[], options: { cwd: string }) => Promise<Result>;
function commandFixture(execute: Execute, active = false, toolDiscoveryError?: Error) {
	const directory = mkdtempSync(path.join(os.tmpdir(), "omp-codegraph-init-"));
	directories.push(directory);
	const project = path.join(directory, "project");
	mkdirSync(project);
	let command: (args: string, ctx: ExtensionContext) => Promise<void>;
	let beforeTurn: (event: { systemPrompt: string[] }, ctx: ExtensionContext) => Promise<{ systemPrompt: string[] } | undefined>;
	const notifications: { text: string; level: string }[] = [];
	const footer = new Map<string, string | undefined>();
	// Exercise registered public commands and lifecycle hooks with an isolated CLI adapter.
	const pi = {
		registerCommand: (_name: string, options: { handler: typeof command }) => { command = options.handler; },
		on: (name: string, handler: typeof beforeTurn) => { if (name === "before_agent_start") beforeTurn = handler; },
		events: { on: () => () => {}, emit: () => {} },
		exec: execute,
		getAllTools: () => {
			if (toolDiscoveryError) throw toolDiscoveryError;
			return active ? [{ name: "mcp__codegraph_explore", sourceInfo: { source: "mcp" } }] : [];
		},
		getActiveTools: () => active ? ["mcp__codegraph_explore"] : [],
	} as unknown as ExtensionAPI;
	const context = { cwd: project, hasUI: false, ui: {
		setStatus: (key: string, text?: string) => footer.set(key, text),
		notify: (text: string, level: string) => notifications.push({ text, level }),
	} } as unknown as ExtensionContext;
	codegraphExtension(pi, { globalConfigPath: path.join(directory, "global.json") });
	return { directory, project, context, notifications, footer, run: (args: string) => command(args, context), turn: () => beforeTurn({ systemPrompt: ["existing"] }, context) };
}

function nativeDataAdapter(workspace: () => string): Execute {
	return async (_command, args) => {
		const project = args[0] === "init" ? args[1]! : workspace();
		const database = path.join(project, ".codegraph", "codegraph.db");
		if (args[0] === "init") {
			mkdirSync(path.dirname(database), { recursive: true });
			writeFileSync(database, "initial graph");
		}
		return { code: 0, stderr: "", stdout: JSON.stringify({ initialized: existsSync(database), projectPath: project, indexPath: path.dirname(database), index: { state: "complete" } }) };
	};
}

test("explicit initialization preserves off policy bytes and refreshes suppressed indexed status without guidance", async () => {
	const fixture = commandFixture(nativeDataAdapter(() => fixture.project), true);
	const policyPath = path.join(fixture.project, ".omp", "codesook-omp.json");
	mkdirSync(path.dirname(policyPath));
	const policy = '{"version":1,"display":{"codegraph":{"visibility":"always"}},"behavior":{"codegraph":{"policy":"off"},"beads":{"policy":"auto"}},"custom":"retain"}\n';
	writeFileSync(policyPath, policy);
	await fixture.run("init");
	expect(readFileSync(path.join(fixture.project, ".codegraph", "codegraph.db"), "utf8")).toBe("initial graph");
	expect(readFileSync(policyPath, "utf8")).toBe(policy);
	expect(fixture.footer.get("codegraph")).toBe("CodeGraph: suppressed");
	expect(await fixture.turn()).toBeUndefined();
});

test("new data belongs to the Git Integration Project rather than its active subdirectory", async () => {
	const fixture = commandFixture(nativeDataAdapter(() => fixture.project), true);
	const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
	const initialized = spawnSync("git", ["init", "--quiet", fixture.project], { env: gitEnvironment });
	expect(initialized.status).toBe(0);
	const subdirectory = path.join(fixture.project, "src");
	mkdirSync(subdirectory);
	fixture.context.cwd = subdirectory;
	await fixture.run("init");
	expect(readFileSync(path.join(fixture.project, ".codegraph", "codegraph.db"), "utf8")).toBe("initial graph");
	expect(existsSync(path.join(subdirectory, ".codegraph"))).toBe(false);
	expect(existsSync(path.join(fixture.project, ".omp"))).toBe(false);
	const guidance = await fixture.turn();
	expect(guidance?.systemPrompt[0]).toBe("existing");
	expect(guidance?.systemPrompt[1]).toContain(fixture.project);
});

test("existing native workspace is reused without changing its bytes or initializing the separate Integration Project", async () => {
	const fixture = commandFixture(nativeDataAdapter(() => fixture.directory));
	const database = path.join(fixture.directory, ".codegraph", "codegraph.db");
	mkdirSync(path.dirname(database));
	const existing = Buffer.from([0, 128, 255, 42]);
	writeFileSync(database, existing);
	await fixture.run("init");
	expect(readFileSync(database)).toEqual(existing);
	expect(existsSync(path.join(fixture.project, ".codegraph"))).toBe(false);
	expect(existsSync(path.join(fixture.project, ".omp"))).toBe(false);
	expect(await fixture.turn()).toBeUndefined();
});

test("indexing without an active MCP tool remains not ready and grants no automatic guidance", async () => {
	const fixture = commandFixture(nativeDataAdapter(() => fixture.project));
	await fixture.run("init");
	expect(readFileSync(path.join(fixture.project, ".codegraph", "codegraph.db"), "utf8")).toBe("initial graph");
	expect(fixture.notifications.at(-1)?.level).toBe("warning");
	expect(await fixture.turn()).toBeUndefined();
});

test("invalid configuration blocks initialization and preserves configuration bytes", async () => {
	const fixture = commandFixture(nativeDataAdapter(() => fixture.project), true);
	const policyPath = path.join(fixture.project, ".omp", "codesook-omp.json");
	mkdirSync(path.dirname(policyPath));
	const invalid = '{"version":1,"display":{},"behavior":{"codegraph":{"policy":"invalid"}}}';
	writeFileSync(policyPath, invalid);
	await fixture.run("init");
	expect(readFileSync(policyPath, "utf8")).toBe(invalid);
	expect(existsSync(path.join(fixture.project, ".codegraph"))).toBe(false);
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(await fixture.turn()).toBeUndefined();
});

test("partial native data blocks initialization while preserving bytes, policy and guidance suppression", async () => {
	const fixture = commandFixture(async (_command, args) => args[0] === "init"
		? { code: 1, stdout: "", stderr: "Existing project data requires manual inspection" }
		: { code: 0, stderr: "", stdout: JSON.stringify({ initialized: false, projectPath: fixture.project, indexPath: path.join(fixture.project, ".codegraph") }) }, true);
	const database = path.join(fixture.project, ".codegraph", "codegraph.db");
	mkdirSync(path.dirname(database));
	const partial = Buffer.from("partial native data");
	writeFileSync(database, partial);
	await fixture.run("init");
	expect(readFileSync(database)).toEqual(partial);
	expect(existsSync(path.join(fixture.project, ".omp"))).toBe(false);
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(await fixture.turn()).toBeUndefined();
});

test("missing CLI and malformed inspection never create data or configuration", async () => {
	for (const result of [
		{ code: 127, stdout: "", stderr: "codegraph not found" },
		{ code: 0, stdout: "invalid JSON", stderr: "" },
		{ code: 0, stdout: JSON.stringify({ initialized: false }), stderr: "" },
	]) {
		const fixture = commandFixture(async () => result, true);
		await fixture.run("init");
		expect(existsSync(path.join(fixture.project, ".codegraph"))).toBe(false);
		expect(existsSync(path.join(fixture.project, ".omp"))).toBe(false);
		expect(fixture.notifications.at(-1)?.level).toBe("error");
		expect(await fixture.turn()).toBeUndefined();
	}
});

test("native exit success without usable data does not claim completed initialization", async () => {
	const fixture = commandFixture(async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ initialized: false, projectPath: fixture.project, indexPath: path.join(fixture.project, ".codegraph") }) }), true);
	await fixture.run("init");
	expect(existsSync(path.join(fixture.project, ".codegraph"))).toBe(false);
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(await fixture.turn()).toBeUndefined();
});

test("off policy does not conceal an incomplete existing index after explicit initialization", async () => {
	const fixture = commandFixture(async () => ({ code: 0, stderr: "", stdout: JSON.stringify({
		initialized: true, projectPath: fixture.project, indexPath: path.join(fixture.project, ".codegraph"), index: { state: "building" },
	}) }), true);
	mkdirSync(path.join(fixture.project, ".omp"));
	const policyPath = path.join(fixture.project, ".omp", "codesook-omp.json");
	const policy = '{"version":1,"display":{"codegraph":{"visibility":"always"}},"behavior":{"codegraph":{"policy":"off"}}}';
	writeFileSync(policyPath, policy);
	await fixture.run("init");
	expect(fixture.footer.get("codegraph")).toBe("CodeGraph: suppressed");
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(readFileSync(policyPath, "utf8")).toBe(policy);
	expect(await fixture.turn()).toBeUndefined();
});

test("normal detection never creates project data or policy before explicit initialization", async () => {
	const fixture = commandFixture(nativeDataAdapter(() => fixture.project), true);
	expect(await fixture.turn()).toBeUndefined();
	await fixture.run("status");
	expect(existsSync(path.join(fixture.project, ".codegraph"))).toBe(false);
	expect(existsSync(path.join(fixture.project, ".omp"))).toBe(false);
});

test("off policy remains suppressed while initialized data still reports missing MCP readiness", async () => {
	const fixture = commandFixture(nativeDataAdapter(() => fixture.project));
	mkdirSync(path.join(fixture.project, ".omp"));
	const policyPath = path.join(fixture.project, ".omp", "codesook-omp.json");
	const policy = '{"version":1,"display":{"codegraph":{"visibility":"always"}},"behavior":{"codegraph":{"policy":"off"}}}';
	writeFileSync(policyPath, policy);
	await fixture.run("init");
	expect(readFileSync(path.join(fixture.project, ".codegraph", "codegraph.db"), "utf8")).toBe("initial graph");
	expect(fixture.footer.get("codegraph")).toBe("CodeGraph: suppressed");
	expect(fixture.notifications.at(-1)?.level).toBe("warning");
	expect(readFileSync(policyPath, "utf8")).toBe(policy);
	expect(await fixture.turn()).toBeUndefined();
});

test("native exit success with a partial graph preserves produced data and off policy but cannot grant guidance", async () => {
	let produced = false;
	const fixture = commandFixture(async (_command, args) => {
		if (args[0] === "init") {
			produced = true;
			mkdirSync(path.join(fixture.project, ".codegraph"));
			writeFileSync(path.join(fixture.project, ".codegraph", "codegraph.db"), "partial graph");
		}
		return { code: 0, stderr: "", stdout: JSON.stringify({
			initialized: produced, projectPath: fixture.project, indexPath: path.join(fixture.project, ".codegraph"), index: { state: produced ? "building" : "complete" },
		}) };
	}, true);
	mkdirSync(path.join(fixture.project, ".omp"));
	const policyPath = path.join(fixture.project, ".omp", "codesook-omp.json");
	const policy = '{"version":1,"display":{"codegraph":{"visibility":"always"}},"behavior":{"codegraph":{"policy":"off"}}}';
	writeFileSync(policyPath, policy);
	await fixture.run("init");
	expect(readFileSync(path.join(fixture.project, ".codegraph", "codegraph.db"), "utf8")).toBe("partial graph");
	expect(readFileSync(policyPath, "utf8")).toBe(policy);
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(fixture.footer.get("codegraph")).toBe("CodeGraph: suppressed");
	expect(await fixture.turn()).toBeUndefined();
});

test("an existing schemaless native database is preserved instead of allowing native in-place rebuilding", async () => {
	const fixture = commandFixture(async (_command, args) => {
		const database = path.join(fixture.project, ".codegraph", "codegraph.db");
		if (args[0] === "init") writeFileSync(database, "rebuilt graph");
		return { code: 0, stderr: "", stdout: JSON.stringify({
			initialized: readFileSync(database, "utf8") === "rebuilt graph",
			projectPath: fixture.project, indexPath: path.dirname(database),
		}) };
	}, true);
	const database = path.join(fixture.project, ".codegraph", "codegraph.db");
	mkdirSync(path.dirname(database));
	writeFileSync(database, "schemaless native data");
	await fixture.run("init");
	expect(readFileSync(database, "utf8")).toBe("schemaless native data");
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(existsSync(path.join(fixture.project, ".omp"))).toBe(false);
	expect(await fixture.turn()).toBeUndefined();
});

test("a dangling native database symlink is preserved and its absent target is not initialized", async () => {
	const fixture = commandFixture(nativeDataAdapter(() => fixture.project), true);
	const database = path.join(fixture.project, ".codegraph", "codegraph.db");
	const target = path.join(fixture.directory, "missing.db");
	mkdirSync(path.dirname(database));
	symlinkSync(target, database);
	await fixture.run("init");
	expect(readlinkSync(database)).toBe(target);
	expect(existsSync(target)).toBe(false);
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(await fixture.turn()).toBeUndefined();
});

test("an invalid native inspection path fails closed without writing data", async () => {
	const fixture = commandFixture(async (_command, args) => {
		if (args[0] === "init") {
			mkdirSync(path.join(fixture.project, ".codegraph"));
			writeFileSync(path.join(fixture.project, ".codegraph", "codegraph.db"), "unexpected graph");
		}
		return { code: 0, stderr: "", stdout: JSON.stringify({
			initialized: false, projectPath: fixture.project, indexPath: path.join(fixture.project, "not-a-directory"),
		}) };
	}, true);
	const invalidPath = path.join(fixture.project, "not-a-directory");
	writeFileSync(invalidPath, "existing native path data");
	await fixture.run("init");
	expect(readFileSync(invalidPath, "utf8")).toBe("existing native path data");
	expect(existsSync(path.join(fixture.project, ".codegraph"))).toBe(false);
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(await fixture.turn()).toBeUndefined();
});

test("initialization from a Git subdirectory preserves partial data at the actual new-data target", async () => {
	const fixture = commandFixture(async (_command, args) => {
		const database = path.join(fixture.project, ".codegraph", "codegraph.db");
		if (args[0] === "init") writeFileSync(database, "rebuilt graph");
		const initialized = readFileSync(database, "utf8") === "rebuilt graph";
		const nativeProject = initialized ? fixture.project : args[2]!;
		return { code: 0, stderr: "", stdout: JSON.stringify({
			initialized, projectPath: nativeProject, indexPath: path.join(nativeProject, ".codegraph"),
		}) };
	}, true);
	const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
	expect(spawnSync("git", ["init", "--quiet", fixture.project], { env: gitEnvironment }).status).toBe(0);
	mkdirSync(path.join(fixture.project, "src"));
	fixture.context.cwd = path.join(fixture.project, "src");
	const database = path.join(fixture.project, ".codegraph", "codegraph.db");
	mkdirSync(path.dirname(database));
	writeFileSync(database, "partial root graph");
	await fixture.run("init");
	expect(readFileSync(database, "utf8")).toBe("partial root graph");
	expect(existsSync(path.join(fixture.context.cwd, ".codegraph"))).toBe(false);
	expect(fixture.notifications.at(-1)?.level).toBe("error");
	expect(await fixture.turn()).toBeUndefined();
});

test("inspection exceptions respect global error visibility without inferring project policy or granting guidance", async () => {
	for (const [visibility, expectedFooter] of [["always", "CodeGraph: error"], ["never", undefined]] as const) {
		const fixture = commandFixture(nativeDataAdapter(() => fixture.project), true, new Error("Tool discovery unavailable"));
		const globalPath = path.join(fixture.directory, "global.json");
		const config = JSON.stringify({ version: 1, display: { codegraph: { visibility } }, behavior: { codegraph: { policy: "auto" } } });
		writeFileSync(globalPath, config);
		await fixture.run("init");
		expect(fixture.footer.get("codegraph")).toBe(expectedFooter);
		expect(fixture.notifications.at(-1)?.level).toBe("error");
		expect(existsSync(path.join(fixture.project, ".codegraph"))).toBe(false);
		expect(existsSync(path.join(fixture.project, ".omp"))).toBe(false);
		expect(readFileSync(globalPath, "utf8")).toBe(config);
		expect(await fixture.turn()).toBeUndefined();
	}
});

test("invalid global visibility and unreadable global configuration fail closed without overwriting either", async () => {
	for (const config of [
		'{"version":2,"display":{"codegraph":{"visibility":"always"}},"behavior":{}}',
		'{"version":1,"display":{"codegraph":{"visibility":"invalid"}},"behavior":{}}',
		undefined,
	]) {
		const fixture = commandFixture(nativeDataAdapter(() => fixture.project), true, new Error("Tool discovery unavailable"));
		const globalPath = path.join(fixture.directory, "global.json");
		if (config === undefined) mkdirSync(globalPath);
		else writeFileSync(globalPath, config);
		await fixture.run("init");
		expect(fixture.footer.get("codegraph")).toBeUndefined();
		expect(fixture.notifications.at(-1)?.level).toBe("error");
		expect(existsSync(path.join(fixture.project, ".codegraph"))).toBe(false);
		if (config !== undefined) expect(readFileSync(globalPath, "utf8")).toBe(config);
		else expect(lstatSync(globalPath).isDirectory()).toBe(true);
		expect(await fixture.turn()).toBeUndefined();
	}
});
