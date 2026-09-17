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
	it("keeps reachable proxy online after compression endpoint HTTP failure", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-http-error-"));
		let compressionRequests = 0;
		const proxy = Bun.serve({
			port: 0,
			fetch(request) {
				const pathname = new URL(request.url).pathname;
				if (pathname === "/health") return Response.json({ status: "healthy" });
				if (pathname === "/v1/compress") {
					compressionRequests++;
					return Response.json({ detail: "Not Found" }, { status: 404 });
				}
				return new Response("not found", { status: 404 });
			},
		});
		const notifications: Array<{ message: string; type: string }> = [];
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
			const { default: headroomExtension } = await import(`./index.ts?headroom-http-error=${Date.now()}-${Math.random()}`);
			headroomExtension(pi as unknown as ExtensionAPI, {
				configPath,
				env: {
					PI_HEADROOM_ENABLED: "1",
					PI_HEADROOM_URL: `http://127.0.0.1:${proxy.port}`,
					PI_HEADROOM_MIN_CONTEXT_TOKENS: "1",
					PI_HEADROOM_MIN_MESSAGE_CHARS: "1",
					PI_HEADROOM_TIMEOUT_MS: "1000",
				},
			});

			const context = {
				hasUI: true,
				ui: {
					theme: { symbol: () => "·" },
					notify(message: string, type: string) {
						notifications.push({ message, type });
					},
					custom: undefined,
				},
				model: undefined,
				getContextUsage: () => ({ tokens: 10 }),
			};
			await handlers.get("session_start")?.({}, context);
			await commands.get("headroom")?.handler("health", context);
			const contextEvent = {
				messages: [
					{
						role: "toolResult",
						toolCallId: "call_1",
						toolName: "test",
						content: [{ type: "text", text: "large result" }],
						isError: false,
						timestamp: 1,
					},
				],
			};
			await handlers.get("context")?.(contextEvent, context);
			expect(compressionRequests).toBe(1);
			await handlers.get("context")?.(contextEvent, context);
			expect(compressionRequests).toBe(1);
			await commands.get("headroom")?.handler("status", context);

			const status = notifications.find(({ message }) => message.startsWith("Headroom token compression"));
			expect(status?.message).toContain(`Proxy:   http://127.0.0.1:${proxy.port} (online)`);
			expect(status?.message).toContain("Compression: unavailable");
			expect(status?.message).toContain("Last error: Headroom /v1/compress failed with HTTP 404");
			expect(notifications.some(({ message }) => message.includes("Headroom proxy unavailable"))).toBe(false);
		} finally {
			proxy.stop(true);
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
	it("stores an interactive proxy token and reloads the client for health checks", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-token-command-"));
		let healthToken: string | null = null;
		const proxy = Bun.serve({
			port: 0,
			fetch(request) {
				if (new URL(request.url).pathname === "/health") {
					healthToken = request.headers.get("x-headroom-proxy-token");
					return Response.json({ status: "healthy" });
				}
				return new Response("not found", { status: 404 });
			},
		});
		try {
			const configPath = path.join(root, "config.json");
			const tokenPath = path.join(root, "headroom", "proxy-token");
			fs.writeFileSync(
				configPath,
				JSON.stringify({
					enabled: true,
					baseUrl: `http://127.0.0.1:${proxy.port}`,
					allowRemote: false,
					minContextTokens: 1,
					minMessageChars: 1,
					timeoutMs: 1000,
					proxyTokenFile: tokenPath,
				}),
			);
			const events = makeEventBus([]);
			const commands = new Map<string, { handler: (args: string, ctx: unknown) => unknown | Promise<unknown> }>();
			const notifications: string[] = [];
			const pi = {
				events,
				on() {},
				registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => unknown | Promise<unknown> }) {
					commands.set(name, command);
				},
				logger: { warn() {}, info() {}, error() {} },
			};
			const { default: headroomExtension } = await import(`./index.ts?headroom-token-command=${Date.now()}-${Math.random()}`);
			headroomExtension(pi as unknown as ExtensionAPI, { configPath, env: { PI_HEADROOM_ENABLED: "1" } });

			const context = {
				hasUI: true,
				ui: {
					theme: { symbol: () => "·" },
					input: async (title: string) => {
						expect(title).toBe("Headroom proxy token (visible)");
						return "proxy-secret";
					},
					notify(message: string) {
						notifications.push(message);
					},
					custom: undefined,
				},
				model: undefined,
				getContextUsage: () => ({ tokens: 10 }),
			};
			await commands.get("headroom")?.handler("token", context);

			expect(fs.readFileSync(tokenPath, "utf8")).toBe("proxy-secret\n");
			expect(fs.statSync(tokenPath).mode & 0o777).toBe(0o600);
			expect(healthToken === "proxy-secret").toBe(true);
			expect(notifications.at(-1)).toContain("Proxy online");
			await commands.get("headroom")?.handler("token leaked-secret", context);
			expect(notifications.at(-1)).toContain("Usage: /headroom");
			expect(fs.readFileSync(tokenPath, "utf8")).toBe("proxy-secret\n");
		} finally {
			proxy.stop(true);
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
