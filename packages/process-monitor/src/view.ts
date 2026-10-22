import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@oh-my-pi/pi-tui";
import { isKillable, leftoverPortCount, type ProcessGroup, type Snapshot, type TrackedProcess } from "./snapshot.ts";

type Painter = { fg(color: "accent" | "dim" | "warning" | "error", text: string): string; bold(text: string): string };

/** Row width for output with no known terminal width (notices, dialogs, plain text). */
export const DEFAULT_ROW_WIDTH = 100;
const MIN_COMMAND_WIDTH = 4;

/** Lays a row out in `width` columns: the command is the only column that gives way, so the leftover marker is never clipped or wrapped. */
export function formatRow(process: TrackedProcess, currentSession: string | undefined, width: number): string {
	const ports = process.ports.length > 0 ? process.ports.map(port => `:${port}`).join(",") : "-";
	const session = process.session === undefined ? "-" : process.session === currentSession ? "this session" : process.session.length > 8 ? `…${process.session.slice(-8)}` : process.session;
	const head = `${String(process.pid).padStart(6)}  ${ports}  `;
	const tail = `  ${session}${process.sessionEnded ? "  ⚠ leftover" : ""}`;
	const commandWidth = Math.max(MIN_COMMAND_WIDTH, width - visibleWidth(head) - visibleWidth(tail));
	return `${head}${truncateToWidth(process.command, commandWidth)}${tail}`;
}

const summary = (snapshot: Snapshot): string => {
	const leftovers = snapshot.processes.filter(process => process.sessionEnded).length;
	return `Processes: ${snapshot.processes.length} tracked, ${leftovers} leftover (${leftoverPortCount(snapshot.processes)} holding ports)`;
};

/** The no-UI rendering of the same grouping the overlay shows. */
export function formatSnapshotText(snapshot: Snapshot, currentSession: string | undefined, width = DEFAULT_ROW_WIDTH): string {
	const lines = [summary(snapshot)];
	for (const group of snapshot.groups) {
		lines.push("", `${group.title} (${group.rows.length})`);
		for (const row of group.rows) lines.push(`  ${formatRow(row, currentSession, width - 2)}`);
	}
	if (snapshot.processes.length === 0) lines.push("", "Nothing OMP started is running.");
	for (const note of snapshot.notes) lines.push("", note);
	return lines.join("\n");
}

export type ProcsChoice = { kind: "close" } | { kind: "kill"; pid: number };

/** Survives re-opening the overlay after a kill so the cursor and folds stay put. */
export type ViewState = { expanded: Set<string>; cursor?: string; notice?: string };

type Item = { key: string; group: ProcessGroup; row?: TrackedProcess };

function itemsOf(snapshot: Snapshot, state: ViewState): Item[] {
	return snapshot.groups.flatMap(group => [
		{ key: `group:${group.id}`, group },
		...(group.collapsed && !state.expanded.has(group.id) ? [] : group.rows.map(row => ({ key: `pid:${row.pid}`, group, row }))),
	]);
}

export function procsOverlay(
	snapshot: Snapshot,
	currentSession: string | undefined,
	state: ViewState,
	done: (choice: ProcsChoice) => void,
	tui: { requestRender(): void; terminal: { rows: number } },
	theme: Painter,
): Component {
	let top = 0;
	state.cursor ??= itemsOf(snapshot, state).find(item => item.row)?.key;
	const selected = (): number => Math.max(0, itemsOf(snapshot, state).findIndex(item => item.key === state.cursor));
	return {
		render(width: number): string[] {
			const items = itemsOf(snapshot, state);
			const height = Math.max(5, tui.terminal.rows - 8);
			const cursor = selected();
			top = Math.min(Math.max(0, top), Math.max(0, items.length - height));
			if (cursor < top) top = cursor;
			if (cursor >= top + height) top = cursor - height + 1;
			const body = items.slice(top, top + height).map((item, offset) => {
				const marker = top + offset === cursor ? "›" : " ";
				if (!item.row) {
					const open = !item.group.collapsed || state.expanded.has(item.group.id);
					return `${marker} ${theme.bold(`${open ? "▾" : "▸"} ${item.group.title} (${item.group.rows.length})`)}`;
				}
				const line = `${marker}   ${formatRow(item.row, currentSession, width - 4)}`;
				return item.row.sessionEnded && item.row.ports.length > 0 ? theme.fg("warning", line) : line;
			});
			const lines = [theme.fg("accent", theme.bold("OMP processes")), theme.fg("dim", summary(snapshot)), "", ...body];
			if (items.length === 0) lines.push("Nothing OMP started is running.");
			if (items.length > height) lines.push(theme.fg("dim", `${top + 1}-${Math.min(items.length, top + height)} of ${items.length}`));
			for (const note of snapshot.notes) lines.push(theme.fg("dim", note));
			if (state.notice) lines.push(theme.fg("error", state.notice));
			lines.push("", theme.fg("dim", "↑/↓ move  k/Backspace stop  Space/Tab fold  Enter/Esc close"));
			return lines.map(line => truncateToWidth(line, width));
		},
		handleInput(data: string): void {
			const items = itemsOf(snapshot, state);
			const item = items[selected()];
			if (matchesKey(data, "enter") || matchesKey(data, "escape")) return done({ kind: "close" });
			if (matchesKey(data, "up") || matchesKey(data, "down")) {
				state.cursor = items[Math.min(items.length - 1, Math.max(0, selected() + (matchesKey(data, "up") ? -1 : 1)))]?.key;
				state.notice = undefined;
			} else if ((matchesKey(data, "space") || matchesKey(data, "tab")) && item && !item.row) {
				if (!state.expanded.delete(item.group.id)) state.expanded.add(item.group.id);
			} else if ((matchesKey(data, "k") || matchesKey(data, "backspace")) && item?.row) {
				if (isKillable(item.row)) return done({ kind: "kill", pid: item.row.pid });
				state.notice = "Not started by OMP as far as can be proven: view-only.";
			} else {
				return;
			}
			tui.requestRender();
		},
		invalidate() {},
	};
}
