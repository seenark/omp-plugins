import { createReadStream, readdirSync } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { isRecord } from "@codesook/omp-shared-display/config-store";
import { skillNamesInToolCall, skillPromptSource, toolCallSource } from "./detect.ts";
import { skillFileExists } from "./skills.ts";
import type { SkillUse, SkillUseSource } from "./types.ts";

const PROJECT_SKILL_ROOTS = [".omp", ".agents", ".claude"] as const;
const HEADER_LINES = 10;

export type HistoryScan = {
	sessions: number;
	uses: SkillUse[];
	/** `skill://` reads whose SKILL.md could not be located. */
	unresolved: number;
	/** Signals dropped because their timestamp did not parse. */
	badTimestamps: number;
};

type Pending = { at: string; name: string; source: SkillUseSource; promptPath?: string };

function projectSkillPath(cwd: string, name: string): string | undefined {
	for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
		for (const root of PROJECT_SKILL_ROOTS) {
			const candidate = path.join(dir, root, "skills", name, "SKILL.md");
			if (skillFileExists(candidate)) return candidate;
		}
		if (path.dirname(dir) === dir) return undefined;
	}
}

/**
 * Stream every `*.jsonl` under the session history root, subagent transcripts included, one line at a time:
 * a single entry can be ~100 KB. A forked session copies its parent's subagent transcripts, so each signal is
 * deduplicated by entry id and timestamp across files. Never calls a model.
 */
export async function scanSessionHistory(root: string, installedPaths: ReadonlyMap<string, string>): Promise<HistoryScan> {
	const scan: HistoryScan = { sessions: 0, uses: [], unresolved: 0, badTimestamps: 0 };
	const seen = new Set<string>();
	let files: string[];
	try {
		files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(name => name.endsWith(".jsonl"));
	} catch {
		return scan;
	}
	for (const relative of files.sort()) {
		const file = path.join(root, relative);
		let session = path.basename(file, ".jsonl");
		let cwd: string | undefined;
		let inSubagent = false;
		const promptPaths = new Map<string, string>();
		const pending: Pending[] = [];
		let lineNumber = 0;
		const stream = createReadStream(file, { encoding: "utf8" });
		for await (const line of createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })) {
			lineNumber += 1;
			if (lineNumber <= HEADER_LINES && line.includes('"type":"session"')) {
				const header = parseObject(line);
				if (header?.type === "session") {
					if (typeof header.id === "string") session = header.id;
					if (typeof header.cwd === "string") cwd = header.cwd;
					inSubagent = typeof header.parentSession === "string";
				}
				continue;
			}
			if (!line.includes("skill-prompt") && !line.includes("skill://")) continue;
			const entry = parseObject(line);
			const timestamp = entry?.timestamp;
			if (entry === undefined || typeof timestamp !== "string") continue;
			const names = signalNames(entry, inSubagent, promptPaths);
			names.forEach((signal, index) => {
				const key = `${typeof entry.id === "string" ? entry.id : `${file}:${lineNumber}`}@${entry.timestamp}#${index}`;
				if (seen.has(key)) return;
				seen.add(key);
				if (!Number.isFinite(Date.parse(timestamp))) {
					scan.badTimestamps += 1;
					return;
				}
				pending.push({ at: timestamp, ...signal });
			});
		}
		scan.sessions += 1;
		for (const signal of pending) {
			const skillPath = signal.promptPath ?? promptPaths.get(signal.name) ?? (cwd === undefined ? undefined : projectSkillPath(cwd, signal.name)) ?? installedPaths.get(signal.name);
			if (skillPath === undefined) scan.unresolved += 1;
			else scan.uses.push({ at: signal.at, name: signal.name, path: skillPath, source: signal.source, session });
		}
	}
	return scan;
}

function parseObject(line: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

type Signal = { name: string; source: SkillUseSource; promptPath?: string };

function signalNames(entry: Record<string, unknown>, inSubagent: boolean, promptPaths: Map<string, string>): Signal[] {
	if (entry.type === "custom_message" && entry.customType === "skill-prompt") {
		const details = entry.details;
		if (!isRecord(details) || typeof details.name !== "string" || typeof details.path !== "string") return [];
		promptPaths.set(details.name, details.path);
		return [{ name: details.name, source: skillPromptSource(entry.attribution, inSubagent), promptPath: details.path }];
	}
	if (entry.type === "custom" && entry.customType === "tool_execution_start" && isRecord(entry.data)) {
		const { toolName, args } = entry.data;
		if (typeof toolName !== "string") return [];
		return skillNamesInToolCall(toolName, args).map(name => ({ name, source: toolCallSource(inSubagent) }));
	}
	return [];
}
