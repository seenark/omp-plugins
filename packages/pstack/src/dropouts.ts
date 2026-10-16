import { isRecord } from "@codesook/omp-shared-display/config-store";
import { seatOfAgent } from "./panel.ts";
import type { PanelSeat } from "./roles.ts";

/** Reverse-domain custom session entry type under which dropouts are persisted. */
export const DROPOUT_ENTRY_TYPE = "dev.codesook.pstack.dropout";

// OMP's EventBus mirrors child frames onto the parent bus under these channels (task/types.ts, session-observer-registry.ts).
const SUBAGENT_EVENT_CHANNEL = "task:subagent:event";
const SUBAGENT_LIFECYCLE_CHANNEL = "task:subagent:lifecycle";

/** A panel seat's run moved off its model mid-run, so its verdict came from a different model than configured. */
export interface Dropout {
	seat: PanelSeat;
	agent: string;
	/** Subagent id on the parent's EventBus. */
	id: string;
	from: string;
	to: string;
	reason?: string;
}

interface EventSource {
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/** Observe child fallbacks on the parent bus and report those that happen inside a panel seat's run. */
export function watchDropouts(events: EventSource, record: (dropout: Dropout) => void): () => void {
	const agentById = new Map<string, string>();
	const offLifecycle = events.on(SUBAGENT_LIFECYCLE_CHANNEL, data => {
		if (!isRecord(data) || typeof data.id !== "string") return;
		if (data.status === "started" && typeof data.agent === "string") agentById.set(data.id, data.agent);
		else if (data.status !== "started") agentById.delete(data.id);
	});
	const offEvent = events.on(SUBAGENT_EVENT_CHANNEL, data => {
		if (!isRecord(data) || typeof data.id !== "string" || !isRecord(data.event)) return;
		const event = data.event;
		if (event.type !== "retry_fallback_applied" || typeof event.from !== "string" || typeof event.to !== "string") return;
		const agent = agentById.get(data.id);
		const role = seatOfAgent(agent);
		if (!agent || !role) return;
		record({
			seat: role.seat,
			agent,
			id: data.id,
			from: event.from,
			to: event.to,
			...(typeof event.reason === "string" ? { reason: event.reason } : {}),
		});
	});
	return () => {
		offLifecycle();
		offEvent();
		agentById.clear();
	};
}
