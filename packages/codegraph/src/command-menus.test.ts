import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function runScenario(scenario: string): void {
	const root = mkdtempSync(path.join(os.tmpdir(), "omp-codegraph-menu-"));
	const environment = Object.fromEntries(["PATH", "LANG", "LC_ALL", "TERM", "COLORTERM"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
	const env = {
		...environment, FIXTURE_ROOT: root, SCENARIO: scenario, HOME: path.join(root, "home"),
		PI_CODING_AGENT_DIR: path.join(root, "agent"), PI_SESSION_DIR: path.join(root, "sessions"),
		XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_DATA_HOME: path.join(root, "data"),
		TMPDIR: path.join(root, "tmp"), BUN_INSTALL_CACHE_DIR: path.join(root, "bun-cache"),
		GIT_CONFIG_GLOBAL: path.join(root, "git-global"), GIT_CONFIG_SYSTEM: path.join(root, "git-system"), GIT_CONFIG_NOSYSTEM: "1",
	};
	const code = `
		import assert from "node:assert/strict";
		import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
		import { homedir } from "node:os";
		import * as path from "node:path";
		import extension from ${JSON.stringify(path.join(import.meta.dir, "index.ts"))};
		import { CODESOOK_OMP_CONFIG_PATH } from "@codesook/omp-shared-display/config-store";
		import { projectIntegrationConfigPath } from "@codesook/omp-shared-display/project-integrations";
		import { LEGACY_CONFIG_PATH, DEFAULT_GLYPH_DIRECTORY, expandHomePath, getLegacyConfigPath } from "../../caveman/src/types.ts";
		import { HEADROOM_PROXY_TOKEN_FILE } from "../../headroom/client.ts";
		import { LEGACY_CONFIG_PATH as legacyPrompt, DEFAULT_LEFT_GLYPH_TEXT_PATH, DEFAULT_RIGHT_GLYPH_TEXT_PATH, DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH } from "../../prompt-border-style/src/main.ts";
		const root = process.env.FIXTURE_ROOT, scenario = process.env.SCENARIO;
		assert.equal(homedir(), process.env.HOME);
		const project = path.join(root, "project"), config = projectIntegrationConfigPath(project), database = path.join(project, ".codegraph", "codegraph.db");
		for (const file of [homedir(), CODESOOK_OMP_CONFIG_PATH, config, database, LEGACY_CONFIG_PATH, getLegacyConfigPath(), expandHomePath(DEFAULT_GLYPH_DIRECTORY), HEADROOM_PROXY_TOKEN_FILE, legacyPrompt, DEFAULT_LEFT_GLYPH_TEXT_PATH, DEFAULT_RIGHT_GLYPH_TEXT_PATH, DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH, ...["PI_CODING_AGENT_DIR", "PI_SESSION_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "TMPDIR", "BUN_INSTALL_CACHE_DIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"].map(key => process.env[key])]) assert.ok(file.startsWith(root + path.sep), file);
		for (const key of ["HOME", "PI_CODING_AGENT_DIR", "PI_SESSION_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "TMPDIR", "BUN_INSTALL_CACHE_DIR"]) mkdirSync(process.env[key], { recursive: true });
		mkdirSync(project);
		mkdirSync(path.dirname(CODESOOK_OMP_CONFIG_PATH), { recursive: true });
		const global = '{"version":1,"display":{},"behavior":{},"custom":"global input"}\\n';
		writeFileSync(CODESOOK_OMP_CONFIG_PATH, global);
		const input = { version: 1, display: { codegraph: { visibility: "always" } }, behavior: { beads: { policy: "off" } }, custom: { keep: true } };
		if (scenario !== "cancel" && scenario !== "help") { mkdirSync(path.dirname(config)); writeFileSync(config, JSON.stringify(input)); }
		const before = existsSync(config) ? readFileSync(config) : undefined;
		const nativeStartup = path.join(process.env.XDG_CONFIG_HOME, "native-startup");
		let command, policyStatus, choice;
		const notifications = [], hooks = new Map();
		const context = { cwd: project, hasUI: scenario !== "help", ui: {
			select: async () => choice, setStatus: (_key, text) => { policyStatus = text; },
			notify: (text, level) => notifications.push({ text, level }),
		} };
		extension({ registerCommand: (_name, value) => { command = value; }, on: (name, value) => hooks.set(name, value), events: { on: () => () => {}, emit() {} },
			getAllTools: () => [{ name: "mcp__codegraph_explore", sourceInfo: { source: "mcp" } }], getActiveTools: () => ["mcp__codegraph_explore"],
			exec: async (_command, args) => {
				writeFileSync(nativeStartup, "native inspection reached");
				if (args[0] === "init") { mkdirSync(path.dirname(database), { recursive: true }); writeFileSync(database, "initial graph"); }
				return { code: 0, stderr: "", stdout: JSON.stringify({ initialized: existsSync(database), projectPath: project, indexPath: path.dirname(database), index: { state: "complete" } }) };
			},
		});
		if (scenario === "cancel" || scenario === "help") {
			await command.handler("", context);
			assert.equal(existsSync(config), false); assert.equal(existsSync(database), false);
			assert.equal(existsSync(nativeStartup), false, "Cancelled root must not reach native startup effects");
			assert.equal(policyStatus, undefined);
		} else if (scenario === "policy") {
			choice = "Disable project guidance"; await command.handler("", context);
			assert.deepEqual(JSON.parse(readFileSync(config)), { ...input, behavior: { ...input.behavior, codegraph: { policy: "off" } } });
			assert.equal(policyStatus, "CodeGraph: suppressed");
			assert.equal(await hooks.get("before_agent_start")({ systemPrompt: ["repository instruction"] }, context), undefined);
			choice = "Enable project guidance"; await command.handler("", context);
			assert.equal(JSON.parse(readFileSync(config)).behavior.codegraph.policy, "auto");
			assert.equal(existsSync(database), false);
		} else {
			choice = "Initialize project data"; await command.handler("", context);
			assert.deepEqual(readFileSync(config), before);
			assert.equal(policyStatus, "CodeGraph: ready");
			await command.handler("off", context); assert.equal(await hooks.get("before_agent_start")({ systemPrompt: ["repository instruction"] }, context), undefined);
			await command.handler("auto", context);
			const prompt = await hooks.get("before_agent_start")({ systemPrompt: ["repository instruction"] }, context);
			assert.equal(prompt.systemPrompt[0], "repository instruction"); assert.ok(prompt.systemPrompt[1].includes(project));
		}
		assert.equal(readFileSync(CODESOOK_OMP_CONFIG_PATH, "utf8"), global);
	`;
	try {
		const child = Bun.spawnSync([process.execPath, "--eval", code], { cwd: import.meta.dir, env, timeout: 15_000 });
		expect(child.exitCode, child.stderr.toString()).toBe(0);
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test("root cancellation leaves policy and native project data untouched", () => runScenario("cancel"));
test("non-UI root offers explicit help without inspection or writes", () => runScenario("help"));
test("root guidance choices preserve unrelated policy and global inputs", () => runScenario("policy"));
test("root initialization and explicit commands expose usable graph and preserve policy", () => runScenario("init"));
