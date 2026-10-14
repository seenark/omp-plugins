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
			const instructions = await import(${JSON.stringify(new URL("./instructions.ts", import.meta.url).href)});
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
			const skill = mode => instructions.readCavemanSkillBody(types.DEFAULT_SKILL_DIRECTORY, mode);
			const prompt = async (h = handlers, c = ctx) => (await h.get("before_agent_start")({ systemPrompt: ["Base"] }, c))?.systemPrompt;
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

test("Each Mode Level injects exactly its vendored skill body and off injects nothing", () => {
	runFixture(`
		extension(pi);
		const bodies = new Set();
		for (const mode of ["caveman", "ultracave", "megacave"]) {
			await command(mode);
			assert.deepEqual(entries.at(-1), { type: "custom", customType: "caveman-mode", data: { mode } });
			const expected = await skill(mode);
			assert.ok(expected.startsWith("# " + mode));
			assert.deepEqual(await prompt(), ["Base", expected]);
			bodies.add(expected);
		}
		assert.equal(bodies.size, 3);
		await command("off");
		assert.equal(await prompt(), undefined);
		assert.equal(entries.at(-1).data.mode, "off");
	`);
});

test("Upstream aliases and standalone commands select ultracave and megacave", () => {
	runFixture(`
		extension(pi);
		await command("ultra");
		assert.equal(entries.at(-1).data.mode, "ultracave");
		assert.deepEqual(await prompt(), ["Base", await skill("ultracave")]);
		await command("wenyan");
		assert.equal(entries.at(-1).data.mode, "megacave");
		assert.deepEqual(await prompt(), ["Base", await skill("megacave")]);
		await command("caveman");
		await commands.get("ultracave").handler("", ctx);
		assert.equal(entries.at(-1).data.mode, "ultracave");
		await commands.get("megacave").handler("", ctx);
		assert.equal(entries.at(-1).data.mode, "megacave");
		assert.deepEqual(await prompt(), ["Base", await skill("megacave")]);
		const count = entries.length;
		for (const removed of ["lite", "full", "wenyan-full", "wenyan-lite", "wenyan-ultra"]) await command(removed);
		assert.equal(entries.length, count);
		assert.equal(notices.filter(message => message.startsWith("Unknown Caveman command")).length, 5);
	`);
});

test("Caveman menu choices change actual prompt rules and recover the session mode", () => {
	runFixture(`
		extension(pi);
		ctx.ui.select = async () => "Ultracave";
		await command("");
		const ultra = await prompt();
		assert.deepEqual(ultra, ["Base", await skill("ultracave")]);
		assert.deepEqual(entries.at(-1), { type: "custom", customType: "caveman-mode", data: { mode: "ultracave" } });
		assert.equal(JSON.parse(fs.readFileSync(sessionFile, "utf8").trim()).data.mode, "ultracave");
		await handlers.get("session_branch")({}, ctx);
		assert.deepEqual(await prompt(), ultra);
		const beforeOff = snapshot();
		ctx.ui.select = async () => "Off";
		await command("");
		assert.equal(await prompt(), undefined);
		const afterOff = snapshot();
		delete beforeOff[sessionFile];
		delete afterOff[sessionFile];
		assert.deepEqual(afterOff, beforeOff);
		assert.equal(entries.at(-1).data.mode, "off");
		await command("megacave");
		assert.deepEqual(await prompt(), ["Base", await skill("megacave")]);
	`);
});

test("Session entries rehydrate on session_switch and session_branch; invalid entries are ignored", () => {
	runFixture(`
		extension(pi);
		await command("ultracave");
		entries.push({ type: "custom", customType: "caveman-level", data: { level: "full" } });
		entries.push({ type: "custom", customType: "caveman-mode", data: { mode: "full" } });
		entries.push({ type: "custom", customType: "caveman-mode", data: { mode: "wenyan-full" } });
		for (const event of ["session_switch", "session_branch"]) {
			await handlers.get(event)({}, ctx);
			assert.deepEqual(await prompt(), ["Base", await skill("ultracave")]);
		}
		entries.length = 0;
		await handlers.get("session_switch")({}, ctx);
		assert.deepEqual(await prompt(), ["Base", await skill("caveman")]);
	`);
});

test("Caveman root cancellation preserves an already active mode and session history", () => {
	runFixture(`
		extension(pi);
		await command("caveman");
		const before = snapshot();
		const history = JSON.stringify(entries);
		ctx.ui.select = async () => undefined;
		await command("");
		assert.deepEqual(snapshot(), before);
		assert.equal(JSON.stringify(entries), history);
		assert.deepEqual(await prompt(), ["Base", await skill("caveman")]);
	`);
});

test("Caveman non-UI root never selects, migrates, seeds, or appends a mode", () => {
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

test("Typing stop caveman or normal mode turns Caveman off for the session", () => {
	runFixture(`
		extension(pi);
		await handlers.get("session_start")({}, ctx);
		const input = (text, source = "interactive") => handlers.get("input")({ type: "input", text, source }, ctx);
		const on = ["Base", await skill("caveman")];
		assert.deepEqual(await prompt(), on);
		await input("stop caveman please");
		await input("stop caveman", "extension");
		assert.equal(entries.length, 0);
		assert.deepEqual(await prompt(), on);
		await input("  Stop Caveman. ");
		assert.deepEqual(entries.at(-1), { type: "custom", customType: "caveman-mode", data: { mode: "off" } });
		assert.equal(await prompt(), undefined);
		await command("ultracave");
		await input("normal mode!");
		assert.equal(entries.at(-1).data.mode, "off");
		await handlers.get("session_branch")({}, ctx);
		assert.equal(await prompt(), undefined);
	`);
});

test("Unparseable root config keeps Caveman off", () => {
	runFixture(`
		write(types.CONFIG_PATH, "{invalid\\n");
		extension(pi);
		await handlers.get("session_start")({}, ctx);
		assert.equal(await prompt(), undefined);
		assert.ok(notices.some(message => message.includes("Unable to parse Caveman config")));
		assert.equal(fs.readFileSync(types.CONFIG_PATH, "utf8"), "{invalid\\n");
	`);
});

test("Legacy defaultLevel in root config fails closed to off", () => {
	runFixture(`
		write(types.CONFIG_PATH, JSON.stringify({ version: 1, display: { caveman: {} }, behavior: { caveman: { defaultLevel: "full" } } }));
		extension(pi);
		await handlers.get("session_start")({}, ctx);
		assert.equal(await prompt(), undefined);
		assert.ok(notices.some(message => message.includes("removed defaultLevel")));
		write(types.CONFIG_PATH, JSON.stringify({ version: 1, display: { caveman: {} }, behavior: { caveman: { defaultMode: "ultracave" } } }));
		await handlers.get("session_switch")({}, ctx);
		assert.deepEqual(await prompt(), ["Base", await skill("ultracave")]);
	`);
});

test("Subagents inherit the mode of their spawning agent, including off", () => {
	runFixture(`
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
		await parent.run("ultracave");
		const child = await start("1-Task", "Main");
		const sibling = await start("0-Task", "Main");
		assert.deepEqual(await prompt(sibling.h, sibling.c), ["Base", await skill("ultracave")]);
		assert.deepEqual(sibling.e, [{ type: "custom", customType: "caveman-mode", data: { mode: "ultracave" } }]);
		await child.run("megacave");
		assert.deepEqual(await prompt(child.h, child.c), ["Base", await skill("megacave")]);
		assert.deepEqual(await prompt(sibling.h, sibling.c), ["Base", await skill("ultracave")]);
		const grandchild = await start("0-Task.0-Sub", "0-Task");
		assert.deepEqual(await prompt(grandchild.h, grandchild.c), ["Base", await skill("ultracave")]);
		await parent.run("off");
		const silent = await start("2-Task", "Main");
		assert.equal(await prompt(silent.h, silent.c), undefined);
		assert.deepEqual(await prompt(sibling.h, sibling.c), ["Base", await skill("ultracave")]);
		await parent.run("megacave");
		await parent.h.get("session_shutdown")({}, parent.c);
		const orphan = await start("4-Task", "Main");
		assert.deepEqual(await prompt(orphan.h, orphan.c), ["Base", await skill("caveman")]);
	`);
});

test("Caveman status says when a session mode overrides the default", () => {
	runFixture(`
		ctx.hasUI = false;
		extension(pi);
		await command("caveman");
		await command("status");
		assert.ok(notices.at(-1).includes("Default: caveman\\n"));
		await command("ultracave");
		await command("status");
		assert.ok(notices.at(-1).includes("Mode: ultracave\\nDefault: caveman (overridden by session mode)"));
	`);
});
