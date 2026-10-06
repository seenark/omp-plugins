import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

function runCommandScenario(scenario: string): void {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "omp-border-menu-")));
	const home = path.join(root, "home");
	const environment = {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BEADS|DOLT|CODEGRAPH|GIT|PI_|OMP_|ANTHROPIC|OPENAI|GOOGLE|GEMINI|AZURE|AWS|BEDROCK|MISTRAL|GROQ|XAI|OPENROUTER|DEEPSEEK|COHERE|HF_|HUGGING|CODESOOK)|API_KEY|TOKEN|AUTH|CREDENTIAL/u.test(key))),
		HOME: home,
		PI_CODING_AGENT_DIR: path.join(root, "agent"),
		PI_SESSION_DIR: path.join(root, "sessions"),
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_CACHE_HOME: path.join(root, "cache"),
		XDG_DATA_HOME: path.join(root, "data"),
		XDG_STATE_HOME: path.join(root, "state"),
		TMPDIR: path.join(root, "tmp"),
		BUN_INSTALL_CACHE_DIR: path.join(root, "bun-cache"),
		GIT_CONFIG_GLOBAL: path.join(root, "git-global"),
		GIT_CONFIG_SYSTEM: path.join(root, "git-system"),
		GIT_CONFIG_NOSYSTEM: "1",
	};
	for (const directory of [home, environment.PI_CODING_AGENT_DIR, environment.PI_SESSION_DIR, environment.XDG_CONFIG_HOME, environment.XDG_CACHE_HOME, environment.XDG_DATA_HOME, environment.XDG_STATE_HOME, environment.TMPDIR, environment.BUN_INSTALL_CACHE_DIR]) mkdirSync(directory, { recursive: true });
	const source = `
		import assert from "node:assert/strict";
		import * as fs from "node:fs";
		import * as os from "node:os";
		import * as path from "node:path";
		const root = ${JSON.stringify(root)};
		assert.equal(os.homedir(), ${JSON.stringify(home)});
		assert.equal(process.cwd(), root);
		for (const value of [os.homedir(), process.env.PI_CODING_AGENT_DIR, process.env.PI_SESSION_DIR, process.env.XDG_CONFIG_HOME, process.env.XDG_CACHE_HOME, process.env.XDG_DATA_HOME, process.env.TMPDIR, process.env.BUN_INSTALL_CACHE_DIR, process.env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_SYSTEM, path.join(os.homedir(), ".pi", "agent"), path.join(os.homedir(), ".config", "omp")]) assert.ok(value.startsWith(root + path.sep), value);
		// Load only after verifying the disposable child's home and environment.
		const border = await import(${JSON.stringify(path.join(import.meta.dir, "main.ts"))});
		for (const value of [border.CONFIG_PATH, border.LEGACY_CONFIG_PATH, border.DEFAULT_LEFT_GLYPH_TEXT_PATH, border.DEFAULT_RIGHT_GLYPH_TEXT_PATH, border.DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, border.DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH, path.resolve(os.homedir(), border.DEFAULT_CONTEXT_RAIL_CONFIG.glyphDirectory.replace(/^~\\//u, ""))]) assert.ok(value.startsWith(root + path.sep), value);
		// Assert the host's real project, session, settings and auth storage paths before any operation.
		const dirs = await import(${JSON.stringify(import.meta.resolve("@oh-my-pi/pi-utils/dirs", import.meta.resolve("@oh-my-pi/pi-coding-agent/config/settings")))});
		for (const value of [dirs.getAgentDir(), dirs.getAgentDbPath(), dirs.getSessionsDir(), dirs.getConfigRootDir(), dirs.getProjectAgentDir(root), path.join(dirs.getAgentDir(), "auth.json"), path.join(dirs.getAgentDir(), "config.yml"), path.join(dirs.getProjectAgentDir(root), "config.yml")]) assert.ok(value.startsWith(root + path.sep), value);
		// The real editor needs the host singleton; keep it entirely in memory.
		const { Settings } = await import(${JSON.stringify(import.meta.resolve("@oh-my-pi/pi-coding-agent/config/settings"))});
		await Settings.init({ inMemory: true, cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR });
		const commands = new Map(), hooks = new Map(), notifications = [], widgets = new Map();
		let choices = [], selections = 0, editorChanges = 0, editor, workingMessage;
		const context = { hasUI: true, ui: {
			theme: { fg: (_role, text) => text, getSymbol: () => undefined, getSpinnerFrames: () => ["."] },
			select: async (_title, options) => {
				selections++;
				const choice = choices.shift();
				if (choice === undefined) return undefined;
				const option = options.find(option => option.label === choice);
				assert.ok(option, 'Missing menu choice: ' + choice);
				assert.ok(option.description, 'Missing description: ' + choice);
				return option.label;
			},
			notify: (message, level) => notifications.push({ message, level }),
			setEditorComponent: factory => { editorChanges++; editor?.dispose(); editor = factory?.({ requestRender() {} }, editorTheme); },
			setWidget: (key, factory) => { if (factory) widgets.set(key, factory); else widgets.delete(key); },
			setWorkingMessage: message => { workingMessage = message; },
		} };
		const editorTheme = {
			borderColor: text => text,
			selectList: { selectedPrefix: text => text, selectedText: text => text, description: text => text, scrollInfo: text => text, noMatch: text => text },
			symbols: { boxRound: border.borderStyles.round, inputCursor: " ", cursor: ">" },
		};
		border.default({ setLabel() {}, on: (name, handler) => hooks.set(name, handler), events: { on() {} }, registerCommand: (name, command) => commands.set(name, command) });
		const command = commands.get("prompt-border");
		assert.ok(command);
		assert.equal(commands.has("context-rail"), false);
		${scenario}
		await hooks.get("session_shutdown")({}, context);
	`;
	try {
		const child = Bun.spawnSync([process.execPath, "--eval", source], { cwd: root, env: environment, stdout: "pipe", stderr: "pipe", timeout: 20_000 });
		expect(child.stderr.toString(), child.stdout.toString()).toBe("");
		expect(child.exitCode, child.stdout.toString()).toBe(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("canceling root and nested prompt border choices leaves legacy config and editor untouched", () => {
	runCommandScenario(`
		fs.mkdirSync(path.dirname(border.LEGACY_CONFIG_PATH), { recursive: true });
		const legacyBytes = JSON.stringify({ promptBorder: { style: "round", layout: "sides" } });
		fs.writeFileSync(border.LEGACY_CONFIG_PATH, legacyBytes);
		const before = fs.readdirSync(path.dirname(border.LEGACY_CONFIG_PATH));
		for (const [args, route] of [["", []], ["", ["Choose border style"]], ["", ["Choose border style", "Choose uniform borders"]], ["", ["Choose border style", "Choose mixed and line borders"]], ["", ["Choose border layout"]], ["", ["Choose Context Rail action"]], ["", ["Choose glyph action"]], ["", ["Choose glyph action", "Choose debug action"]], ["style", []], ["style", ["Choose uniform borders"]], ["style", ["Choose mixed and line borders"]], ["layout", []], ["rail", []], ["glyphs", []], ["glyphs", ["Choose debug action"]], ["glyphs debug", []]]) {
			choices = [...route];
			const previousSelections = selections;
			await command.handler(args, context);
			assert.ok(selections > previousSelections, 'No menu for ' + args);
			assert.equal(editorChanges, 0);
			assert.equal(widgets.size, 0);
			assert.equal(workingMessage, undefined);
			assert.equal(fs.existsSync(border.CONFIG_PATH), false);
			assert.equal(fs.readFileSync(border.LEGACY_CONFIG_PATH, "utf8"), legacyBytes);
			assert.deepEqual(fs.readdirSync(path.dirname(border.LEGACY_CONFIG_PATH)), before);
		}
	`);
});

test("menu style and layout choices retain their counterpart in rendered editor and reset with the session", () => {
	runCommandScenario(`
		fs.mkdirSync(path.dirname(border.CONFIG_PATH), { recursive: true });
		const configBytes = JSON.stringify({ version: 1, display: { promptBorder: { style: "round", layout: "sides" }, contextRail: { enabled: false } }, behavior: {} });
		fs.writeFileSync(border.CONFIG_PATH, configBytes);
		await hooks.get("session_start")({}, context);
		choices = ["Choose border style", "Choose uniform borders", "heavy-dashed"];
		await command.handler("", context);
		editor.setText("draft");
		let rows = editor.render(20).map(row => row.replace(/\\x1b\\[[0-9;:]*m/gu, ""));
		assert.ok(rows.some(row => row.startsWith("╏") && row.endsWith("╏")), rows);
		assert.equal(rows.some(row => row.includes("╍")), false, 'Style choice must retain sides layout');
		choices = ["bottom"];
		await command.handler("layout", context);
		editor.setText("draft");
		rows = editor.render(20).map(row => row.replace(/\\x1b\\[[0-9;:]*m/gu, ""));
		assert.equal(rows.at(-1), "┗" + "╍".repeat(18) + "┛");
		assert.equal(rows.some(row => row.startsWith("┏")), false, 'Layout choice must retain heavy-dashed style without top');
		choices = ["Choose mixed and line borders", "double-side"];
		await command.handler("style", context);
		editor.setText("draft");
		rows = editor.render(20).map(row => row.replace(/\\x1b\\[[0-9;:]*m/gu, ""));
		assert.equal(rows.at(-1), "╙" + "─".repeat(18) + "╜");
		assert.equal(rows.some(row => row.startsWith("╓")), false, 'Mixed style must retain bottom layout');
		await command.handler("double-side top-bottom", context);
		editor.setText("draft");
		rows = editor.render(20).map(row => row.replace(/\\x1b\\[[0-9;:]*m/gu, ""));
		assert.ok(rows[0].startsWith("╓") && rows[0].endsWith("╖"), rows);
		assert.equal(rows.at(-1), "╙" + "─".repeat(18) + "╜");
		assert.equal(rows.some(row => row.startsWith("║") && row.endsWith("║")), false);
		assert.equal(fs.readFileSync(border.CONFIG_PATH, "utf8"), configBytes);
		await hooks.get("session_switch")({}, context);
		editor.setText("draft");
		rows = editor.render(20).map(row => row.replace(/\\x1b\\[[0-9;:]*m/gu, ""));
		assert.ok(rows.some(row => row.startsWith("│") && row.endsWith("│")), rows);
		assert.equal(rows.some(row => row.includes("╍") || row.includes("║") || row.includes("─")), false);
	`);
});

test("nested glyph choices enable and remove actual working debug output", () => {
	runCommandScenario(`
		fs.mkdirSync(path.dirname(border.CONFIG_PATH), { recursive: true });
		const configBytes = JSON.stringify({ version: 1, display: { promptBorder: { style: "round", layout: "full" }, contextRail: { enabled: false } }, behavior: {} });
		fs.writeFileSync(border.CONFIG_PATH, configBytes);
		fs.mkdirSync(path.dirname(border.DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH), { recursive: true });
		fs.writeFileSync(border.DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, "fps=20\\nA\\n\\nB");
		const glyphBytes = fs.readFileSync(border.DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, "utf8");
		choices = ["Choose glyph action", "Choose debug action", "Enable debug message"];
		await command.handler("", context);
		assert.ok(workingMessage.includes("[status 1/2]"), workingMessage);
		choices = ["Disable glyph debug"];
		await command.handler("glyphs debug", context);
		assert.equal(workingMessage, undefined);
		assert.equal(widgets.has("prompt-loading-glyphs-debug"), false);
		assert.equal(editorChanges, 0);
		assert.equal(fs.readFileSync(border.CONFIG_PATH, "utf8"), configBytes);
		assert.equal(fs.readFileSync(border.DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH, "utf8"), glyphBytes);
	`);
});

test("noninteractive root and prefixes explain explicit operations without reading or changing configuration", () => {
	runCommandScenario(`
		context.hasUI = false;
		fs.mkdirSync(path.dirname(border.LEGACY_CONFIG_PATH), { recursive: true });
		const legacyBytes = JSON.stringify({ promptBorder: { style: "round", layout: "sides" } });
		fs.writeFileSync(border.LEGACY_CONFIG_PATH, legacyBytes);
		for (const args of ["", "style", "layout", "rail", "glyphs", "glyphs debug"]) {
			const before = notifications.length;
			await command.handler(args, context);
			assert.ok(notifications.length > before);
			assert.ok(notifications.at(-1).message.includes("/prompt-border"));
			assert.equal(selections, 0);
			assert.equal(editorChanges, 0);
			assert.equal(fs.existsSync(border.CONFIG_PATH), false);
			assert.equal(fs.readFileSync(border.LEGACY_CONFIG_PATH, "utf8"), legacyBytes);
		}
		const before = notifications.length;
		await command.handler("round bottom", context);
		assert.equal(notifications.length, before, 'Complete explicit non-UI behavior remains unchanged');
	`);
});
