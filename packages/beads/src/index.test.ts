import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
		exec: (command: string, args: readonly string[], options: { cwd: string }) => execute(command, args, options.cwd),
	} as unknown as ExtensionAPI;
	let overlay: Component | undefined;
	const renderWaiters: (() => void)[] = [];
	const context = {
		cwd: project,
		hasUI: true,
		ui: {
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
		root, project, workspace, context, events, footer, notifications, hook, settings,
		command: (args: string) => commands.get("beads")!.handler(args, context),
		setExecute: (replacement: typeof execute) => { execute = replacement; },
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

test("ready Beads guidance preserves repository rules and requires explicit in-scope issue consent", async () => {
	const f = fixture();
	await f.hook("session_start");
	const original = Object.freeze(["Repository: track all work with bd; never sync without authorization", "Other plugin"]);
	const result = await f.hook("before_agent_start", original);
	expect(result?.systemPrompt.slice(0, 2)).toEqual([...original]);
	const guidance = result!.systemPrompt[2]!;
	expect(guidance).toContain("explicitly requests");
	expect(guidance).toContain("scope");
	expect(guidance).toContain("Availability alone does not authorize issue operations");
	expect(guidance).toContain("unrelated work");
	expect(guidance).toContain("--json");
	expect(guidance).toContain(JSON.stringify(f.project));
	expect(guidance).toContain(JSON.stringify(f.workspace));
	expect(guidance).toContain("repository");
	expect(original).toEqual(["Repository: track all work with bd; never sync without authorization", "Other plugin"]);
	expect(f.footer.get("beads")).toBe("Beads: ready");
	const next = await f.hook("before_agent_start", original);
	expect(next?.systemPrompt).toEqual(result!.systemPrompt);
});

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
	expect(f.render()).toContain("Repair");
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
	expect(f.render()).toContain("Enter/Esc close");
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
