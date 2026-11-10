import { isRecord } from "@codesook/omp-shared-display/config-store";

/** A process OMP can account for, and how the monitor knows it. */
export type Origin =
	| { kind: "supervised"; daemon: string; owner?: string; kept: boolean }
	| { kind: "tagged"; session: string }
	| { kind: "internal"; role: string }
	| { kind: "unknown" };

export type TrackedProcess = {
	pid: number;
	ppid: number;
	/** Raw `ps` command. The PID re-check before a stop compares this. */
	command: string;
	/** `command` without the ADR-0010 marker and shell wrapper; the only form shown to users. */
	displayCommand: string;
	/** Supervised daemon name, else derived from `displayCommand`. */
	name: string;
	ports: number[];
	project?: string;
	/** Working directory from lsof; absent when lsof could not read it. */
	cwd?: string;
	/** Seconds since the process started, from `ps` etime; absent when `ps` printed something unreadable. */
	elapsedSeconds?: number;
	origin: Origin;
	session?: string;
	sessionEnded: boolean;
};

/** Only processes OMP can prove it started may be killed from `/procs`. */
export const KILLABLE: Record<Origin["kind"], boolean> = {
	supervised: true,
	tagged: true,
	internal: false,
	unknown: false,
};

export const isKillable = (process: TrackedProcess): boolean => KILLABLE[process.origin.kind];

/** A Kept Process is a supervised daemon its owner marked `persist` or `detached` in `omp ps`; a tagged process can never be one. */
export const isKept = (process: TrackedProcess): boolean => process.origin.kind === "supervised" && process.origin.kept;

/** A Stop Candidate is a killable Leftover Process that is not kept. Holding a port is not required. */
export const isStopCandidate = (process: TrackedProcess): boolean => isKillable(process) && process.sessionEnded && !isKept(process);

export type Standing = "current" | "live" | "kept" | "stopCandidate" | "viewOnly";

export function standingOf(process: TrackedProcess, currentSession: string | undefined): Standing {
	if (!isKillable(process)) return "viewOnly";
	if (process.sessionEnded) return isKept(process) ? "kept" : "stopCandidate";
	return process.session !== undefined && process.session === currentSession ? "current" : "live";
}

/** What the status segment shows: Stop Candidates that hold a port. */
export const stopCandidatePortCount = (processes: readonly TrackedProcess[]): number => processes.filter(process => isStopCandidate(process) && process.ports.length > 0).length;

export type ProcessGroup = {
	id: string;
	/** The folder name for a project, else the fixed title of a special group. */
	title: string;
	/** The project's full path; absent for groups that are not a project. */
	path?: string;
	current: boolean;
	collapsed: boolean;
	rows: TrackedProcess[];
};

/** What the monitor knows about an Agent Session from its OMP session file; both parts are optional because every read may fail. */
export type SessionInfo = { title?: string; lastActive?: Date };

/** Raw exec outputs. Every source except the process table may be missing; the snapshot then says what it could not tell. */
export type SnapshotInputs = {
	processTable: string;
	ompPs?: string;
	environTable?: string;
	listeners?: string;
	cwds?: string;
	lockFiles?: string;
	heldLocks?: string;
	currentSession?: string;
	currentProject: string;
	/** Per session id; read outside the snapshot so `buildSnapshot` stays pure. */
	sessions?: ReadonlyMap<string, SessionInfo>;
};

export type Snapshot = {
	processes: TrackedProcess[];
	groups: ProcessGroup[];
	notes: string[];
	sessions: ReadonlyMap<string, SessionInfo>;
};

const MARKER_VARIABLE = "OMP_PLUGINS_SESSION";
export const SESSION_ID = /^[\w.-]+$/;
const MARKER_PREFIX = new RegExp(`^export ${MARKER_VARIABLE}='[^']*'; `);

/** ADR-0010. Ids outside the shell-safe set are left untagged rather than quoted. */
export function withSessionMarker(command: string, sessionId: string): string {
	if (!SESSION_ID.test(sessionId)) return command;
	return `export ${MARKER_VARIABLE}='${sessionId}'; ${command.replace(MARKER_PREFIX, "")}`;
}

const WORKER = /\bomp __omp_worker_(\w+)/;

const SHELL_WRAPPER = /^(?:\S*\/)?(?:sh|bash|zsh)\s+(?:-l\s+-c|-lc|-c)\s+/;
const INTERPRETER = /^(?:node|bun|deno|python[\d.]*)$/;
const PACKAGE_RUNNER = /^(?:bunx|npx|pnpx)$/;
const PACKAGE_MANAGER = /^(?:npm|pnpm|yarn)$/;
const EVAL_FLAG = /^(?:-[epc]|--eval|--print)$/;
const VALUE_FLAG = /^(?:-r|--require|--import|--loader|--experimental-loader|--env-file|--cwd|-C|--config|--inspect-port)$/;
const PACKAGE_MANAGER_VALUE_FLAG = /^(?:--cwd|-C|--prefix|--filter)$/;
const SCRIPT_EXTENSION = /\.(?:[cm]?js|ts|py)$/;
const SUBCOMMAND = /^[A-Za-z][\w:-]*$/;
const CHANGE_DIRECTORY = /^cd(?:\s|$)/;
const BIN_DIRECTORY = "node_modules/.bin/";

/** An executable inside a macOS bundle is named after the innermost bundle; a path with spaces cannot be split on whitespace. */
const BUNDLE_EXECUTABLE = /^(?:\/.*\/)?([^/]+)\.(?:app|appex)\/Contents\/MacOS\//;

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const isScriptFile = (arg: string): boolean => SCRIPT_EXTENSION.test(arg) || arg.includes("/");

/** `next dev`: a package bin plus the subcommand that directly follows it. */
const binName = (bin: string, rest: readonly string[]): string => (rest[0] !== undefined && SUBCOMMAND.test(rest[0]) ? `${bin} ${rest[0]}` : bin);

/** Index of the first argument that is neither a flag nor a flag's value, or -1. */
function positionalIndex(args: readonly string[], valueFlag: RegExp, from = 0): number {
	for (let index = from; index < args.length; index++) {
		const arg = args[index]!;
		if (valueFlag.test(arg)) index++;
		else if (!arg.startsWith("-")) return index;
	}
	return -1;
}

function runnerName(args: readonly string[]): string | undefined {
	const index = args.findIndex(arg => !arg.startsWith("-"));
	return index < 0 ? undefined : binName(basename(args[index]!), args.slice(index + 1));
}

/** `pnpm dev` for `pnpm run dev` too; npm keeps `run` because `npm dev` is not a command. */
function packageManagerName(manager: string, args: readonly string[]): string {
	const first = positionalIndex(args, PACKAGE_MANAGER_VALUE_FLAG);
	if (first < 0) return manager;
	const ran = args[first] === "run" || args[first] === "run-script";
	const script = ran ? args[positionalIndex(args, PACKAGE_MANAGER_VALUE_FLAG, first + 1)] : args[first];
	if (script === undefined) return manager;
	return manager === "npm" && ran ? `npm run ${script}` : `${manager} ${script}`;
}

/** A script file is named after the file, a package manager after the manager and its script, a package bin after the bin and subcommand. */
function scriptName(program: string, entry: string, after: readonly string[]): string {
	const script = basename(entry);
	const name = script.replace(SCRIPT_EXTENSION, "");
	if (PACKAGE_MANAGER.test(name)) return packageManagerName(name, after);
	if (entry.includes(BIN_DIRECTORY)) return binName(script, after);
	return /^\.*$/.test(name) ? program : name;
}

/** `entry` is the first argument that is not a flag. For bun and deno, anything that is not a script file is a subcommand or a package script. */
function entryName(program: string, [entry = "", ...after]: readonly string[]): string {
	const runtime = program === "bun" || program === "deno";
	if (program === "bun" && entry === "x") return runnerName(after) ?? program;
	if (program === "deno" && entry === "task") {
		const task = after[positionalIndex(after, VALUE_FLAG)];
		return task === undefined ? program : `deno task ${task}`;
	}
	if (runtime && entry === "run") {
		const at = positionalIndex(after, VALUE_FLAG);
		if (at < 0) return program;
		const target = after[at]!;
		return program === "bun" && !isScriptFile(target) ? `bun run ${target}` : scriptName(program, target, after.slice(at + 1));
	}
	return runtime && !isScriptFile(entry) ? `${program} ${entry}` : scriptName(program, entry, after);
}

function interpreterName(program: string, args: readonly string[]): string {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (EVAL_FLAG.test(arg)) return program;
		if (arg === "-m") return args[index + 1] ?? program;
		if (VALUE_FLAG.test(arg)) index++;
		else if (!arg.startsWith("-")) return entryName(program, args.slice(index));
	}
	return program;
}

/** The program a user would recognise: the executable, or what an interpreter or package runner was asked to run. */
function programName(displayCommand: string): string {
	const bundle = BUNDLE_EXECUTABLE.exec(displayCommand)?.[1];
	if (bundle) return bundle;
	const [executable = "", ...args] = displayCommand.split(/\s+/);
	const program = basename(executable);
	if (PACKAGE_MANAGER.test(program)) return packageManagerName(program, args);
	if (executable.includes(BIN_DIRECTORY)) return binName(program, args);
	if (PACKAGE_RUNNER.test(program)) return runnerName(args) ?? program;
	return INTERPRETER.test(program) ? interpreterName(program, args) : program;
}

/** Splits a shell payload at `&&`, `||` and `;` outside quotes. */
function shellSegments(payload: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: string | undefined;
	for (let index = 0; index < payload.length; index++) {
		const char = payload[index]!;
		if (quote) {
			if (char === quote) quote = undefined;
		} else if (char === "'" || char === '"') {
			quote = char;
		} else {
			const width = payload.startsWith("&&", index) || payload.startsWith("||", index) ? 2 : char === ";" ? 1 : 0;
			if (width > 0) {
				segments.push(current);
				current = "";
				index += width - 1;
				continue;
			}
		}
		current += char;
	}
	segments.push(current);
	return segments.map(segment => segment.trim()).filter(segment => segment !== "");
}

/** The command a compound shell payload runs last, skipping `cd <dir>` steps: `cd /work/app && bun run dev` runs `bun run dev`. */
function lastCommand(payload: string): string {
	const segments = shellSegments(payload);
	return segments.filter(segment => !CHANGE_DIRECTORY.test(segment)).at(-1) ?? segments.at(-1) ?? payload;
}

/**
 * Pure. Strips the session marker and a `sh -c` style wrapper, then names the program that remains. Only a wrapped
 * payload is a shell script whose `;` and `&&` separate commands; a bare command's own arguments are never split.
 */
export function describeCommand(command: string): { name: string; displayCommand: string } {
	const unwrapped = command.replace(SHELL_WRAPPER, "");
	const displayCommand = unwrapped.replace(MARKER_PREFIX, "").trim() || command;
	const named = unwrapped === command ? displayCommand : lastCommand(displayCommand);
	return { name: programName(named) || displayCommand, displayCommand };
}
/** `ended` is a terminal broker state: the daemon no longer runs, so a process on its recorded pid is a reused pid and not attributed. */
type Daemon = { name: string; pid?: number; owner?: string; command?: string; kept: boolean; ended: boolean };
type Scope = { projectDir?: string; brokerPid?: number; daemons: Daemon[] };

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const integer = (value: unknown): number | undefined => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined);

/** `omp ps --all --json`: only the fields attribution needs. The daemon spec file is never read. */
export function parseOmpPs(raw: string): Scope[] | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed)) return undefined;
	return parsed.filter(isRecord).map(scope => ({
		projectDir: scope.kind === "project" ? text(scope.projectDir) : undefined,
		brokerPid: integer(scope.brokerPid),
		daemons: (Array.isArray(scope.daemons) ? scope.daemons : []).filter(isRecord).map(daemon => ({
			name: text(daemon.name) ?? "daemon",
			pid: integer(daemon.pid),
			owner: text(daemon.owner),
			command: text(daemon.command),
			kept: daemon.persist === true || daemon.detached === true,
			ended: daemon.state === "exited" || daemon.state === "failed",
		})),
	}));
}

type ProcessEntry = { ppid: number; command: string; elapsedSeconds?: number };

/** `ps` etime, `[[dd-]hh:]mm:ss`. */
const ELAPSED = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/;

function parseElapsed(raw: string): number | undefined {
	const match = ELAPSED.exec(raw);
	if (!match) return undefined;
	const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
	return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

function parseProcessTable(raw: string): Map<number, ProcessEntry> {
	const table = new Map<number, ProcessEntry>();
	for (const line of raw.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*\S)\s*$/.exec(line);
		if (!match) continue;
		const elapsedSeconds = parseElapsed(match[3]!);
		table.set(Number(match[1]), { ppid: Number(match[2]), command: match[4]!, ...(elapsedSeconds === undefined ? {} : { elapsedSeconds }) });
	}
	return table;
}

/** Keeps only the marker value from `ps -E` output; no other environment value is retained. */
export function parseSessionTags(raw: string): Map<number, string> {
	const tags = new Map<number, string>();
	const marker = new RegExp(`(?:^|\\s)${MARKER_VARIABLE}=([\\w.-]+)(?=\\s|$)`);
	for (const line of raw.split("\n")) {
		const match = /^\s*(\d+)\s(.*)$/.exec(line);
		const session = match ? marker.exec(match[2]!)?.[1] : undefined;
		if (match && session) tags.set(Number(match[1]), session);
	}
	return tags;
}

const LISTEN_ADDRESS = /^(?:\*|[\d.]+|\[[0-9a-fA-F:.]+\]):(\d+)$/;

function parseListeners(raw: string): Map<number, { name: string; ports: number[] }> {
	const listeners = new Map<number, { name: string; ports: number[] }>();
	let current: { name: string; ports: number[] } | undefined;
	for (const line of raw.split("\n")) {
		if (line.startsWith("p")) {
			current = { name: "", ports: [] };
			listeners.set(Number(line.slice(1)), current);
		} else if (current && line.startsWith("c")) {
			current.name = line.slice(1);
		} else if (current && line.startsWith("n")) {
			const port = LISTEN_ADDRESS.exec(line.slice(1))?.[1];
			if (port && !current.ports.includes(Number(port))) current.ports.push(Number(port));
		}
	}
	for (const listener of listeners.values()) listener.ports.sort((a, b) => a - b);
	return listeners;
}

function parseCwds(raw: string): Map<number, string> {
	const cwds = new Map<number, string>();
	let pid: number | undefined;
	for (const line of raw.split("\n")) {
		if (line.startsWith("p")) pid = Number(line.slice(1));
		else if (pid !== undefined && line.startsWith("n/")) cwds.set(pid, line.slice(1));
	}
	return cwds;
}

function parseLockFiles(raw: string): Set<string> {
	const ids = new Set<string>();
	for (const line of raw.split("\n")) {
		const id = /^(.+)\.lock$/.exec(line.trim())?.[1];
		if (id) ids.add(id);
	}
	return ids;
}

function parseHeldLocks(raw: string): Set<string> {
	const held = new Set<string>();
	for (const line of raw.split("\n")) {
		const id = /^n.*\/session-owners\/([^/]+)\.lock$/.exec(line)?.[1];
		if (id) held.add(id);
	}
	return held;
}

const projectOf = (directory: string, known: readonly string[]): string =>
	known.filter(parent => directory === parent || directory.startsWith(`${parent}/`)).sort((a, b) => b.length - a.length)[0] ?? directory;

const UNKNOWN_PROJECT = "No project";

/** Current project first, other projects, OMP internals (collapsed), unknown origin. */
export function groupProcesses(processes: readonly TrackedProcess[], currentProject: string): ProcessGroup[] {
	const order = (a: TrackedProcess, b: TrackedProcess): number =>
		Number(isStopCandidate(b)) - Number(isStopCandidate(a)) || b.ports.length - a.ports.length || a.pid - b.pid;
	const byProject = new Map<string, TrackedProcess[]>();
	const internals: TrackedProcess[] = [];
	const unknown: TrackedProcess[] = [];
	for (const process of processes) {
		if (process.origin.kind === "internal") internals.push(process);
		else if (process.origin.kind === "unknown") unknown.push(process);
		else byProject.set(process.project ?? "", [...(byProject.get(process.project ?? "") ?? []), process]);
	}
	const projectGroup = ([project, rows]: [string, TrackedProcess[]]): ProcessGroup => ({
		id: `project:${project}`,
		title: project === "" ? UNKNOWN_PROJECT : project.slice(project.lastIndexOf("/") + 1) || project,
		...(project === "" ? {} : { path: project }),
		current: project === currentProject,
		collapsed: false,
		rows: rows.sort(order),
	});
	const others = [...byProject].filter(([project]) => project !== currentProject);
	others.sort(([a], [b]) => Number(a === "") - Number(b === "") || a.localeCompare(b));
	const current = byProject.has(currentProject) ? [projectGroup([currentProject, byProject.get(currentProject)!])] : [];
	return [
		...current,
		...others.map(projectGroup),
		{ id: "internal", title: "OMP internals", current: false, collapsed: true, rows: internals.sort(order) },
		{ id: "unknown", title: "Unknown origin (view-only)", current: false, collapsed: false, rows: unknown.sort(order) },
	].filter(group => group.rows.length > 0);
}

/**
 * Attribution precedence: supervised launch, then session tag, then OMP internal, then any other
 * listening port holder. An `omp ps` daemon that is an OMP worker stays internal, because it has
 * no Agent Session to be left over from and stopping it breaks OMP.
 */
export function buildSnapshot(inputs: SnapshotInputs): Snapshot {
	const notes: string[] = [];
	const table = parseProcessTable(inputs.processTable);
	const scopes = inputs.ompPs === undefined ? undefined : parseOmpPs(inputs.ompPs);
	if (scopes === undefined) notes.push("omp ps unavailable: supervised launches are not attributed.");
	const tags = inputs.environTable === undefined ? new Map<number, string>() : parseSessionTags(inputs.environTable);
	if (inputs.environTable === undefined) notes.push("Process environment unavailable on this platform: tagged processes are not attributed.");
	const listeners = inputs.listeners === undefined ? new Map<number, { name: string; ports: number[] }>() : parseListeners(inputs.listeners);
	if (inputs.listeners === undefined) notes.push("lsof unavailable: ports are not shown.");
	const cwds = inputs.cwds === undefined ? new Map<number, string>() : parseCwds(inputs.cwds);
	const lockFiles = inputs.lockFiles === undefined ? new Set<string>() : parseLockFiles(inputs.lockFiles);
	const held = inputs.heldLocks === undefined ? new Set<string>() : parseHeldLocks(inputs.heldLocks);
	// The running omp holds its own lock open, so a current-session lock that lsof cannot see means lsof is blind to every lock.
	const holdersUnreadable =
		lockFiles.size > 0 && (inputs.heldLocks === undefined || (inputs.currentSession !== undefined && lockFiles.has(inputs.currentSession) && !held.has(inputs.currentSession)));
	if (holdersUnreadable) notes.push("Session owner locks unreadable: sessions that have a lock file are not marked as left over.");
	// A session with no lock file ended no matter what lsof shows; the lock itself only proves a live owner while a process holds it open.
	const sessionEnded = (id: string): boolean => id !== inputs.currentSession && (!lockFiles.has(id) || (!holdersUnreadable && !held.has(id)));

	const projectDirs = (scopes ?? []).flatMap(scope => (scope.projectDir ? [scope.projectDir] : []));
	const currentProject = projectOf(inputs.currentProject, projectDirs);
	const known = [...new Set([...projectDirs, currentProject])];
	const brokerPids = new Set((scopes ?? []).flatMap(scope => (scope.brokerPid ? [scope.brokerPid] : [])));

	const supervised = new Map<number, { scope: Scope; daemon: Daemon }>();
	for (const scope of scopes ?? []) {
		for (const daemon of scope.daemons) {
			const entry = daemon.pid === undefined ? undefined : table.get(daemon.pid);
			if (daemon.pid !== undefined && !daemon.ended && entry && !WORKER.test(daemon.command ?? entry.command) && !supervised.has(daemon.pid)) supervised.set(daemon.pid, { scope, daemon });
		}
	}

	const candidates = new Set<number>([...supervised.keys(), ...tags.keys(), ...brokerPids, ...listeners.keys()]);
	for (const [pid, entry] of table) if (WORKER.test(entry.command)) candidates.add(pid);

	const processes: TrackedProcess[] = [];
	for (const pid of [...candidates].sort((a, b) => a - b)) {
		const entry = table.get(pid);
		const listener = listeners.get(pid);
		if (!entry && !listener) continue;
		const command = entry?.command ?? listener!.name;
		const cwd = cwds.get(pid);
		const base = {
			pid,
			ppid: entry?.ppid ?? 0,
			command,
			ports: listener?.ports ?? [],
			...(cwd === undefined ? {} : { cwd }),
			...(entry?.elapsedSeconds === undefined ? {} : { elapsedSeconds: entry.elapsedSeconds }),
			...describeCommand(command),
		};
		const launch = supervised.get(pid);
		const tag = tags.get(pid);
		const role = brokerPids.has(pid) ? "broker" : WORKER.exec(base.command)?.[1]?.replaceAll("_", "-");
		const projectFromCwd = (): string | undefined => {
			const cwd = cwds.get(pid);
			return cwd === undefined ? undefined : projectOf(cwd, known);
		};
		if (launch) {
			const { owner } = launch.daemon;
			const brokerGone = launch.scope.brokerPid !== undefined && !table.has(launch.scope.brokerPid);
			processes.push({
				...base,
				name: launch.daemon.name,
				origin: { kind: "supervised", daemon: launch.daemon.name, ...(owner ? { owner } : {}), kept: launch.daemon.kept },
				project: launch.scope.projectDir ?? projectFromCwd(),
				...(owner ? { session: owner } : {}),
				sessionEnded: owner ? sessionEnded(owner) : brokerGone,
			});
		} else if (tag) {
			// Every child of a tagged shell carries the tag; keep tree roots and port holders.
			if (base.ports.length === 0 && tags.get(base.ppid) === tag) continue;
			processes.push({ ...base, origin: { kind: "tagged", session: tag }, project: projectFromCwd(), session: tag, sessionEnded: sessionEnded(tag) });
		} else if (role) {
			processes.push({ ...base, name: role, origin: { kind: "internal", role }, sessionEnded: false });
		} else if (base.ports.length > 0) {
			processes.push({ ...base, origin: { kind: "unknown" }, project: projectFromCwd(), sessionEnded: false });
		}
	}
	return { processes, groups: groupProcesses(processes, currentProject), notes, sessions: inputs.sessions ?? new Map() };
}
