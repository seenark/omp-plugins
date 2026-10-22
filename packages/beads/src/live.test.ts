import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Component } from "@oh-my-pi/pi-tui";
import type { SharedDisplayEvents } from "@codesook/omp-shared-display/client";
import beadsExtension from "./index";

type Hook = (event: unknown, context: ExtensionContext) => Promise<unknown> | void;
type Command = { handler: (args: string, context: ExtensionContext) => Promise<void>; getArgumentCompletions: (prefix: string) => { value: string }[] };
type Result = { code: number; stdout: string; stderr: string };
type Issue = Record<string, unknown>;

const directories: string[] = [];
const shutdowns: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const shutdown of shutdowns.splice(0)) await shutdown();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const summaryOf = (fields: Record<string, number> = {}) => ({ schema_version: 1, summary: { total_issues: 0, closed_issues: 0, deferred_issues: 0, in_progress_issues: 0, ready_issues: 0, ...fields } });
const issue = (id: string, status: string, priority: number, title: string, updatedAt: string, description?: string): Issue => ({ id, status, priority, title, updated_at: updatedAt, issue_type: "task", ...(description === undefined ? {} : { description }) });
const BOARD_LISTING = [
	issue("a-1", "in_progress", 1, "Wire the watcher", "2026-10-20T10:00:00Z", "## Heading\nbody"),
	issue("a-2", "in_progress", 0, "Fix crash", "2026-10-19T10:00:00Z", "Crash on start\nmore"),
	issue("r-1", "open", 2, "Older ready", "2026-10-01T10:00:00Z"),
	issue("r-2", "open", 2, "Newer ready", "2026-10-15T10:00:00Z"),
	issue("r-3", "open", 0, "Top ready", "2026-10-02T10:00:00Z", "\n\nLeading blank lines skipped"),
	issue("b-1", "open", 1, "Blocked by dependency", "2026-10-03T10:00:00Z"),
	issue("b-2", "blocked", 3, "Explicitly blocked", "2026-10-03T10:00:00Z", "Waiting on vendor"),
	issue("d-1", "deferred", 0, "Postponed work", "2026-10-03T10:00:00Z"),
];
const BOARD_READY = ["r-1", "r-2", "r-3"];
const BOARD_SUMMARY = summaryOf({ total_issues: 9, closed_issues: 1, deferred_issues: 1, in_progress_issues: 2, ready_issues: 3 });
const BOARD_TEXT = [
	"In progress (2)",
	"  a-2  P0  Fix crash - Crash on start",
	"  a-1  P1  Wire the watcher - ## Heading",
	"Ready (3)",
	"  r-3  P0  Top ready - Leading blank lines skipped",
	"  r-2  P2  Newer ready",
	"  r-1  P2  Older ready",
	"Blocked (2)",
	"  b-1  P1  Blocked by dependency",
	"  b-2  P3  Explicitly blocked - Waiting on vendor",
].join("\n");

// These tests wait on real fs.watch events from a real temp directory; only the debounce timer is injected.
const delay = (milliseconds: number): Promise<void> => {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, milliseconds);
	return promise;
};
async function waitFor(condition: () => boolean, message: string, timeout = 3000): Promise<void> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${message}`);
		await delay(5);
	}
}
// Absence of a watch event cannot be awaited, so give the watcher a fixed window to deliver one.
const quiet = (): Promise<void> => delay(120);

function fixture(rows = 20) {
	const root = mkdtempSync(path.join(os.tmpdir(), "omp-beads-live-test-"));
	directories.push(root);
	const project = path.join(root, "project");
	const otherProject = path.join(root, "other");
	const workspace = path.join(root, "redirected", ".beads");
	const otherWorkspace = path.join(root, "other-redirected", ".beads");
	for (const directory of [project, otherProject, workspace, otherWorkspace]) mkdirSync(directory, { recursive: true });
	const globalConfig = path.join(root, "global.json");

	const state = { summary: summaryOf() as unknown, listing: [] as Issue[], ready: [] as string[], initialized: true, statusFails: false, listFails: false };
	const calls: { command: string; args: readonly string[] }[] = [];
	const spawns = (name: string) => calls.filter(call => call.args[0] === name).length;
	const execute = async (command: string, args: readonly string[], cwd: string): Promise<Result> => {
		calls.push({ command, args });
		if (!state.initialized) return { code: 1, stderr: "", stdout: '{"error":"no_beads_directory"}' };
		switch (args[0]) {
			case "where": return { code: 0, stderr: "", stdout: JSON.stringify({ path: cwd === otherProject ? otherWorkspace : workspace, database_path: path.join(workspace, "dolt") }) };
			case "status": return state.statusFails ? { code: 1, stderr: "Error: corrupt database", stdout: "" } : { code: 0, stderr: "", stdout: JSON.stringify(state.summary) };
			case "list": return state.listFails ? { code: 1, stderr: "Error: query failed", stdout: "" } : { code: 0, stderr: "", stdout: JSON.stringify(state.listing) };
			case "ready": return { code: 0, stderr: "", stdout: JSON.stringify(state.ready.map(id => ({ id }))) };
			default: throw new Error(`Unexpected bd operation: ${args[0]}`);
		}
	};

	const pending = new Map<number, () => void>();
	let nextTimer = 1;
	let scheduled = 0;
	const timers = {
		set: (callback: () => void) => { const id = nextTimer++; pending.set(id, callback); scheduled += 1; return id; },
		clear: (handle: unknown) => { pending.delete(handle as number); },
	};
	const fire = () => { const callbacks = [...pending.values()]; pending.clear(); for (const callback of callbacks) callback(); };

	const handlers = new Map<string, Hook>();
	const commands = new Map<string, Command>();
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const events: SharedDisplayEvents = {
		on: (channel, handler) => { const set = listeners.get(channel) ?? new Set(); listeners.set(channel, set); set.add(handler); return () => { set.delete(handler); }; },
		emit: (channel, data) => { for (const handler of [...(listeners.get(channel) ?? [])]) handler(data); },
	};
	const pi = {
		on: (name: string, handler: Hook) => { handlers.set(name, handler); },
		registerCommand: (name: string, command: Command) => { commands.set(name, command); },
		events,
		exec: (command: string, args: readonly string[], options: { cwd: string }) => execute(command, args, options.cwd),
	} as unknown as ExtensionAPI;

	const footer: (string | undefined)[] = [];
	const notifications: { text: string; level: string }[] = [];
	let overlay: Component | undefined;
	let selection: string | undefined;
	const session = {
		cwd: project,
		hasUI: true,
		ui: {
			select: async () => selection,
			setStatus: (_key: string, text?: string) => { footer.push(text); },
			notify: (text: string, level: string) => { notifications.push({ text, level }); },
			custom: (factory: (tui: unknown, theme: unknown, keys: unknown, done: () => void) => Component) => {
				const { promise, resolve } = Promise.withResolvers<void>();
				overlay = factory({ requestRender() {}, terminal: { rows } }, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, {}, resolve);
				return promise;
			},
		},
	};
	const context = session as unknown as ExtensionContext;
	beadsExtension(pi, { globalConfigPath: globalConfig, debounceMs: 250, timers });
	const hook = (name: string) => Promise.resolve(handlers.get(name)!({ systemPrompt: [] }, context));
	shutdowns.push(() => hook("session_shutdown"));

	return {
		root, project, otherProject, workspace, otherWorkspace, state, calls, spawns, footer, notifications, hook,
		command: (args: string) => commands.get("beads")!.handler(args, context),
		completions: (prefix: string) => commands.get("beads")!.getArgumentCompletions(prefix).map(item => item.value),
		current: () => footer.at(-1),
		setCwd: (cwd: string) => { session.cwd = cwd; },
		setHasUI: (value: boolean) => { session.hasUI = value; },
		select: (label: string | undefined) => { selection = label; },
		globalConfig: (display: unknown) => writeFileSync(globalConfig, JSON.stringify({ version: 1, display, behavior: {} })),
		projectConfig: (value: unknown) => { mkdirSync(path.join(project, ".omp"), { recursive: true }); writeFileSync(path.join(project, ".omp", "codesook-omp.json"), JSON.stringify(value)); },
		touch: (file: string, directory = workspace) => { const temporary = path.join(directory, `${file}.tmp`); writeFileSync(temporary, String(Math.random())); renameSync(temporary, path.join(directory, file)); },
		scheduled: () => scheduled,
		pendingTimers: () => pending.size,
		fire,
		overlayText: (width = 200) => overlay?.render(width).join("\n") ?? "",
		overlayLines: (width = 200) => overlay!.render(width),
		input: (data: string) => overlay!.handleInput!(data),
		seedBoard: () => { state.summary = BOARD_SUMMARY; state.listing = BOARD_LISTING; state.ready = BOARD_READY; },
		assertReadOnly: () => {
			for (const call of calls) {
				expect(call.command).toBe("bd");
				expect(["where", "status", "list", "ready"]).toContain(call.args[0]!);
				expect(call.args).toContain("--readonly");
				expect(call.args).toContain("--sandbox");
			}
		},
	};
}

test("segment shows ready and open counts, excluding closed and deferred issues", async () => {
	const f = fixture();
	f.seedBoard();
	await f.hook("session_start");
	expect(f.current()).toBe("Beads: 3 ready · 7 open");
	f.assertReadOnly();
	expect(f.spawns("status")).toBe(1);
});

test("template tokens are configurable and invalid templates fall back to the default", async () => {
	const f = fixture();
	f.seedBoard();
	f.globalConfig({ beads: { template: "{ready}/{open} ({inProgress} active)" } });
	await f.hook("session_start");
	expect(f.current()).toBe("3/7 (2 active)");
	for (const template of ["", "   ", "two\nlines", 42]) {
		f.globalConfig({ beads: { template } });
		await f.hook("session_switch");
		expect(f.current()).toBe("Beads: 3 ready · 7 open");
	}
});

test("zero open issues and non-counted states keep the integration state text", async () => {
	const f = fixture();
	f.globalConfig({ beads: { visibility: "always" } });
	f.state.summary = summaryOf({ total_issues: 4, closed_issues: 3, deferred_issues: 1 });
	await f.hook("session_start");
	expect(f.current()).toBe("Beads: ready");

	f.seedBoard();
	f.state.statusFails = true;
	await f.hook("before_agent_start");
	expect(f.current()).toBe("Beads: error");

	f.state.statusFails = false;
	f.state.initialized = false;
	await f.hook("before_agent_start");
	expect(f.current()).toBe("Beads: uninitialized");

	f.state.initialized = true;
	f.projectConfig({ version: 1, display: {}, behavior: { beads: { policy: "off" } } });
	await f.hook("before_agent_start");
	expect(f.current()).toBe("Beads: suppressed");
});

test("visibility settings and project overrides still decide whether the segment shows", async () => {
	const f = fixture();
	f.seedBoard();
	f.globalConfig({ beads: { visibility: "never" } });
	await f.hook("session_start");
	expect(f.current()).toBeUndefined();

	f.projectConfig({ version: 1, display: { beads: { visibility: "ready" } }, behavior: {} });
	await f.hook("before_agent_start");
	expect(f.current()).toBe("Beads: 3 ready · 7 open");

	f.globalConfig({ beads: { visibility: "ready" } });
	f.projectConfig({ version: 1, display: { beads: { visibility: "never" } }, behavior: {} });
	await f.hook("before_agent_start");
	expect(f.current()).toBeUndefined();

	f.projectConfig({ version: 1, display: { beads: { visibility: "always" } }, behavior: {} });
	f.state.initialized = false;
	await f.hook("before_agent_start");
	expect(f.current()).toBe("Beads: uninitialized");
});

test("a Beads write marker triggers exactly one debounced refresh and unrelated files trigger none", async () => {
	const f = fixture();
	f.state.summary = summaryOf({ total_issues: 2, ready_issues: 1 });
	await f.hook("session_start");
	expect(f.current()).toBe("Beads: 1 ready · 2 open");
	const baseline = f.spawns("status");

	f.touch("issues.jsonl");
	f.touch("embeddeddolt.gate.lock");
	await quiet();
	expect(f.scheduled()).toBe(0);
	expect(f.spawns("status")).toBe(baseline);

	f.state.summary = summaryOf({ total_issues: 5, ready_issues: 4 });
	const history = f.footer.length;
	f.touch("last-touched");
	f.touch("last-touched");
	await waitFor(() => f.pendingTimers() === 1, "a debounced refresh to be scheduled");
	expect(f.spawns("status")).toBe(baseline);
	await quiet();
	f.fire();
	await waitFor(() => f.current() === "Beads: 4 ready · 5 open", "the new counts");
	expect(f.spawns("status")).toBe(baseline + 1);
	expect(f.footer.slice(history).some(text => text === "Beads: loading")).toBe(false);

	f.state.summary = summaryOf({ total_issues: 6, ready_issues: 4 });
	f.touch("export-state.json");
	await waitFor(() => f.pendingTimers() === 1, "the export-state refresh to be scheduled");
	await quiet();
	f.fire();
	await waitFor(() => f.current() === "Beads: 4 ready · 6 open", "the export-state counts");
	expect(f.spawns("status")).toBe(baseline + 2);
	f.assertReadOnly();
});

test("the watch follows the project, stops when not ready, and is torn down on shutdown", async () => {
	const f = fixture();
	f.state.summary = summaryOf({ total_issues: 2, ready_issues: 1 });
	await f.hook("session_start");

	f.setCwd(f.otherProject);
	await f.hook("session_switch");
	f.touch("last-touched");
	await quiet();
	expect(f.scheduled()).toBe(0);
	f.touch("last-touched", f.otherWorkspace);
	await waitFor(() => f.pendingTimers() === 1, "a change in the new project's workspace");
	await quiet();
	f.fire();
	await waitFor(() => f.spawns("status") === 3, "the refresh for the new project");

	f.state.initialized = false;
	await f.hook("before_agent_start");
	const scheduledBefore = f.scheduled();
	f.touch("last-touched", f.otherWorkspace);
	await quiet();
	expect(f.scheduled()).toBe(scheduledBefore);

	f.state.initialized = true;
	await f.hook("before_agent_start");
	f.touch("last-touched", f.otherWorkspace);
	await waitFor(() => f.pendingTimers() === 1, "the watch to resume once ready");
	const spawnsBeforeShutdown = f.calls.length;
	await f.hook("session_shutdown");
	expect(f.pendingTimers()).toBe(0);
	const scheduledAtShutdown = f.scheduled();
	f.touch("last-touched", f.otherWorkspace);
	await quiet();
	expect(f.scheduled()).toBe(scheduledAtShutdown);
	expect(f.calls.length).toBe(spawnsBeforeShutdown);
});

test("/beads tasks lists open issues by group, priority and recency, and plain text matches without a UI", async () => {
	const f = fixture();
	f.seedBoard();
	await f.hook("session_start");
	f.setHasUI(false);
	await f.command("tasks");
	expect(f.notifications.at(-1)).toEqual({ text: BOARD_TEXT, level: "info" });
	expect(f.notifications.at(-1)!.text).not.toContain("Postponed work");
	f.assertReadOnly();
});

test("the tasks overlay renders the board, truncates to width, scrolls, and closes only on Enter or Esc", async () => {
	const f = fixture(9);
	f.seedBoard();
	await f.hook("session_start");
	const closed = f.command("tasks");
	await waitFor(() => f.overlayText().includes("In progress (2)"), "the board to load");
	const text = f.overlayText();
	expect(text).toContain("Beads Tasks");
	expect(text).toContain("Enter/Esc close");
	expect(text).toContain("In progress (2)");
	expect(text).toContain("1-3 of 10");
	expect(text).not.toContain("Ready (3)");

	const first = f.overlayLines();
	f.input("\x1b[B");
	expect(f.overlayLines()[1]).toBe(first[2]!);
	f.input("\x1b[A");
	f.input("\x1b[A");
	expect(f.overlayLines()[1]).toBe(first[1]!);
	for (let index = 0; index < 30; index += 1) f.input("\x1b[B");
	expect(f.overlayText()).toContain("8-10 of 10");
	expect(f.overlayText()).toContain("b-2  P3  Explicitly blocked");

	for (const line of f.overlayLines(24)) expect(line.length).toBeLessThanOrEqual(24);
	expect(f.overlayText(24)).toContain("…");

	f.input("x");
	f.input("\r");
	await closed;
});

test("the tasks overlay re-queries on the change signal while open and stops after it closes", async () => {
	const f = fixture();
	f.seedBoard();
	await f.hook("session_start");
	const closed = f.command("tasks");
	await waitFor(() => f.overlayText().includes("Ready (3)"), "the board to load");
	const listsAtOpen = f.spawns("list");

	f.state.listing = [...BOARD_LISTING, issue("n-1", "open", 0, "Added from another terminal", "2026-10-21T10:00:00Z")];
	f.state.ready = [...BOARD_READY, "n-1"];
	f.state.summary = summaryOf({ total_issues: 10, closed_issues: 1, deferred_issues: 1, in_progress_issues: 2, ready_issues: 4 });
	f.touch("last-touched");
	await waitFor(() => f.pendingTimers() === 1, "a debounced refresh");
	await quiet();
	f.fire();
	await waitFor(() => f.overlayText().includes("Added from another terminal"), "the new issue to appear");
	expect(f.overlayText()).toContain("Ready (4)");
	expect(f.spawns("list")).toBe(listsAtOpen + 1);
	expect(f.current()).toBe("Beads: 4 ready · 8 open");

	f.input("\x1b");
	await closed;
	f.touch("last-touched");
	await waitFor(() => f.pendingTimers() === 1, "a refresh after the overlay closed");
	await quiet();
	f.fire();
	await waitFor(() => f.spawns("status") === 3, "the segment refresh");
	expect(f.spawns("list")).toBe(listsAtOpen + 1);
	f.assertReadOnly();
});

test("the tasks view distinguishes an empty board from load errors and non-ready states", async () => {
	const f = fixture();
	f.state.summary = summaryOf({ total_issues: 1, closed_issues: 1 });
	await f.hook("session_start");
	f.setHasUI(false);

	await f.command("tasks");
	expect(f.notifications.at(-1)!.text).toBe("No open issues.");

	f.state.listFails = true;
	await f.command("tasks");
	expect(f.notifications.at(-1)!.text).toContain("Could not load tasks: bd list failed (exit 1): Error: query failed");

	f.state.listFails = false;
	f.state.initialized = false;
	await f.command("tasks");
	expect(f.notifications.at(-1)!.text).toContain("Beads is uninitialized; there is no task list to show.");

	f.state.initialized = true;
	f.projectConfig({ version: 1, display: {}, behavior: { beads: { policy: "off" } } });
	await f.command("tasks");
	expect(f.notifications.at(-1)!.text).toContain("Beads is suppressed");
	f.assertReadOnly();
});

test("the menu offers Show tasks, completion includes tasks, and usage names it", async () => {
	const f = fixture(9);
	f.seedBoard();
	await f.hook("session_start");
	expect(f.completions("ta")).toEqual(["tasks"]);
	expect(f.completions("")).toContain("tasks");

	f.select("Show tasks");
	const closed = f.command("");
	await waitFor(() => f.overlayText().includes("In progress (2)"), "the menu choice to open the board");
	f.input("\r");
	await closed;

	await f.command("bogus");
	expect(f.notifications.at(-1)!.text).toContain("[init|status|tasks|auto|off]");
});
