import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

function runFixture(scenario: string): void {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "caveman-menu-")));
	const home = path.join(root, "home");
	const project = path.join(root, "project");
	fs.mkdirSync(project);
	try {
		const result = spawnSync(process.execPath, ["--eval", `
			import assert from "node:assert/strict";
			import * as fs from "node:fs";
			import * as os from "node:os";
			import * as path from "node:path";
			const root = ${JSON.stringify(root)};
			const home = ${JSON.stringify(home)};
			const inside = file => assert.ok(file.startsWith(root + path.sep), file);
			assert.equal(os.homedir(), home);
			for (const key of ["HOME", "PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "TMPDIR", "GIT_CONFIG_GLOBAL"]) inside(process.env[key]);
			inside(process.cwd());
			// Import only after the child process proves HOME and writable paths are isolated.
			const { default: extension } = await import(${JSON.stringify(new URL("./index.ts", import.meta.url).href)});
			const types = await import(${JSON.stringify(new URL("./types.ts", import.meta.url).href)});
			for (const file of [types.CONFIG_PATH, types.LEGACY_CONFIG_PATH, types.getLegacyConfigPath(), types.expandHomePath(types.DEFAULT_GLYPH_DIRECTORY), path.join(process.env.PI_CODING_AGENT_DIR, "sessions")]) inside(file);
			const snapshot = () => {
				const files = {};
				const visit = dir => { if (!fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file); else files[file] = fs.readFileSync(file).toString("base64"); } };
				visit(path.join(home, ".config")); visit(path.join(home, ".pi")); visit(process.cwd()); return files;
			};
			const write = (file, value) => { inside(file); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
			const handlers = new Map();
			const commands = new Map();
			const entries = [];
			const notices = [];
			const sessionFile = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", "fixture.jsonl");
			inside(sessionFile);
			const pi = {
				events: { on() { return () => {}; }, emit() {} },
				on(name, handler) { handlers.set(name, handler); },
				registerCommand(name, command) { commands.set(name, command); },
				appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); write(sessionFile, entries.map(entry => JSON.stringify(entry)).join("\\n") + "\\n"); },
				logger: { warn() {}, info: message => notices.push(message), error: message => notices.push(message) },
			};
			const ctx = { hasUI: true, agent: { kind: "main", id: "Main", name: "main", depth: 0 }, ui: { theme: { fg: (_color, text) => text, bold: text => text }, notify: message => notices.push(message), select: async () => undefined, setStatus() {} }, sessionManager: { getBranch: () => entries } };
			const command = args => commands.get("caveman").handler(args, ctx);
			globalThis.fetch = async () => { throw new Error("Network access is forbidden in menu fixtures"); };
			${scenario}
		`], {
			cwd: project,
			env: {
				PATH: process.env.PATH,
				HOME: home,
				PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
				XDG_CONFIG_HOME: path.join(home, ".config"),
				XDG_CACHE_HOME: path.join(home, ".cache"),
				TMPDIR: path.join(root, "temp"),
				GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
				GIT_CONFIG_NOSYSTEM: "1",
			},
			encoding: "utf8",
		});
		expect(result.stderr + result.stdout).toBe("");
		expect(result.status).toBe(0);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

test("cancelling Caveman root preserves legacy config and creates no glyphs or session entries", () => {
	runFixture(`
		write(types.LEGACY_CONFIG_PATH, JSON.stringify({ defaultLevel: "lite" }));
		const before = snapshot();
		extension(pi);
		await command("");
		assert.deepEqual(snapshot(), before);
		assert.deepEqual(entries, []);
		assert.equal(fs.existsSync(types.CONFIG_PATH), false);
		assert.equal(fs.existsSync(types.expandHomePath(types.DEFAULT_GLYPH_DIRECTORY)), false);
	`);
});

test("Caveman menu choices change actual prompt rules and recover the session level", () => {
	runFixture(`
		extension(pi);
		ctx.ui.select = async () => "Lite";
		await command("");
		const light = await handlers.get("before_agent_start")({ systemPrompt: ["Base prompt"] }, ctx);
		assert.equal(light.systemPrompt[0], "Base prompt");
		assert.equal(light.systemPrompt.at(-1).split("\\n")[0], "CAVEMAN MODE ACTIVE — level: lite");
		assert.deepEqual(entries.at(-1), { type: "custom", customType: "caveman-level", data: { level: "lite" } });
		const session = fs.readFileSync(sessionFile, "utf8");
		assert.equal(JSON.parse(session.trim()).data.level, "lite");
		await handlers.get("session_branch")({}, ctx);
		const restored = await handlers.get("before_agent_start")({ systemPrompt: ["Base prompt"] }, ctx);
		assert.deepEqual(restored.systemPrompt, light.systemPrompt);
		const beforeOff = snapshot();
		ctx.ui.select = async () => "Off";
		await command("");
		assert.equal(await handlers.get("before_agent_start")({ systemPrompt: ["Base prompt"] }, ctx), undefined);
		const afterOff = snapshot();
		delete beforeOff[sessionFile];
		delete afterOff[sessionFile];
		assert.deepEqual(afterOff, beforeOff);
		assert.equal(entries.at(-1).data.level, "off");
		await command("ultra");
		const explicit = await handlers.get("before_agent_start")({ systemPrompt: ["Base prompt"] }, ctx);
		assert.equal(explicit.systemPrompt.at(-1).split("\\n")[0], "CAVEMAN MODE ACTIVE — level: ultra");
	`);
});

test("Caveman root cancellation preserves an already active level and session history", () => {
	runFixture(`
		extension(pi);
		await command("full");
		const before = snapshot();
		const history = JSON.stringify(entries);
		ctx.ui.select = async () => undefined;
		await command("");
		assert.deepEqual(snapshot(), before);
		assert.equal(JSON.stringify(entries), history);
		const result = await handlers.get("before_agent_start")({ systemPrompt: ["Base prompt"] }, ctx);
		assert.equal(result.systemPrompt.at(-1).split("\\n")[0], "CAVEMAN MODE ACTIVE — level: full");
	`);
});

test("Caveman non-UI root never selects, migrates, seeds, or appends a level", () => {
	runFixture(`
		write(types.LEGACY_CONFIG_PATH, JSON.stringify({ defaultLevel: "lite" }));
		const before = snapshot();
		extension(pi);
		ctx.hasUI = false;
		ctx.ui.select = async () => { throw new Error("No UI selection allowed"); };
		await command("");
		assert.deepEqual(snapshot(), before);
		assert.deepEqual(entries, []);
	`);
});

const promptLevel = `
	const level = async (h, c) => (await h.get("before_agent_start")({ systemPrompt: ["Base"] }, c))?.systemPrompt.at(-1).split("\\n")[0];
`;

test("Typing stop caveman or normal mode turns Caveman off for the session", () => {
	runFixture(`
		${promptLevel}
		extension(pi);
		await handlers.get("session_start")({}, ctx);
		const input = (text, source = "interactive") => handlers.get("input")({ type: "input", text, source }, ctx);
		assert.equal(await level(handlers, ctx), "CAVEMAN MODE ACTIVE — level: full");
		await input("stop caveman please");
		await input("stop caveman", "extension");
		assert.equal(entries.length, 0);
		assert.equal(await level(handlers, ctx), "CAVEMAN MODE ACTIVE — level: full");
		await input("  Stop Caveman. ");
		assert.deepEqual(entries.at(-1), { type: "custom", customType: "caveman-level", data: { level: "off" } });
		assert.equal(await level(handlers, ctx), undefined);
		await command("lite");
		await input("normal mode!");
		assert.equal(entries.at(-1).data.level, "off");
		await handlers.get("session_branch")({}, ctx);
		assert.equal(await level(handlers, ctx), undefined);
	`);
});

test("Unparseable root config keeps Caveman off", () => {
	runFixture(`
		write(types.CONFIG_PATH, "{invalid\\n");
		extension(pi);
		await handlers.get("session_start")({}, ctx);
		assert.equal(await handlers.get("before_agent_start")({ systemPrompt: ["Base"] }, ctx), undefined);
		assert.ok(notices.some(message => message.includes("Unable to parse Caveman config")));
		assert.equal(fs.readFileSync(types.CONFIG_PATH, "utf8"), "{invalid\\n");
	`);
});

test("Subagents inherit the level of their spawning agent, including off", () => {
	runFixture(`
		${promptLevel}
		const agent = (id, parentId) => ({ kind: parentId ? "sub" : "main", id, name: id, depth: 0, ...(parentId ? { parentId } : {}) });
		const start = async (id, parentId) => {
			const h = new Map();
			const cmds = new Map();
			const e = [];
			const p = { ...pi, on: (name, handler) => h.set(name, handler), registerCommand: (name, cmd) => cmds.set(name, cmd), appendEntry: (customType, data) => e.push({ type: "custom", customType, data }) };
			const c = { ...ctx, agent: agent(id, parentId), sessionManager: { getBranch: () => e } };
			extension(p);
			await h.get("session_start")({}, c);
			return { h, e, c, run: args => cmds.get("caveman").handler(args, c) };
		};
		const parent = await start("Main");
		await parent.run("ultra");
		const lite = await start("1-Task", "Main");
		const ultra = await start("0-Task", "Main");
		assert.equal(await level(ultra.h, ultra.c), "CAVEMAN MODE ACTIVE — level: ultra");
		assert.deepEqual(ultra.e, [{ type: "custom", customType: "caveman-level", data: { level: "ultra" } }]);
		await lite.run("lite");
		assert.equal(await level(lite.h, lite.c), "CAVEMAN MODE ACTIVE — level: lite");
		assert.equal(await level(ultra.h, ultra.c), "CAVEMAN MODE ACTIVE — level: ultra");
		const grandchild = await start("0-Task.0-Sub", "0-Task");
		assert.equal(await level(grandchild.h, grandchild.c), "CAVEMAN MODE ACTIVE — level: ultra");
		await parent.run("off");
		const silent = await start("2-Task", "Main");
		assert.equal(await level(silent.h, silent.c), undefined);
		assert.equal(await level(ultra.h, ultra.c), "CAVEMAN MODE ACTIVE — level: ultra");
		await parent.run("lite");
		await parent.h.get("session_shutdown")({}, parent.c);
		const orphan = await start("4-Task", "Main");
		assert.equal(await level(orphan.h, orphan.c), "CAVEMAN MODE ACTIVE — level: full");
	`);
});

test("Caveman status says when a session level overrides the default", () => {
	runFixture(`
		ctx.hasUI = false;
		extension(pi);
		await command("full");
		await command("status");
		assert.ok(notices.at(-1).includes("Default: full\\n"));
		await command("lite");
		await command("status");
		assert.ok(notices.at(-1).includes("Level: lite\\nDefault: full (overridden by session level)"));
	`);
});
