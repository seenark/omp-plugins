import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

function runFixture(scenario: string): void {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "headroom-menu-")));
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
			const config = await import(${JSON.stringify(new URL("./config.ts", import.meta.url).href)});
			const display = await import(${JSON.stringify(new URL("./display.ts", import.meta.url).href)});
			const client = await import(${JSON.stringify(new URL("./client.ts", import.meta.url).href)});
			const init = await import(${JSON.stringify(new URL("./init.ts", import.meta.url).href)});
			for (const file of [config.HEADROOM_CONFIG_FILE, config.LEGACY_HEADROOM_CONFIG_FILE, ...config.HEADROOM_SETTINGS_PATHS, config.LEGACY_HEADROOM_DISPLAY_FILE, display.GLYPH_DIR, client.HEADROOM_PROXY_TOKEN_FILE, init.defaultPaths.config, init.defaultPaths.glyphs]) inside(file);
			const snapshot = () => {
				const files = {};
				const visit = dir => { if (!fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file); else files[file] = fs.readFileSync(file).toString("base64"); } };
				visit(path.join(home, ".config")); visit(path.join(home, ".pi")); visit(process.cwd()); return files;
			};
			const write = (file, value) => { inside(file); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
			const handlers = new Map();
			const commands = new Map();
			const notices = [];
			const pi = {
				events: { on() { return () => {}; }, emit() {} },
				on(name, handler) { handlers.set(name, handler); },
				registerCommand(name, command) { commands.set(name, command); },
				logger: { warn() {}, info() {}, error() {} },
			};
			const ctx = { hasUI: true, ui: { theme: { symbol: () => "S" }, notify: message => notices.push(message), select: async () => undefined, input: async () => undefined, confirm: async () => false }, getContextUsage: () => ({ tokens: 50000 }) };
			const command = args => commands.get("headroom").handler(args, ctx);
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

test("cancelling Headroom root leaves missing config and legacy inputs untouched", () => {
	runFixture(`
		write(config.LEGACY_HEADROOM_CONFIG_FILE, JSON.stringify({ enabled: false }));
		const before = snapshot();
		extension(pi);
		await command("");
		assert.deepEqual(snapshot(), before);
		assert.equal(fs.existsSync(config.HEADROOM_CONFIG_FILE), false);
		assert.equal(fs.existsSync(display.GLYPH_DIR + "/off.txt"), false);
	`);
});

test("Headroom cancellation keeps compression active and Off disables it without changing saved settings", () => {
	runFixture(`
		write(config.HEADROOM_CONFIG_FILE, JSON.stringify({ version: 1, behavior: { headroom: { enabled: true, minContextTokens: 1, minMessageChars: 1 } }, display: { headroom: {} } }));
		const before = snapshot();
		let requests = 0;
		globalThis.fetch = async url => {
			requests++;
			if (url.endsWith("/health")) return Response.json({ status: "healthy" });
			return Response.json({ messages: [{ role: "tool", tool_call_id: "call_1", content: "short result" }], tokens_before: 20, tokens_after: 2, tokens_saved: 18, compression_ratio: 0.1 });
		};
		extension(pi);
		await command("health");
		await command("");
		const event = { messages: [{ role: "toolResult", toolCallId: "call_1", toolName: "fixture", content: [{ type: "text", text: "a long fixture result with details" }], isError: false, timestamp: 1 }] };
		const compressed = await handlers.get("context")(event, ctx);
		assert.equal(compressed.messages[0].content[0].text, "short result");
		ctx.ui.select = async () => "Disable compression";
		await command("");
		const afterOff = requests;
		assert.equal(await handlers.get("context")(event, ctx), undefined);
		assert.equal(requests, afterOff);
		assert.deepEqual(snapshot(), before);
	`);
});

test("cancelling Headroom initialization choice creates nothing", () => {
	runFixture(`
		const before = snapshot();
		extension(pi);
		const choices = ["Choose files to initialize", undefined];
		ctx.ui.select = async () => choices.shift();
		await command("");
		assert.deepEqual(snapshot(), before);
		assert.equal(fs.existsSync(config.HEADROOM_CONFIG_FILE), false);
		assert.equal(fs.existsSync(display.GLYPH_DIR), false);
	`);
});

test("Headroom menu initializes only the chosen config and preserves other feature settings", () => {
	runFixture(`
		write(config.HEADROOM_CONFIG_FILE, JSON.stringify({ version: 1, behavior: { caveman: { defaultLevel: "ultra" } }, display: { caveman: { visible: false } } }));
		extension(pi);
		const choices = ["Choose files to initialize", "Initialize config"];
		ctx.ui.select = async () => choices.shift();
		ctx.ui.confirm = async () => true;
		await command("");
		const saved = JSON.parse(fs.readFileSync(config.HEADROOM_CONFIG_FILE, "utf8"));
		assert.equal(saved.behavior.headroom.enabled, true);
		assert.equal(saved.behavior.headroom.baseUrl, "http://127.0.0.1:8788");
		assert.equal(saved.behavior.caveman.defaultLevel, "ultra");
		assert.equal(saved.display.caveman.visible, false);
		assert.equal(fs.existsSync(display.GLYPH_DIR), false);
	`);
});

test("Headroom glyph initialization does not seed config and keeps per-file skips", () => {
	runFixture(`
		write(path.join(display.GLYPH_DIR, "off.txt"), "custom off\\n");
		extension(pi);
		const choices = ["Choose files to initialize", "Initialize glyphs"];
		ctx.ui.select = async () => choices.shift();
		await command("");
		assert.equal(fs.existsSync(config.HEADROOM_CONFIG_FILE), false);
		assert.equal(fs.readFileSync(path.join(display.GLYPH_DIR, "off.txt"), "utf8"), "custom off\\n");
		assert.equal(fs.readFileSync(path.join(display.GLYPH_DIR, "compressed.txt"), "utf8"), "S\\n");
	`);
});

test("Headroom explicit init still writes all targets and rejects compound commands", () => {
	runFixture(`
		extension(pi);
		ctx.ui.select = async () => { throw new Error("Explicit init must not choose a target"); };
		await command("init");
		const saved = JSON.parse(fs.readFileSync(config.HEADROOM_CONFIG_FILE, "utf8"));
		assert.equal(saved.behavior.headroom.enabled, true);
		assert.equal(fs.readFileSync(path.join(display.GLYPH_DIR, "compressed.txt"), "utf8"), "S\\n");
		const before = snapshot();
		for (const args of ["off now", "init all extra", "token secret"]) await command(args);
		assert.deepEqual(snapshot(), before);
	`);
});

test("cancelling Headroom token input preserves existing token bytes", () => {
	runFixture(`
		write(config.HEADROOM_CONFIG_FILE, JSON.stringify({ version: 1, behavior: { headroom: { enabled: false } }, display: { headroom: {} } }));
		write(client.HEADROOM_PROXY_TOKEN_FILE, "existing-token\\n");
		const before = snapshot();
		extension(pi);
		ctx.ui.select = async () => "Set proxy token";
		await command("");
		assert.deepEqual(snapshot(), before);
		assert.equal(fs.readFileSync(client.HEADROOM_PROXY_TOKEN_FILE, "utf8"), "existing-token\\n");
	`);
});

test("Headroom non-UI root reports help without loading or changing config", () => {
	runFixture(`
		write(config.LEGACY_HEADROOM_CONFIG_FILE, JSON.stringify({ enabled: false }));
		const before = snapshot();
		extension(pi);
		ctx.hasUI = false;
		ctx.ui.select = async () => { throw new Error("No UI selection allowed"); };
		await command("");
		assert.deepEqual(snapshot(), before);
		assert.equal(fs.existsSync(config.HEADROOM_CONFIG_FILE), false);
	`);
});
