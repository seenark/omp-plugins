import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function runScenario(scenario: string): void {
	const root = mkdtempSync(path.join(os.tmpdir(), "omp-beads-menu-"));
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
		const project = path.join(root, "project"), config = projectIntegrationConfigPath(project), workspace = path.join(project, ".beads"), data = path.join(workspace, "history");
		for (const file of [homedir(), CODESOOK_OMP_CONFIG_PATH, config, workspace, LEGACY_CONFIG_PATH, getLegacyConfigPath(), expandHomePath(DEFAULT_GLYPH_DIRECTORY), HEADROOM_PROXY_TOKEN_FILE, legacyPrompt, DEFAULT_LEFT_GLYPH_TEXT_PATH, DEFAULT_RIGHT_GLYPH_TEXT_PATH, DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH, ...["PI_CODING_AGENT_DIR", "PI_SESSION_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "TMPDIR", "BUN_INSTALL_CACHE_DIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"].map(key => process.env[key])]) assert.ok(file.startsWith(root + path.sep), file);
		for (const key of ["HOME", "PI_CODING_AGENT_DIR", "PI_SESSION_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "TMPDIR", "BUN_INSTALL_CACHE_DIR"]) mkdirSync(process.env[key], { recursive: true });
		mkdirSync(project);
		mkdirSync(path.dirname(CODESOOK_OMP_CONFIG_PATH), { recursive: true });
		const global = '{"version":1,"display":{},"behavior":{},"custom":"global input"}\\n';
		writeFileSync(CODESOOK_OMP_CONFIG_PATH, global);
		const input = { version: 1, display: { beads: { visibility: "always" } }, behavior: { beads: { policy: "off" }, codegraph: { policy: "auto" } }, custom: { keep: true } };
		if (scenario !== "cancel" && scenario !== "help") { mkdirSync(path.dirname(config)); writeFileSync(config, JSON.stringify(input)); }
		if (scenario === "policy" || scenario === "reuse") { mkdirSync(workspace); writeFileSync(data, "existing issue history"); }
		const agent = path.join(project, "AGENTS.md"), hook = path.join(project, "existing-hook");
		writeFileSync(agent, "repository instructions"); writeFileSync(hook, "existing hook");
		const inputs = [agent, hook, CODESOOK_OMP_CONFIG_PATH, ...(existsSync(config) && scenario !== "policy" ? [config] : []), ...(existsSync(data) ? [data] : [])].map(file => [file, readFileSync(file)]);
		const nativeStartup = path.join(process.env.XDG_CONFIG_HOME, "native-startup");
		let command, policyStatus, mode, sawHooks = false;
		const notifications = [], hooks = new Map();
		const context = { cwd: project, hasUI: scenario !== "help", ui: {
			select: async (_title, options) => {
				if (scenario === "policy") return mode;
				if (scenario === "reuse") return "Initialize project workspace";
				if (scenario === "hooks-cancel") {
					if (options.some(option => option.label === "Initialize project workspace")) return "Initialize project workspace";
					if (options.some(option => option === "Standard/team" || option.label === "Standard/team")) return "Standard/team";
					sawHooks = true;
					return undefined;
				}
				return undefined;
			},
			setStatus: (_key, text) => { policyStatus = text; }, notify: (text, level) => notifications.push({ text, level }),
		} };
		extension({ registerCommand: (_name, value) => { command = value; }, on: (name, value) => hooks.set(name, value), events: { on: () => () => {}, emit() {} },
			exec: async (_command, args) => {
				writeFileSync(nativeStartup, "native inspection reached");
				if (args[0] === "where") return existsSync(data) ? { code: 0, stderr: "", stdout: JSON.stringify({ path: workspace, database_path: path.join(workspace, "dolt") }) } : { code: 1, stderr: "", stdout: '{"error":"no_beads_directory"}' };
				if (args[0] === "count") return { code: 0, stderr: "", stdout: '{"count":0}' };
				mkdirSync(workspace, { recursive: true }); writeFileSync(data, "UNEXPECTED initialization"); writeFileSync(hook, "UNEXPECTED hook install");
				return { code: 0, stdout: "", stderr: "" };
			},
		});
		if (scenario === "cancel" || scenario === "help") {
			await command.handler("", context);
			assert.equal(existsSync(config), false); assert.equal(existsSync(workspace), false);
			assert.equal(existsSync(nativeStartup), false, "Cancelled root must not reach native startup effects");
			assert.equal(policyStatus, undefined);
		} else if (scenario === "policy") {
			mode = "Enable project guidance"; await command.handler("", context);
			assert.deepEqual(JSON.parse(readFileSync(config)), { ...input, behavior: { ...input.behavior, beads: { policy: "auto" } } });
			assert.equal(policyStatus, "Beads: ready");
			const prompt = await hooks.get("before_agent_start")({ systemPrompt: ["repository instruction"] }, context);
			assert.equal(prompt.systemPrompt[0], "repository instruction"); assert.ok(prompt.systemPrompt[1].includes(workspace));
			mode = "Disable project guidance"; await command.handler("", context);
			assert.deepEqual(JSON.parse(readFileSync(config)), input); assert.equal(policyStatus, "Beads: suppressed");
			assert.equal(await hooks.get("before_agent_start")({ systemPrompt: ["repository instruction"] }, context), undefined);
			await command.handler("auto", context); assert.equal(JSON.parse(readFileSync(config)).behavior.beads.policy, "auto");
			await command.handler("off", context); assert.deepEqual(JSON.parse(readFileSync(config)), input);
			await command.handler("status", context); assert.ok(notifications.at(-1).text.includes("Beads: suppressed"));
		} else {
			await command.handler(scenario === "reuse" || scenario === "hooks-cancel" ? "" : "init", context);
			assert.equal(notifications.at(-1).level, "info");
			if (scenario !== "reuse") assert.equal(existsSync(workspace), false);
			assert.equal(await hooks.get("before_agent_start")({ systemPrompt: ["repository instruction"] }, context), undefined);
			if (scenario === "reuse") await command.handler("init", context);
		}
		if (scenario === "hooks-cancel") assert.equal(sawHooks, true, "Escape must occur at the hooks choice");
		for (const [file, bytes] of inputs) assert.deepEqual(readFileSync(file), bytes);
	`;
	try {
		const child = Bun.spawnSync([process.execPath, "--eval", code], { cwd: import.meta.dir, env, timeout: 15_000 });
		expect(child.exitCode, child.stderr.toString()).toBe(0);
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test("root cancellation preserves policy, agent files, hooks and native data", () => runScenario("cancel"));
test("non-UI root gives explicit help without reaching native startup", () => runScenario("help"));
test("root guidance choices and explicit commands preserve unrelated config and issue history", () => runScenario("policy"));
test("root initialization reuses ready workspace without changing policy, data or hooks", () => runScenario("reuse"));
test("Escape at initialization mode preserves policy, data, hooks and agent files", () => runScenario("mode-cancel"));
test("Escape at initialization hooks cancels entire operation without writes", () => runScenario("hooks-cancel"));
