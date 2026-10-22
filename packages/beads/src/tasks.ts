import { isRecord } from "@codesook/omp-shared-display/config-store";
import type { BeadsExecute } from "./status";

export type TaskGroup = "in_progress" | "ready" | "blocked";
export type TaskRow = { id: string; priority: number; title: string; summary: string; updatedAt: string };
export type TaskBoard = Record<TaskGroup, TaskRow[]>;
export type TaskLine = { kind: "heading" | "row" | "note"; text: string };

const TASK_GROUPS: readonly TaskGroup[] = ["in_progress", "ready", "blocked"];
const GROUP_TITLES: Record<TaskGroup, string> = { in_progress: "In progress", ready: "Ready", blocked: "Blocked" };
// Deferred issues are deliberately postponed work; closed ones are only listed if bd ever stops hiding them.
const isExcluded = (status: string): boolean => status === "closed" || status === "deferred";

function groupOf(status: string, id: string, readyIds: ReadonlySet<string>): TaskGroup | undefined {
	if (isExcluded(status)) return undefined;
	if (status === "in_progress") return "in_progress";
	return readyIds.has(id) ? "ready" : "blocked";
}

function firstLine(description: unknown): string {
	return typeof description === "string" ? description.split(/\r?\n/u).map(line => line.trim()).find(line => line !== "") ?? "" : "";
}

/** Throws on a shape bd should never produce. */
export function groupTasks(listing: unknown, readyIds: ReadonlySet<string>): TaskBoard {
	if (!Array.isArray(listing)) throw new Error("bd list returned an unsupported response.");
	const board: TaskBoard = { in_progress: [], ready: [], blocked: [] };
	for (const issue of listing) {
		if (!isRecord(issue) || typeof issue.id !== "string" || typeof issue.title !== "string" || typeof issue.status !== "string" || typeof issue.priority !== "number") {
			throw new Error("bd list returned an issue without id, title, status and priority.");
		}
		const group = groupOf(issue.status, issue.id, readyIds);
		if (!group) continue;
		board[group].push({ id: issue.id, priority: issue.priority, title: issue.title, summary: firstLine(issue.description), updatedAt: typeof issue.updated_at === "string" ? issue.updated_at : "" });
	}
	for (const group of TASK_GROUPS) board[group].sort((a, b) => a.priority - b.priority || (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id));
	return board;
}

export function taskLines(board: TaskBoard): TaskLine[] {
	const lines: TaskLine[] = [];
	for (const group of TASK_GROUPS) {
		if (board[group].length === 0) continue;
		lines.push({ kind: "heading", text: `${GROUP_TITLES[group]} (${board[group].length})` });
		for (const row of board[group]) lines.push({ kind: "row", text: `  ${row.id}  P${row.priority}  ${row.title}${row.summary ? ` - ${row.summary}` : ""}` });
	}
	return lines.length > 0 ? lines : [{ kind: "note", text: "No open issues." }];
}

async function readonlyJson(execute: BeadsExecute, cwd: string, args: string[]): Promise<unknown> {
	const result = await execute("bd", [...args, "--json", "--readonly", "--sandbox"], { cwd, timeout: 10_000 });
	if (result.code !== 0) throw new Error(`bd ${args[0]} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`);
	try { return JSON.parse(result.stdout); } catch { throw new Error(`bd ${args[0]} returned malformed JSON.`); }
}

export async function loadTaskBoard(execute: BeadsExecute, cwd: string): Promise<TaskBoard> {
	const [listing, ready] = await Promise.all([
		readonlyJson(execute, cwd, ["list", "-n", "0"]),
		readonlyJson(execute, cwd, ["ready", "--brief", "-n", "0"]),
	]);
	if (!Array.isArray(ready)) throw new Error("bd ready returned an unsupported response.");
	return groupTasks(listing, new Set(ready.flatMap(issue => isRecord(issue) && typeof issue.id === "string" ? [issue.id] : [])));
}
