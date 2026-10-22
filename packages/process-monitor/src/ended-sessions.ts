import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { SESSION_ID } from "./snapshot.ts";

export const endedSessionsDir = (homeDir: string): string =>
	path.join(homeDir, ".local", "share", "codesook-omp", "process-monitor", "ended");

/**
 * One empty file per ended session, so concurrent OMP instances never write the same file.
 * Used when OMP quits and there is no UI left to ask; the next start reads and clears them.
 */
export function recordEndedSession(directory: string, sessionId: string): void {
	if (!SESSION_ID.test(sessionId)) return;
	mkdirSync(directory, { recursive: true });
	writeFileSync(path.join(directory, sessionId), "");
}

export function readEndedSessions(directory: string): string[] {
	try {
		return readdirSync(directory).filter(name => SESSION_ID.test(name) && !name.startsWith("."));
	} catch {
		return [];
	}
}

export function clearEndedSessions(directory: string, sessionIds: readonly string[]): void {
	for (const sessionId of sessionIds) if (SESSION_ID.test(sessionId)) rmSync(path.join(directory, sessionId), { force: true });
}
