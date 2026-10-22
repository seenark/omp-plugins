import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isRecord } from "@codesook/omp-shared-display/config-store";
import { isSkillUse, type SkillUse, type StoreMeta } from "./types.ts";

export const GLOBAL_STORE_DIR = path.join(os.homedir(), ".local", "share", "codesook-omp", "skill-stats");

export function projectStoreDir(projectRoot: string): string {
	return path.join(projectRoot, ".omp", "skill-stats");
}

const USES = "uses.jsonl";
const IMPORTED = "imported.jsonl";
const META = "meta.json";

const metaPath = (dir: string): string => path.join(dir, META);
const temporaryPath = (target: string): string => `${target}.${process.pid}.${randomUUID()}.tmp`;

export function readMeta(dir: string): StoreMeta | undefined {
	try {
		const raw: unknown = JSON.parse(readFileSync(metaPath(dir), "utf8"));
		if (!isRecord(raw) || typeof raw.recordingStartedAt !== "string") return undefined;
		const resetBySkill: Record<string, string> = {};
		if (isRecord(raw.resetBySkill)) {
			for (const [name, at] of Object.entries(raw.resetBySkill)) if (typeof at === "string") resetBySkill[name] = at;
		}
		const meta: StoreMeta = { recordingStartedAt: raw.recordingStartedAt, resetBySkill };
		if (typeof raw.importedAt === "string") meta.importedAt = raw.importedAt;
		if (typeof raw.resetAll === "string") meta.resetAll = raw.resetAll;
		return meta;
	} catch {
		return undefined;
	}
}

function writeFileAtomic(target: string, content: string): void {
	const temporary = temporaryPath(target);
	try {
		writeFileSync(temporary, content);
		renameSync(temporary, target);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

export function writeMeta(dir: string, meta: StoreMeta): void {
	writeFileAtomic(metaPath(dir), `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * Create the store on first use and return its meta. `recordingStartedAt` is set once, by a create-if-absent
 * link, so two OMP processes racing to create the same store agree on one value.
 */
export function ensureStore(dir: string, now: Date, options: { gitignore: boolean }): StoreMeta {
	mkdirSync(dir, { recursive: true });
	const ignore = path.join(dir, ".gitignore");
	if (options.gitignore && !existsSync(ignore)) writeFileSync(ignore, "*\n");
	const existing = readMeta(dir);
	if (existing) return existing;
	const created: StoreMeta = { recordingStartedAt: now.toISOString(), resetBySkill: {} };
	const temporary = temporaryPath(metaPath(dir));
	writeFileSync(temporary, `${JSON.stringify(created, null, 2)}\n`);
	try {
		linkSync(temporary, metaPath(dir));
	} catch {
		// Another process created it first.
	} finally {
		rmSync(temporary, { force: true });
	}
	return readMeta(dir) ?? created;
}

export function appendUse(dir: string, use: SkillUse): void {
	appendFileSync(path.join(dir, USES), `${JSON.stringify(use)}\n`);
}

function readUseLines(file: string): SkillUse[] {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return [];
	}
	const uses: SkillUse[] = [];
	for (const line of text.split("\n")) {
		if (line === "") continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (isSkillUse(parsed)) uses.push(parsed);
		} catch {
			// A torn trailing line from a crashed writer is skipped, never fatal.
		}
	}
	return uses;
}

/** Live and imported records together; this is what every report counts. */
export function readUses(dir: string): SkillUse[] {
	return [...readUseLines(path.join(dir, USES)), ...readUseLines(path.join(dir, IMPORTED))];
}

export function resetStore(dir: string, skill: string | undefined, now: Date): void {
	const meta = readMeta(dir);
	if (meta === undefined) throw new Error(`Skill stats store has no meta: ${dir}`);
	if (skill === undefined) meta.resetAll = now.toISOString();
	else meta.resetBySkill[skill] = now.toISOString();
	writeMeta(dir, meta);
}

export type ImportBatch = { dir: string; uses: SkillUse[] };

/**
 * Write every store's `imported.jsonl` and set `importedAt`, or leave no trace. A previous crashed attempt may have
 * left an `imported.jsonl` without `importedAt`; it is replaced, never added to, so a retry cannot double count.
 */
export function commitImports(batches: readonly ImportBatch[], now: Date): void {
	const staged: { dir: string; temporary: string }[] = [];
	const installed: string[] = [];
	const marked: { dir: string; before: StoreMeta }[] = [];
	try {
		for (const batch of batches) {
			const target = path.join(batch.dir, IMPORTED);
			const temporary = temporaryPath(target);
			staged.push({ dir: batch.dir, temporary });
			writeFileSync(temporary, batch.uses.map(use => `${JSON.stringify(use)}\n`).join(""));
		}
		for (const { dir, temporary } of staged) {
			renameSync(temporary, path.join(dir, IMPORTED));
			installed.push(dir);
		}
		for (const { dir } of staged) {
			const before = readMeta(dir);
			if (before === undefined) throw new Error(`Skill stats store has no meta: ${dir}`);
			writeMeta(dir, { ...before, importedAt: now.toISOString() });
			marked.push({ dir, before });
		}
	} catch (error) {
		for (const { temporary } of staged) rmSync(temporary, { force: true });
		for (const dir of installed) rmSync(path.join(dir, IMPORTED), { force: true });
		for (const { dir, before } of marked) {
			try {
				writeMeta(dir, before);
			} catch {
				// Best effort: the imported file is already gone, so a leftover importedAt only blocks a retry.
			}
		}
		throw error;
	}
}
