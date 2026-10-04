import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Component } from "@oh-my-pi/pi-tui";
import { CHANNEL, type SharedDisplayEvents } from "@codesook/omp-shared-display/client";
import { CODESOOK_OMP_CONFIG_CHANGED } from "@codesook/omp-shared-display/config-store";
import beadsExtension from "./index";

type Hook = (event: { systemPrompt?: readonly string[] }, context: ExtensionContext) => Promise<{ systemPrompt: string[] } | undefined | void> | void;
type Command = { handler: (args: string, context: ExtensionContext) => Promise<void> };
type Result = { code: number; stdout: string; stderr: string };
const directories: string[] = [];
const shutdowns: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const shutdown of shutdowns.splice(0)) await shutdown();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), "omp-beads-runtime-test-"));
	directories.push(root);
	const project = path.join(root, "project");
	const workspace = path.join(root, "redirected", ".beads");
	mkdirSync(project);
	mkdirSync(workspace, { recursive: true });
	const gitEnvironment = {
		...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
		HOME: path.join(root, "git-home"), PI_CODING_AGENT_DIR: path.join(root, "git-agent"), PI_SESSION_DIR: path.join(root, "git-sessions"),
		XDG_CONFIG_HOME: path.join(root, "git-config"), XDG_CACHE_HOME: path.join(root, "git-cache"), XDG_DATA_HOME: path.join(root, "git-data"),
		TMPDIR: path.join(root, "git-tmp"), BUN_INSTALL_CACHE_DIR: path.join(root, "git-bun-cache"),
		GIT_CONFIG_GLOBAL: path.join(root, "git-global"), GIT_CONFIG_SYSTEM: path.join(root, "git-system"), GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C", LANG: "C",
	};
	for (const directory of [gitEnvironment.HOME, gitEnvironment.PI_CODING_AGENT_DIR, gitEnvironment.PI_SESSION_DIR, gitEnvironment.XDG_CONFIG_HOME, gitEnvironment.XDG_CACHE_HOME, gitEnvironment.XDG_DATA_HOME, gitEnvironment.TMPDIR, gitEnvironment.BUN_INSTALL_CACHE_DIR]) mkdirSync(directory, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: project, encoding: "utf8", env: gitEnvironment });
	const handlers = new Map<string, Hook>();
	const commands = new Map<string, Command>();
	const footer = new Map<string, string | undefined>();
	const statusWaiters = new Set<(text: string | undefined) => void>();
	const notifications: { text: string; level: string }[] = [];
	const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
	const events: SharedDisplayEvents = {
		on: (channel, handler) => {
			const listeners = eventHandlers.get(channel) ?? new Set();
			eventHandlers.set(channel, listeners);
			listeners.add(handler);
			return () => { listeners.delete(handler); };
		},
		emit: (channel, data) => { for (const handler of [...(eventHandlers.get(channel) ?? [])]) handler(data); },
	};
	let execute = async (_command: string, args: readonly string[], _cwd: string): Promise<Result> => {
		if (args.includes("where")) return { code: 0, stderr: "", stdout: JSON.stringify({ path: workspace, database_path: path.join(workspace, "dolt") }) };
		return { code: 0, stderr: "", stdout: '{"count":0}' };
	};
	const pi = {
		on: (name: string, handler: Hook) => { handlers.set(name, handler); },
		registerCommand: (name: string, command: Command) => { commands.set(name, command); },
		events,
		exec: (command: string, args: readonly string[], options: { cwd: string }) => {
			if (command === "env") {
				const executable = args.findIndex(value => value === "git" || value === "bd");
				return execute(args[executable]!, args.slice(executable + 1), options.cwd);
			}
			return execute(command, args, options.cwd);
		},
	} as unknown as ExtensionAPI;
	let overlay: Component | undefined;
	let select = async (_title: string, _options: readonly string[]): Promise<string | undefined> => undefined;
	const renderWaiters: (() => void)[] = [];
	const context = {
		cwd: project,
		hasUI: true,
		ui: {
			select: (title: string, options: readonly string[]) => select(title, options),
			setStatus: (key: string, text?: string) => {
				footer.set(key, text);
				for (const waiter of statusWaiters) waiter(text);
			},
			notify: (text: string, level: string) => { notifications.push({ text, level }); },
			custom: (factory: (tui: unknown, theme: unknown, keys: unknown, done: () => void) => Component) => new Promise<void>(resolve => {
				overlay = factory({ requestRender: () => { for (const waiter of renderWaiters.splice(0)) waiter(); } }, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, {}, resolve);
			}),
		},
	} as unknown as ExtensionContext;
	beadsExtension(pi, { globalConfigPath: path.join(root, "global.json") });
	const hook = (name: string, prompt: readonly string[] = []) => Promise.resolve(handlers.get(name)!({ systemPrompt: prompt }, context));
	shutdowns.push(() => hook("session_shutdown"));
	const settings = (value: unknown, target = project) => {
		mkdirSync(path.join(target, ".omp"), { recursive: true });
		writeFileSync(path.join(target, ".omp", "codesook-omp.json"), JSON.stringify(value));
	};
	return {
		root, project, workspace, context, events, footer, notifications, hook, settings, git,
		command: (args: string) => commands.get("beads")!.handler(args, context),
		setExecute: (replacement: typeof execute) => { execute = replacement; },
		setSelect: (replacement: typeof select) => { select = replacement; },
		render: () => overlay!.render(200).join("\n"),
		input: (data: string) => overlay!.handleInput!(data),
		rendered: () => new Promise<void>(resolve => { renderWaiters.push(resolve); }),
		statusWhen: (text: string) => new Promise<void>(resolve => {
			if (footer.get("beads") === text) { resolve(); return; }
			const waiter = (current: string | undefined) => {
				if (current !== text) return;
				statusWaiters.delete(waiter);
				resolve();
			};
			statusWaiters.add(waiter);
		}),
	};
}

test("off policy suppresses only plugin guidance and policy commands preserve other settings and data", async () => {
	const f = fixture();
	f.settings({ version: 1, display: { beads: { visibility: "always" } }, behavior: { codegraph: { policy: "off" } }, custom: { keep: true } });
	const data = path.join(f.workspace, "history");
	writeFileSync(data, "existing issue history");
	f.setExecute(async (command, args) => {
		if (command !== "bd" || !args.includes("--readonly") || !args.includes("--sandbox")) throw new Error("Unexpected mutable CLI operation");
		if (args[0] === "where") return { code: 0, stderr: "", stdout: JSON.stringify({ path: f.workspace }) };
		if (args[0] === "count") return { code: 0, stderr: "", stdout: '{"count":0}' };
		throw new Error("Unexpected CLI operation");
	});
	await f.hook("session_start");
	await f.command("off");
	const prompt = ["Repository still requires bd tracking"];
	expect(await f.hook("before_agent_start", prompt)).toBeUndefined();
	expect(prompt).toEqual(["Repository still requires bd tracking"]);
	expect(f.footer.get("beads")).toBe("Beads: suppressed");
	expect(JSON.parse(readFileSync(path.join(f.project, ".omp", "codesook-omp.json"), "utf8"))).toEqual({
		version: 1, display: { beads: { visibility: "always" } }, behavior: { codegraph: { policy: "off" }, beads: { policy: "off" } }, custom: { keep: true },
	});
	const policy = readFileSync(path.join(f.project, ".omp", "codesook-omp.json"));
	await f.command("init");
	expect(f.notifications.at(-1)?.level).toBe("info");
	expect(readFileSync(path.join(f.project, ".omp", "codesook-omp.json"))).toEqual(policy);
	expect(await f.hook("before_agent_start", prompt)).toBeUndefined();
	expect(readFileSync(data, "utf8")).toBe("existing issue history");
	await f.command("auto");
	expect((await f.hook("before_agent_start", prompt))?.systemPrompt[1]).toContain(f.workspace);
});

test("invalid configuration fails closed, remains inspectable, and cannot be overwritten by policy commands", async () => {
	const f = fixture();
	f.settings({ version: 1, display: {}, behavior: {} });
	const config = path.join(f.project, ".omp", "codesook-omp.json");
	writeFileSync(config, "{ broken bytes\n");
	await f.hook("session_start");
	expect(await f.hook("before_agent_start", ["Repository instruction"])).toBeUndefined();
	await f.command("auto");
	expect(readFileSync(config, "utf8")).toBe("{ broken bytes\n");
	expect(f.notifications.at(-1)?.level).toBe("error");
	const rendered = f.rendered();
	const command = f.command("status");
	expect(f.render()).toContain("Loading");
	await rendered;
	expect(f.render()).toContain("Beads: error");
	expect(f.render()).toContain(config);
	f.input("\r");
	await command;
});

test("visibility never hides persistent display but not ready guidance or read-only status overlay", async () => {
	const f = fixture();
	f.settings({ version: 1, display: { beads: { visibility: "never" } }, behavior: {} });
	await f.hook("session_start");
	expect(f.footer.get("beads")).toBeUndefined();
	expect((await f.hook("before_agent_start", ["Repository instruction"]))?.systemPrompt[1]).toContain(f.workspace);
	const rendered = f.rendered();
	const command = f.command("status");
	expect(f.render()).toContain("Loading");
	await rendered;
	expect(f.render()).toContain(`Integration Project: ${f.project}`);
	expect(f.render()).toContain(`Tool Workspace: ${f.workspace}`);
	expect(f.render()).toContain(`Database: ${path.join(f.workspace, "dolt")}`);
	f.input("\u001b");
	await command;
	expect(f.footer.get("beads")).toBeUndefined();
});

test("host activation moves status off native footer and host loss restores fallback", async () => {
	const f = fixture();
	const snapshots: unknown[] = [];
	f.events.on(CHANNEL, message => {
		if (typeof message === "object" && message !== null && "kind" in message && message.kind === "snapshot") snapshots.push(message);
	});
	await f.hook("session_start");
	expect(f.footer.get("beads")).toBe("Beads: ready");
	f.events.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "host", active: true });
	expect(f.footer.get("beads")).toBeUndefined();
	expect(snapshots.at(-1)).toMatchObject({ source: "beads", sequence: { frames: [["Beads: ready"]] } });
	f.settings({ version: 1, display: { beads: { visibility: "never" } }, behavior: {} });
	await f.hook("before_agent_start");
	expect(snapshots.at(-1)).toMatchObject({ source: "beads", sequence: null });
	f.settings({ version: 1, display: {}, behavior: {} });
	await f.hook("before_agent_start");
	f.events.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "host", active: false });
	expect(f.footer.get("beads")).toBe("Beads: ready");
});

test("project switch discards pending inspection and uses new policy and native workspace", async () => {
	const f = fixture();
	await f.hook("session_start");
	const second = path.join(f.root, "second");
	const secondWorkspace = path.join(second, ".beads");
	mkdirSync(secondWorkspace, { recursive: true });
	f.settings({ version: 1, display: { beads: { visibility: "always" } }, behavior: { beads: { policy: "off" } } }, second);
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	f.setExecute(async (_command, args, cwd) => {
		if (args[0] === "where") {
			if (cwd === f.project) { started.resolve(); await release.promise; }
			return { code: 0, stderr: "", stdout: JSON.stringify({ path: cwd === f.project ? f.workspace : secondWorkspace }) };
		}
		return { code: 0, stderr: "", stdout: '{"count":0}' };
	});
	const oldTurn = f.hook("before_agent_start", ["Repository"]);
	await started.promise;
	f.context.cwd = second;
	await f.hook("session_switch");
	expect(await f.hook("before_agent_start", ["Repository"])).toBeUndefined();
	expect(f.footer.get("beads")).toBe("Beads: suppressed");
	release.resolve();
	expect(await oldTurn).toBeUndefined();
	expect(f.footer.get("beads")).toBe("Beads: suppressed");
	await f.command("auto");
	const current = await f.hook("before_agent_start", ["Repository"]);
	expect(current?.systemPrompt[1]).toContain(JSON.stringify(secondWorkspace));
	expect(current?.systemPrompt[1]).not.toContain(JSON.stringify(f.workspace));
});

test("settings events and session branches refresh without waiting for another turn", async () => {
	const f = fixture();
	await f.hook("session_start");
	f.settings({ version: 1, display: { beads: { visibility: "always" } }, behavior: { beads: { policy: "off" } } });
	const suppressed = f.statusWhen("Beads: suppressed");
	f.events.emit(CODESOOK_OMP_CONFIG_CHANGED, { projectPath: f.project });
	await suppressed;
	expect(await f.hook("before_agent_start", ["Repository"])).toBeUndefined();
	f.settings({ version: 1, display: {}, behavior: {} });
	await f.hook("session_branch");
	expect(f.footer.get("beads")).toBe("Beads: ready");
});

test("moving cwd during an inspection without a lifecycle event cannot return stale guidance", async () => {
	const f = fixture();
	await f.hook("session_start");
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	f.setExecute(async (_command, args) => {
		if (args[0] === "where") {
			started.resolve();
			await release.promise;
			return { code: 0, stderr: "", stdout: JSON.stringify({ path: f.workspace }) };
		}
		return { code: 0, stderr: "", stdout: '{"count":0}' };
	});
	const turn = f.hook("before_agent_start", ["Repository"]);
	await started.promise;
	f.context.cwd = path.join(f.root, "new-project");
	release.resolve();
	expect(await turn).toBeUndefined();
	expect(f.footer.get("beads")).toBeUndefined();
});

test("missing Git keeps global visibility while refusing guessed project policy and all guidance", () => {
	for (const visibility of ["always", "never"] as const) {
		const root = mkdtempSync(path.join(os.tmpdir(), "omp-beads-missing-git-"));
		directories.push(root);
		const project = path.join(root, "project");
		const cwd = path.join(project, "nested");
		const home = path.join(root, "home");
		const agentDirectory = path.join(home, "agent");
		const emptyPath = path.join(root, "empty-path");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(emptyPath);
		const childEnvironment = {
			...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
			HOME: home, PI_CODING_AGENT_DIR: agentDirectory, PI_SESSION_DIR: path.join(root, "sessions"),
			XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_DATA_HOME: path.join(root, "data"),
			TMPDIR: path.join(root, "tmp"), BUN_INSTALL_CACHE_DIR: path.join(root, "bun-cache"),
			GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"), GIT_CONFIG_SYSTEM: path.join(root, "git-system"), GIT_CONFIG_NOSYSTEM: "1",
		};
		for (const directory of [home, agentDirectory, childEnvironment.PI_SESSION_DIR, childEnvironment.XDG_CONFIG_HOME, childEnvironment.XDG_CACHE_HOME, childEnvironment.XDG_DATA_HOME, childEnvironment.TMPDIR, childEnvironment.BUN_INSTALL_CACHE_DIR]) mkdirSync(directory, { recursive: true });
		execFileSync("git", ["init", "--quiet", project], { env: childEnvironment });
		mkdirSync(path.join(project, ".omp"));
		const policyPath = path.join(project, ".omp", "codesook-omp.json");
		const policyBytes = JSON.stringify({ version: 1, display: { beads: { visibility: visibility === "always" ? "never" : "always" } }, behavior: { beads: { policy: "off" } } });
		writeFileSync(policyPath, policyBytes);
		const extensionPath = path.join(import.meta.dir, "index.ts");
		const code = `
			import assert from "node:assert/strict";
			import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
			import { homedir } from "node:os";
			import * as path from "node:path";
			import beadsExtension from ${JSON.stringify(extensionPath)};
			import { CODESOOK_OMP_CONFIG_PATH } from "@codesook/omp-shared-display/config-store";
			import { CHANNEL } from "@codesook/omp-shared-display/client";
			const root = ${JSON.stringify(root)};
			assert.equal(homedir(), ${JSON.stringify(home)});
			for (const value of [homedir(), process.env.PI_CODING_AGENT_DIR, process.env.PI_SESSION_DIR, process.env.XDG_CONFIG_HOME, process.env.XDG_CACHE_HOME, process.env.XDG_DATA_HOME, process.env.TMPDIR, process.env.BUN_INSTALL_CACHE_DIR, process.env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_SYSTEM, CODESOOK_OMP_CONFIG_PATH, ${JSON.stringify(policyPath)}, path.join(homedir(), ".pi", "agent"), path.join(homedir(), ".config", "omp")]) assert.ok(value.startsWith(root + path.sep), value);
			mkdirSync(path.dirname(CODESOOK_OMP_CONFIG_PATH), { recursive: true });
			writeFileSync(CODESOOK_OMP_CONFIG_PATH, JSON.stringify({ version: 1, display: { beads: { visibility: ${JSON.stringify(visibility)} } }, behavior: { beads: { policy: "auto" } } }));
			const hooks = new Map();
			let command, footer, component, rendered;
			const notifications = [], snapshots = [], listeners = new Map();
			const events = {
				on(channel, handler) {
					const group = listeners.get(channel) ?? new Set();
					listeners.set(channel, group); group.add(handler);
					return () => group.delete(handler);
				},
				emit(channel, message) {
					if (channel === CHANNEL && message.kind === "snapshot") snapshots.push(message);
					for (const listener of [...(listeners.get(channel) ?? [])]) listener(message);
				},
			};
			const context = { cwd: ${JSON.stringify(cwd)}, hasUI: true, ui: {
				setStatus(_key, text) { footer = text; },
				notify(text, level) { notifications.push({ text, level }); },
				custom(factory) {
					const completion = Promise.withResolvers();
					component = factory({ requestRender() { rendered(); } }, { fg(_color, text) { return text; }, bold(text) { return text; } }, {}, completion.resolve);
					return completion.promise;
				},
			} };
			const pi = {
				on(name, handler) { hooks.set(name, handler); },
				registerCommand(_name, value) { command = value; },
				events, exec() { throw new Error("Beads inspection must not run without a resolved Integration Project"); },
			};
			beadsExtension(pi);
			await hooks.get("session_start")({}, context);
			const native = footer ?? null;
			const original = Object.freeze(["Repository still requires tracking", "Other plugin"]);
			const guidance = await hooks.get("before_agent_start")({ systemPrompt: original }, context);
			assert.equal(guidance, undefined);
			assert.deepEqual(original, ["Repository still requires tracking", "Other plugin"]);
			events.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "host", active: true });
			assert.equal(footer, undefined);
			const shared = snapshots.at(-1).sequence;
			const ready = Promise.withResolvers();
			rendered = ready.resolve;
			const status = command.handler("status", context);
			assert.ok(component.render(500).join("\\n").includes("Loading"));
			await ready.promise;
			const detail = component.render(500).join("\\n");
			component.handleInput("\\r");
			await status;
			await command.handler("auto", context);
			assert.equal(notifications.at(-1).level, "error");
			assert.equal(readFileSync(${JSON.stringify(policyPath)}, "utf8"), ${JSON.stringify(policyBytes)});
			assert.equal(existsSync(path.join(context.cwd, ".omp", "codesook-omp.json")), false);
			await hooks.get("session_shutdown")({}, context);
			console.log(JSON.stringify({ native, shared, detail }));
		`;
		const child = Bun.spawnSync([process.execPath, "--eval", code], {
			cwd: path.resolve(import.meta.dir, ".."),
			env: { ...childEnvironment, PATH: emptyPath },
			timeout: 10_000,
		});
		expect(child.exitCode, child.stderr.toString()).toBe(0);
		const result = JSON.parse(child.stdout.toString()) as { native: string | null; shared: unknown; detail: string };
		expect(result.native).toBe(visibility === "always" ? "Beads: error" : null);
		expect(result.shared).toEqual(visibility === "always" ? { frames: [["Beads: error"]] } : null);
		expect(result.detail).toContain(`Visibility: ${visibility}`);
		expect(result.detail).toContain("Cannot resolve Integration Project");
		expect(result.detail).toContain("Git availability");
	}
});

test("init refuses an unusable native workspace even when off policy masks backend readiness", async () => {
	const f = fixture();
	f.settings({ version: 1, display: { beads: { visibility: "always" } }, behavior: { beads: { policy: "off" } } });
	const policyPath = path.join(f.project, ".omp", "codesook-omp.json");
	const policy = readFileSync(policyPath);
	const historyPath = path.join(f.workspace, "history");
	writeFileSync(historyPath, "existing history");
	let mutated = false;
	f.setExecute(async (_command, args) => {
		if (args[0] === "where") return { code: 0, stderr: "", stdout: JSON.stringify({ path: f.workspace }) };
		if (args[0] === "count") return { code: 1, stderr: "Error: no beads database found", stdout: "" };
		mutated = true;
		throw new Error("Existing workspace must not be overwritten");
	});
	await f.command("init");
	expect(f.notifications.at(-1)?.level).toBe("error");
	expect(mutated).toBe(false);
	expect(readFileSync(historyPath, "utf8")).toBe("existing history");
	expect(readFileSync(policyPath)).toEqual(policy);
	expect(await f.hook("before_agent_start", ["Repository"])).toBeUndefined();
});

test("cancelling either initialization choice preserves policy, hooks, agent files and issue data", async () => {
	for (const cancelAt of [0, 1]) {
		const f = fixture();
		f.settings({ version: 1, display: {}, behavior: { beads: { policy: "off" }, codegraph: { policy: "auto" } }, custom: "keep" });
		const agent = path.join(f.project, "AGENTS.md");
		const hook = path.join(f.project, "preexisting-hook");
		writeFileSync(agent, "repository instructions");
		writeFileSync(hook, "repository hook");
		const policy = path.join(f.project, ".omp", "codesook-omp.json");
		const inputs = [agent, hook, policy].map(file => [file, readFileSync(file)] as const);
		let choice = 0;
		let mutated = false;
		f.setSelect(async (_title, options) => choice++ === cancelAt ? undefined : options[0]);
		f.setExecute(async (_command, args) => {
			if (args[0] === "where") return { code: 1, stderr: "", stdout: '{"error":"no_beads_directory"}' };
			mutated = true;
			throw new Error("Cancellation must not invoke a writable command");
		});
		await f.command("init");
		expect(f.notifications.at(-1)?.level).toBe("info");
		expect(mutated).toBe(false);
		for (const [file, bytes] of inputs) expect(readFileSync(file)).toEqual(bytes);
		expect(await f.hook("before_agent_start", ["Repository"])).toBeUndefined();
	}
});

test("standard initialization refuses native Git auto-commit hazards without changing user index or files", async () => {
	for (const unsafe of ["staged", "dirty-agent", "exclusion-shaped-markdown"]) {
		const f = fixture();
		const git = f.git;
		git("init", "--quiet");
		git("config", "user.name", "Test");
		git("config", "user.email", "test@example.invalid");
		writeFileSync(path.join(f.project, "AGENTS.md"), "original instructions");
		git("add", "AGENTS.md");
		git("commit", "--quiet", "-m", "Fixture baseline");
		const userFile = path.join(f.project, unsafe === "staged" ? "user.txt" : "AGENTS.md");
		writeFileSync(userFile, "user changes must not be committed");
		if (unsafe === "staged") git("add", "user.txt");
		const exclusion = path.join(f.project, ":(exclude)AGENTS.md");
		if (unsafe === "exclusion-shaped-markdown") writeFileSync(exclusion, "filename must not exclude real agent changes");
		const index = readFileSync(path.join(f.project, ".git", "index"));
		let initialized = false;
		f.setSelect(async (_title, choices) => choices[0]);
		f.setExecute(async (command, args) => {
			if (command === "git") {
				try { return { code: 0, stdout: git(...args), stderr: "" }; }
				catch (error) { const failure = error as { status: number; stdout: string; stderr: string }; return { code: failure.status, stdout: String(failure.stdout), stderr: String(failure.stderr) }; }
			}
			if (args[0] === "where") return { code: 1, stderr: "", stdout: '{"error":"no_beads_directory"}' };
			initialized = true;
			return { code: 1, stderr: "Native init must not run", stdout: "" };
		});
		await f.command("init");
		expect(initialized).toBe(false);
		expect(f.notifications.at(-1)?.level).toBe("error");
		expect(readFileSync(path.join(f.project, ".git", "index"))).toEqual(index);
		expect(readFileSync(userFile, "utf8")).toBe("user changes must not be committed");
		if (unsafe === "exclusion-shaped-markdown") expect(readFileSync(exclusion, "utf8")).toBe("filename must not exclude real agent changes");
	}
});

test("initializing through a directory alias reports the same project ready after native Git creation", async () => {
	const f = fixture();
	const alias = path.join(f.root, "project-alias");
	symlinkSync(f.project, alias, "dir");
	f.context.cwd = alias;
	f.settings({ version: 1, display: { beads: { visibility: "always" } }, behavior: { beads: { policy: "off" } }, custom: "preserve" });
	const policy = path.join(f.project, ".omp", "codesook-omp.json");
	const before = readFileSync(policy);
	let initialized = false;
	f.setSelect(async (_title, choices) => choices[0]);
	f.setExecute(async (command, args) => {
		if (command === "git") {
			try { return { code: 0, stdout: f.git(...args), stderr: "" }; }
			catch (error) { const failure = error as { status: number; stdout: string; stderr: string }; return { code: failure.status, stdout: String(failure.stdout), stderr: String(failure.stderr) }; }
		}
		if (args[0] === "init") { f.git("init", "--quiet"); initialized = true; return { code: 0, stdout: "", stderr: "" }; }
		if (!initialized) return { code: 1, stderr: "", stdout: '{"error":"no_beads_directory"}' };
		if (args[0] === "where") return { code: 0, stderr: "", stdout: JSON.stringify({ path: path.join(realpathSync(f.project), ".beads") }) };
		return { code: 0, stderr: "", stdout: '{"count":0}' };
	});
	await f.command("init");
	expect(f.notifications.at(-1)?.level).toBe("info");
	expect(f.footer.get("beads")).toBe("Beads: suppressed");
	expect(readFileSync(policy)).toEqual(before);
	expect(await f.hook("before_agent_start", ["Repository"])).toBeUndefined();
});

test("changing project while choosing initialization cannot write either project's data or policy", async () => {
	const f = fixture();
	const other = path.join(f.root, "other-project");
	mkdirSync(other);
	f.settings({ version: 1, display: {}, behavior: { beads: { policy: "off" } } }, other);
	const policy = path.join(other, ".omp", "codesook-omp.json");
	const before = readFileSync(policy);
	let mutated = false;
	f.setExecute(async (_command, args) => {
		if (args[0] === "where") return { code: 1, stderr: "", stdout: '{"error":"no_beads_directory"}' };
		mutated = true;
		throw new Error("A choice in the old project cannot authorize a write");
	});
	f.setSelect(async (_title, choices) => { f.context.cwd = other; return choices[0]; });
	await f.command("init");
	expect(mutated).toBe(false);
	expect(f.notifications.at(-1)?.level).toBe("error");
	expect(readFileSync(policy)).toEqual(before);
	expect(await f.hook("before_agent_start", ["Repository"])).toBeUndefined();
});

test("native init exit zero with an unusable resulting backend reports failure and keeps off policy", async () => {
	const f = fixture();
	f.settings({ version: 1, display: { beads: { visibility: "always" } }, behavior: { beads: { policy: "off" } }, custom: "preserve" });
	const policy = path.join(f.project, ".omp", "codesook-omp.json");
	const before = readFileSync(policy);
	let attempted = false;
	f.setSelect(async (_title, choices) => choices[0]);
	f.setExecute(async (command, args) => {
		if (command === "git") return { code: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git" };
		if (args[0] === "where") return attempted
			? { code: 0, stderr: "", stdout: JSON.stringify({ path: f.workspace, database_path: path.join(f.workspace, "dolt") }) }
			: { code: 1, stderr: "", stdout: '{"error":"no_beads_directory"}' };
		if (args[0] === "init") { attempted = true; return { code: 0, stdout: "Native init completed", stderr: "" }; }
		return { code: 1, stdout: "", stderr: "Error: query failed: table issues not found" };
	});
	await f.command("init");
	expect(attempted).toBe(true);
	expect(f.notifications.at(-1)?.level).toBe("error");
	expect(readFileSync(policy)).toEqual(before);
	expect(await f.hook("before_agent_start", ["Repository"])).toBeUndefined();
});
