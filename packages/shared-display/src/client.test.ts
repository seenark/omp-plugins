import { describe, expect, it } from "bun:test";
import {
	CHANNEL,
	connectSharedDisplay,
	parseFrameSequenceAsset,
	parseSharedDisplayMessage,
} from "./client.ts";

type EventBus = {
	on(channel: string, handler: (data: unknown) => void): () => void;
	emit(channel: string, data: unknown): void;
};

function makeBus(messages: unknown[]): EventBus {
	const handlers = new Set<(data: unknown) => void>();
	return {
		on(channel, handler) {
			if (channel === CHANNEL) handlers.add(handler);
			return () => handlers.delete(handler);
		},
		emit(channel, data) {
			messages.push(data);
			if (channel === CHANNEL) for (const handler of handlers) handler(data);
		},
	};
}

describe("Shared Display client", () => {
	it("parses multiline assets and preserves row boundaries", () => {
		expect(parseFrameSequenceAsset("fps=5\n A  \n B\n\nC\n")).toEqual({ frames: [[" A  ", " B"], ["C"]], fps: 5 });
		expect(parseFrameSequenceAsset("A B")).toEqual({ frames: [["A"], ["B"]] });
		expect(parseFrameSequenceAsset("fps=0\nA\n\nB")).toEqual({ frames: [["A"], ["B"]] });
	});

	it("reports explicit host presence, not requests, and only notifies changes", () => {
		const messages: unknown[] = [];
		const bus = makeBus(messages);
		const publisher = connectSharedDisplay(bus, "codegraph");
		const availability: boolean[] = [];
		const unsubscribe = publisher.onHostAvailabilityChange(active => availability.push(active));
		expect(publisher.hostAvailable).toBe(false);
		publisher.publish({ frames: [["CodeGraph ready"]] });
		bus.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "session-1" });
		expect(publisher.hostAvailable).toBe(false);
		expect(messages.filter(message => parseSharedDisplayMessage(message)?.kind === "snapshot")).toEqual([]);
		bus.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "session-1", active: true });
		expect(publisher.hostAvailable).toBe(true);
		bus.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "session-1", active: true });
		bus.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "session-1", active: false });
		publisher.publish({ frames: [["CodeGraph off"]] });
		bus.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "session-2", active: true });
		bus.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "session-1", active: false });
		expect(publisher.hostAvailable).toBe(true);
		expect(availability).toEqual([true, false, true]);
		unsubscribe();
		bus.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "session-2", active: false });
		expect(publisher.hostAvailable).toBe(false);
		expect(availability).toEqual([true, false, true]);
		publisher.dispose();
		const absent = connectSharedDisplay(undefined, "codegraph");
		expect(absent.hostAvailable).toBe(false);
	});

	it("replays immutable state and disposal removes the connected segment", () => {
		const messages: unknown[] = [];
		const bus = makeBus(messages);
		const publisher = connectSharedDisplay(bus, "headroom");
		const frames = [["A"]];
		publisher.publish({ frames, fps: 5 });
		frames[0]![0] = "mutated input";
		bus.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "epoch-1", active: true });
		bus.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "epoch-1" });
		const first = messages.find(message => parseSharedDisplayMessage(message)?.kind === "snapshot") as {
			sequence: { frames: string[][]; fps?: number };
		};
		expect(first.sequence).toEqual({ frames: [["A"]], fps: 5 });
		first.sequence.frames[0]![0] = "mutated replay";
		bus.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "epoch-1" });
		expect(messages.at(-1)).toMatchObject({ kind: "snapshot", revision: 1, sequence: { frames: [["A"]], fps: 5 } });
		bus.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "old-epoch" });
		publisher.dispose();
		expect(messages.at(-1)).toMatchObject({ kind: "snapshot", epoch: "epoch-1", revision: 2, sequence: null });
		publisher.publish({ frames: [["stale"]] });
		bus.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "epoch-1" });
		expect(messages.at(-1)).toMatchObject({ kind: "request" });
		expect(publisher.hostAvailable).toBe(false);
	});

	it("rejects malformed messages and keeps valid state after malformed publication", () => {
		expect(parseSharedDisplayMessage({ protocol: 1, kind: "snapshot", source: "headroom", epoch: "x", revision: 0, sequence: null })).toBeUndefined();
		expect(parseSharedDisplayMessage({ protocol: 1, kind: "host", epoch: "x", active: "yes" })).toBeUndefined();
		expect(parseSharedDisplayMessage({ protocol: 1, kind: "request", source: "host", epoch: "x" })).toBeUndefined();
		const messages: unknown[] = [];
		const bus = makeBus(messages);
		const publisher = connectSharedDisplay(bus, "headroom");
		publisher.publish({ frames: [["valid"]] });
		publisher.publish({ frames: [["bad\nrow"]] });
		bus.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "x", active: true });
		bus.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "x" });
		expect(messages.at(-1)).toMatchObject({ kind: "snapshot", sequence: { frames: [["valid"]] } });
		publisher.dispose();
	});
});
