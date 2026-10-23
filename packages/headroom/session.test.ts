import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { formatCompact } from "./display.ts";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import sharedDisplayExtension, {
	DEFAULT_SHARED_DISPLAY_CONFIG,
	writeSharedDisplayConfig,
} from "@codesook/omp-shared-display";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type Message = Record<string, unknown>;
type CompressBody = { messages: Array<Record<string, unknown>>; model: string; config: Record<string, unknown> };
type CompressHandler = (body: CompressBody, count: number) => Response | Promise<Response>;

const RAW_COMMAND = "cat a";
const CALL_CHARS = "bash".length + JSON.stringify({ command: RAW_COMMAND }).length;

const shrinkAll: CompressHandler = body =>
	Response.json({
		messages: body.messages.map(message =>
			message.role === "tool" && String(message.content).length > 10 ? { ...message, content: "small" } : message,
		),
		tokens_before: 1,
		tokens_after: 1,
		tokens_saved: 0,
		compression_ratio: 1,
		transforms_applied: ["test"],
		ccr_hashes: [],
		session: { id: String(body.config.session_id), frozen_message_count: 1, cached_prefix_replayed: false },
	});

function call(id: string, command = RAW_COMMAND, withUsage = false): Message {
	const usage = withUsage ? { usage: { input: 2800, output: 10, cacheRead: 0, cacheWrite: 0 } } : {};
	return { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }], timestamp: 1, ...usage };
}

function result(id: string, text: string, isError = false): Message {
	return { role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text }], isError, timestamp: 2 };
}

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

function texts(messages: readonly Message[] | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const message of messages ?? []) {
		if (message.role === "toolResult") out[String(message.toolCallId)] = (message.content as Array<{ text: string }>)[0]?.text ?? "";
	}
	return out;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
	setSystemTime();
	for (const cleanup of cleanups.splice(0)) cleanup();
});

async function createHarness(options: { healthDelayMs?: number; timeoutMs?: number } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-session-"));
	const requests = { health: 0, compress: 0 };
	const bodies: CompressBody[] = [];
	let compressHandler: CompressHandler = shrinkAll;
	const fetchHandler = async (request: Request): Promise<Response> => {
		const pathname = new URL(request.url).pathname;
		if (pathname === "/health") {
			requests.health++;
			// Real delay on purpose: the plugin must await an in-flight request, which fake timers cannot model.
			if (options.healthDelayMs) await Bun.sleep(options.healthDelayMs);
			return Response.json({ status: "healthy" });
		}
		if (pathname === "/v1/compress") {
			const body = (await request.json()) as CompressBody;
			bodies.push(body);
			return compressHandler(body, ++requests.compress);
		}
		return new Response("not found", { status: 404 });
	};
	let proxy = Bun.serve({ port: 0, fetch: fetchHandler });
	const port = proxy.port;

	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const events = {
		on(channel: string, handler: (data: unknown) => void) {
			const set = listeners.get(channel) ?? new Set();
			set.add(handler);
			listeners.set(channel, set);
			return () => set.delete(handler);
		},
		emit(channel: string, data: unknown) {
			for (const handler of listeners.get(channel) ?? []) handler(data);
		},
	};
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
	const notifications: string[] = [];
	let widget: { render(width: number): readonly string[] } | undefined;
	let contextTokens: number | undefined = 1000;
	const session = { id: "agent-session-1" };
	const ctx = {
		hasUI: true,
		ui: {
			theme: { symbol: () => "·" },
			notify(message: string) {
				notifications.push(message);
			},
			custom: undefined,
			setStatus() {},
			setWidget(_key: string, factory: ((tui: { requestComponentRender(): void }) => { render(width: number): readonly string[] }) | undefined) {
				widget = factory?.({ requestComponentRender() {} });
			},
		},
		model: undefined,
		getContextUsage: () => (contextTokens === undefined ? undefined : { tokens: contextTokens }),
		sessionManager: { getBranch: () => [], getSessionId: () => session.id },
		setInterval() {
			throw new Error("Headroom must not start a timer");
		},
		clearTimer() {},
	};

	const configPath = path.join(root, "config.json");
	const hostConfigPath = path.join(root, "shared-display.json");
	writeSharedDisplayConfig({ ...DEFAULT_SHARED_DISPLAY_CONFIG, order: ["headroom"] }, hostConfigPath);
	const { default: headroomExtension } = await import(`./index.ts?session=${Date.now()}-${Math.random()}`);
	headroomExtension(pi as unknown as ExtensionAPI, {
		configPath,
		glyphDirectory: root,
		env: {
			PI_HEADROOM_ENABLED: "1",
			PI_HEADROOM_URL: `http://127.0.0.1:${port}`,
			PI_HEADROOM_MIN_CONTEXT_TOKENS: "100",
			PI_HEADROOM_MIN_MESSAGE_CHARS: "10",
			PI_HEADROOM_TIMEOUT_MS: String(options.timeoutMs ?? 2000),
		},
	});
	const hostHandlers = new Map<string, Handler>();
	sharedDisplayExtension(
		{ events, on: (event: string, handler: Handler) => hostHandlers.set(event, handler) } as unknown as ExtensionAPI,
		{ configPath: hostConfigPath },
	);
	cleanups.push(() => {
		proxy.stop(true);
		fs.rmSync(root, { recursive: true, force: true });
	});

	const harness = {
		requests,
		bodies,
		notifications,
		session,
		setCompress(next: CompressHandler) {
			compressHandler = next;
		},
		setContextTokens(tokens: number | undefined) {
			contextTokens = tokens;
		},
		restartProxy() {
			proxy = Bun.serve({ port, fetch: fetchHandler });
		},
		stopProxy() {
			proxy.stop(true);
		},
		fire: async (event: string) => {
			await handlers.get(event)?.({}, ctx);
		},
		async start() {
			await handlers.get("session_start")?.({}, ctx);
			await hostHandlers.get("session_start")?.({}, ctx);
		},
		async context(messages: Message[]): Promise<Message[] | undefined> {
			const out = (await handlers.get("context")?.({ messages }, ctx)) as { messages?: Message[] } | undefined;
			return out?.messages;
		},
		widget: () => (widget?.render(120) ?? []).join("\n"),
		async command(args: string) {
			await commands.get("headroom")?.handler(args, ctx);
		},
		async status(): Promise<string> {
			notifications.length = 0;
			await commands.get("headroom")?.handler("status", ctx);
			return notifications.at(-1) ?? "";
		},
	};
	return harness;
}

describe("Headroom Agent Session compression", () => {
	it("sends a stable session id and real tool calls, and shows Headroom Savings once tokens are saved", async () => {
		const h = await createHarness();
		await h.start();
		expect(await h.status()).toContain("Headroom Savings: 0%");
		await h.command("health");
		expect(h.widget()).toContain("Headroom");
		expect(h.widget()).not.toContain("saved");

		// 3.8k-token request (system prompt and tools included); 4000 chars = 1000 tokens shrink to 2.
		h.setContextTokens(3800);
		const first = [call("c1"), result("c1", "a".repeat(4000))];
		expect(texts(await h.context(first))).toEqual({ c1: "small" });
		expect(h.bodies[0]?.config).toEqual({ session_id: "agent-session-1" });
		const assistant = h.bodies[0]?.messages[0] as { tool_calls: Array<{ function: { name: string; arguments: string } }> };
		expect(assistant.tool_calls[0]?.function).toEqual({ name: "bash", arguments: JSON.stringify({ command: RAW_COMMAND }) });

		// Whole-request denominator: 998 of 3800 = 26%, not 998 of the message payload alone.
		const status = await h.status();
		expect(status).toContain("Headroom Savings: 26% (998 of 3.8k tokens saved over 1 calls)");
		expect(status).toContain("Server session: agent-session-1");
		expect(h.widget()).toContain("Headroom 998 saved");

		// Second call: the assistant after c1 carries provider usage (anchor), so OMP's estimate already counts
		// c1 compressed (2810 = prior prompt) plus c2 at original size (1000). c1's 998 saved are added back.
		h.setContextTokens(2810 + 1000);
		const second = [call("c1"), result("c1", "a".repeat(4000)), call("c2", RAW_COMMAND, true), result("c2", "b".repeat(4000))];
		expect(texts(await h.context(second))).toEqual({ c1: "small", c2: "small" });
		// before = 3810 + 998 = 4808, saved = 998 (replay) + 999 (new, aggregate rounding: 1997); cumulative 2995 of 8608.
		expect(await h.status()).toContain("Headroom Savings: 35% (3k of 8.6k tokens saved over 2 calls)");
		expect(h.widget()).toContain("Headroom 3k saved");
		expect(await h.status()).toContain("2k of 4.8k tokens saved (42%)");
	});

	it("falls back to the message payload estimate when OMP reports no context usage", async () => {
		const h = await createHarness();
		await h.start();
		h.setContextTokens(undefined);
		await h.context([call("c1"), result("c1", "a".repeat(4000))]);
		const before = Math.ceil((4000 + CALL_CHARS) / 4);
		const saved = 1000 - 2;
		expect(await h.status()).toContain(`Headroom Savings: ${Math.round((saved / before) * 100)}% (998 of ${formatCompact(before)} tokens saved over 1 calls)`);
	});

	it("keeps forwarded bytes stable across skipped, 503, timed-out, and below-threshold calls", async () => {
		const h = await createHarness({ timeoutMs: 150 });
		await h.start();
		const history: Message[] = [call("c1"), result("c1", "a".repeat(400))];
		expect(texts(await h.context(history))).toEqual({ c1: "small" });

		// 503 twice (original + one retry): memo only, new result stays raw.
		h.setCompress(() => Response.json({ detail: "busy" }, { status: 503 }));
		history.push(call("c2"), result("c2", "b".repeat(300)));
		const compressBefore503 = h.requests.compress;
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "b".repeat(300) });
		expect(h.requests.compress - compressBefore503).toBe(2);

		// 200 + compression_skipped returns originals; c1 is still replayed.
		h.setCompress(body =>
			Response.json({
				messages: body.messages,
				tokens_before: 1,
				tokens_after: 1,
				tokens_saved: 0,
				compression_ratio: 1,
				transforms_applied: [],
				compression_skipped: true,
				skip_reason: "compression_timeout",
			}),
		);
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "b".repeat(300) });

		// Client timeout: same.
		h.setCompress(async () => {
			// Real delay on purpose: exercises the client's AbortSignal.timeout (150 ms above).
			await Bun.sleep(400);
			return Response.json({});
		});
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "b".repeat(300) });
		expect(await h.status()).not.toContain("Compression: unavailable");

		// Below the context threshold the server is not called, memo still applies.
		h.setContextTokens(5);
		const compressBeforeSkip = h.requests.compress;
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "b".repeat(300) });
		expect(h.requests.compress).toBe(compressBeforeSkip);

		// Recovery: transient failures never marked compression unavailable, so the next call compresses c2.
		h.setContextTokens(1000);
		h.setCompress(shrinkAll);
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "small" });
	});

	it("retries a 503 once immediately", async () => {
		const h = await createHarness();
		await h.start();
		h.setCompress((body, count) => (count === 1 ? Response.json({ detail: "busy" }, { status: 503 }) : shrinkAll(body, count)));
		expect(texts(await h.context([call("c1"), result("c1", "a".repeat(400))]))).toEqual({ c1: "small" });
		expect(h.requests.compress).toBe(2);
	});

	it("never replaces failed or RTK-processed results", async () => {
		const h = await createHarness();
		await h.start();
		const out = await h.context([
			call("ok", "cat big.log"),
			result("ok", "a".repeat(300)),
			call("failed", "make test"),
			result("failed", "f".repeat(300), true),
			call("rtk", "cd app && rtk cargo test"),
			result("rtk", "r".repeat(300)),
		]);
		expect(texts(out)).toEqual({ ok: "small", failed: "f".repeat(300), rtk: "r".repeat(300) });
	});

	it("applies candidate changes even when the server also rewrites other messages", async () => {
		const h = await createHarness();
		await h.start();
		h.setCompress((body, count) => {
			const base = shrinkAll(body, count) as Response;
			return base.json().then((json: { messages: Array<Record<string, unknown>> }) =>
				Response.json({
					...json,
					messages: json.messages.map(message =>
						message.role === "user" ? { ...message, content: "rewritten" } : message.role === "assistant" ? { ...message, content: "rewritten" } : message,
					),
				}),
			);
		});
		const out = await h.context([user("go"), call("c1"), result("c1", "a".repeat(300))]);
		expect(texts(out)).toEqual({ c1: "small" });
		expect(out?.[0]).toEqual(user("go"));
	});

	it("shows Compression Unavailable with the status, stops calling, and recovers lazily after the backoff", async () => {
		const h = await createHarness();
		await h.start();
		h.setCompress(() => Response.json({ detail: "bad token" }, { status: 401 }));
		const history: Message[] = [call("c1"), result("c1", "a".repeat(400))];

		expect(await h.context(history)).toBeUndefined();
		expect(h.widget()).toContain("Headroom unavailable (401)");
		const status = await h.status();
		expect(status).toContain("Compression: unavailable");
		expect(status).toContain("Unavailable reason: 401");
		expect(status).toContain("Next health retry");

		const health = h.requests.health;
		history.push(call("c2"), result("c2", "b".repeat(400)));
		expect(await h.context(history)).toBeUndefined();
		expect(h.requests.compress).toBe(1);
		expect(h.requests.health).toBe(health);

		h.setCompress(shrinkAll);
		setSystemTime(new Date(Date.now() + 31_000));
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "small" });
		expect(h.requests.health).toBe(health + 1);
		expect(h.widget()).toMatch(/Headroom \d+ saved/);
		expect(h.widget()).not.toContain("unavailable");
	});

	it("goes offline on network failure, keeps replaying the memo, and re-checks with growing backoff", async () => {
		const h = await createHarness();
		await h.start();
		const history: Message[] = [call("c1"), result("c1", "a".repeat(400))];
		expect(texts(await h.context(history))).toEqual({ c1: "small" });

		h.stopProxy();
		history.push(call("c2"), result("c2", "b".repeat(400)));
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "b".repeat(400) });
		expect(h.widget()).toContain("Headroom not running");
		expect(await h.status()).toContain("Next health retry: on the next request after 30s");

		// Still down after the first backoff: next delay doubles to 60s.
		setSystemTime(new Date(Date.now() + 31_000));
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "b".repeat(400) });
		expect(await h.status()).toContain("after 60s");

		h.restartProxy();
		setSystemTime(new Date(Date.now() + 61_000));
		expect(texts(await h.context(history))).toEqual({ c1: "small", c2: "small" });
		expect(h.widget()).toMatch(/Headroom \d+ saved/);
	});

	it("waits for the in-flight startup health check before the first call", async () => {
		const h = await createHarness({ healthDelayMs: 200 });
		await h.start();
		expect(texts(await h.context([call("c1"), result("c1", "a".repeat(400))]))).toEqual({ c1: "small" });
	});

	it("keeps session stats and memo on branch, resets them on switch and start", async () => {
		const h = await createHarness();
		await h.start();
		await h.context([call("c1"), result("c1", "a".repeat(400))]);
		const before = await h.status();
		expect(before).toContain("Compressed results replayed: 1");

		await h.fire("session_branch");
		const afterBranch = await h.status();
		expect(afterBranch).toContain("Compressed results replayed: 1");
		expect(afterBranch).toContain("Agent Session: agent-session-1");
		expect(afterBranch.match(/Headroom Savings: .*/)?.[0]).toBe(before.match(/Headroom Savings: .*/)?.[0]);

		h.session.id = "agent-session-2";
		await h.fire("session_switch");
		const afterSwitch = await h.status();
		expect(afterSwitch).toContain("Headroom Savings: 0% (0 of 0 tokens saved over 0 calls)");
		expect(afterSwitch).toContain("Compressed results replayed: 0");
		await h.context([call("c9"), result("c9", "z".repeat(400))]);
		expect(h.bodies.at(-1)?.config).toEqual({ session_id: "agent-session-2" });
	});
});
