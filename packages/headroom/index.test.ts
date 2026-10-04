import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import sharedDisplayExtension, {
	DEFAULT_SHARED_DISPLAY_CONFIG,
	writeSharedDisplayConfig,
} from "@codesook/omp-shared-display";

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
	it("replays Headroom into a late host and removes its segment on shutdown", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-index-"));
		try {
			const configPath = path.join(root, "config.json");
			fs.writeFileSync(configPath, JSON.stringify({ display: { glyphDirectory: root } }));
			const hostConfigPath = path.join(root, "shared-display.json");
			writeSharedDisplayConfig({ ...DEFAULT_SHARED_DISPLAY_CONFIG, order: ["headroom"] }, hostConfigPath);
			const messages: unknown[] = [];
			const events = makeEventBus(messages);
			const handlers = new Map<string, Handler>();
			const pi = {
				events,
				on(event: string, handler: Handler) {
					handlers.set(event, handler);
				},
				registerCommand() {},
				logger: { warn() {}, info() {}, error() {} },
			};
			const { default: headroomExtension } = await import(`./index.ts?headroom=${Date.now()}`);
			headroomExtension(pi as unknown as ExtensionAPI, { configPath, env: { PI_HEADROOM_ENABLED: "0" } });

			let widget: { render(width: number): readonly string[] } | undefined;
			const context = {
				hasUI: true,
				ui: {
					theme: { symbol: () => "·" },
					notify() {},
					custom: undefined,
					setStatus() {},
					setWidget(_key: string, factory: ((tui: { requestComponentRender(): void }) => { render(width: number): readonly string[] }) | undefined) {
						widget = factory?.({ requestComponentRender() {} });
					},
				},
				model: undefined,
				getContextUsage: () => undefined,
				sessionManager: { getBranch: () => [] },
				setInterval() { throw new Error("Static Headroom status must not start a timer"); },
				clearTimer() {},
			};
			await handlers.get("session_start")?.({}, context);
			expect(widget).toBeUndefined();
			const hostHandlers = new Map<string, Handler>();
			sharedDisplayExtension({
				events,
				on(event: string, handler: Handler) { hostHandlers.set(event, handler); },
			} as unknown as ExtensionAPI, { configPath: hostConfigPath });
			await hostHandlers.get("session_start")?.({}, context);
			expect(widget?.render(14)).toEqual(["· Headroom off"]);
			await handlers.get("session_shutdown")?.({}, context);
			expect(widget).toBeUndefined();
			await hostHandlers.get("session_shutdown")?.({}, context);
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
