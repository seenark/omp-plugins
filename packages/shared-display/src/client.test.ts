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

	it("replays the latest immutable snapshot and emits a tombstone", () => {
		const messages: unknown[] = [];
		const publisher = connectSharedDisplay(makeBus(messages), "headroom");
		const frames = [["A"]];
		publisher.publish({ frames, fps: 5 });
		frames[0]![0] = "mutated";
		const beforeRequest = messages.length;
		const bus = makeBus(messages);
		const replay = connectSharedDisplay(bus, "caveman");
		replay.publish({ frames: [["C"]] });
		bus.emit(CHANNEL, { protocol: 1, kind: "request", epoch: "epoch-1" });
		const snapshots = messages.filter((message): message is { kind?: string; source?: string; sequence?: { frames: readonly (readonly string[])[] } | null } => typeof message === "object" && message !== null && (message as { kind?: unknown }).kind === "snapshot");
		expect(messages.length).toBeGreaterThan(beforeRequest);
		expect(snapshots.at(-1)).toMatchObject({ source: "caveman", sequence: { frames: [["C"]] } });
		replay.publish(null);
		expect(snapshots.at(-1)?.sequence).toEqual({ frames: [["C"]] });
		const tombstone = messages.at(-1);
		expect(tombstone).toMatchObject({ kind: "snapshot", source: "caveman", sequence: null });
		replay.dispose();
	});

	it("rejects malformed wire messages and malformed publications", () => {
		expect(parseSharedDisplayMessage({ protocol: 1, kind: "snapshot", source: "headroom", epoch: "x", revision: 0, sequence: null })).toBeUndefined();
		expect(parseSharedDisplayMessage({ protocol: 1, kind: "request", source: "host", epoch: "x" })).toBeUndefined();
		const messages: unknown[] = [];
		const publisher = connectSharedDisplay(makeBus(messages), "headroom");
		const count = messages.length;
		publisher.publish({ frames: [["bad\nrow"] as readonly string[]] });
		expect(messages).toHaveLength(count);
	});
});
