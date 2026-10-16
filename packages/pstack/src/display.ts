import { panelAttendance, type RunState } from "./run-state.ts";

/** Status Segment text, e.g. `pstack · feature · 3/7 · panel 3/4`. Undefined while pstack is inactive, which tombstones the segment. */
export function segmentText(state: RunState): string | undefined {
	if (!state.active) return undefined;
	const parts = ["pstack"];
	if (state.playbook) parts.push(state.playbook);
	if (state.progress) parts.push(`${state.progress.done}/${state.progress.total}`);
	if (state.receipts.length > 0) {
		const { attended, seats } = panelAttendance(state);
		parts.push(`panel ${attended}/${seats}`);
	}
	if (state.dropouts.length > 0) parts.push(`dropouts ${state.dropouts.length}`);
	return parts.join(" · ");
}

/** `/pstack status` output. */
export function statusReport(state: RunState): string {
	if (!state.active) return "pstack: inactive";
	const lines = ["pstack: active"];
	if (state.task) lines.push(`Task: ${state.task}`);
	lines.push(`Playbook: ${state.playbook ?? "not chosen yet"}`);
	if (state.progress) {
		lines.push(`Steps: ${state.progress.done}/${state.progress.total}${state.progress.current ? `, now: ${state.progress.current}` : ""}`);
	}
	if (state.seats.length > 0) {
		const { attended, seats } = panelAttendance(state);
		lines.push(`Panel: ${attended}/${seats} seats attended (${state.seats.map(seat => seat.toUpperCase()).join(", ")} configured)`);
	} else {
		lines.push("Panel: no seats configured");
	}
	for (const dropout of state.dropouts) {
		lines.push(`Dropout: seat ${dropout.seat.toUpperCase()} ran on ${dropout.to} instead of ${dropout.from}`);
	}
	return lines.join("\n");
}

/** Hidden note sent to the model after compaction so it keeps its place in the run. */
export function reminderText(state: RunState): string {
	const where = [
		state.playbook ? `playbook ${state.playbook}` : "no playbook chosen yet",
		state.progress ? `step ${state.progress.done}/${state.progress.total}${state.progress.current ? `: ${state.progress.current}` : ""}` : undefined,
	].filter(Boolean);
	return `pstack is still active after compaction (${where.join(", ")}). Continue the run from there; the todo list holds the playbook steps.`;
}
