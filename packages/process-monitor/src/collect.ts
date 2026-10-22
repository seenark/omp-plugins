import * as path from "node:path";
import { buildSnapshot, type Snapshot } from "./snapshot.ts";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type Exec = (command: string, args: string[], options?: { timeout?: number }) => Promise<ExecResult>;

export type CollectEnvironment = {
	platform: NodeJS.Platform;
	homeDir: string;
	currentSession?: string;
	currentProject: string;
};

const TIMEOUT = 10_000;

/** Output of a source that may be absent; undefined means the command could not run. */
async function read(exec: Exec, command: string, args: string[], emptyIsFine = false): Promise<string | undefined> {
	try {
		const result = await exec(command, args, { timeout: TIMEOUT });
		return result.code === 0 || result.stdout.length > 0 || emptyIsFine ? result.stdout : undefined;
	} catch {
		return undefined;
	}
}

/** Reads every outside source through `exec`; all interpretation happens in `buildSnapshot`. */
export async function collectSnapshot(exec: Exec, environment: CollectEnvironment): Promise<Snapshot> {
	const darwin = environment.platform === "darwin";
	const ps = darwin ? "/bin/ps" : "ps";
	const locksDir = path.join(environment.homeDir, ".omp", "run", "session-owners");
	const [ompPs, processTable, environTable, listeners, cwds, lockFiles, heldLocks] = await Promise.all([
		read(exec, "omp", ["ps", "--all", "--json"]),
		read(exec, ps, ["-axww", "-o", "pid=,ppid=,command="]),
		// Only macOS prints a process environment in one `ps` call; the marker is the only value read from it.
		darwin ? read(exec, ps, ["-axwwE", "-o", "pid=,command="]) : undefined,
		read(exec, "lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], true),
		read(exec, "lsof", ["-nP", "-d", "cwd", "-F", "pn"], true),
		// `ls` fails when the directory is absent, the normal state of a home where no session has run. `lsof` exits 1 both then and when it prints holders, so only its output carries signal.
		read(exec, "ls", ["-1", locksDir]),
		read(exec, "lsof", ["-nP", "-F", "pn", "+d", locksDir], true),
	]);
	if (processTable === undefined) throw new Error("The process table could not be read (ps failed).");
	return buildSnapshot({
		processTable,
		ompPs,
		environTable,
		listeners,
		cwds,
		lockFiles,
		heldLocks,
		currentSession: environment.currentSession,
		currentProject: environment.currentProject,
	});
}

/** One numeric PID, never a name. Returns the failure text, or undefined when the signal was delivered. */
export async function killProcess(exec: Exec, pid: number): Promise<string | undefined> {
	if (!Number.isSafeInteger(pid) || pid <= 1) return `Refusing to signal pid ${pid}.`;
	try {
		const result = await exec("kill", ["-TERM", String(pid)], { timeout: TIMEOUT });
		return result.code === 0 ? undefined : result.stderr.trim() || result.stdout.trim() || `kill exited with code ${result.code}`;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}
