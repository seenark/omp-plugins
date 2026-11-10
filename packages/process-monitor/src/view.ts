import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@oh-my-pi/pi-tui";
import { isKillable, isStopCandidate, standingOf, stopCandidatePortCount, type Origin, type ProcessGroup, type SessionInfo, type Snapshot, type Standing, type TrackedProcess } from "./snapshot.ts";

/** Only names in OMP's theme colour set: `Theme.fg` throws on anything else. */
type Color = "accent" | "dim" | "muted" | "warning" | "error" | "success" | "syntaxNumber";
type Painter = { fg(color: Color, text: string): string; bold(text: string): string };

const PLAIN: Painter = { fg: (_color, text) => text, bold: text => text };

/** Row width for output with no known terminal width (notices, dialogs, plain text). */
export const DEFAULT_ROW_WIDTH = 100;
const MIN_COMMAND_WIDTH = 4;
const MIN_NAME_WIDTH = 4;
const MIN_TITLE_WIDTH = 8;
const MAX_TITLE_WIDTH = 40;
const MAX_PORTS_WIDTH = 16;
const MIN_BODY_HEIGHT = 5;
const GAP = "  ";

/** What a row's standing looks like. A tint colours the whole row; a badge colour only the badge. */
const LOOK: Record<Standing, { badge: string; badgeColor?: "success" | "accent"; tint?: "warning" | "dim" }> = {
	current: { badge: "● this session", badgeColor: "success" },
	live: { badge: "● live", badgeColor: "accent" },
	stopCandidate: { badge: "⚠ stop?", tint: "warning" },
	kept: { badge: "📌 kept", badgeColor: "accent" },
	viewOnly: { badge: "", tint: "dim" },
};

const shortId = (id: string): string => (id.length > 8 ? `…${id.slice(-8)}` : id);

function formatAge(seconds: number | undefined): string {
	if (seconds === undefined) return "-";
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86400)}d`;
}

/** Ports beyond what fits in MAX_PORTS_WIDTH collapse into `+N`. */
function formatPorts(ports: readonly number[]): string {
	if (ports.length === 0) return "-";
	const labels = ports.map(port => `:${port}`);
	const all = labels.join(",");
	if (all.length <= MAX_PORTS_WIDTH) return all;
	for (let shown = labels.length - 1; shown > 1; shown--) {
		const text = `${labels.slice(0, shown).join(",")},+${labels.length - shown}`;
		if (text.length <= MAX_PORTS_WIDTH) return text;
	}
	return `${labels[0]},+${labels.length - 1}`;
}

type Row = { standing: Standing; ports: string; compactPorts: string; command: string; age: string; session: string; titled: boolean };

function describeRow(process: TrackedProcess, sessions: ReadonlyMap<string, SessionInfo>, currentSession: string | undefined): Row {
	const info = process.session === undefined ? undefined : sessions.get(process.session);
	const title = info?.title;
	const ports = formatPorts(process.ports);
	return {
		standing: standingOf(process, currentSession),
		ports,
		compactPorts: process.ports.length > 1 ? `:${process.ports[0]},+${process.ports.length - 1}` : ports,
		command: process.displayCommand !== process.name ? process.displayCommand : "",
		age: formatAge(process.elapsedSeconds),
		session: process.session === undefined ? "-" : (title ?? shortId(process.session)),
		titled: title !== undefined,
	};
}

type Table = {
	/** Plain width of the widest line `header` or `row` returns, without a prefix. */
	width: number;
	header(paint: Painter, prefix?: string): string;
	/** `prefix` sits inside the row tint so a cursor marker takes the row's colour. */
	row(process: TrackedProcess, paint: Painter, prefix?: string): string;
};

const widest = (header: string, cells: readonly string[]): number => Math.max(visibleWidth(header), ...cells.map(visibleWidth));

const cell = (plain: string, width: number, style: (text: string) => string): string => style(plain) + " ".repeat(Math.max(0, width - visibleWidth(plain)));

/**
 * Column widths are computed once over `processes` so rows align. When `width` is short, parts give way in this order:
 * the command, a long session title (down to the short-id width), then multi-port rows collapse to `:<first>,+N`, then the
 * whole SESSION column is hidden. Only after all of that does the name shrink. PID, AGE and the STATE badge never give way.
 */
function layoutTable(processes: readonly TrackedProcess[], sessions: ReadonlyMap<string, SessionInfo>, currentSession: string | undefined, width: number): Table {
	const rows = new Map<TrackedProcess, Row>(processes.map(process => [process, describeRow(process, sessions, currentSession)] as const));
	const all = [...rows.values()];
	const pidW = widest("PID", processes.map(process => String(process.pid)));
	const ageW = widest("AGE", all.map(row => row.age));
	const stateW = widest("STATE", all.map(row => LOOK[row.standing].badge));
	let compactPorts = false;
	const portsOf = (row: Row): string => (compactPorts ? row.compactPorts : row.ports);
	let portsW = widest("PORTS", all.map(portsOf));
	let nameW = widest("NAME", processes.map(process => process.name));
	let commandW = Math.max(0, ...all.map(row => visibleWidth(row.command)));
	const fixedSessionW = Math.max(0, ...all.filter(row => !row.titled).map(row => visibleWidth(row.session)));
	const titleW = Math.max(0, ...all.filter(row => row.titled).map(row => Math.min(MAX_TITLE_WIDTH, visibleWidth(row.session))));
	let sessionW = Math.max(visibleWidth("SESSION"), fixedSessionW, titleW);
	const sessionMin = Math.min(sessionW, Math.max(MIN_TITLE_WIDTH, fixedSessionW));
	let sessionShown = true;

	const used = (): number =>
		pidW + portsW + nameW + ageW + stateW + 4 * GAP.length + (commandW > 0 ? GAP.length + commandW : 0) + (sessionShown ? GAP.length + sessionW : 0);
	const over = (): number => used() - width;
	if (over() > 0 && commandW > 0) commandW = commandW - over() >= MIN_COMMAND_WIDTH ? commandW - over() : 0;
	if (over() > 0) sessionW = Math.max(sessionMin, sessionW - over());
	if (over() > 0) {
		compactPorts = true;
		portsW = widest("PORTS", all.map(portsOf));
	}
	if (over() > 0) sessionShown = false;
	if (over() > 0) nameW = Math.max(MIN_NAME_WIDTH, nameW - over());

	const gutter = commandW > 0 ? [" ".repeat(commandW)] : [];
	return {
		width: used(),
		header: (paint, prefix = "") =>
			paint.fg("dim", `${prefix}${["PID".padStart(pidW), "PORTS".padEnd(portsW), "NAME".padEnd(nameW), ...gutter, "AGE".padEnd(ageW), ...(sessionShown ? ["SESSION".padEnd(sessionW)] : []), "STATE"].join(GAP)}`.trimEnd()),
		row: (process, paint, prefix = "") => {
			const row = rows.get(process)!;
			const { badge, badgeColor, tint } = LOOK[row.standing];
			// A nested colour would end the tint at its own reset, so a tinted row carries no other colour.
			const colour = (color: Color, text: string): string => (tint ? text : paint.fg(color, text));
			const parts = [
				String(process.pid).padStart(pidW),
				cell(portsOf(row), portsW, text => (process.ports.length > 0 ? colour("syntaxNumber", text) : text)),
				cell(truncateToWidth(process.name, nameW), nameW, text => paint.bold(text)),
				...(commandW > 0 ? [cell(truncateToWidth(row.command, commandW), commandW, text => colour("dim", text))] : []),
				cell(row.age, ageW, text => text),
				...(sessionShown ? [cell(row.titled ? truncateToWidth(row.session, sessionW) : row.session, sessionW, text => text)] : []),
				badgeColor ? colour(badgeColor, badge) : badge,
			];
			const line = `${prefix}${parts.join(GAP)}`.trimEnd();
			return tint ? paint.fg(tint, line) : line;
		},
	};
}

/** One row on its own, plain, for prompts and notices. */
export function formatRow(process: TrackedProcess, sessions: ReadonlyMap<string, SessionInfo>, currentSession: string | undefined, width: number): string {
	return layoutTable([process], sessions, currentSession, width).row(process, PLAIN);
}

/** One line for the overlay and the plain listing; the port count is the one the status segment shows. */
const summaryLine = (processes: readonly TrackedProcess[]): string =>
	`${processes.length} tracked · ${processes.filter(isStopCandidate).length} suggested to stop · ${stopCandidatePortCount(processes)} holding a port`;

/** The `(this project)` mark when it is the current one, then the row count; the title and path are styled apart. */
const groupSuffix = (group: ProcessGroup): string => `${group.current ? " (this project)" : ""} (${group.rows.length})`;

/** The no-UI rendering of the same grouping the overlay shows. */
export function formatSnapshotText(snapshot: Snapshot, currentSession: string | undefined, width = DEFAULT_ROW_WIDTH): string {
	const lines = [summaryLine(snapshot.processes)];
	const table = layoutTable(snapshot.processes, snapshot.sessions, currentSession, width - 2);
	for (const group of snapshot.groups) {
		lines.push("", `${group.title}${groupSuffix(group)}${group.path === undefined ? "" : `  ${group.path}`}`);
		for (const row of group.rows) lines.push(`  ${table.row(row, PLAIN)}`);
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

const DETAIL_LABEL_WIDTH = 9;
/** The rule plus the six detail lines; reserved even when the cursor is on a group header or a row with no `why`, so the body does not resize. */
const DETAIL_HEIGHT = 7;

function describeOrigin(origin: Origin): string {
	switch (origin.kind) {
		case "supervised":
			return `supervised (daemon ${origin.daemon})`;
		case "tagged":
			return "tagged (OMP session marker)";
		case "internal":
			return `OMP internal (${origin.role})`;
		case "unknown":
			return "unknown";
	}
}

/** Label and value pairs for the row under the cursor; values are untruncated. Only a Stop Candidate or a Kept Process gets a `why` pair. */
function detailsOf(process: TrackedProcess, standing: Standing, sessions: ReadonlyMap<string, SessionInfo>, now: number): [label: string, value: string][] {
	const info = process.session === undefined ? undefined : sessions.get(process.session);
	const title = info?.title;
	const lastActive = info?.lastActive;
	const details: [string, string][] = [
		["command", process.displayCommand],
		["cwd", process.cwd ?? "-"],
		["session", process.session === undefined ? "-" : title === undefined ? process.session : `${process.session}  ${title}`],
		["origin", describeOrigin(process.origin)],
		["stop", isKillable(process) ? "k stops it" : "view-only: not started by OMP as far as can be proven"],
	];
	if (standing === "stopCandidate") {
		const ago = lastActive === undefined ? "" : ` (last active ${formatAge(Math.max(0, Math.floor((now - lastActive.getTime()) / 1000)))} ago)`;
		const holds = process.ports.length === 0 ? "" : ` · holds ${process.ports.map(port => `:${port}`).join(", ")}`;
		details.push(["why", `session ended${ago}${holds} · not kept`]);
	} else if (standing === "kept") {
		details.push(["why", "started in persist or detached mode, so it is not suggested"]);
	}
	return details;
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
			// Title, summary and a blank line, the table header, the notes, the notice, then a blank line and the key hint.
			const chrome = 3 + (snapshot.processes.length > 0 ? 1 : 0) + snapshot.notes.length + (state.notice ? 1 : 0) + 2;
			const room = (paneHeight: number): number => Math.max(1, tui.terminal.rows - chrome - paneHeight);
			const pane = items.length > 0 && room(DETAIL_HEIGHT) >= MIN_BODY_HEIGHT ? DETAIL_HEIGHT : 0;
			// The scroll line takes one row of the room when the items do not all fit.
			const height = items.length > room(pane) ? Math.max(1, room(pane) - 1) : room(pane);
			const cursor = selected();
			top = Math.min(Math.max(0, top), Math.max(0, items.length - height));
			if (cursor < top) top = cursor;
			if (cursor >= top + height) top = cursor - height + 1;
			// Clipping goes by the plain width: a painted line counts its escape codes only in a test theme.
			const fit = (painted: string, plainWidth: number): string => (plainWidth <= width ? painted : truncateToWidth(painted, width));
			const say = (color: Color, text: string): string => fit(theme.fg(color, text), visibleWidth(text));
			const indent = "    ";
			const table = layoutTable(snapshot.processes, snapshot.sessions, currentSession, width - indent.length);
			const body = items.slice(top, top + height).map((item, offset) => {
				const marker = top + offset === cursor ? "›" : " ";
				if (!item.row) {
					const arrow = !item.group.collapsed || state.expanded.has(item.group.id) ? "▾" : "▸";
					const { title, path } = item.group;
					const suffix = groupSuffix(item.group);
					const plain = `${marker} ${arrow} ${title}${suffix}${path === undefined ? "" : `  ${path}`}`;
					return fit(`${marker} ${theme.bold(`${arrow} ${title}`)}${suffix}${path === undefined ? "" : `  ${theme.fg("dim", path)}`}`, visibleWidth(plain));
				}
				return fit(table.row(item.row, theme, `${marker}   `), indent.length + table.width);
			});
			const lines = [fit(theme.fg("accent", theme.bold("OMP processes")), "OMP processes".length), say("dim", summaryLine(snapshot.processes)), ""];
			if (snapshot.processes.length > 0) lines.push(fit(table.header(theme, indent), indent.length + table.width));
			lines.push(...body);
			if (items.length === 0) lines.push("Nothing OMP started is running.");
			if (items.length > height) lines.push(say("dim", `${top + 1}-${Math.min(items.length, top + height)} of ${items.length}`));
			if (pane > 0) {
				const under = items[cursor]?.row;
				if (under) {
					lines.push(say("dim", "─".repeat(width)));
					const valueWidth = Math.max(0, width - 2 - DETAIL_LABEL_WIDTH);
					const details = detailsOf(under, standingOf(under, currentSession), snapshot.sessions, Date.now());
					for (const [label, value] of details) lines.push(`  ${theme.fg("dim", label.padEnd(DETAIL_LABEL_WIDTH))}${truncateToWidth(value, valueWidth)}`);
					for (let reserved = details.length; reserved < DETAIL_HEIGHT - 1; reserved++) lines.push("");
				} else {
					for (let reserved = 0; reserved < DETAIL_HEIGHT; reserved++) lines.push("");
				}
			}
			for (const note of snapshot.notes) lines.push(say("dim", note));
			if (state.notice) lines.push(say("error", state.notice));
			lines.push("", say("muted", "↑/↓ move  k/Backspace stop  Space/Tab fold  Enter/Esc close"));
			return lines;
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
