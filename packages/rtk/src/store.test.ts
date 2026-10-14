import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openSessionStore, pruneSessions, readSavings } from "./store.ts";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const temp = (): string => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "omp-rtk-store-"));
	directories.push(directory);
	return directory;
};

function createHistory(file: string, rows: [input: number, saved: number][]): void {
	const db = new Database(file);
	db.run("PRAGMA journal_mode = WAL"); // rtk's mode: a plain readonly open of this file fails once rtk exits
	db.run(`CREATE TABLE commands (
		id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL,
		input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL,
		savings_pct REAL NOT NULL, exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT ''
	)`);
	for (const [input, saved] of rows) {
		db.run("INSERT INTO commands (timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct) VALUES ('t','a','b',?,?,?,0)", [input, input - saved, saved]);
	}
	db.close();
}

test("savings sums the session history and tolerates a missing database", () => {
	const root = temp();
	const file = path.join(root, "history.db");
	expect(readSavings(file)).toEqual({ commands: 0, tokensInput: 0, tokensSaved: 0 });
	createHistory(file, [[1000, 800], [500, 100]]);
	expect(readSavings(file)).toEqual({ commands: 2, tokensInput: 1500, tokensSaved: 900 });
});

test("session store is private to the owner and names both databases", () => {
	const root = temp();
	const store = openSessionStore("abc/../def", root);
	expect(path.dirname(store.dir)).toBe(root);
	expect(statSync(store.dir).mode & 0o777).toBe(0o700);
	expect(store.historyDb).toBe(path.join(store.dir, "history.db"));
	expect(store.recallDb).toBe(path.join(store.dir, "recall.db"));
});

test("retention prunes stale session directories and never the current one", () => {
	const root = temp();
	const day = 86_400_000;
	const now = Date.now();
	const make = (name: string, ageDays: number): string => {
		const dir = path.join(root, name);
		mkdirSync(dir);
		const when = new Date(now - ageDays * day);
		utimesSync(dir, when, when);
		return dir;
	};
	const stale = make("stale", 8);
	const fresh = make("fresh", 2);
	const current = make("current", 30);
	expect(pruneSessions(root, current, 7, now)).toEqual([stale]);
	expect(existsSync(stale)).toBe(false);
	expect(existsSync(fresh)).toBe(true);
	expect(existsSync(current)).toBe(true);
	expect(pruneSessions(path.join(root, "missing"), current, 7, now)).toEqual([]);
});
