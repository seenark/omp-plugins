import { isRecord } from "@codesook/omp-shared-display/config-store";
import { seatOfAgent } from "./panel.ts";
import type { PanelSeat } from "./roles.ts";
import { modelKey } from "./panel-rules.ts";

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

/** A panel seat's run reached a terminal state, whatever model it ran on. */
export interface SeatSettled {
	seat: PanelSeat;
	agent: string;
	id: string;
	status: "completed" | "failed" | "aborted";
}

interface EventSource {
	on(channel: string, handler: (data: unknown) => void): () => void;
}

// OMP's Fast-to-Standard tier degrade reports a fallback whose model ids differ only by tier suffix.
const SAME_MODEL_FALLBACK_ROLE = "fireworks-fast";

/** A fallback is a dropout only when the run moved to another model: OMP also reports same-model service-tier and thinking-level fallbacks. */
function changesModel(event: Record<string, unknown>, from: string, to: string): boolean {
	return event.role !== SAME_MODEL_FALLBACK_ROLE && modelKey(from) !== modelKey(to);
}

const SETTLED_STATUSES: readonly string[] = ["completed", "failed", "aborted"];

/**
 * Observe child runs on the parent bus: report a fallback to another model inside a panel seat's run as a dropout,
 * and each seat run's end through `settled`.
 */
export function watchDropouts(
	events: EventSource,
	record: (dropout: Dropout) => void,
	settled?: (seat: SeatSettled) => void,
): () => void {
	const agentById = new Map<string, string>();
	const offLifecycle = events.on(SUBAGENT_LIFECYCLE_CHANNEL, data => {
		if (!isRecord(data) || typeof data.id !== "string") return;
		if (data.status === "started" && typeof data.agent === "string") {
			agentById.set(data.id, data.agent);
			return;
		}
		if (data.status === "started") return;
		const agent = agentById.get(data.id);
		agentById.delete(data.id);
		const role = seatOfAgent(agent);
		if (agent && role && typeof data.status === "string" && SETTLED_STATUSES.includes(data.status)) {
			settled?.({ seat: role.seat, agent, id: data.id, status: data.status as SeatSettled["status"] });
		}
	});
	const offEvent = events.on(SUBAGENT_EVENT_CHANNEL, data => {
		if (!isRecord(data) || typeof data.id !== "string" || !isRecord(data.event)) return;
		const event = data.event;
		if (event.type !== "retry_fallback_applied" || typeof event.from !== "string" || typeof event.to !== "string") return;
		if (!changesModel(event, event.from, event.to)) return;
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
