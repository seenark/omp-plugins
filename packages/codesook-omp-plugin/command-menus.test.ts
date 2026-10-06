import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("settings initialization uses saved values, shows its result in place, and keeps the unapplied draft", () => {
	const root = mkdtempSync(path.join(tmpdir(), "codesook-command-menu-"));
	const environment: Record<string, string> = Object.fromEntries(["PATH", "LANG", "LC_ALL", "TERM", "COLORTERM"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
	for (const [key, relative] of Object.entries({ HOME: "home", PI_CODING_AGENT_DIR: "agent", PI_CODING_AGENT_SESSION_DIR: "sessions", PI_SESSION_DIR: "sessions", XDG_CONFIG_HOME: "home/.config", XDG_DATA_HOME: "data", XDG_CACHE_HOME: "cache", TMPDIR: "tmp", TMP: "tmp", TEMP: "tmp", BUN_INSTALL_CACHE_DIR: "bun-cache" })) {
		environment[key] = path.join(root, relative);
		mkdirSync(environment[key]!, { recursive: true });
	}
	environment.GIT_CONFIG_GLOBAL = path.join(root, "git-global");
	environment.GIT_CONFIG_SYSTEM = path.join(root, "git-system");
	environment.GIT_CONFIG_NOSYSTEM = "1";
	environment.TEST_MENU_ROOT = root;
	const script = `
		import assert from "node:assert/strict";
		import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
		import { homedir } from "node:os";
		import path from "node:path";
		assert.equal(homedir(), process.env.HOME);
		const root = process.env.TEST_MENU_ROOT;
		// Delayed imports exercise module initialization only after the child HOME assertion.
		const { CODESOOK_OMP_CONFIG_PATH } = await import("@codesook/omp-shared-display/config-store");
		const headroom = await import("@codesook/omp-headroom/config");
		const { HEADROOM_PROXY_TOKEN_FILE } = await import("@codesook/omp-headroom/client");
		const caveman = await import(${JSON.stringify(new URL("../caveman/src/types.ts", import.meta.url).href)});
		const border = await import("@codesook/omp-prompt-border-style/src/main.ts");
		const { projectIntegrationConfigPath } = await import("@codesook/omp-shared-display/project-integrations");
		const project = path.join(root, "project");
		const glyphDirectory = path.join(root, "saved-glyphs");
		for (const value of [homedir(), process.env.PI_CODING_AGENT_DIR, process.env.PI_CODING_AGENT_SESSION_DIR, process.env.PI_SESSION_DIR, process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME, process.env.XDG_CACHE_HOME, process.env.TMPDIR, process.env.BUN_INSTALL_CACHE_DIR, process.env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_SYSTEM, CODESOOK_OMP_CONFIG_PATH, ...[headroom.HEADROOM_CONFIG_DIR, headroom.LEGACY_HEADROOM_CONFIG_FILE, headroom.HEADROOM_SETTINGS_FILE, headroom.LEGACY_HEADROOM_SETTINGS_FILE, headroom.LEGACY_HEADROOM_DISPLAY_FILE], HEADROOM_PROXY_TOKEN_FILE, caveman.getLegacyConfigPath(), caveman.LEGACY_CONFIG_PATH, border.LEGACY_CONFIG_PATH, border.DEFAULT_LEFT_GLYPH_TEXT_PATH, border.DEFAULT_RIGHT_GLYPH_TEXT_PATH, border.DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, border.DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH, path.join(homedir(), ".config/codesook-omp/context-rail"), projectIntegrationConfigPath(project), glyphDirectory]) assert.ok(path.resolve(value).startsWith(root + path.sep), value);
		mkdirSync(project);
		mkdirSync(path.dirname(CODESOOK_OMP_CONFIG_PATH), { recursive: true });
		mkdirSync(glyphDirectory);
		const original = JSON.stringify({ version: 1, custom: "retain", display: { headroom: { glyphDirectory } }, behavior: { codegraph: { policy: "off" } } });
		writeFileSync(CODESOOK_OMP_CONFIG_PATH, original);
		const existingGlyph = path.join(glyphDirectory, "off.txt");
		writeFileSync(existingGlyph, "preserve this glyph\\n");
		const { default: extension } = await import(${JSON.stringify(new URL("./index.ts", import.meta.url).href)});
		let command;
		let emits = 0;
		extension({ setLabel() {}, registerCommand(name, value) { command = value; }, exec: async () => ({ code: 0, stdout: '{"npm":[]}', stderr: "" }), events: { emit() { emits++; } } });
		await command.handler("init", { cwd: project, hasUI: true, ui: { select: async () => undefined, notify() { throw new Error("Cancelled initialization must not run"); } } });
		assert.equal(readFileSync(CODESOOK_OMP_CONFIG_PATH, "utf8"), original);
		assert.equal(existsSync(path.join(glyphDirectory, "online.txt")), false);
		assert.equal(emits, 0);
		for (const action of ["cancel", "initialize-cancel", "initialize-apply"]) {
			const save = action === "initialize-apply";
			let closed = false;
			const context = { cwd: project, hasUI: true, ui: {
				theme: { symbol() { return "*"; } },
				select: async () => { throw new Error("No hidden selector inside focused settings"); },
				confirm: async () => { throw new Error("No hidden confirmation inside focused settings"); },
				notify() { throw new Error("Initialization result must stay visible inside settings"); },
				custom: async builder => {
					const component = builder({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_color, text) => text, bold: text => text }, {}, () => { closed = true; });
					if (action === "cancel") {
						component.handleInput("\\x1b");
						assert.equal(closed, true);
						assert.equal(existsSync(path.join(glyphDirectory, "online.txt")), false);
						assert.equal(readFileSync(CODESOOK_OMP_CONFIG_PATH, "utf8"), original);
						assert.equal(emits, 0);
						return;
					}
					const select = label => { for (let i = 0; i < 180; i++) { if (component.render(80).join("\\n").includes("> " + label)) return; component.handleInput("\\x1b[B"); } throw new Error("Action not reachable: " + label); };
					select("Global policy");
					component.handleInput("\\r");
					select("Create missing files");
					component.handleInput("\\r");
					assert.equal(closed, false);
					assert.equal(readFileSync(CODESOOK_OMP_CONFIG_PATH, "utf8"), original);
					assert.equal(readFileSync(existingGlyph, "utf8"), "preserve this glyph\\n");
					assert.ok(existsSync(path.join(glyphDirectory, "online.txt")));
					assert.equal(emits, 0);
					component.handleInput("\\x1b[13;2u");
					assert.equal(readFileSync(CODESOOK_OMP_CONFIG_PATH, "utf8"), original);
					assert.equal(closed, false);
					component.handleInput(save ? "\\r" : "\\x1b");
					assert.equal(closed, false);
					component.handleInput(save ? "\\x1b[13;2u" : "\\x1b");
					assert.equal(closed, true);
				}
			} };
			await command.handler("", context);
			if (!save) assert.equal(readFileSync(CODESOOK_OMP_CONFIG_PATH, "utf8"), original);
		}
		const saved = JSON.parse(readFileSync(CODESOOK_OMP_CONFIG_PATH, "utf8"));
		assert.equal(saved.behavior.codegraph.policy, "auto");
		assert.equal(saved.custom, "retain");
		assert.equal(emits, 1);
		assert.equal(existsSync(projectIntegrationConfigPath(project)), false);
		assert.equal(readFileSync(existingGlyph, "utf8"), "preserve this glyph\\n");
		console.log(JSON.stringify({ policy: saved.behavior.codegraph.policy, emits, glyph: readFileSync(existingGlyph, "utf8") }));
	`;
	try {
		const output = execFileSync(process.execPath, ["--eval", script], { cwd: import.meta.dir, env: environment, encoding: "utf8", timeout: 30_000 });
		expect(JSON.parse(output)).toEqual({ policy: "auto", emits: 1, glyph: "preserve this glyph\n" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
