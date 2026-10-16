import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { suspendInstructionModes } from "@codesook/omp-shared-display/instruction-mode";
import cavemanExtension from "./index.ts";
import { getCodesookOmpConfigPath } from "./types.ts";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function makeHome(): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "caveman-suspend-"));
	homes.push(home);
	const file = getCodesookOmpConfigPath(home);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ version: 1, display: {}, behavior: { caveman: { defaultMode: "caveman" } } }));
	return home;
}

type Handler = (event: unknown, ctx: unknown) => unknown;
type Command = { handler: (args: string, ctx: unknown) => unknown };

function createHarness(home: string, entries: unknown[] = []) {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const bus: Array<(data: unknown) => void> = [];
	const events = {
		on: (_channel: string, handler: (data: unknown) => void) => {
			bus.push(handler);
			return () => void bus.splice(bus.indexOf(handler), 1);
		},
		emit: (_channel: string, data: unknown) => bus.forEach(handler => handler(data)),
	};
	const pi = {
		events,
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerCommand: (name: string, command: Command) => void commands.set(name, command),
		appendEntry: (customType: string, data: unknown) => void entries.push({ type: "custom", customType, data }),
		logger: { warn() {}, info() {}, error() {} },
	};
	const ctx = {
		hasUI: false,
		agent: { id: `a-${homes.length}-${entries.length}` },
		ui: { notify() {}, setStatus() {}, theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text } },
		sessionManager: { getBranch: () => entries },
	};
	cavemanExtension(pi as never, { homeDirectory: home });
	return {
		entries,
		events,
		fire: (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx),
		command: (args: string) => commands.get("caveman")!.handler(args, ctx),
		injected: async () => ((await handlers.get("before_agent_start")!({ systemPrompt: ["BASE"] }, ctx)) as { systemPrompt: string[] } | undefined)?.systemPrompt.length === 2,
	};
}

describe("Caveman suspension by pstack", () => {
	it("switches the session to off, never writes the config, and leaves /caveman working", async () => {
		const home = makeHome();
		const configBefore = fs.readFileSync(getCodesookOmpConfigPath(home), "utf8");
		const h = createHarness(home);
		await h.fire("session_start");
		expect(await h.injected()).toBe(true);
		suspendInstructionModes(h.events, ["caveman"]);
		expect(await h.injected()).toBe(false);
		expect(fs.readFileSync(getCodesookOmpConfigPath(home), "utf8")).toBe(configBefore);
		await h.command("ultracave");
		expect(await h.injected()).toBe(true);
	});

	it("leaves a parallel session on its configured Mode Level", async () => {
		const home = makeHome();
		const suspended = createHarness(home);
		const parallel = createHarness(home);
		await suspended.fire("session_start");
		await parallel.fire("session_start");
		suspendInstructionModes(suspended.events, ["caveman"]);
		expect(await suspended.injected()).toBe(false);
		expect(await parallel.injected()).toBe(true);
	});

	it("keeps the suspension when the session is resumed", async () => {
		const home = makeHome();
		const first = createHarness(home);
		await first.fire("session_start");
		suspendInstructionModes(first.events, ["caveman"]);
		const resumed = createHarness(home, [...first.entries]);
		await resumed.fire("session_start");
		expect(await resumed.injected()).toBe(false);
	});

	it("applies a suspension that arrives before the session starts", async () => {
		const h = createHarness(makeHome());
		suspendInstructionModes(h.events, ["caveman"]);
		await h.fire("session_start");
		expect(await h.injected()).toBe(false);
	});

	it("ignores a suspension that does not name Caveman", async () => {
		const h = createHarness(makeHome());
		await h.fire("session_start");
		suspendInstructionModes(h.events, ["ponytail"]);
		h.events.emit("codesook/instruction-mode-suspension/v1", { protocol: 2, source: "pstack", modes: ["caveman"] });
		expect(await h.injected()).toBe(true);
	});
});
