import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CHANNEL } from "@codesook/omp-shared-display/client";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

type EventBus = {
	on(channel: string, handler: (data: unknown) => void): () => void;
	emit(channel: string, data: unknown): void;
};

function makeEventBus(messages: unknown[]): EventBus {
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	return {
		on(channel, handler) {
			const set = listeners.get(channel) ?? new Set();
			set.add(handler);
			listeners.set(channel, set);
			return () => set.delete(handler);
		},
		emit(channel, data) {
			messages.push(data);
			for (const handler of listeners.get(channel) ?? []) handler(data);
		},
	};
}

describe("Headroom Shared Display producer", () => {
	it("publishes headroom snapshots without owning a widget or Ponytail command", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-index-"));
		try {
			const configPath = path.join(root, "config.json");
			const messages: unknown[] = [];
			const events = makeEventBus(messages);
			const handlers = new Map<string, Handler>();
			const commands = new Map<string, { handler: (args: string, ctx: unknown) => unknown | Promise<unknown> }>();
			const pi = {
				events,
				on(event: string, handler: Handler) {
					handlers.set(event, handler);
				},
				registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => unknown | Promise<unknown> }) {
					commands.set(name, command);
				},
				logger: { warn() {}, info() {}, error() {} },
			};
			const { default: headroomExtension } = await import(`./index.ts?headroom=${Date.now()}`);
			headroomExtension(pi as unknown as ExtensionAPI, { configPath, env: { PI_HEADROOM_ENABLED: "0" } });
			expect([...commands.keys()]).toEqual(["headroom"]);
			expect(handlers.has("session_start")).toBe(true);
			expect(handlers.has("session_shutdown")).toBe(true);

			const context = {
				hasUI: true,
				ui: {
					theme: { symbol: () => "·" },
					notify() {},
					custom: undefined,
				},
				model: undefined,
				getContextUsage: () => undefined,
			};
			await handlers.get("session_start")?.({}, context);
			const ready = messages.find((message): message is { kind?: string; source?: string } => typeof message === "object" && message !== null && "kind" in message && (message as { kind?: unknown }).kind === "ready");
			expect(ready).toMatchObject({ kind: "ready", source: "headroom" });

			events.emit(CHANNEL, { protocol: 1, kind: "request", source: "headroom", epoch: "headroom-test" });
			const snapshot = messages.find((message): message is { kind?: string; source?: string; sequence?: unknown } => typeof message === "object" && message !== null && (message as { kind?: unknown }).kind === "snapshot");
			expect(snapshot).toMatchObject({ kind: "snapshot", source: "headroom", epoch: "headroom-test" });
			expect((snapshot as { sequence?: { frames?: unknown[] } }).sequence?.frames).toBeInstanceOf(Array);
			expect(messages.some(message => typeof message === "object" && message !== null && (message as { kind?: unknown }).kind === "ready" && (message as { source?: unknown }).source === "ponytail")).toBe(false);

			await handlers.get("session_shutdown")?.({}, context);
			expect(messages.at(-1)).toMatchObject({ kind: "snapshot", source: "headroom", sequence: null });
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
