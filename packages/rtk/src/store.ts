import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const SESSIONS_ROOT = path.join(os.homedir(), ".local", "share", "codesook-omp", "rtk", "sessions");

export type SessionStore = { dir: string; historyDb: string; recallDb: string };
export type Savings = { commands: number; tokensInput: number; tokensSaved: number };

/** Create (or touch) the Agent Session directory; its mtime drives retention. */
export function openSessionStore(sessionId: string, root = SESSIONS_ROOT): SessionStore {
	const dir = path.join(root, sessionId.replace(/[^\w.-]/g, "_"));
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const now = new Date();
	utimesSync(dir, now, now);
	return { dir, historyDb: path.join(dir, "history.db"), recallDb: path.join(dir, "recall.db") };
}

/** Delete session directories untouched for more than `retentionDays`; never the current one. */
export function pruneSessions(root: string, currentDir: string, retentionDays: number, now = Date.now()): string[] {
	if (!existsSync(root)) return [];
	const cutoff = now - retentionDays * 86_400_000;
	const removed: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const dir = path.join(root, entry.name);
		if (!entry.isDirectory() || dir === currentDir || statSync(dir).mtimeMs >= cutoff) continue;
		rmSync(dir, { recursive: true, force: true });
		removed.push(dir);
	}
	return removed;
}

/** Sum the session's RTK history; a missing database counts as no savings. Read errors propagate. */
export function readSavings(historyDb: string): Savings {
	if (!existsSync(historyDb)) return { commands: 0, tokensInput: 0, tokensSaved: 0 };
	// rtk keeps history.db in WAL mode; a readonly handle cannot open it once rtk exited and removed the -shm file.
	const db = new Database(historyDb, { readwrite: true });
	try {
		db.run("PRAGMA query_only = ON");
		const row = db
			.query("SELECT COUNT(*) AS commands, COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(saved_tokens),0) AS saved FROM commands")
			.get() as { commands: number; input: number; saved: number };
		return { commands: row.commands, tokensInput: row.input, tokensSaved: row.saved };
	} finally {
		db.close();
	}
}
