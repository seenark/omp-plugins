import { isRecord } from "@codesook/omp-shared-display/config-store";

/** A process OMP can account for, and how the monitor knows it. */
export type Origin =
	| { kind: "supervised"; daemon: string; owner?: string }
	| { kind: "tagged"; session: string }
	| { kind: "internal"; role: string }
	| { kind: "unknown" };

export type TrackedProcess = {
	pid: number;
	ppid: number;
	command: string;
	ports: number[];
	project?: string;
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

/** A Leftover Process holds a port that nobody will free. */
export const leftoverPortCount = (processes: readonly TrackedProcess[]): number =>
	processes.filter(process => process.sessionEnded && process.ports.length > 0).length;

export type ProcessGroup = {
	id: string;
	title: string;
	collapsed: boolean;
	rows: TrackedProcess[];
};

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
};

export type Snapshot = {
	processes: TrackedProcess[];
	groups: ProcessGroup[];
	notes: string[];
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

type Daemon = { name: string; pid?: number; owner?: string; command?: string };
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
		})),
	}));
}

function parseProcessTable(raw: string): Map<number, { ppid: number; command: string }> {
	const table = new Map<number, { ppid: number; command: string }>();
	for (const line of raw.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
		if (match) table.set(Number(match[1]), { ppid: Number(match[2]), command: match[3]! });
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
		Number(b.sessionEnded) - Number(a.sessionEnded) || b.ports.length - a.ports.length || a.pid - b.pid;
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
		title: project === currentProject ? `This project (${project})` : project === "" ? UNKNOWN_PROJECT : project,
		collapsed: false,
		rows: rows.sort(order),
	});
	const others = [...byProject].filter(([project]) => project !== currentProject);
	others.sort(([a], [b]) => Number(a === "") - Number(b === "") || a.localeCompare(b));
	const current = byProject.has(currentProject) ? [projectGroup([currentProject, byProject.get(currentProject)!])] : [];
	return [
		...current,
		...others.map(projectGroup),
		{ id: "internal", title: "OMP internals", collapsed: true, rows: internals.sort(order) },
		{ id: "unknown", title: "Unknown origin (view-only)", collapsed: false, rows: unknown.sort(order) },
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
			if (daemon.pid !== undefined && entry && !WORKER.test(daemon.command ?? entry.command) && !supervised.has(daemon.pid)) supervised.set(daemon.pid, { scope, daemon });
		}
	}

	const candidates = new Set<number>([...supervised.keys(), ...tags.keys(), ...brokerPids, ...listeners.keys()]);
	for (const [pid, entry] of table) if (WORKER.test(entry.command)) candidates.add(pid);

	const processes: TrackedProcess[] = [];
	for (const pid of [...candidates].sort((a, b) => a - b)) {
		const entry = table.get(pid);
		const listener = listeners.get(pid);
		if (!entry && !listener) continue;
		const base = { pid, ppid: entry?.ppid ?? 0, command: entry?.command ?? listener!.name, ports: listener?.ports ?? [] };
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
				origin: { kind: "supervised", daemon: launch.daemon.name, ...(owner ? { owner } : {}) },
				project: launch.scope.projectDir ?? projectFromCwd(),
				...(owner ? { session: owner } : {}),
				sessionEnded: owner ? sessionEnded(owner) : brokerGone,
			});
		} else if (tag) {
			// Every child of a tagged shell carries the tag; keep tree roots and port holders.
			if (base.ports.length === 0 && tags.get(base.ppid) === tag) continue;
			processes.push({ ...base, origin: { kind: "tagged", session: tag }, project: projectFromCwd(), session: tag, sessionEnded: sessionEnded(tag) });
		} else if (role) {
			processes.push({ ...base, origin: { kind: "internal", role }, sessionEnded: false });
		} else if (base.ports.length > 0) {
			processes.push({ ...base, origin: { kind: "unknown" }, project: projectFromCwd(), sessionEnded: false });
		}
	}
	return { processes, groups: groupProcesses(processes, currentProject), notes };
}
