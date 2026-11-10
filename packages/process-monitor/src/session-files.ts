import { closeSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import * as path from "node:path";
import { isRecord } from "@codesook/omp-shared-display/config-store";
import type { SessionInfo } from "./snapshot.ts";

/** The title record's line is padded to about 500 bytes; anything longer is not a line this reader trusts. */
const FIRST_LINE_BOUND = 4096;

export type SessionReader = (ids: readonly string[]) => Map<string, SessionInfo>;

const MISSING_RETRY_MS = 5 * 60_000;

/** The title from the first line of a session file when it is a title record or a session header that carries one; undefined for any other first line. Nothing after the first newline is looked at. */
function titleOf(chunk: Buffer): string | undefined {
	const end = chunk.indexOf(0x0a);
	if (end < 0) return undefined;
	let record: unknown;
	try {
		record = JSON.parse(chunk.toString("utf8", 0, end));
	} catch {
		return undefined;
	}
	if (!isRecord(record) || (record.type !== "title" && record.type !== "session") || typeof record.title !== "string") return undefined;
	// A title is shown on one row; control characters would break it.
	return record.title.replace(/\p{Cc}+/gu, " ").trim() || undefined;
}

function readFirstLine(file: string): SessionInfo | undefined {
	let fd: number | undefined;
	try {
		fd = openSync(file, "r");
		const chunk = Buffer.alloc(FIRST_LINE_BOUND);
		const bytesRead = readSync(fd, chunk, 0, FIRST_LINE_BOUND, 0);
		const { mtime } = fstatSync(fd);
		const title = titleOf(chunk.subarray(0, bytesRead));
		return { ...(title === undefined ? {} : { title }), lastActive: mtime };
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {}
		}
	}
}

/** One readdir of the sessions directory and one per project directory, stopping once every wanted id has a file. */
function locate(root: string, wanted: readonly string[], paths: Map<string, string>): void {
	let projects;
	try {
		projects = readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const project of projects) {
		if (!project.isDirectory()) continue;
		let names: string[];
		try {
			names = readdirSync(path.join(root, project.name));
		} catch {
			continue;
		}
		for (const id of wanted) {
			if (paths.has(id)) continue;
			const name = names.find(candidate => candidate.endsWith(`_${id}.jsonl`));
			if (name !== undefined) paths.set(id, path.join(root, project.name, name));
		}
		if (wanted.every(id => paths.has(id))) return;
	}
}

/**
 * Reads only the first line of OMP's session file `<home>/.omp/agent/sessions/<project>/<timestamp>_<id>.jsonl`.
 * Found paths are remembered, so a refresh only lists directories for a session it has not seen, and an id with no file is
 * not looked for again for five minutes. Every failure leaves the session out.
 * The reads are synchronous because they are a few small bounded reads and the refresh needs no extra async hop.
 */
export function createSessionReader(homeDir: string): SessionReader {
	const root = path.join(homeDir, ".omp", "agent", "sessions");
	const paths = new Map<string, string>();
	const missedAt = new Map<string, number>();
	return ids => {
		const current = Date.now();
		const unseen = ids.filter(id => !paths.has(id) && current - (missedAt.get(id) ?? Number.NEGATIVE_INFINITY) >= MISSING_RETRY_MS);
		if (unseen.length > 0) {
			locate(root, unseen, paths);
			for (const id of unseen) if (!paths.has(id)) missedAt.set(id, current);
		}
		const sessions = new Map<string, SessionInfo>();
		for (const id of ids) {
			const file = paths.get(id);
			if (file === undefined) continue;
			const info = readFirstLine(file);
			if (info) sessions.set(id, info);
			else paths.delete(id);
		}
		return sessions;
	};
}
