import * as path from "node:path";
import { classifySkillPath, describeSkill, sameScope, skillFileExists, type SkillEnv } from "./skills.ts";
import { SKILL_USE_SOURCES, type Scope, type SkillInfo, type SkillUse, type SkillUseSource, type StoreMeta } from "./types.ts";

const DAY_MS = 86_400_000;
export const CANDIDATE_DAYS = 60;

export type Counts = Record<SkillUseSource, number>;
type Dates = Record<SkillUseSource, string | undefined>;

export type Row = {
	info: SkillInfo;
	d7: Counts;
	d30: Counts;
	sinceReset: Counts;
	/** Latest use per source (ISO), regardless of Reset Points. */
	lastBySource: Dates;
	lastUsed: string | undefined;
};

export type Report = { lines: string[]; command: string | undefined };

const zero = (): Counts => ({ user: 0, agent: 0, subagent: 0 });
const total = (counts: Counts): number => counts.user + counts.agent + counts.subagent;

function resetPointMs(meta: StoreMeta | undefined, name: string): number {
	const points = [meta?.resetAll, meta?.resetBySkill[name]].map(at => (at === undefined ? Number.NEGATIVE_INFINITY : Date.parse(at)));
	return Math.max(...points.map(point => (Number.isNaN(point) ? Number.NEGATIVE_INFINITY : point)));
}

export type RowInput = {
	scope: Scope;
	meta: StoreMeta | undefined;
	uses: readonly SkillUse[];
	installed: readonly SkillInfo[];
	env: SkillEnv;
	now: Date;
};

/**
 * One row per SKILL.md path of this scope: every installed skill (even with zero uses) plus every recorded skill
 * whose file still exists. A recorded skill whose file is gone is hidden; one that merely is not discovered stays.
 */
export function buildRows(input: RowInput): Row[] {
	const nowMs = input.now.getTime();
	const infos = new Map<string, SkillInfo>();
	for (const info of input.installed) if (sameScope(info.scope, input.scope)) infos.set(info.path, info);
	const usesByPath = new Map<string, SkillUse[]>();
	for (const use of input.uses) {
		const usePath = path.resolve(use.path);
		if (!sameScope(classifySkillPath(usePath, input.env.home), input.scope)) continue;
		if (!infos.has(usePath)) infos.set(usePath, describeSkill(use.name, usePath, input.env));
		usesByPath.set(usePath, [...(usesByPath.get(usePath) ?? []), use]);
	}
	const rows: Row[] = [];
	for (const [skillPath, info] of infos) {
		if (!skillFileExists(skillPath)) continue;
		const reset = resetPointMs(input.meta, info.name);
		const row: Row = { info, d7: zero(), d30: zero(), sinceReset: zero(), lastBySource: { user: undefined, agent: undefined, subagent: undefined }, lastUsed: undefined };
		for (const use of usesByPath.get(skillPath) ?? []) {
			const at = Date.parse(use.at);
			const age = nowMs - at;
			if (age <= 7 * DAY_MS) row.d7[use.source] += 1;
			if (age <= 30 * DAY_MS) row.d30[use.source] += 1;
			if (at > reset) row.sinceReset[use.source] += 1;
			const last = row.lastBySource[use.source];
			if (last === undefined || Date.parse(last) < at) row.lastBySource[use.source] = use.at;
		}
		const lasts = SKILL_USE_SOURCES.flatMap(source => row.lastBySource[source] ?? []);
		row.lastUsed = lasts.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
		rows.push(row);
	}
	return rows.sort(compareRows);
}

const lastMs = (row: Row): number => (row.lastUsed === undefined ? 0 : Date.parse(row.lastUsed));

function compareRows(a: Row, b: Row): number {
	return (
		total(a.sinceReset) - total(b.sinceReset) ||
		lastMs(a) - lastMs(b) ||
		a.info.name.localeCompare(b.info.name) ||
		a.info.path.localeCompare(b.info.path)
	);
}

/** No use in the last 60 days and installed at least 60 days ago; an unknown install time never qualifies. */
export function deleteCandidates(rows: readonly Row[], now: Date): Row[] {
	const window = CANDIDATE_DAYS * DAY_MS;
	return rows.filter(row => {
		const used = lastMs(row);
		return now.getTime() - used > window && row.info.installedAt !== undefined && now.getTime() - row.info.installedAt >= window;
	});
}

const countCell = (counts: Counts): string => `${total(counts)} (${counts.user}/${counts.agent}/${counts.subagent})`;
const day = (at: string | undefined): string => (at === undefined ? "-" : at.slice(0, 10));

function lastCell(row: Row): string {
	if (row.lastUsed === undefined) return "never";
	return `u:${day(row.lastBySource.user)} a:${day(row.lastBySource.agent)} s:${day(row.lastBySource.subagent)}`;
}

function table(rows: readonly Row[]): string[] {
	const header = ["SKILL", "ORIGIN", "7d", "30d", "SINCE RESET", "LAST USED"];
	const body = rows.map(row => [row.info.name, row.info.origin, countCell(row.d7), countCell(row.d30), countCell(row.sinceReset), lastCell(row)]);
	const widths = header.map((title, column) => Math.max(title.length, ...body.map(cells => cells[column]!.length)));
	const format = (cells: readonly string[]): string => cells.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd();
	return [format(header), ...body.map(format)];
}

export function renderReport(input: RowInput & { title: string }): Report {
	const rows = buildRows(input);
	const meta = input.meta;
	const resets = [
		...(meta?.resetAll === undefined ? [] : [`all ${day(meta.resetAll)}`]),
		...Object.entries(meta?.resetBySkill ?? {}).map(([name, at]) => `${name} ${day(at)}`),
	];
	const lines = [
		input.title,
		`Recording since ${day(meta?.recordingStartedAt)}. Reset points: ${resets.length > 0 ? resets.join(", ") : "none"}.`,
		"Counts are total (user/agent/subagent). Last used: u=user a=agent s=subagent, UTC dates.",
		"",
		...(rows.length > 0 ? table(rows) : ["No skills found."]),
		"",
	];
	const candidates = deleteCandidates(rows, input.now);
	if (candidates.length === 0) return { lines: [...lines, `Delete candidates: none (no use in ${CANDIDATE_DAYS} days and installed ${CANDIDATE_DAYS}+ days ago).`], command: undefined };
	const managed = candidates.filter(row => row.info.origin === "npx-skills");
	const others = candidates.filter(row => row.info.origin !== "npx-skills");
	const flag = input.scope.kind === "global" ? " -g" : "";
	const command = managed.length > 0 ? `npx skills remove${flag} ${managed.map(row => row.info.name).join(" ")}` : undefined;
	return {
		lines: [
			...lines,
			`Delete candidates (no use in ${CANDIDATE_DAYS} days, installed ${CANDIDATE_DAYS}+ days ago):`,
			...(command === undefined ? [] : [`  ${command}`]),
			...(others.length > 0 ? ["  Not installed by npx skills, remove by hand:", ...others.map(row => `    ${row.info.name} (${row.info.origin})  ${row.info.path}`)] : []),
		],
		command,
	};
}
