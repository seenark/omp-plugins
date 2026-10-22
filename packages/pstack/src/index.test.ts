import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createExtensionModelQuery } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/model-api";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import pstackExtension from "./index.ts";

type Completion = { value: string; label: string; description: string };
type Command = { description?: string; getArgumentCompletions?: (prefix: string) => Completion[] | null; handler: (args: string, ctx: unknown) => unknown };
type Handler = (event: unknown, ctx: unknown) => unknown;

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDirectory(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-test-"));
	roots.push(root);
	return root;
}

/** `configured` lists the model roles that resolve to a model, as `ctx.models.resolve` does in OMP. */
function createHarness(options: { hasUI?: boolean; configured?: string[]; models?: { resolve(spec: string): unknown }; pick?: string } = {}) {
	const menus: string[][] = [];
	const commands = new Map<string, Command>();
	const handlers = new Map<string, Handler>();
	const bus = new Map<string, Array<(data: unknown) => void>>();
	const entries: Array<{ customType: string; data: unknown }> = [];
	const notices: Array<{ level: string; message: string }> = [];
	const logs: Array<{ level: string; message: string }> = [];
	const log = (level: string) => (message: string) => void logs.push({ level, message });
	const events = {
		on: (channel: string, handler: (data: unknown) => void) => {
			bus.set(channel, [...(bus.get(channel) ?? []), handler]);
			return () => void bus.set(channel, (bus.get(channel) ?? []).filter(other => other !== handler));
		},
		emit: (channel: string, data: unknown) => void (bus.get(channel) ?? []).forEach(handler => handler(data)),
	};
	const pi = {
		events,
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerCommand: (name: string, command: Command) => void commands.set(name, command),
		appendEntry: (customType: string, data: unknown) => void entries.push({ customType, data }),
		logger: { info: log("info"), warn: log("warn"), error: log("error") },
	};
	const ctx = {
		hasUI: options.hasUI ?? true,
		agent: { kind: "main", id: "Main", name: "main", depth: 0 },
		ui: {
			notify: (message: string, level: string) => void notices.push({ level, message }),
			select: async (_title: string, items: Array<{ label: string }>) => {
				menus.push(items.map(item => item.label));
				return options.pick;
			},
		},
		sessionManager: { getBranch: () => [] },
		models: options.models ?? {
			resolve: (spec: string) => (options.configured?.includes(spec) ? { provider: "test", id: spec.slice(1) } : undefined),
			family: (model: { provider: string }) => model.provider,
		},
	};
	const home = tempDirectory();
	pstackExtension(pi as never, { homeDirectory: home });
	return {
		commands,
		notices,
		logs,
		entries,
		events,
		home,
		command: (args = "") => commands.get("pstack")!.handler(args, ctx),
		fire: (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx),
		menus,
		complete: (prefix: string) => commands.get("pstack")!.getArgumentCompletions?.(prefix) ?? null,
	};
}

const spawn = (agent: string) => ({ type: "before_subagent_spawn", agent, invocationKind: "task", patterns: [] });

describe("/pstack", () => {
	it("is registered with a description", () => {
		expect(createHarness().commands.get("pstack")?.description).toBeTruthy();
	});

	it("status reports pstack inactive", async () => {
		const h = createHarness();
		await h.command("status");
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]?.level).toBe("info");
		expect(h.notices[0]?.message).toContain("inactive");
	});

	it("completes subcommands and preset names", () => {
		const h = createHarness();
		expect(h.complete("")?.map(c => c.value)).toEqual(["status", "setup", "preset claude-only", "preset claude-codex", "preset lean", "doctor"]);
		expect(h.complete("pr")?.map(c => c.value)).toEqual(["preset claude-only", "preset claude-codex", "preset lean"]);
		expect(h.complete("preset claude-c")?.map(c => c.value)).toEqual(["preset claude-codex"]);
		expect(h.complete("nope")).toBeNull();
	});

	it("bare /pstack with a UI opens a menu and runs the chosen subcommand", async () => {
		const h = createHarness({ pick: "Status" });
		await h.command("");
		expect(h.menus[0]).toEqual(["Status", "Setup", "Preset: claude-only", "Preset: claude-codex", "Preset: lean", "Doctor"]);
		expect(h.notices[0]?.message).toContain("inactive");
	});

	it("bare /pstack menu dismissed does nothing", async () => {
		const h = createHarness();
		await h.command("");
		expect(h.menus).toHaveLength(1);
		expect(h.notices).toEqual([]);
	});

	it("bare /pstack without a UI reports status", async () => {
		const h = createHarness({ hasUI: false });
		await h.command("");
		expect(h.logs[0]?.message).toContain("inactive");
	});

	it("falls back to the logger without a UI", async () => {
		const h = createHarness({ hasUI: false });
		await h.command("status");
		expect(h.notices).toEqual([]);
		expect(h.logs[0]?.level).toBe("info");
		expect(h.logs[0]?.message).toContain("inactive");
	});

	it("rejects an unknown subcommand with a warning and no status", async () => {
		const h = createHarness();
		await h.command("bogus");
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]?.level).toBe("warning");
		expect(h.notices[0]?.message).not.toContain("inactive");
	});
});

describe("panel seat spawn guard", () => {
	it("blocks a seat's critic and builder when the seat role is unset, with a reason for the model", async () => {
		const h = createHarness({ configured: ["@pstack-panel-a"] });
		for (const agent of ["pstack-panel-b-critic", "pstack-panel-b-builder"]) {
			const result = (await h.fire("before_subagent_spawn", spawn(agent))) as { block?: boolean; reason?: string };
			expect(result.block).toBe(true);
			expect(result.reason).toBeTruthy();
		}
	});

	it("lets a seat's agents spawn when the seat role has a model", async () => {
		const h = createHarness({ configured: ["@pstack-panel-b"] });
		for (const agent of ["pstack-panel-b-critic", "pstack-panel-b-builder"]) {
			expect(await h.fire("before_subagent_spawn", spawn(agent))).toBeUndefined();
		}
	});

	it("matches agent names case-insensitively", async () => {
		const h = createHarness();
		const result = (await h.fire("before_subagent_spawn", spawn("PSTACK-Panel-C-Critic"))) as { block?: boolean };
		expect(result.block).toBe(true);
	});

	it("never blocks agents that are not panel seats, even with every role unset", async () => {
		const h = createHarness();
		for (const agent of ["pstack-build", "pstack-judge", "task", "pstack-panel-z-critic", "comment-sicko"]) {
			expect(await h.fire("before_subagent_spawn", spawn(agent))).toBeUndefined();
		}
	});
});

describe("panel seat spawn guard on OMP's real models facade", () => {
	const available = [{ provider: "google", id: "seat-model", name: "seat-model", api: "x", reasoning: false, input: ["text"], contextWindow: 1, maxTokens: 1 }];
	const harness = (modelRoles: Record<string, string>) =>
		createHarness({ models: createExtensionModelQuery({ getAvailable: () => available } as never, Settings.isolated({ modelRoles }), () => undefined) });

	it("blocks a seat whose role is unset and passes a seat whose role is set", async () => {
		const h = harness({ "pstack-panel-a": "google/seat-model" });
		expect(await h.fire("before_subagent_spawn", spawn("pstack-panel-a-critic"))).toBeUndefined();
		expect(((await h.fire("before_subagent_spawn", spawn("pstack-panel-b-critic"))) as { block?: boolean }).block).toBe(true);
	});

	it("blocks a seat whose role names a model the registry does not serve", async () => {
		const h = harness({ "pstack-panel-a": "google/not-served" });
		expect(((await h.fire("before_subagent_spawn", spawn("pstack-panel-a-critic"))) as { block?: boolean }).block).toBe(true);
	});
});

describe("dropouts", () => {
	const lifecycle = (id: string, agent: string, status = "started") => ({ id, agent, status, index: 0 });
	const fallback = (id: string, extra: object = {}) => ({
		id,
		event: { type: "retry_fallback_applied", from: "anthropic/a", to: "openai/b", role: `subagent:${id}`, ...extra },
	});

	it("records a fallback inside a seat's run as a persisted dropout", async () => {
		const h = createHarness();
		await h.fire("session_start");
		h.events.emit("task:subagent:lifecycle", lifecycle("0-Critic", "pstack-panel-b-critic"));
		h.events.emit("task:subagent:event", fallback("0-Critic", { reason: "rate limited" }));
		expect(h.entries).toEqual([
			{
				customType: "dev.codesook.pstack.dropout",
				data: { seat: "b", agent: "pstack-panel-b-critic", id: "0-Critic", from: "anthropic/a", to: "openai/b", reason: "rate limited" },
			},
		]);
	});

	it("ignores a fallback that keeps the model: a thinking level, a provider route or the Fast tier", async () => {
		const h = createHarness();
		await h.fire("session_start");
		h.events.emit("task:subagent:lifecycle", lifecycle("6-Critic", "pstack-panel-a-critic"));
		h.events.emit("task:subagent:event", fallback("6-Critic", { from: "anthropic/a:high", to: "anthropic/a:low" }));
		h.events.emit("task:subagent:event", fallback("6-Critic", { from: "anthropic/a", to: "bedrock/a" }));
		h.events.emit("task:subagent:event", fallback("6-Critic", { from: "fireworks/m-fast", to: "fireworks/m", role: "fireworks-fast" }));
		expect(h.entries).toEqual([]);
		h.events.emit("task:subagent:event", fallback("6-Critic", { from: "anthropic/a:high", to: "openai/b:high" }));
		expect(h.entries).toHaveLength(1);
	});

	it("ignores fallbacks in runs that are not seats, other event types, and unknown runs", async () => {
		const h = createHarness();
		await h.fire("session_start");
		h.events.emit("task:subagent:lifecycle", lifecycle("1-Build", "pstack-build"));
		h.events.emit("task:subagent:event", fallback("1-Build"));
		h.events.emit("task:subagent:lifecycle", lifecycle("2-Critic", "pstack-panel-a-critic"));
		h.events.emit("task:subagent:event", { id: "2-Critic", event: { type: "turn_end" } });
		h.events.emit("task:subagent:event", fallback("never-started"));
		expect(h.entries).toEqual([]);
	});

	it("stops attributing events once the run settled", async () => {
		const h = createHarness();
		await h.fire("session_start");
		h.events.emit("task:subagent:lifecycle", lifecycle("3-Critic", "pstack-panel-a-critic"));
		h.events.emit("task:subagent:lifecycle", lifecycle("3-Critic", "pstack-panel-a-critic", "completed"));
		h.events.emit("task:subagent:event", fallback("3-Critic"));
		expect(h.entries).toEqual([]);
	});

	it("stops observing at session shutdown", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.fire("session_shutdown");
		h.events.emit("task:subagent:lifecycle", lifecycle("4-Critic", "pstack-panel-a-critic"));
		h.events.emit("task:subagent:event", fallback("4-Critic"));
		expect(h.entries).toEqual([]);
	});

	it("does not double-record after a second session_start", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.fire("session_start");
		h.events.emit("task:subagent:lifecycle", lifecycle("5-Critic", "pstack-panel-a-critic"));
		h.events.emit("task:subagent:event", fallback("5-Critic"));
		expect(h.entries).toHaveLength(1);
	});
});

describe("Behavior Configuration through the extension", () => {
	it("warns once at load and uses defaults when the root config is unparseable", () => {
		const home = tempDirectory();
		const file = path.join(home, ".config", "codesook-omp", "config.json");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "{ not json");
		const warnings: string[] = [];
		pstackExtension({ events: { on: () => () => {}, emit() {} }, on() {}, registerCommand() {}, logger: { warn: (m: string) => warnings.push(m) } } as never, { homeDirectory: home });
		expect(warnings).toHaveLength(1);
	});
});
