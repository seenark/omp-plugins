import { afterEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { visibleWidth, type Component } from "@oh-my-pi/pi-tui";
import { CHANNEL, type SharedDisplayEvents } from "@codesook/omp-shared-display/client";
import processMonitor, { REFRESH_MS, type Timers } from "./index.ts";

type Handler = (event: unknown, context: ExtensionContext) => unknown;
type Listing = { pid: number; ppid: number; command: string; env?: string; ports?: number[]; cwd?: string; etime?: string };
/** `locks` are lock files a process holds open; `staleLocks` exist on disk with no holder; `lockDirMissing` is a home no session ever ran in. */
type World = { ompPs: unknown[]; processes: Listing[]; locks: string[]; staleLocks?: string[]; lockDirMissing?: boolean; killFailure?: string; psFails?: boolean };

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const KEYS = { up: "\x1b[A", down: "\x1b[B", enter: "\r", escape: "\x1b", space: " ", k: "k" };

/** One process of every origin: supervised (with a tag that must lose), tagged, internal, unknown, and a scope whose broker has exited. */
function defaultWorld(): World {
	return {
		ompPs: [
			{
				kind: "project",
				projectDir: "/work/app",
				brokerPid: 900,
				daemons: [
					{ name: "web", pid: 100, state: "ready", owner: "S-old", command: "/bin/bash -l -c bun run dev" },
					{ name: "finished", state: "exited", owner: "S-old", command: "make" },
					{ name: "omp.text-predict.1", pid: 110, state: "ready", command: "/bin/omp __omp_worker_text_predict" },
				],
			},
			{
				kind: "project",
				projectDir: "/work/other",
				brokerPid: 901,
				daemons: [
					{ name: "omp.browser.headless", pid: 200, state: "ready", command: "Google Chrome for Testing --headless" },
					{ name: "web2", pid: 201, state: "ready", owner: "S-dead", command: "/bin/bash -l -c vite" },
				],
			},
			{ kind: "global", service: "browser-relay", daemons: [] },
		],
		processes: [
			{ pid: 100, ppid: 1, command: "bun run dev", env: "OMP_PLUGINS_SESSION=S-tagged" },
			{ pid: 110, ppid: 900, command: "/bin/omp __omp_worker_text_predict" },
			{ pid: 120, ppid: 1, command: "node server.js", env: "OMP_PLUGINS_SESSION=S-old", ports: [3000], cwd: "/work/app/apps/web", etime: "2-03:04:05" },
			{ pid: 121, ppid: 120, command: "node child.js", env: "OMP_PLUGINS_SESSION=S-old" },
			{ pid: 122, ppid: 1, command: "vite --port 5173", env: "OMP_PLUGINS_SESSION=S-now", ports: [5173], cwd: "/work/app", etime: "12:34" },
			{ pid: 200, ppid: 1, command: "Google Chrome for Testing --headless", ports: [9222] },
			{ pid: 201, ppid: 1, command: "vite", ports: [8090] },
			{ pid: 300, ppid: 1, command: "postgres -D data", ports: [5432], cwd: "/var/db" },
			{ pid: 900, ppid: 1, command: "/bin/omp __omp_worker_daemon_broker" },
			{ pid: 950, ppid: 11, command: "/bin/omp __omp_worker_js_eval_process" },
		],
		locks: ["S-now", "S-live"],
	};
}

const SECRET = "SECRET_TOKEN=hunter2";

function harness(options: { world?: World; home?: string; hasUI?: boolean; config?: unknown; session?: string; terminalRows?: number } = {}) {
	const home = options.home ?? mkdtempSync(path.join(os.tmpdir(), "omp-process-monitor-"));
	if (!options.home) directories.push(home);
	const configPath = path.join(home, "config.json");
	if (options.config !== undefined) writeFileSync(configPath, JSON.stringify(options.config));
	const world = options.world ?? defaultWorld();
	const calls: string[] = [];
	const log: string[] = [];
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
	const listeners = new Set<(data: unknown) => void>();
	const events: SharedDisplayEvents = {
		on: (_channel, handler) => { listeners.add(handler); return () => { listeners.delete(handler); }; },
		emit: (_channel, data) => { for (const handler of [...listeners]) handler(data); },
	};
	const segments: (string | null)[] = [];
	events.on(CHANNEL, data => {
		const message = data as { kind?: string; source?: string; sequence?: { frames: string[][] } | null };
		if (message.kind === "snapshot" && message.source === "process-monitor") segments.push(message.sequence ? message.sequence.frames[0]![0]! : null);
	});

	const locksDir = `${home}/.omp/run/session-owners`;
	const out = (stdout: string) => ({ code: 0, stdout, stderr: "", killed: false });
	const exec = async (command: string, args: string[]) => {
		const line = `${command} ${args.join(" ")}`;
		calls.push(line);
		if (line === "omp ps --all --json") return out(JSON.stringify(world.ompPs));
		if (line === "/bin/ps -axww -o pid=,ppid=,etime=,command=")
			return world.psFails ? { code: 1, stdout: "", stderr: "ps: not permitted", killed: false } : out(world.processes.map(p => `${p.pid} ${p.ppid} ${p.etime ?? "00:45"} ${p.command}`).join("\n"));
		if (line === "/bin/ps -axwwE -o pid=,command=") return out(world.processes.map(p => `${p.pid} ${p.command} ${SECRET}${p.env ? ` ${p.env}` : ""} HOME=/h`).join("\n"));
		if (line === "lsof -nP -iTCP -sTCP:LISTEN -F pcn")
			return out(world.processes.filter(p => p.ports?.length).map(p => `p${p.pid}\ncfake\n${p.ports!.map(port => `f9\nn*:${port}`).join("\n")}`).join("\n"));
		if (line === "lsof -nP -d cwd -F pn") return out(world.processes.filter(p => p.cwd).map(p => `p${p.pid}\nfcwd\nn${p.cwd}`).join("\n"));
		if (line === `ls -1 ${locksDir}`)
			return world.lockDirMissing
				? { code: 1, stdout: "", stderr: `ls: ${locksDir}: No such file or directory`, killed: false }
				: out([...world.locks, ...(world.staleLocks ?? [])].map(id => `${id}.lock`).join("\n"));
		if (line === `lsof -nP -F pn +d ${locksDir}`)
			return world.locks.length === 0 ? { code: 1, stdout: "", stderr: "", killed: false } : { code: 1, stdout: `p42\n${world.locks.map(id => `f3\nn${locksDir}/${id}.lock`).join("\n")}`, stderr: "", killed: false };
		const kill = /^kill -TERM (\d+)$/.exec(line);
		if (kill) {
			log.push(`kill ${kill[1]}`);
			return world.killFailure ? { code: 1, stdout: "", stderr: world.killFailure, killed: false } : out("");
		}
		throw new Error(`unexpected exec: ${line}`);
	};
	const pi = {
		on: (name: string, handler: Handler) => { handlers.set(name, handler); },
		registerCommand: (name: string, command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => { commands.set(name, command); },
		events,
		exec,
	} as unknown as ExtensionAPI;

	const intervals: { handler: () => void; ms: number }[] = [];
	const cleared: unknown[] = [];
	const timers: Timers = {
		setInterval: (handler, ms) => { intervals.push({ handler, ms }); return intervals.length; },
		clearInterval: handle => { cleared.push(handle); },
	};

	const notifications: { text: string; level?: string }[] = [];
	const statuses: (string | undefined)[] = [];
	const confirms: { title: string; message: string }[] = [];
	const selects: { title: string; options: unknown[] }[] = [];
	const screens: string[][] = [];
	const scripts: ((component: Component) => void)[] = [];
	const answers = { confirm: true, select: "Close all" as string | undefined };
	/** Runs when the next select prompt is shown, before it answers: the world changes while the user decides. */
	const onSelect: (() => void)[] = [];
	const ui = {
		notify: (text: string, level?: string) => { notifications.push({ text, level }); },
		setStatus: (_key: string, text: string | undefined) => { statuses.push(text); },
		confirm: async (title: string, message: string) => { log.push("confirm"); confirms.push({ title, message }); return answers.confirm; },
		select: async (title: string, choices: unknown[]) => { selects.push({ title, options: choices }); onSelect.shift()?.(); return answers.select; },
		custom: <T>(factory: (tui: unknown, theme: unknown, keys: unknown, done: (value: T) => void) => Component): Promise<T> => {
			const { promise, resolve } = Promise.withResolvers<T>();
			const component = factory({ requestRender() {}, terminal: { rows: options.terminalRows ?? 40 } }, { fg: (c: string, t: string) => `<${c}>${t}</${c}>`, bold: (t: string) => `<b>${t}</b>` }, {}, resolve);
			screens.push([...component.render(120)]);
			scripts.shift()?.(component);
			return promise;
		},
	};
	const idle = { value: true };
	const ctxFor = (sessionId: string): ExtensionContext =>
		({ hasUI: options.hasUI ?? false, cwd: "/work/app", isIdle: () => idle.value, sessionManager: { getSessionId: () => sessionId }, ui }) as unknown as ExtensionContext;

	processMonitor(pi, { configPath, homeDir: home, platform: "darwin", timers, settleMs: 0 });
	// Every collaborator answers with already-resolved promises, so draining microtasks is enough.
	const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
	const session = options.session ?? "S-now";
	const fire = async (name: string, event: unknown = {}, ctx: ExtensionContext = ctxFor(session)) => {
		const result = await handlers.get(name)!(event, ctx);
		await settle();
		return result;
	};
	const startSession = async (host = true) => {
		await fire("session_start");
		if (host) {
			events.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "e", active: true });
			events.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "e" });
		}
	};
	const runProcs = async (ctx: ExtensionContext = ctxFor(session)) => {
		await commands.get("procs")!.handler("", ctx);
		await settle();
	};
	const endedDir = path.join(home, ".local", "share", "codesook-omp", "process-monitor", "ended");
	return { home, world, calls, log, notifications, statuses, confirms, selects, onSelect, screens, scripts, answers, segments, timers: { intervals, cleared }, idle, ui, ctxFor, fire, startSession, runProcs, settle, endedDir, handlers, commands };
}

type Harness = ReturnType<typeof harness>;

/** The fake theme wraps text as `<colour>text</colour>` and `<b>text</b>`; `plain` is what a user reads. */
const plain = (text: string): string => text.replace(/<\/?(?:b|accent|dim|muted|warning|error|success|syntaxNumber)>/g, "");

function parseListing(text: string): Map<number, { group: string; path?: string; line: string }> {
	const rows = new Map<number, { group: string; path?: string; line: string }>();
	let group = "";
	let path: string | undefined;
	for (const line of text.split("\n")) {
		const row = /^\s+(\d+)\s{2}/.exec(line);
		const heading = /^(\S.*?) \(\d+\)(?:  (\S.*))?$/.exec(line);
		if (row) rows.set(Number(row[1]), { group, path, line: line.trim() });
		else if (heading) {
			group = heading[1]!;
			path = heading[2];
		}
	}
	return rows;
}

/** The overlay line of `pid`, still carrying the fake theme's tags. */
const overlayRow = (component: Component, pid: number, width = 120): string => {
	const row = component.render(width).find(line => new RegExp(`^[› ]\\s+${pid}\\s`).test(plain(line)));
	if (!row) throw new Error(`no overlay row for pid ${pid}`);
	return row;
};

function moveTo(component: Component, pid: number): void {
	for (let step = 0; step < 40; step++) {
		const cursor = component.render(120).map(plain).find(line => line.startsWith("›"));
		if (cursor && new RegExp(`^›\\s+${pid}\\s`).test(cursor)) return;
		component.handleInput?.(KEYS.down);
	}
	throw new Error(`cursor never reached pid ${pid}`);
}

const killsIn = (h: Harness) => h.calls.filter(call => call.startsWith("kill "));

test("every bash call is tagged with the calling session and the rest of the command is untouched", async () => {
	const h = harness();
	const envBefore = process.env.OMP_PLUGINS_SESSION;
	const call = (command: string, toolName = "bash") => ({ type: "tool_call", toolName, toolCallId: "c", input: { command } });

	const plain = call("git status");
	await h.fire("tool_call", plain, h.ctxFor("S-now"));
	expect(plain.input.command).toBe("export OMP_PLUGINS_SESSION='S-now'; git status");

	const subagent = call("git status");
	await h.fire("tool_call", subagent, h.ctxFor("S-sub.1"));
	expect(subagent.input.command).toBe("export OMP_PLUGINS_SESSION='S-sub.1'; git status");

	const rewrittenByRtk = call("export RTK_DB_PATH='/x/history.db'; rtk git status");
	await h.fire("tool_call", rewrittenByRtk, h.ctxFor("S-now"));
	expect(rewrittenByRtk.input.command).toBe("export OMP_PLUGINS_SESSION='S-now'; export RTK_DB_PATH='/x/history.db'; rtk git status");

	const again = call("export OMP_PLUGINS_SESSION='S-other'; ls");
	await h.fire("tool_call", again, h.ctxFor("S-now"));
	expect(again.input.command).toBe("export OMP_PLUGINS_SESSION='S-now'; ls");

	const notBash = call("git status", "read");
	await h.fire("tool_call", notBash, h.ctxFor("S-now"));
	expect(notBash.input.command).toBe("git status");

	const unsafe = call("git status");
	await h.fire("tool_call", unsafe, h.ctxFor("odd id'; rm -rf /"));
	expect(unsafe.input.command).toBe("git status");
	expect(process.env.OMP_PLUGINS_SESSION).toBe(envBefore);
});

test("attribution precedence is supervised, then tagged, then internal, then unknown", async () => {
	const h = harness();
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);

	expect(rows.get(100)).toMatchObject({ group: "app (this project)", path: "/work/app" });
	expect(rows.get(100)!.line).toContain("S-old");
	expect(rows.get(100)!.line).not.toContain("S-tagged");
	expect(rows.get(120)).toMatchObject({ group: "app (this project)", path: "/work/app" });
	expect(rows.get(110)).toMatchObject({ group: "OMP internals" });
	expect(rows.get(900)).toMatchObject({ group: "OMP internals" });
	expect(rows.get(950)).toMatchObject({ group: "OMP internals" });
	expect(rows.get(300)).toMatchObject({ group: "Unknown origin (view-only)" });
	expect(rows.has(121)).toBe(false);
	expect(text).not.toContain("hunter2");
	expect(text).not.toContain("HOME=");
});

test("the stop badge marks processes whose session holds no owner lock, including a scope whose broker exited", async () => {
	const h = harness();
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	expect(rows.get(100)!.line).toEndWith("⚠ stop?");
	expect(rows.get(120)!.line).toEndWith("⚠ stop?");
	expect(rows.get(201)).toMatchObject({ group: "other", path: "/work/other" });
	expect(rows.get(201)!.line).toEndWith("⚠ stop?");
	expect(rows.get(200)!.line).toEndWith("⚠ stop?");
	expect(rows.get(122)!.line).toContain("this session");
	expect(rows.get(122)!.line).not.toContain("stop?");
	expect(rows.get(300)!.line).not.toContain("stop?");
	expect(killsIn(h)).toEqual([]);
});

test("a session whose lock file exists but is held by no process is ended", async () => {
	const h = harness({ world: { ...defaultWorld(), staleLocks: ["S-old"] } });
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	for (const pid of [100, 120]) expect(rows.get(pid)!.line).toEndWith("⚠ stop?");
	expect(text).not.toContain("Session owner locks unreadable");
});

test("a held lock keeps its session live and the current session is live without any lock", async () => {
	const h = harness({ world: { ...defaultWorld(), locks: ["S-old"] } });
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	for (const pid of [100, 120]) expect(rows.get(pid)!.line).not.toContain("stop?");
	expect(rows.get(122)!.line).toContain("this session");
	expect(rows.get(122)!.line).not.toContain("stop?");
});

test("with no owner lock directory at all, tagged and supervised processes are still leftovers", async () => {
	const h = harness({ world: { ...defaultWorld(), locks: [], lockDirMissing: true } });
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	for (const pid of [100, 120, 201]) expect(rows.get(pid)!.line).toEndWith("⚠ stop?");
	expect(rows.get(122)!.line).not.toContain("stop?");
	expect(text).not.toContain("Session owner locks unreadable");
});

test("a tagged stand-in holding a port is counted as a leftover when no session ever created a lock", async () => {
	const world: World = {
		ompPs: [],
		processes: [{ pid: 777, ppid: 1, command: "bun -e Bun.serve", env: "OMP_PLUGINS_SESSION=verify-demo", ports: [54665] }],
		locks: [],
		lockDirMissing: true,
	};
	const h = harness({ world });
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	expect(text).toContain("1 tracked · 1 suggested to stop · 1 holding a port");
	expect(parseListing(text).get(777)!.line).toEndWith("⚠ stop?");
	await h.startSession();
	expect(h.segments.at(-1)).toBe("⚠ 1 ports");
});

test("when lsof cannot see the current session's own lock, sessions that have a lock file are not called ended", async () => {
	const h = harness({ world: { ...defaultWorld(), locks: [], staleLocks: ["S-now", "S-old"] } });
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	for (const pid of [100, 120]) expect(rows.get(pid)!.line).not.toContain("stop?");
	expect(rows.get(201)!.line).toEndWith("⚠ stop?");
	expect(text).toContain("Session owner locks unreadable");
});

test("the overlay opens read-only, keeps OMP internals collapsed until expanded, and closes with Enter", async () => {
	const h = harness({ hasUI: true });
	h.scripts.push(component => {
		const before = component.render(120).map(plain).join("\n");
		expect(before).toContain("▸ OMP internals (3)");
		expect(before).not.toContain("__omp_worker_text_predict");
		moveTo(component, 300);
		component.handleInput?.(KEYS.up);
		component.handleInput?.(KEYS.up);
		component.handleInput?.(KEYS.space);
		expect(component.render(120).map(plain).join("\n")).toContain("__omp_worker_text_predict");
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(h.screens).toHaveLength(1);
	expect(h.screens[0]!.join("\n")).toContain("Enter/Esc close");
	expect(killsIn(h)).toEqual([]);
	expect(h.confirms).toEqual([]);
});

test("rows of unknown origin and OMP internals offer no kill", async () => {
	const h = harness({ hasUI: true });
	let afterUnknown = "";
	h.scripts.push(component => {
		moveTo(component, 300);
		component.handleInput?.(KEYS.k);
		afterUnknown = component.render(120).map(plain).join("\n");
		component.handleInput?.(KEYS.escape);
	});
	await h.runProcs();
	expect(afterUnknown).toContain("view-only");
	expect(h.confirms).toEqual([]);
	expect(killsIn(h)).toEqual([]);
});

test("killing a tagged process asks first, then sends exactly one SIGTERM to that pid and refreshes the list", async () => {
	const h = harness({ hasUI: true });
	h.scripts.push(component => {
		moveTo(component, 120);
		component.handleInput?.(KEYS.k);
	});
	h.scripts.push(component => component.handleInput?.(KEYS.escape));
	await h.runProcs();

	expect(h.log).toEqual(["confirm", "kill 120"]);
	expect(killsIn(h)).toEqual(["kill -TERM 120"]);
	expect(h.confirms).toHaveLength(1);
	expect(h.confirms[0]!.message).toContain("pid 120");
	expect(h.confirms[0]!.message).toContain("node server.js");
	expect(h.confirms[0]!.message).toContain("3000");
	expect(h.screens).toHaveLength(2);
});

test("a supervised process can be killed too", async () => {
	const h = harness({ hasUI: true });
	h.scripts.push(component => {
		moveTo(component, 201);
		component.handleInput?.(KEYS.k);
	});
	h.scripts.push(component => component.handleInput?.(KEYS.escape));
	await h.runProcs();
	expect(killsIn(h)).toEqual(["kill -TERM 201"]);
});

test("declining the confirmation sends no signal", async () => {
	const h = harness({ hasUI: true });
	h.answers.confirm = false;
	h.scripts.push(component => {
		moveTo(component, 120);
		component.handleInput?.(KEYS.k);
	});
	h.scripts.push(component => component.handleInput?.(KEYS.escape));
	await h.runProcs();
	expect(h.confirms).toHaveLength(1);
	expect(killsIn(h)).toEqual([]);
});

test("a failed kill is reported with the reason, in a notification and in the reopened overlay", async () => {
	const world = defaultWorld();
	world.killFailure = "kill: 120: Operation not permitted";
	const h = harness({ world, hasUI: true });
	h.scripts.push(component => {
		moveTo(component, 120);
		component.handleInput?.(KEYS.k);
	});
	h.scripts.push(component => component.handleInput?.(KEYS.escape));
	await h.runProcs();
	const failure = h.notifications.find(note => note.level === "error");
	expect(failure?.text).toContain("pid 120");
	expect(failure?.text).toContain("Operation not permitted");
	expect(h.screens[1]!.join("\n")).toContain("Operation not permitted");
});

test("a process that changed since the list was drawn is not signalled", async () => {
	const h = harness({ hasUI: true });
	h.scripts.push(component => {
		moveTo(component, 120);
		h.world.processes.find(p => p.pid === 120)!.command = "something else entirely";
		component.handleInput?.(KEYS.k);
	});
	h.scripts.push(component => component.handleInput?.(KEYS.escape));
	await h.runProcs();
	expect(killsIn(h)).toEqual([]);
	expect(h.notifications.find(note => note.level === "error")?.text).toContain("nothing was stopped");
});

test("the segment counts leftover processes that hold a port and clears at zero", async () => {
	const h = harness();
	await h.startSession();
	expect(h.segments.at(-1)).toBe("⚠ 3 ports");

	h.world.locks.push("S-old", "S-dead");
	h.world.ompPs = [];
	await h.fire("before_agent_start", { systemPrompt: [] });
	expect(h.segments.at(-1)).toBeNull();
});

test("display.processMonitor sets the template and can hide the segment", async () => {
	const templated = harness({ config: { version: 1, display: { processMonitor: { template: "stuck: {count}" } }, behavior: {} } });
	await templated.startSession();
	expect(templated.segments.at(-1)).toBe("stuck: 3");

	const hidden = harness({ config: { version: 1, display: { processMonitor: { visible: false } }, behavior: {} } });
	await hidden.startSession();
	expect(hidden.segments.at(-1)).toBeNull();
});

test("without a Display Host the count falls back to native status", async () => {
	const h = harness();
	await h.startSession(false);
	expect(h.statuses.at(-1)).toBe("⚠ 3 ports");
});

test("an idle timer refreshes the segment and shutdown stops it", async () => {
	const h = harness();
	await h.startSession();
	expect(h.timers.intervals).toHaveLength(1);
	expect(h.timers.intervals[0]!.ms).toBe(REFRESH_MS);
	expect(h.segments.at(-1)).toBe("⚠ 3 ports");

	h.world.processes = h.world.processes.filter(p => p.pid !== 120);
	const callsBefore = h.calls.length;
	h.idle.value = false;
	h.timers.intervals[0]!.handler();
	await h.settle();
	expect(h.calls.length).toBe(callsBefore);
	expect(h.segments.at(-1)).toBe("⚠ 3 ports");

	h.idle.value = true;
	h.timers.intervals[0]!.handler();
	await h.settle();
	expect(h.segments.at(-1)).toBe("⚠ 2 ports");

	await h.fire("session_shutdown");
	expect(h.timers.cleared).toContain(1);
	expect(h.segments.at(-1)).toBeNull();
});

test("switching sessions offers to close what the previous session left running", async () => {
	const closing = harness({ hasUI: true });
	await closing.startSession();
	await closing.fire("session_switch", { reason: "new" }, closing.ctxFor("S-next"));
	expect(closing.selects).toHaveLength(1);
	expect(closing.selects[0]!.options).toEqual(["Close all", "Keep"]);
	expect(closing.selects[0]!.title).toContain("122");
	expect(closing.selects[0]!.title).toContain("vite --port 5173");
	expect(killsIn(closing)).toEqual(["kill -TERM 122"]);

	const keeping = harness({ hasUI: true });
	keeping.answers.select = "Keep";
	await keeping.startSession();
	await keeping.fire("session_switch", { reason: "new" }, keeping.ctxFor("S-next"));
	expect(keeping.selects).toHaveLength(1);
	expect(killsIn(keeping)).toEqual([]);

	const quiet = harness({ hasUI: true, session: "S-nothing" });
	await quiet.startSession();
	await quiet.fire("session_switch", { reason: "new" }, quiet.ctxFor("S-next"));
	expect(quiet.selects).toEqual([]);

	const headless = harness({ hasUI: false });
	await headless.startSession();
	await headless.fire("session_switch", { reason: "new" }, headless.ctxFor("S-next"));
	expect(headless.selects).toEqual([]);
});

test("quitting records the session without asking, and the next start reports what is still running", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "omp-process-monitor-home-"));
	directories.push(home);
	const world = defaultWorld();
	world.processes.push({ pid: 123, ppid: 1, command: "node api.js", env: "OMP_PLUGINS_SESSION=S-quit", ports: [4000] });

	const first = harness({ home, world, hasUI: true, session: "S-quit" });
	await first.startSession();
	await first.fire("session_shutdown");
	expect(first.selects).toEqual([]);
	expect(first.confirms).toEqual([]);
	expect(readdirSync(first.endedDir)).toEqual(["S-quit"]);

	const second = harness({ home, world: structuredClone(world), session: "S-new" });
	await second.startSession();
	const notice = second.notifications.find(note => note.level === "warning");
	expect(notice?.text).toContain("123");
	expect(notice?.text).toContain("node api.js");
	expect(notice?.text).toContain("/procs");
	expect(readdirSync(second.endedDir)).toEqual([]);

	const third = harness({ home, world: structuredClone(world), session: "S-third" });
	await third.startSession();
	expect(third.notifications).toEqual([]);
});

test("the next start stays quiet when the quit session left nothing running", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "omp-process-monitor-home-"));
	directories.push(home);
	const ended = path.join(home, ".local", "share", "codesook-omp", "process-monitor", "ended");
	mkdirSync(ended, { recursive: true });
	writeFileSync(path.join(ended, "S-empty"), "");

	const h = harness({ home, session: "S-new" });
	await h.startSession();
	expect(h.notifications).toEqual([]);
	expect(existsSync(path.join(ended, "S-empty"))).toBe(false);
});

/** Three services of the ended session S-prev (persist, detached, plain) and a tagged leftover without a port. */
function keptWorld(): World {
	return {
		ompPs: [
			{
				kind: "project",
				projectDir: "/work/app",
				brokerPid: 900,
				daemons: [
					{ name: "db", pid: 500, state: "ready", owner: "S-prev", persist: true, command: "postgres -D data" },
					{ name: "preview", pid: 501, state: "ready", owner: "S-prev", detached: true, command: "vite preview" },
					{ name: "scratch", pid: 502, state: "ready", owner: "S-prev", command: "python3 -m http.server" },
				],
			},
		],
		processes: [
			{ pid: 123, ppid: 1, command: "node worker.js", env: "OMP_PLUGINS_SESSION=S-prev" },
			{ pid: 500, ppid: 1, command: "postgres -D data", ports: [5432] },
			{ pid: 501, ppid: 1, command: "vite preview", ports: [4173] },
			{ pid: 502, ppid: 1, command: "python3 -m http.server", ports: [8000] },
			{ pid: 900, ppid: 1, command: "/bin/omp __omp_worker_daemon_broker" },
		],
		locks: ["S-now"],
	};
}

test("persist and detached services from an ended session are not counted by the segment, only plain leftovers with a port are", async () => {
	const h = harness({ world: keptWorld() });
	await h.startSession();
	expect(h.segments.at(-1)).toBe("⚠ 1 ports");
});

test("Close all lists and stops the previous session's plain leftovers and never a persist or detached service", async () => {
	const h = harness({ world: { ...keptWorld(), locks: ["S-next"] }, hasUI: true, session: "S-prev" });
	await h.startSession();
	await h.fire("session_switch", { reason: "new" }, h.ctxFor("S-next"));
	expect(h.selects).toHaveLength(1);
	const { title } = h.selects[0]!;
	expect(title).toContain("123");
	expect(title).toContain("scratch");
	expect(title).not.toContain("postgres");
	expect(title).not.toContain("5432");
	expect(title).not.toContain("4173");
	expect(title).not.toContain("preview");
	expect(killsIn(h)).toEqual(["kill -TERM 123", "kill -TERM 502"]);
});

test("when only persist or detached services remain from the previous session, no prompt appears", async () => {
	const world = keptWorld();
	world.processes = world.processes.filter(p => p.pid !== 123 && p.pid !== 502);
	world.locks = ["S-next"];
	const h = harness({ world, hasUI: true, session: "S-prev" });
	await h.startSession();
	await h.fire("session_switch", { reason: "new" }, h.ctxFor("S-next"));
	expect(h.selects).toEqual([]);
	expect(killsIn(h)).toEqual([]);
});

test("the next start warns about a tagged leftover without a port but not about a kept service of the same session", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "omp-process-monitor-home-"));
	directories.push(home);
	const world = keptWorld();
	world.processes = world.processes.filter(p => p.pid !== 501 && p.pid !== 502);
	world.ompPs = [{ kind: "project", projectDir: "/work/app", brokerPid: 900, daemons: [{ name: "db", pid: 500, state: "ready", owner: "S-quit", persist: true, command: "postgres -D data" }] }];
	world.processes = world.processes.map(p => (p.pid === 123 ? { ...p, env: "OMP_PLUGINS_SESSION=S-quit" } : p));

	const first = harness({ home, world, session: "S-quit" });
	await first.startSession();
	await first.fire("session_shutdown");

	const second = harness({ home, world: structuredClone({ ...world, locks: ["S-new"] }), session: "S-new" });
	await second.startSession();
	const notice = second.notifications.find(note => note.level === "warning");
	expect(notice?.text).toContain("1 process");
	expect(notice?.text).toContain("123");
	expect(notice?.text).toContain("node worker.js");
	expect(notice?.text).not.toContain("postgres");
	expect(notice?.text).not.toContain("5432");
	expect(readdirSync(second.endedDir)).toEqual([]);
});

test("unknown-origin processes and OMP internals are never Stop Candidates, even holding a port", async () => {
	const world: World = {
		ompPs: [{ kind: "project", projectDir: "/work/app", brokerPid: 900, daemons: [] }],
		processes: [
			{ pid: 300, ppid: 1, command: "postgres -D data", ports: [5432] },
			{ pid: 900, ppid: 1, command: "/bin/omp __omp_worker_daemon_broker", ports: [9999] },
			{ pid: 950, ppid: 900, command: "/bin/omp __omp_worker_js_eval_process", ports: [9998] },
		],
		locks: ["S-now"],
	};
	const h = harness({ world });
	await h.startSession();
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	expect(rows.get(300)).toMatchObject({ group: "Unknown origin (view-only)" });
	expect(rows.get(900)).toMatchObject({ group: "OMP internals" });
	expect(rows.get(950)).toMatchObject({ group: "OMP internals" });
	expect(h.segments.at(-1)).toBeNull();
	expect(h.notifications.filter(note => note.level === "warning")).toEqual([]);
});

const LONG_COMMAND = 'bun -e Bun.serve({port:0,fetch:()=>new Response("x")});setInterval(()=>{},1e6) --padding-so-the-command-cannot-fit-any-reasonable-terminal';

function longCommandWorld(): World {
	const world = defaultWorld();
	world.processes.push({ pid: 25718, ppid: 1, command: LONG_COMMAND, env: "OMP_PLUGINS_SESSION=verify-demo", ports: [56561] });
	return world;
}

test("the overlay row keeps the pid, age and badge whole and truncates only the command while the session column is shown", async () => {
	const h = harness({ world: longCommandWorld(), hasUI: true });
	const rowAt: Record<number, string> = {};
	h.scripts.push(component => {
		for (const width of [120, 60]) rowAt[width] = plain(overlayRow(component, 25718, width));
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	for (const width of [120, 60]) {
		const row = rowAt[width]!;
		expect(row, `row at ${width}`).toEndWith("⚠ stop?");
		expect(row).toContain(":56561");
		expect(row).toContain("45s");
		expect(visibleWidth(row)).toBeLessThanOrEqual(width);
	}
	expect(rowAt[120]).toContain("…");
	expect(rowAt[120]).toContain("…ify-demo");
	expect(rowAt[120]).not.toContain("padding-so-the-command");
	expect(rowAt[60]).not.toContain("…");
});

test("the no-UI listing and the next-start notice keep the stop badge on the row's own line", async () => {
	const listing = harness({ world: longCommandWorld() });
	await listing.runProcs();
	const listed = parseListing(listing.notifications.at(-1)!.text).get(25718)!.line;
	expect(listed).toEndWith("⚠ stop?");
	expect(listed).toContain("…");
	expect(visibleWidth(listed)).toBeLessThanOrEqual(100);

	const home = mkdtempSync(path.join(os.tmpdir(), "omp-process-monitor-home-"));
	directories.push(home);
	const world = longCommandWorld();
	world.processes.push({ pid: 123, ppid: 1, command: LONG_COMMAND, env: "OMP_PLUGINS_SESSION=S-quit", ports: [4000] });
	const first = harness({ home, world, hasUI: true, session: "S-quit" });
	await first.startSession();
	await first.fire("session_shutdown");
	const second = harness({ home, world: structuredClone(world), session: "S-new" });
	await second.startSession();
	const notice = second.notifications.find(note => note.level === "warning")!;
	const row = notice.text.split("\n").find(line => /^\s+123\s/.test(line))!;
	expect(row).toEndWith("⚠ stop?");
	expect(row).toContain("…");
	expect(visibleWidth(row)).toBeLessThanOrEqual(100);
});

function namingWorld(): World {
	return {
		ompPs: [
			{
				kind: "project",
				projectDir: "/work/app",
				daemons: [{ name: "onboarding-http", pid: 400, state: "ready", owner: "S-old", command: "/bin/zsh -l -c python3 -m http.server 8080" }],
			},
		],
		processes: [
			{ pid: 400, ppid: 1, command: "python3 -m http.server 8080", ports: [8080] },
			{ pid: 401, ppid: 1, command: "/bin/zsh -l -c export OMP_PLUGINS_SESSION='S-old'; python3 -m http.server 8765", env: "OMP_PLUGINS_SESSION=S-old", ports: [8765] },
			{ pid: 402, ppid: 1, command: "/usr/local/bin/node /work/app/server.js --inspect", env: "OMP_PLUGINS_SESSION=S-old", ports: [3000] },
			{ pid: 403, ppid: 1, command: "node /work/app/node_modules/.bin/next dev --port 3001", env: "OMP_PLUGINS_SESSION=S-old", ports: [3001] },
			{ pid: 404, ppid: 1, command: "/work/app/node_modules/.bin/next dev", env: "OMP_PLUGINS_SESSION=S-old", ports: [3002] },
			{ pid: 405, ppid: 1, command: "bunx vite --port 5173", env: "OMP_PLUGINS_SESSION=S-old", ports: [5173] },
			{ pid: 406, ppid: 1, command: "/bin/bash -c export OMP_PLUGINS_SESSION='S-now'; bun run /work/app/scripts/dev-server.ts", env: "OMP_PLUGINS_SESSION=S-now", ports: [54000] },
			{ pid: 407, ppid: 1, command: "bun -e Bun.serve({port:0})", env: "OMP_PLUGINS_SESSION=S-old", ports: [54001] },
			{ pid: 408, ppid: 1, command: "/Users/x/Library/Application Support/Figma/FigmaAgent.app/Contents/MacOS/figma_agent --from-desktop", env: "OMP_PLUGINS_SESSION=S-old", ports: [44950] },
			{
				pid: 409,
				ppid: 1,
				command: "/Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (Renderer).app/Contents/MacOS/Obsidian Helper (Renderer)",
				env: "OMP_PLUGINS_SESSION=S-old",
				ports: [9229],
			},
		],
		locks: ["S-now"],
	};
}

test("a supervised daemon shows its omp ps name", async () => {
	const h = harness({ world: namingWorld() });
	await h.runProcs();
	expect(parseListing(h.notifications.at(-1)!.text).get(400)!.line).toMatch(/^400\s+:8080\s+onboarding-http\s+python3 -m http\.server 8080\s/);
});

test("a tagged command launched through zsh -l -c shows the program, not the shell or the marker", async () => {
	const h = harness({ world: namingWorld() });
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const line = parseListing(text).get(401)!.line;
	expect(line).toMatch(/^401\s+:8765\s+http\.server\s+python3 -m http\.server 8765\s/);
	expect(line).not.toContain("OMP_PLUGINS_SESSION");
	expect(line).not.toContain("zsh");
	expect(text).not.toContain("OMP_PLUGINS_SESSION");
});

test("interpreter launches are named after their script, module or package-runner command", async () => {
	const h = harness({ world: namingWorld() });
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	expect(rows.get(402)!.line).toMatch(/^402\s+:3000\s+server\s+\/usr\/local\/bin\/node /);
	expect(rows.get(403)!.line).toMatch(/^403\s+:3001\s+next dev\s+node /);
	expect(rows.get(404)!.line).toMatch(/^404\s+:3002\s+next dev\s+\/work\/app\/node_modules/);
	expect(rows.get(405)!.line).toMatch(/^405\s+:5173\s+vite\s+bunx vite /);
	expect(rows.get(406)!.line).toMatch(/^406\s+:54000\s+dev-server\s+bun run /);
	expect(rows.get(407)!.line).toMatch(/^407\s+:54001\s+bun\s+bun -e /);
});

test("the overlay row shows the name without the shell or the marker", async () => {
	const h = harness({ world: namingWorld(), hasUI: true });
	h.scripts.push(component => component.handleInput?.(KEYS.enter));
	await h.runProcs();
	const screen = plain(h.screens[0]!.join("\n"));
	expect(screen).toMatch(/\b401\s+:8765\s+http\.server\s+python3 -m http\.server 8765\s/);
	expect(screen).not.toContain("OMP_PLUGINS_SESSION");
	expect(screen).not.toContain("zsh");
});

test("the stop confirmation shows the command without the marker and the shell wrapper, and the re-check still stops that pid", async () => {
	const h = harness({ world: namingWorld(), hasUI: true });
	h.scripts.push(component => {
		moveTo(component, 401);
		component.handleInput?.(KEYS.k);
	});
	h.scripts.push(component => component.handleInput?.(KEYS.escape));
	await h.runProcs();
	expect(h.confirms).toHaveLength(1);
	expect(h.confirms[0]!.message).toContain("Command: python3 -m http.server 8765");
	expect(h.confirms[0]!.message).not.toContain("OMP_PLUGINS_SESSION");
	expect(h.confirms[0]!.message).not.toContain("zsh");
	expect(killsIn(h)).toEqual(["kill -TERM 401"]);
});

test("the session-switch prompt names the process", async () => {
	const h = harness({ world: namingWorld(), hasUI: true });
	await h.startSession();
	await h.fire("session_switch", { reason: "new" }, h.ctxFor("S-next"));
	expect(h.selects).toHaveLength(1);
	expect(h.selects[0]!.title).toMatch(/406\s+:54000\s+dev-server\s+bun run /);
	expect(h.selects[0]!.title).not.toContain("OMP_PLUGINS_SESSION");
	expect(killsIn(h)).toEqual(["kill -TERM 406"]);
});

test("an unreadable process table is reported instead of guessed", async () => {
	const h = harness({ world: { ...defaultWorld(), psFails: true } });
	await h.runProcs();
	const failure = h.notifications.at(-1)!;
	expect(failure.level).toBe("error");
	expect(failure.text).toContain("process table could not be read");
});

test("with nothing running /procs says so", async () => {
	const h = harness({ world: { ...defaultWorld(), ompPs: [], processes: [], locks: ["S-now"] } });
	await h.runProcs();
	expect(h.notifications.at(-1)!.text).toContain("Nothing OMP started is running");
});

test("an executable inside a macOS bundle is named after the innermost bundle, not a folder in its path", async () => {
	const h = harness({ world: namingWorld() });
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	expect(rows.get(408)!.line).toMatch(/^408\s+:44950\s+FigmaAgent\s/);
	expect(rows.get(409)!.line).toMatch(/^409\s+:9229\s+Obsidian Helper \(Renderer\)\s/);
});

test("OMP internals are named after their role, not omp", async () => {
	const world = defaultWorld();
	world.processes.push({ pid: 951, ppid: 1, command: "/bin/omp __omp_worker_daemon_broker" });
	const h = harness({ world });
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	expect(rows.get(110)!.line).toMatch(/^110\s+-\s+text-predict\s+\/bin\/omp /);
	expect(rows.get(900)!.line).toMatch(/^900\s+-\s+broker\s+\/bin\/omp /);
	expect(rows.get(950)!.line).toMatch(/^950\s+-\s+js-eval-process\s+\/bin\/omp /);
	expect(rows.get(951)!.line).toMatch(/^951\s+-\s+daemon-broker\s+\/bin\/omp /);
});

const titleRecord = (title: string) => JSON.stringify({ type: "title", v: 1, title, source: "auto", updatedAt: "2026-11-10T01:02:03.456Z", pad: " ".repeat(300) });

function writeSessionFile(home: string, project: string, id: string, content: string): string {
	const directory = path.join(home, ".omp", "agent", "sessions", project);
	mkdirSync(directory, { recursive: true });
	const file = path.join(directory, `2026-11-10T01-02-03-456Z_${id}.jsonl`);
	writeFileSync(file, content);
	return file;
}

test("a session whose file starts with a title record shows that title instead of its id, and nothing past the first line", async () => {
	const h = harness();
	writeSessionFile(h.home, "--work-app--", "S-old", `${titleRecord("Fix flaky login test")}\n{"type":"message","content":"SECRET_SESSION_BODY"}\n`);
	writeSessionFile(h.home, "--work-other--", "S-now", `${titleRecord("The running session")}\n`);
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	for (const pid of [100, 120]) {
		expect(rows.get(pid)!.line).toContain("Fix flaky login test");
		expect(rows.get(pid)!.line).not.toContain("S-old");
		expect(rows.get(pid)!.line).toEndWith("⚠ stop?");
	}
	expect(rows.get(122)!.line).toContain("this session");
	expect(rows.get(122)!.line).toContain("The running session");
	expect(rows.get(201)!.line).toContain("S-dead");
	expect(text).not.toContain("SECRET_SESSION_BODY");
});

test("a long title gives way before the name and the stop badge, and a narrow overlay hides the session column", async () => {
	const h = harness({ hasUI: true });
	writeSessionFile(h.home, "--work-app--", "S-old", `${titleRecord("A very long session title that cannot fit beside the process name")}\n`);
	const rowAt: Record<number, string> = {};
	h.scripts.push(component => {
		for (const width of [120, 60]) rowAt[width] = plain(overlayRow(component, 120, width));
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	for (const width of [120, 60]) {
		expect(rowAt[width], `row at ${width}`).toEndWith("⚠ stop?");
		expect(rowAt[width]).toContain("server");
		expect(rowAt[width]).not.toContain("cannot fit beside the process name");
		expect(visibleWidth(rowAt[width]!)).toBeLessThanOrEqual(width);
	}
	expect(rowAt[120]).toContain("A very");
	expect(rowAt[60]).not.toContain("A very");
});

test("the session-switch prompt shows the previous session's title", async () => {
	const h = harness({ hasUI: true });
	writeSessionFile(h.home, "--work-app--", "S-now", `${titleRecord("Wire up the billing webhook")}\n`);
	await h.startSession();
	await h.fire("session_switch", { reason: "new" }, h.ctxFor("S-next"));
	expect(h.selects).toHaveLength(1);
	expect(h.selects[0]!.title).toContain("Wire up the billing webhook");
});

test("a session with no session file keeps its short id", async () => {
	const h = harness({ world: longCommandWorld() });
	writeSessionFile(h.home, "--work-app--", "S-unrelated", `${titleRecord("Someone else")}\n`);
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	expect(rows.get(25718)!.line).toContain("…ify-demo");
	expect(rows.get(120)!.line).toContain("S-old");
	expect(h.notifications.at(-1)!.text).not.toContain("Someone else");
});

test("a first line that is not a title record, or does not end within the bound, shows the short id", async () => {
	const h = harness();
	writeSessionFile(h.home, "--work-app--", "S-old", `${JSON.stringify({ type: "message", id: "S-old", title: "Not a title record" })}\n`);
	writeSessionFile(h.home, "--work-app--", "S-dead", `${titleRecord("Past the bound").replace('"pad":"', `"pad":"${"x".repeat(5000)}`)}\n`);
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	expect(rows.get(120)!.line).toContain("S-old");
	expect(rows.get(201)!.line).toContain("S-dead");
	expect(text).not.toContain("Not a title record");
	expect(text).not.toContain("Past the bound");
});

test("the overlay starts its table with a dimmed header row naming every column", async () => {
	const h = harness({ hasUI: true });
	h.scripts.push(component => component.handleInput?.(KEYS.enter));
	await h.runProcs();
	const header = h.screens[0]!.find(line => /PID\s+PORTS\s+NAME\s+AGE\s+SESSION\s+STATE/.test(plain(line)));
	expect(header).toBeDefined();
	expect(header).toStartWith("<dim>");
	expect(header).toEndWith("</dim>");
});

test("AGE shows how long a process has run, from the ps elapsed time, and a dash when ps gave none", async () => {
	const ages = [
		["00:45", "45s"],
		["59:59", "59m"],
		["01:00:00", "1h"],
		["23:59:59", "23h"],
		["1-00:00:00", "1d"],
		["2-03:04:05", "2d"],
		["unreadable", "-"],
	] as const;
	const world: World = {
		ompPs: [],
		processes: ages.map(([etime], index) => ({ pid: 601 + index, ppid: 1, command: `svc-${index}`, env: "OMP_PLUGINS_SESSION=S-old", ports: [6001 + index], etime })),
		locks: [],
		lockDirMissing: true,
	};
	const h = harness({ world });
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	ages.forEach(([, age], index) => expect(rows.get(601 + index)!.line.split(/\s{2,}/)[3]).toBe(age));
});

test("group headers show the folder name in bold and the full path dimmed", async () => {
	const h = harness({ hasUI: true });
	h.scripts.push(component => component.handleInput?.(KEYS.enter));
	await h.runProcs();
	const screen = h.screens[0]!.join("\n");
	expect(screen).toMatch(/<b>▾ app<\/b> \(this project\) \(3\)  <dim>\/work\/app<\/dim>/);
	expect(screen).toMatch(/<b>▾ other<\/b> \(2\)  <dim>\/work\/other<\/dim>/);
	expect(screen).toContain("<b>▸ OMP internals</b> (3)");
	expect(plain(screen)).toContain("▾ Unknown origin (view-only) (1)");
});

/** The default world plus a tagged server of S-live, a session whose owner lock is held. */
function liveWorld(): World {
	const world = defaultWorld();
	world.processes.push({ pid: 130, ppid: 1, command: "node live.js", env: "OMP_PLUGINS_SESSION=S-live", ports: [3100], cwd: "/work/app", etime: "03:04:05" });
	return world;
}

test("the current session's row carries the success colour and a this-session badge, with the session's title", async () => {
	const h = harness({ world: liveWorld(), hasUI: true });
	writeSessionFile(h.home, "--work-app--", "S-now", `${titleRecord("The running session")}\n`);
	let row = "";
	h.scripts.push(component => {
		row = overlayRow(component, 122);
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(row).toContain("<success>● this session</success>");
	expect(plain(row)).toContain("The running session");
	expect(plain(row)).toMatch(/\s12m\s/);
	expect(row).not.toContain("<warning>");
});

test("a live row of another session carries the accent colour and a live badge", async () => {
	const h = harness({ world: liveWorld(), hasUI: true });
	let row = "";
	h.scripts.push(component => {
		row = overlayRow(component, 130);
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(row).toContain("<accent>● live</accent>");
	expect(plain(row)).toContain("S-live");
	expect(plain(row)).toMatch(/\s3h\s/);
	expect(row).not.toContain("<warning>");
});

test("a Stop Candidate row is wrapped whole in the warning colour and shows the stop badge", async () => {
	const h = harness({ hasUI: true });
	let row = "";
	h.scripts.push(component => {
		row = overlayRow(component, 120);
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(row).toStartWith("<warning>");
	expect(row).toEndWith("</warning>");
	expect(row.match(/<\/warning>/g)).toHaveLength(1);
	expect(plain(row)).toMatch(/\s2d\s/);
	expect(plain(row)).toEndWith("⚠ stop?");
});

test("a Kept Process row has an accent badge and no warning tint", async () => {
	const h = harness({ world: keptWorld(), hasUI: true });
	let kept = "";
	let stoppable = "";
	h.scripts.push(component => {
		kept = overlayRow(component, 500);
		stoppable = overlayRow(component, 502);
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(kept).toContain("<accent>📌 kept</accent>");
	expect(kept).not.toContain("<warning>");
	expect(plain(kept)).not.toContain("stop?");
	expect(stoppable).toStartWith("<warning>");
	expect(plain(stoppable)).toEndWith("⚠ stop?");
});

test("a row of unknown origin is wrapped whole in the dim colour and has no badge", async () => {
	const h = harness({ hasUI: true });
	let row = "";
	h.scripts.push(component => {
		row = overlayRow(component, 300);
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(row).toStartWith("<dim>");
	expect(row).toEndWith("</dim>");
	expect(row.match(/<\/dim>/g)).toHaveLength(1);
	expect(plain(row)).not.toMatch(/stop\?|kept|live|this session/);
});

test("ports use the number colour and names are bold", async () => {
	const h = harness({ world: liveWorld(), hasUI: true });
	let row = "";
	h.scripts.push(component => {
		row = overlayRow(component, 130);
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(row).toContain("<syntaxNumber>:3100</syntaxNumber>");
	expect(row).toContain("<b>live</b>");
});

test("one row with many ports cannot take the line: the ports past the cap become +N", async () => {
	const world: World = {
		ompPs: [],
		processes: [
			{ pid: 700, ppid: 1, command: "svc-many", env: "OMP_PLUGINS_SESSION=S-old", ports: Array.from({ length: 13 }, (_, index) => 3000 + index) },
			{ pid: 701, ppid: 1, command: "svc-one", env: "OMP_PLUGINS_SESSION=S-old", ports: [4000] },
		],
		locks: ["S-now"],
	};
	const h = harness({ world, hasUI: true });
	let row = "";
	h.scripts.push(component => {
		row = plain(overlayRow(component, 700, 60));
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(row).toContain(":3000,:3001,+11");
	expect(row).not.toContain(":3002");
	expect(row).toContain("45s");
	expect(row).toEndWith("⚠ stop?");
	expect(visibleWidth(row)).toBeLessThanOrEqual(60);
});

test("PID, AGE and the state badge survive a 60-column overlay", async () => {
	const h = harness({ world: longCommandWorld(), hasUI: true });
	const lines: string[] = [];
	const rows: Record<number, string> = {};
	h.scripts.push(component => {
		lines.push(...component.render(60).map(plain));
		for (const pid of [120, 122, 300, 25718]) rows[pid] = plain(overlayRow(component, pid, 60));
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(rows[120]).toMatch(/^[› ]\s+120\s.*\s2d\s.*⚠ stop\?$/);
	expect(rows[122]).toMatch(/^[› ]\s+122\s.*\s12m\s.*● this session$/);
	expect(rows[300]).toMatch(/^[› ]\s+300\s.*\s45s$/);
	expect(rows[25718]).toMatch(/^[› ]\s+25718\s.*\s45s\s.*⚠ stop\?$/);
	for (const line of lines) expect(visibleWidth(line), line).toBeLessThanOrEqual(60);
});

test("moving the cursor to a tagged row shows its command without the marker, cwd, full session id, title and that k stops it", async () => {
	const world: World = {
		ompPs: [],
		processes: [
			{ pid: 801, ppid: 1, command: "/bin/zsh -l -c export OMP_PLUGINS_SESSION='S-old-1234-5678'; python3 -m http.server 8765", env: "OMP_PLUGINS_SESSION=S-old-1234-5678", ports: [8765], cwd: "/work/app/site" },
			{ pid: 802, ppid: 1, command: "node other.js", env: "OMP_PLUGINS_SESSION=S-old-1234-5678", ports: [8766], cwd: "/work/app/other" },
		],
		locks: ["S-now"],
	};
	const h = harness({ world, hasUI: true });
	writeSessionFile(h.home, "--work-app--", "S-old-1234-5678", `${titleRecord("Serve the docs site")}\n`);
	let pane = "";
	h.scripts.push(component => {
		moveTo(component, 801);
		pane = component.render(120).map(plain).join("\n");
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(pane).toMatch(/^\s+command\s+python3 -m http\.server 8765$/m);
	expect(pane).toMatch(/^\s+cwd\s+\/work\/app\/site$/m);
	expect(pane).toMatch(/^\s+session\s+S-old-1234-5678\s+Serve the docs site$/m);
	expect(pane).toMatch(/^\s+origin\s+tagged/m);
	expect(pane).toMatch(/^\s+stop\s+k stops it$/m);
	expect(pane).not.toContain("OMP_PLUGINS_SESSION");
});

test("the detail pane follows the cursor from one row to the next", async () => {
	const world: World = {
		ompPs: [],
		processes: [
			{ pid: 801, ppid: 1, command: "node first.js", env: "OMP_PLUGINS_SESSION=S-old", ports: [8765], cwd: "/work/app/first" },
			{ pid: 802, ppid: 1, command: "node second.js", env: "OMP_PLUGINS_SESSION=S-old", ports: [8766], cwd: "/work/app/second" },
		],
		locks: ["S-now"],
	};
	const h = harness({ world, hasUI: true });
	const panes: string[] = [];
	h.scripts.push(component => {
		moveTo(component, 801);
		panes.push(component.render(120).map(plain).join("\n"));
		component.handleInput?.(KEYS.down);
		panes.push(component.render(120).map(plain).join("\n"));
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(panes[0]).toMatch(/^\s+command\s+node first\.js$/m);
	expect(panes[1]).toMatch(/^\s+command\s+node second\.js$/m);
	expect(panes[1]).toMatch(/^\s+cwd\s+\/work\/app\/second$/m);
	expect(panes[1]).not.toMatch(/^\s+command\s+node first\.js$/m);
});

test("a row of unknown origin says in the detail pane that it is view-only", async () => {
	const h = harness({ hasUI: true });
	let pane = "";
	h.scripts.push(component => {
		moveTo(component, 300);
		pane = component.render(120).map(plain).join("\n");
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(pane).toMatch(/^\s+command\s+postgres -D data$/m);
	expect(pane).toMatch(/^\s+cwd\s+\/var\/db$/m);
	expect(pane).toMatch(/^\s+session\s+-$/m);
	expect(pane).toMatch(/^\s+origin\s+unknown$/m);
	expect(pane).toMatch(/^\s+stop\s+view-only: not started by OMP as far as can be proven$/m);
	expect(pane).not.toContain("k stops it");
});

test("a group header row keeps the detail pane's space blank, so the overlay does not resize", async () => {
	const h = harness({ hasUI: true });
	let withRow: string[] = [];
	let onHeader: string[] = [];
	h.scripts.push(component => {
		withRow = component.render(120).map(plain);
		component.handleInput?.(KEYS.up);
		onHeader = component.render(120).map(plain);
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(withRow.join("\n")).toMatch(/^\s+command\s/m);
	expect(onHeader.join("\n")).toMatch(/^› ▾ /m);
	expect(onHeader.join("\n")).not.toMatch(/^\s+(command|cwd|origin|stop)\s/m);
	expect(onHeader.join("\n")).not.toContain("─");
	expect(onHeader).toHaveLength(withRow.length);
});

test("the detail pane fits a 60-column overlay", async () => {
	const h = harness({ world: longCommandWorld(), hasUI: true });
	const lines: string[] = [];
	h.scripts.push(component => {
		moveTo(component, 25718);
		lines.push(...component.render(60).map(plain));
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(lines.some(line => /^\s+command\s/.test(line))).toBe(true);
	for (const line of lines) expect(visibleWidth(line), line).toBeLessThanOrEqual(60);
});

test("within a group, Stop Candidates sort above live rows, then by port count, then by pid", async () => {
	const h = harness({ world: liveWorld() });
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	const inApp = [...rows].filter(([, row]) => row.group === "app (this project)").map(([pid]) => pid);
	expect(inApp).toEqual([120, 100, 122, 130]);
});

test("the summary counts what is tracked, what is suggested to stop and what holds a port, leaving Kept Processes out of both", async () => {
	const listing = harness({ world: keptWorld() });
	await listing.runProcs();
	expect(listing.notifications.at(-1)!.text).toContain("5 tracked · 2 suggested to stop · 1 holding a port");

	const overlay = harness({ world: keptWorld(), hasUI: true });
	overlay.scripts.push(component => component.handleInput?.(KEYS.enter));
	await overlay.runProcs();
	expect(plain(overlay.screens[0]!.join("\n"))).toContain("5 tracked · 2 suggested to stop · 1 holding a port");
});

test("the plain-text listing, the switch prompt and the next-start notice carry the badges uncoloured", async () => {
	const listing = harness({ world: keptWorld() });
	await listing.runProcs();
	const text = listing.notifications.at(-1)!.text;
	const rows = parseListing(text);
	expect(rows.get(502)!.line).toEndWith("⚠ stop?");
	expect(rows.get(500)!.line).toEndWith("📌 kept");
	expect(text).not.toMatch(/<\/?(?:warning|accent)>/);

	const switching = harness({ world: { ...keptWorld(), locks: ["S-next"] }, hasUI: true, session: "S-prev" });
	await switching.startSession();
	await switching.fire("session_switch", { reason: "new" }, switching.ctxFor("S-next"));
	expect(switching.selects[0]!.title).toContain("⚠ stop?");

	const home = mkdtempSync(path.join(os.tmpdir(), "omp-process-monitor-home-"));
	directories.push(home);
	const first = harness({ home, world: keptWorld(), session: "S-prev" });
	await first.startSession();
	await first.fire("session_shutdown");
	const second = harness({ home, world: { ...keptWorld(), locks: ["S-new"] }, session: "S-new" });
	await second.startSession();
	const notice = second.notifications.find(note => note.level === "warning")!;
	expect(notice.text.split("\n").find(line => /^\s+502\s/.test(line))).toEndWith("⚠ stop?");
	expect(notice.text).not.toMatch(/<\/?(?:warning|accent)>/);
	expect(notice.text).not.toContain("📌 kept");
});

test("the detail pane of a Stop Candidate says why: session ended, last active, ports held and not kept", async () => {
	const world: World = {
		ompPs: [],
		processes: [
			{ pid: 811, ppid: 1, command: "node first.js", env: "OMP_PLUGINS_SESSION=S-old", ports: [8765] },
			{ pid: 812, ppid: 1, command: "node second.js", env: "OMP_PLUGINS_SESSION=S-gone" },
		],
		locks: ["S-now"],
	};
	const h = harness({ world, hasUI: true });
	const file = writeSessionFile(h.home, "--work-app--", "S-old", `${titleRecord("Serve the docs site")}\n`);
	const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000 - 60_000);
	utimesSync(file, threeDaysAgo, threeDaysAgo);
	const panes: string[] = [];
	h.scripts.push(component => {
		moveTo(component, 811);
		panes.push(component.render(120).map(plain).join("\n"));
		moveTo(component, 812);
		panes.push(component.render(120).map(plain).join("\n"));
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(panes[0]).toMatch(/^\s+why\s+session ended \(last active 3d ago\) · holds :8765 · not kept$/m);
	expect(panes[1]).toMatch(/^\s+why\s+session ended · not kept$/m);
});

test("the detail pane of a Kept Process says it is not suggested, and a live row has no why line", async () => {
	const h = harness({ world: { ...keptWorld(), processes: [...keptWorld().processes, { pid: 124, ppid: 1, command: "node live.js", env: "OMP_PLUGINS_SESSION=S-now", ports: [3200] }] }, hasUI: true });
	const panes: string[] = [];
	h.scripts.push(component => {
		moveTo(component, 500);
		panes.push(component.render(120).map(plain).join("\n"));
		moveTo(component, 124);
		panes.push(component.render(120).map(plain).join("\n"));
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(panes[0]).toMatch(/^\s+why\s+started in persist or detached mode, so it is not suggested$/m);
	expect(panes[1]).toMatch(/^\s+command\s+node live\.js$/m);
	expect(panes[1]).not.toMatch(/^\s+why\s/m);
});

/** Two plain leftovers of S-prev that Close all lists, plus one that becomes a Kept Process while the prompt is open. */
function closeAllWorld(persist: boolean): World {
	return {
		ompPs: [{ kind: "project", projectDir: "/work/app", brokerPid: 900, daemons: [{ name: "scratch", pid: 502, state: "ready", owner: "S-prev", persist, command: "python3 -m http.server" }] }],
		processes: [
			{ pid: 123, ppid: 1, command: "node worker.js", env: "OMP_PLUGINS_SESSION=S-prev" },
			{ pid: 124, ppid: 1, command: "node api.js", env: "OMP_PLUGINS_SESSION=S-prev", ports: [4000] },
			{ pid: 125, ppid: 1, command: "node gone.js", env: "OMP_PLUGINS_SESSION=S-prev" },
			{ pid: 502, ppid: 1, command: "python3 -m http.server", ports: [8000] },
			{ pid: 900, ppid: 1, command: "/bin/omp __omp_worker_daemon_broker" },
		],
		locks: ["S-next"],
	};
}

test("Close all skips a process that went away, changed its command or became a Kept Process while the prompt was open, and reports each", async () => {
	const h = harness({ world: closeAllWorld(false), hasUI: true, session: "S-prev" });
	await h.startSession();
	h.onSelect.push(() => {
		h.world.processes = h.world.processes.filter(p => p.pid !== 125).map(p => (p.pid === 123 ? { ...p, command: "node something-else.js" } : p));
		h.world.ompPs = closeAllWorld(true).ompPs;
	});
	await h.fire("session_switch", { reason: "new" }, h.ctxFor("S-next"));
	expect(h.selects).toHaveLength(1);
	expect(h.selects[0]!.title).toContain("123");
	expect(h.selects[0]!.title).toContain("502");
	expect(killsIn(h)).toEqual(["kill -TERM 124"]);
	const failure = h.notifications.find(note => note.level === "error")!;
	expect(failure.text).toMatch(/pid 123 is gone or no longer the same process/);
	expect(failure.text).toMatch(/pid 125 is gone or no longer the same process/);
	expect(failure.text).toMatch(/pid 502 is now a kept process/);
	expect(failure.text).not.toContain("pid 124");
});

test("at 60 columns a current-session row with many ports keeps its whole name and badge: the command, ports and session column give way first", async () => {
	const world: World = {
		ompPs: [],
		processes: [{ pid: 122, ppid: 1, command: "node invoice-webhooks.js", env: "OMP_PLUGINS_SESSION=S-now", ports: Array.from({ length: 13 }, (_, index) => 3000 + index), etime: "12:34" }],
		locks: ["S-now"],
	};
	const h = harness({ world, hasUI: true });
	let wide = "";
	let narrow = "";
	let header = "";
	h.scripts.push(component => {
		wide = plain(overlayRow(component, 122, 120));
		narrow = plain(overlayRow(component, 122, 60));
		header = component.render(60).map(plain).find(line => /PID\s+PORTS/.test(line))!;
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	expect(wide).toContain("S-now");
	expect(wide).toContain(":3000,:3001,+11");
	expect(wide).toEndWith("● this session");
	expect(narrow).toEndWith("● this session");
	expect(narrow).toContain("invoice-webhooks");
	expect(narrow).toContain(":3000,+12");
	expect(narrow).toContain("12m");
	expect(narrow).not.toContain("S-now");
	expect(visibleWidth(narrow)).toBeLessThanOrEqual(60);
	expect(header).toMatch(/PID\s+PORTS\s+NAME\s+AGE\s+STATE$/);
});

test("the overlay never renders more lines than the terminal has, and does not resize as the cursor moves", async () => {
	const heights = async (terminalRows: number) => {
		const h = harness({ hasUI: true, terminalRows });
		const seen: number[] = [];
		let first = "";
		h.scripts.push(component => {
			first = plain(component.render(120).join("\n"));
			for (let step = 0; step < 12; step++) {
				seen.push(component.render(120).length);
				component.handleInput?.(KEYS.down);
			}
			component.handleInput?.(KEYS.enter);
		});
		await h.runProcs();
		return { seen, first };
	};
	const roomy = await heights(40);
	expect(new Set(roomy.seen).size).toBe(1);
	expect(roomy.first).toMatch(/^\s+command\s/m);
	for (const terminalRows of [16, 12]) {
		const short = await heights(terminalRows);
		expect(Math.max(...short.seen), `rows ${terminalRows}`).toBeLessThanOrEqual(terminalRows);
		expect(short.first).not.toMatch(/^\s+command\s/m);
	}
	expect((await heights(12)).first).toMatch(/\d+-\d+ of 10/);
});

test("an id with no session file is not looked for again for five minutes", async () => {
	const h = harness();
	const start = Date.now();
	try {
		await h.runProcs();
		writeSessionFile(h.home, "--work-app--", "S-old", `${titleRecord("Written later")}\n`);
		setSystemTime(new Date(start + 4 * 60_000));
		await h.runProcs();
		expect(parseListing(h.notifications.at(-1)!.text).get(120)!.line).not.toContain("Written later");
		setSystemTime(new Date(start + 5 * 60_000 + 1000));
		await h.runProcs();
		expect(parseListing(h.notifications.at(-1)!.text).get(120)!.line).toContain("Written later");
	} finally {
		setSystemTime();
	}
});

test("a session header that carries a title shows it, a header without one shows the short id, and only the first line counts", async () => {
	const h = harness();
	writeSessionFile(h.home, "--work-app--", "S-old", `${JSON.stringify({ type: "session", version: 3, id: "S-old", title: "Header title" })}\n{"type":"title","title":"Second line title"}\n`);
	writeSessionFile(h.home, "--work-app--", "S-dead", `${JSON.stringify({ type: "session", version: 3, id: "S-dead", title: "  " })}\n`);
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	expect(rows.get(120)!.line).toContain("Header title");
	expect(rows.get(201)!.line).toContain("S-dead");
	expect(text).not.toContain("Second line title");
});

test("package-manager scripts, compound shell payloads and flags that take a value are named after what runs", async () => {
	const cases: [command: string, name: string][] = [
		["npm run dev", "npm run dev"],
		["pnpm dev", "pnpm dev"],
		["pnpm run dev", "pnpm dev"],
		["yarn dev", "yarn dev"],
		["node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs dev", "pnpm dev"],
		["node /usr/local/lib/node_modules/yarn/bin/yarn.js dev", "yarn dev"],
		["bun run dev", "bun run dev"],
		["deno task dev", "deno task dev"],
		["bun run server.ts", "server"],
		["node --import tsx server.ts", "server"],
		["node -r dotenv/config server.js", "server"],
		["bun --cwd apps/web dev", "bun dev"],
		["/bin/bash -lc cd /work/app && bun run dev", "bun run dev"],
		["/bin/zsh -c export OMP_PLUGINS_SESSION='S-old'; cd /work/app && pnpm dev --port 3001", "pnpm dev"],
	];
	const world: World = {
		ompPs: [],
		processes: cases.map(([command], index) => ({ pid: 1000 + index, ppid: 1, command, env: "OMP_PLUGINS_SESSION=S-old", ports: [7000 + index] })),
		locks: ["S-now"],
	};
	const h = harness({ world });
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	const names = cases.map(([command], index) => [command, rows.get(1000 + index)!.line.split(/\s{2,}/)[2]]);
	expect(names).toEqual(cases.map(([command, name]) => [command, name]));
});

test("a daemon omp ps lists as exited or failed no longer claims its pid, so a reused pid is neither supervised nor suggested", async () => {
	const world: World = {
		ompPs: [
			{
				kind: "project",
				projectDir: "/work/app",
				brokerPid: 900,
				daemons: [
					{ name: "old-web", pid: 650, state: "exited", owner: "S-old", command: "vite" },
					{ name: "old-api", pid: 651, state: "failed", owner: "S-old", command: "node api.js" },
					{ name: "live-web", pid: 652, state: "ready", owner: "S-old", command: "vite --port 5173" },
				],
			},
		],
		processes: [
			{ pid: 650, ppid: 1, command: "postgres -D data", ports: [5432] },
			{ pid: 651, ppid: 1, command: "sleep 100" },
			{ pid: 652, ppid: 1, command: "vite --port 5173", ports: [5173] },
			{ pid: 900, ppid: 1, command: "/bin/omp __omp_worker_daemon_broker" },
		],
		locks: ["S-now"],
	};
	const h = harness({ world });
	await h.startSession();
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	expect(rows.get(650)).toMatchObject({ group: "Unknown origin (view-only)" });
	expect(rows.get(650)!.line).toContain("postgres");
	expect(rows.get(650)!.line).not.toContain("old-web");
	expect(rows.get(650)!.line).not.toContain("stop?");
	expect(rows.has(651)).toBe(false);
	expect(rows.get(652)!.line).toEndWith("⚠ stop?");
	expect(text).toContain("3 tracked · 1 suggested to stop · 1 holding a port");
	expect(h.segments.at(-1)).toBe("⚠ 1 ports");
});
