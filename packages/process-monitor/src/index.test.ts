import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { visibleWidth, type Component } from "@oh-my-pi/pi-tui";
import { CHANNEL, type SharedDisplayEvents } from "@codesook/omp-shared-display/client";
import processMonitor, { REFRESH_MS, type Timers } from "./index.ts";

type Handler = (event: unknown, context: ExtensionContext) => unknown;
type Listing = { pid: number; ppid: number; command: string; env?: string; ports?: number[]; cwd?: string };
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
			{ pid: 120, ppid: 1, command: "node server.js", env: "OMP_PLUGINS_SESSION=S-old", ports: [3000], cwd: "/work/app/apps/web" },
			{ pid: 121, ppid: 120, command: "node child.js", env: "OMP_PLUGINS_SESSION=S-old" },
			{ pid: 122, ppid: 1, command: "vite --port 5173", env: "OMP_PLUGINS_SESSION=S-now", ports: [5173], cwd: "/work/app" },
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

function harness(options: { world?: World; home?: string; hasUI?: boolean; config?: unknown; session?: string } = {}) {
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
		if (line === "/bin/ps -axww -o pid=,ppid=,command=")
			return world.psFails ? { code: 1, stdout: "", stderr: "ps: not permitted", killed: false } : out(world.processes.map(p => `${p.pid} ${p.ppid} ${p.command}`).join("\n"));
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
	const ui = {
		notify: (text: string, level?: string) => { notifications.push({ text, level }); },
		setStatus: (_key: string, text: string | undefined) => { statuses.push(text); },
		confirm: async (title: string, message: string) => { log.push("confirm"); confirms.push({ title, message }); return answers.confirm; },
		select: async (title: string, choices: unknown[]) => { selects.push({ title, options: choices }); return answers.select; },
		custom: <T>(factory: (tui: unknown, theme: unknown, keys: unknown, done: (value: T) => void) => Component): Promise<T> => {
			const { promise, resolve } = Promise.withResolvers<T>();
			const component = factory({ requestRender() {}, terminal: { rows: 40 } }, { fg: (_c: string, t: string) => t, bold: (t: string) => t }, {}, resolve);
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
	return { home, world, calls, log, notifications, statuses, confirms, selects, screens, scripts, answers, segments, timers: { intervals, cleared }, idle, ui, ctxFor, fire, startSession, runProcs, settle, endedDir, handlers, commands };
}

type Harness = ReturnType<typeof harness>;

function parseListing(text: string): Map<number, { group: string; line: string }> {
	const rows = new Map<number, { group: string; line: string }>();
	let group = "";
	for (const line of text.split("\n")) {
		const row = /^\s+(\d+)\s{2}/.exec(line);
		if (row) rows.set(Number(row[1]), { group, line: line.trim() });
		else if (/^\S.* \(\d+\)$/.test(line)) group = line.replace(/ \(\d+\)$/, "");
	}
	return rows;
}

function moveTo(component: Component, pid: number): void {
	for (let step = 0; step < 40; step++) {
		const cursor = component.render(120).find(line => line.startsWith("›"));
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

	expect(rows.get(100)).toMatchObject({ group: "This project (/work/app)" });
	expect(rows.get(100)!.line).toContain("S-old");
	expect(rows.get(100)!.line).not.toContain("S-tagged");
	expect(rows.get(120)).toMatchObject({ group: "This project (/work/app)" });
	expect(rows.get(110)).toMatchObject({ group: "OMP internals" });
	expect(rows.get(900)).toMatchObject({ group: "OMP internals" });
	expect(rows.get(950)).toMatchObject({ group: "OMP internals" });
	expect(rows.get(300)).toMatchObject({ group: "Unknown origin (view-only)" });
	expect(rows.has(121)).toBe(false);
	expect(text).not.toContain("hunter2");
	expect(text).not.toContain("HOME=");
});

test("leftover marks processes whose session holds no owner lock, including a scope whose broker exited", async () => {
	const h = harness();
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	expect(rows.get(100)!.line).toEndWith("⚠ leftover");
	expect(rows.get(120)!.line).toEndWith("⚠ leftover");
	expect(rows.get(201)).toMatchObject({ group: "/work/other" });
	expect(rows.get(201)!.line).toEndWith("⚠ leftover");
	expect(rows.get(200)!.line).toEndWith("⚠ leftover");
	expect(rows.get(122)!.line).toContain("this session");
	expect(rows.get(122)!.line).not.toContain("leftover");
	expect(rows.get(300)!.line).not.toContain("leftover");
	expect(killsIn(h)).toEqual([]);
});

test("a session whose lock file exists but is held by no process is ended", async () => {
	const h = harness({ world: { ...defaultWorld(), staleLocks: ["S-old"] } });
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	for (const pid of [100, 120]) expect(rows.get(pid)!.line).toEndWith("⚠ leftover");
	expect(text).not.toContain("Session owner locks unreadable");
});

test("a held lock keeps its session live and the current session is live without any lock", async () => {
	const h = harness({ world: { ...defaultWorld(), locks: ["S-old"] } });
	await h.runProcs();
	const rows = parseListing(h.notifications.at(-1)!.text);
	for (const pid of [100, 120]) expect(rows.get(pid)!.line).not.toContain("leftover");
	expect(rows.get(122)!.line).toContain("this session");
	expect(rows.get(122)!.line).not.toContain("leftover");
});

test("with no owner lock directory at all, tagged and supervised processes are still leftovers", async () => {
	const h = harness({ world: { ...defaultWorld(), locks: [], lockDirMissing: true } });
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	for (const pid of [100, 120, 201]) expect(rows.get(pid)!.line).toEndWith("⚠ leftover");
	expect(rows.get(122)!.line).not.toContain("leftover");
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
	expect(text).toContain("1 tracked, 1 leftover (1 holding ports)");
	expect(parseListing(text).get(777)!.line).toEndWith("⚠ leftover");
	await h.startSession();
	expect(h.segments.at(-1)).toBe("⚠ 1 ports");
});

test("when lsof cannot see the current session's own lock, sessions that have a lock file are not called ended", async () => {
	const h = harness({ world: { ...defaultWorld(), locks: [], staleLocks: ["S-now", "S-old"] } });
	await h.runProcs();
	const text = h.notifications.at(-1)!.text;
	const rows = parseListing(text);
	for (const pid of [100, 120]) expect(rows.get(pid)!.line).not.toContain("leftover");
	expect(rows.get(201)!.line).toEndWith("⚠ leftover");
	expect(text).toContain("Session owner locks unreadable");
});

test("the overlay opens read-only, keeps OMP internals collapsed until expanded, and closes with Enter", async () => {
	const h = harness({ hasUI: true });
	h.scripts.push(component => {
		const before = component.render(120).join("\n");
		expect(before).toContain("▸ OMP internals (3)");
		expect(before).not.toContain("__omp_worker_text_predict");
		moveTo(component, 300);
		component.handleInput?.(KEYS.up);
		component.handleInput?.(KEYS.up);
		component.handleInput?.(KEYS.space);
		expect(component.render(120).join("\n")).toContain("__omp_worker_text_predict");
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
		afterUnknown = component.render(120).join("\n");
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

const LONG_COMMAND = 'bun -e Bun.serve({port:0,fetch:()=>new Response("x")});setInterval(()=>{},1e6) --padding-so-the-command-cannot-fit-any-reasonable-terminal';

function longCommandWorld(): World {
	const world = defaultWorld();
	world.processes.push({ pid: 25718, ppid: 1, command: LONG_COMMAND, env: "OMP_PLUGINS_SESSION=verify-demo", ports: [56561] });
	return world;
}

test("the overlay row keeps the leftover marker whole and truncates only the command at any width", async () => {
	const h = harness({ world: longCommandWorld(), hasUI: true });
	const rowAt: Record<number, string> = {};
	h.scripts.push(component => {
		for (const width of [120, 60]) {
			const row = component.render(width).find(line => line.includes("25718"));
			rowAt[width] = row ?? "";
		}
		component.handleInput?.(KEYS.enter);
	});
	await h.runProcs();
	for (const width of [120, 60]) {
		const row = rowAt[width]!;
		expect(row, `row at ${width}`).toEndWith("⚠ leftover");
		expect(row).toContain("…");
		expect(row).toContain(":56561");
		expect(row).toContain("…ify-demo");
		expect(visibleWidth(row)).toBeLessThanOrEqual(width);
	}
	expect(rowAt[120]).not.toContain("padding-so-the-command");
});

test("the no-UI listing and the next-start notice keep the leftover marker on the row's own line", async () => {
	const listing = harness({ world: longCommandWorld() });
	await listing.runProcs();
	const listed = parseListing(listing.notifications.at(-1)!.text).get(25718)!.line;
	expect(listed).toEndWith("⚠ leftover");
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
	expect(row).toEndWith("⚠ leftover");
	expect(row).toContain("…");
	expect(visibleWidth(row)).toBeLessThanOrEqual(100);
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
