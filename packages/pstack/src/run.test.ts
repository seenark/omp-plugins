import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isRecord } from "@codesook/omp-shared-display/config-store";
import { SHARED_DISPLAY_CHANNEL, type FrameSequence } from "@codesook/omp-shared-display/client";
import { INSTRUCTION_MODE_SUSPENSION_CHANNEL } from "@codesook/omp-shared-display/instruction-mode";
import pstackExtension from "./index.ts";
import { SINGLE_VENDOR_WARNING } from "./setup/rules.ts";
import { duplicateCandidates, mergeVerdicts } from "./verdict.ts";
import { INACTIVE_RUN, RECEIPT_ENTRY_TYPE, RUN_ENTRY_TYPE, rebuildRunState } from "./run-state.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Command = { handler: (args: string, ctx: unknown) => unknown };
type Snapshot = { kind: string; source: string; sequence: FrameSequence | null };
type SessionEntry = { type: "custom"; customType: string; data: unknown };

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDirectory(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-run-test-"));
	roots.push(root);
	return root;
}

function skillFixture(): string {
	const directory = tempDirectory();
	fs.writeFileSync(path.join(directory, "SKILL.md"), "---\nname: poteto-mode\n---\n\n# Poteto mode\n\nSKILL-BODY-SENTINEL\n");
	return directory;
}

const SEAT_MODELS: Record<string, string> = { "@pstack-panel-a": "anthropic/a", "@pstack-panel-b": "openai/b", "@pstack-panel-c": "google/c" };

/** `entries` is the session branch: pass the same array to a second harness to model resuming the session. */
function createHarness(options: { entries?: SessionEntry[]; idle?: boolean; maxPanelSize?: number; behavior?: Record<string, unknown>; home?: string; seatModels?: Record<string, string> } = {}) {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const bus = new Map<string, Array<(data: unknown) => void>>();
	const entries = options.entries ?? [];
	const notices: Array<{ level: string; message: string }> = [];
	const sentMessages: Array<{ message: { customType?: string; content?: string; display?: boolean }; options?: unknown }> = [];
	const sentPrompts: Array<{ text: string; options?: unknown }> = [];
	const snapshots: Snapshot[] = [];
	const suspensions: Array<{ protocol: number; source: string; modes: string[] }> = [];
	const events = {
		on(channel: string, handler: (data: unknown) => void) {
			bus.set(channel, [...(bus.get(channel) ?? []), handler]);
			return () => void bus.set(channel, (bus.get(channel) ?? []).filter(other => other !== handler));
		},
		emit(channel: string, data: unknown) {
			if (channel === SHARED_DISPLAY_CHANNEL && isRecord(data) && data.kind === "snapshot" && data.source === "pstack") snapshots.push(data as Snapshot);
			if (channel === INSTRUCTION_MODE_SUSPENSION_CHANNEL) suspensions.push(data as (typeof suspensions)[number]);
			for (const handler of bus.get(channel) ?? []) handler(data);
			// A running host answers a producer's ready message, so every publish becomes a snapshot.
			if (isRecord(data) && data.kind === "ready" && data.source === "pstack") events.emit(SHARED_DISPLAY_CHANNEL, { protocol: 1, kind: "host", epoch: "e1", active: true });
		},
	};
	const pi = {
		events,
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerCommand: (name: string, command: Command) => void commands.set(name, command),
		appendEntry: (customType: string, data: unknown) => void entries.push({ type: "custom", customType, data }),
		sendMessage: (message: never, sendOptions?: unknown) => void sentMessages.push({ message, options: sendOptions }),
		sendUserMessage: (text: string, sendOptions?: unknown) => void sentPrompts.push({ text, options: sendOptions }),
		logger: { info() {}, warn() {}, error() {} },
	};
	let idle = options.idle ?? true;
	const ctx = {
		hasUI: true,
		isIdle: () => idle,
		ui: { notify: (message: string, level: string) => void notices.push({ level, message }) },
		sessionManager: { getBranch: () => entries },
		models: {
			resolve: (spec: string) => {
				const model = (options.seatModels ?? SEAT_MODELS)[spec];
				return model ? { provider: model.split("/")[0], id: model.split("/")[1] } : undefined;
			},
			family: (model: { provider: string }) => model.provider,
		},
	};
	const home = options.home ?? tempDirectory();
	const pstackBehavior = { ...(options.maxPanelSize === undefined ? {} : { maxPanelSize: options.maxPanelSize }), ...options.behavior };
	if (Object.keys(pstackBehavior).length > 0) {
		const file = path.join(home, ".config", "codesook-omp", "config.json");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ version: 1, display: {}, behavior: { pstack: pstackBehavior } }));
	}
	pstackExtension(pi as never, { homeDirectory: home, skillDirectory: skillFixture() });
	const fire = (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx);
	const lifecycle = (id: string, agent: string, status: string) => events.emit("task:subagent:lifecycle", { id, agent, status, index: 0 });
	return {
		entries,
		notices,
		sentMessages,
		sentPrompts,
		snapshots,
		suspensions,
		events,
		fire,
		setIdle: (value: boolean) => void (idle = value),
		command: (name: string, args = "") => commands.get(name)!.handler(args, ctx),
		status: async () => {
			notices.length = 0;
			await commands.get("pstack")!.handler("status", ctx);
			return notices[0]!.message;
		},
		segment: () => snapshots.at(-1)?.sequence?.frames[0]?.[0],
		lifecycle,
		seatRun: (id: string, agent: string, status = "completed") => {
			lifecycle(id, agent, "started");
			lifecycle(id, agent, status);
		},
		skillPrompt: (name: string, attribution: string, args?: string) =>
			fire("message_start", { type: "message_start", message: { role: "custom", customType: "skill-prompt", attribution, details: { name, args } } }),
		todo: (phases: Array<{ name: string; tasks: Array<{ content: string; status: string }> }>, isError = false) =>
			fire("tool_result", { type: "tool_result", toolName: "todo", input: {}, content: [], isError, details: { op: "init", phases } }),
		read: (target: string, isError = false) =>
			fire("tool_result", { type: "tool_result", toolName: "read", input: { path: target }, content: [], isError, details: undefined }),
	};
}

const todo = (done: number, total: number) => [
	{ name: "Steps", tasks: Array.from({ length: total }, (_, index) => ({ content: `step ${index + 1}`, status: index < done ? "completed" : index === done ? "in_progress" : "pending" })) },
];
const PLAYBOOK = "/pkg/skills/poteto-mode/playbooks/feature.md";

const activatedEntries = (entries: SessionEntry[]) => entries.filter(entry => entry.customType === RUN_ENTRY_TYPE && (entry.data as { kind: string }).kind === "activated");

describe("activation", () => {
	it("/poteto <task> starts poteto-mode on the task and reports pstack active", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "ship the thing");
		expect(h.sentPrompts).toHaveLength(1);
		expect(h.sentPrompts[0]!.text).toContain("SKILL-BODY-SENTINEL");
		expect(h.sentPrompts[0]!.text).toContain("ship the thing");
		expect(h.sentPrompts[0]!.options).toBeUndefined();
		expect(await h.status()).toContain("active");
		expect(await h.status()).toContain("ship the thing");
		expect(h.segment()).toBe("pstack");
	});

	it("/poteto queues as a follow-up while the agent is busy", async () => {
		const h = createHarness({ idle: false });
		await h.fire("session_start");
		await h.command("poteto", "later");
		expect(h.sentPrompts[0]!.options).toEqual({ deliverAs: "followUp" });
		expect(h.segment()).toBe("pstack");
	});

	it("/poteto without a task still starts poteto-mode", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto");
		expect(h.sentPrompts).toHaveLength(1);
		expect(h.segment()).toBe("pstack");
	});

	it("/skill:poteto-mode typed by the user activates through the input event", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.fire("input", { type: "input", text: "/skill:poteto-mode fix the bug", source: "interactive" });
		expect(await h.status()).toContain("fix the bug");
		expect(h.segment()).toBe("pstack");
		expect(h.sentPrompts).toEqual([]);
	});

	it("/skill:poteto-mode activates through its skill-prompt message where no input event exists", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.skillPrompt("poteto-mode", "user", "fix the bug");
		expect(await h.status()).toContain("fix the bug");
		expect(h.segment()).toBe("pstack");
	});

	it("does not activate on other input, extension input, other skills or autoloaded skill prompts", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.fire("input", { type: "input", text: "fix the bug", source: "interactive" });
		await h.fire("input", { type: "input", text: "explain /skill:poteto-mode to me", source: "interactive" });
		await h.fire("input", { type: "input", text: "/skill:poteto-mode-extra x", source: "interactive" });
		await h.fire("input", { type: "input", text: "/skill:poteto-mode x", source: "extension" });
		await h.skillPrompt("how", "user");
		await h.skillPrompt("poteto-mode", "agent");
		expect(await h.status()).toContain("inactive");
		expect(h.entries).toEqual([]);
	});

	it("activates once: a second start in an active session records nothing new", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.fire("input", { type: "input", text: "/skill:poteto-mode a", source: "interactive" });
		await h.skillPrompt("poteto-mode", "user", "a");
		await h.command("poteto", "again");
		expect(activatedEntries(h.entries)).toHaveLength(1);
	});

	it("tells the session which panel seats are configured, as a hidden note for the next turn", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		expect(h.sentMessages).toHaveLength(1);
		const { message, options } = h.sentMessages[0]!;
		expect(message.display).toBe(false);
		expect(options).toEqual({ deliverAs: "nextTurn" });
		for (const seat of ["pstack-panel-a", "pstack-panel-b", "pstack-panel-c"]) expect(message.content).toContain(seat);
		expect(message.content).not.toContain("pstack-panel-d");
	});

	it("caps the roster by the maximum panel size", async () => {
		const h = createHarness({ maxPanelSize: 2 });
		await h.fire("session_start");
		await h.command("poteto", "x");
		expect(h.sentMessages[0]!.message.content).toContain("pstack-panel-b");
		expect(h.sentMessages[0]!.message.content).not.toContain("pstack-panel-c");
	});
});

describe("seat roster and the panel skills", () => {
	const CLAUDE_ONLY = { "@pstack-panel-a": "anthropic/claude-a", "@pstack-panel-b": "anthropic/claude-b" };
	const roster = (h: ReturnType<typeof createHarness>) => h.sentMessages.filter(sent => sent.message.customType === "dev.codesook.pstack.roster");

	it("names each seat's model and vendor so a merged verdict can name them", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		const content = h.sentMessages[0]!.message.content!;
		for (const model of ["anthropic/a", "openai/b", "google/c"]) expect(content).toContain(model);
		for (const vendor of ["anthropic", "openai", "google"]) expect(content).toContain(`vendor ${vendor}`);
		expect(content).not.toContain(SINGLE_VENDOR_WARNING);
	});

	it("tells the session when every configured seat is one vendor", async () => {
		const h = createHarness({ seatModels: CLAUDE_ONLY });
		await h.fire("session_start");
		await h.command("poteto", "x");
		expect(h.sentMessages[0]!.message.content).toContain(SINGLE_VENDOR_WARNING);
	});

	it("sends the roster when a panel skill starts outside a run, for interactive and print modes", async () => {
		for (const skill of ["interrogate", "arena", "swarm", "architect", "how"]) {
			const typed = createHarness();
			await typed.fire("session_start");
			await typed.fire("input", { type: "input", text: `/skill:${skill} the diff`, source: "interactive" });
			expect(roster(typed)).toHaveLength(1);
			expect(roster(typed)[0]!.options).toEqual({ deliverAs: "nextTurn" });
			const printed = createHarness();
			await printed.fire("session_start");
			await printed.skillPrompt(skill, "user", "the diff");
			expect(roster(printed)).toHaveLength(1);
			expect(await printed.status()).toContain("inactive");
		}
	});

	it("sends the roster once when both the input event and the skill-prompt message arrive", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.fire("input", { type: "input", text: "/skill:interrogate", source: "interactive" });
		await h.skillPrompt("interrogate", "user");
		expect(roster(h)).toHaveLength(1);
		await h.skillPrompt("interrogate", "user");
		expect(roster(h)).toHaveLength(2);
	});

	it("does not resend the roster inside an active run, for other skills, autoloaded prompts or extension input", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		expect(roster(h)).toHaveLength(1);
		await h.fire("input", { type: "input", text: "/skill:interrogate", source: "interactive" });
		await h.skillPrompt("interrogate", "user");
		expect(roster(h)).toHaveLength(1);
		const idle = createHarness();
		await idle.fire("session_start");
		await idle.fire("input", { type: "input", text: "/skill:why x", source: "interactive" });
		await idle.fire("input", { type: "input", text: "/skill:how-to x", source: "interactive" });
		await idle.fire("input", { type: "input", text: "/skill:interrogate", source: "extension" });
		await idle.skillPrompt("interrogate", "autoload");
		await idle.skillPrompt("why", "user");
		expect(roster(idle)).toHaveLength(0);
	});

	it("lists no seats when none is configured", async () => {
		const h = createHarness({ seatModels: {} });
		await h.fire("session_start");
		await h.fire("input", { type: "input", text: "/skill:interrogate", source: "interactive" });
		expect(roster(h)[0]!.message.content).not.toContain("vendor");
	});
});

describe("interrogate dispatch shape", () => {
	const spawn = (agent: string) => ({ type: "before_subagent_spawn", agent, patterns: [], modelRole: undefined });
	const verdict = (value: string, findings: object[] = []) => ({ verdict: value, summary: "s", findings });
	const finding = (severity: string, claim: string) => ({ severity, file: "src/a.ts", line: 3, claim, evidence: "e" });

	/** The seats the roster names are the seats the skill dispatches: read them back out of the hidden note, as the model does. */
	const rosterSeats = (h: ReturnType<typeof createHarness>): string[] => [...(h.sentMessages[0]!.message.content!.matchAll(/(?:^|, |: )([A-E]) \(pstack-panel-[a-e]: ([^,]+), vendor ([^)]+)\)/g))].map(match => match[1]!.toLowerCase());

	it("with three configured seats dispatches three critics and merges them into one verdict naming each seat's model", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.fire("input", { type: "input", text: "/skill:interrogate the diff", source: "interactive" });
		const seats = rosterSeats(h);
		expect(seats).toEqual(["a", "b", "c"]);
		for (const seat of seats) expect(await h.fire("before_subagent_spawn", spawn(`pstack-panel-${seat}-critic`))).toBeUndefined();
		const runs = seats.map(seat => ({ seat: seat as never, model: SEAT_MODELS[`@pstack-panel-${seat}`]!, vendor: SEAT_MODELS[`@pstack-panel-${seat}`]!.split("/")[0]!, verdict: seat === "c" ? verdict("approve") : verdict("concerns", [finding(seat === "a" ? "major" : "blocker", `claim ${seat}`)]) }));
		const merged = mergeVerdicts(runs, Object.keys(duplicateCandidates(runs)).filter(key => key === "a0~b0"));
		expect(merged.findings).toHaveLength(1);
		expect(merged.findings[0]!.raisedBy).toEqual(["a", "b"]);
		expect(merged.seats.map(seat => seat.model)).toEqual(Object.values(SEAT_MODELS));
		expect(merged.notes).toEqual([]);
	});

	it("a Claude-only panel's merged verdict carries the single-vendor note", async () => {
		const h = createHarness({ seatModels: { "@pstack-panel-a": "anthropic/claude-a", "@pstack-panel-b": "anthropic/claude-b" } });
		await h.fire("session_start");
		await h.fire("input", { type: "input", text: "/skill:interrogate", source: "interactive" });
		const vendors = [...h.sentMessages[0]!.message.content!.matchAll(/vendor (\w+)/g)].map(match => match[1]!);
		const runs = rosterSeats(h).map((seat, index) => ({ seat: seat as never, model: `anthropic/claude-${seat}`, vendor: vendors[index]!, verdict: verdict("approve") }));
		expect(mergeVerdicts(runs, []).notes).toContain(SINGLE_VENDOR_WARNING);
	});

	it("skips unset seats without error and caps the panel at the maximum panel size", async () => {
		const gaps = createHarness({ seatModels: { "@pstack-panel-b": "openai/b", "@pstack-panel-d": "google/d" } });
		await gaps.fire("session_start");
		await gaps.fire("input", { type: "input", text: "/skill:interrogate", source: "interactive" });
		expect(rosterSeats(gaps)).toEqual(["b", "d"]);
		expect(await gaps.fire("before_subagent_spawn", spawn("pstack-panel-a-critic"))).toMatchObject({ block: true });
		expect(await gaps.fire("before_subagent_spawn", spawn("pstack-panel-b-critic"))).toBeUndefined();

		const capped = createHarness({ maxPanelSize: 2, seatModels: { "@pstack-panel-a": "x/a", "@pstack-panel-b": "y/b", "@pstack-panel-c": "z/c", "@pstack-panel-d": "w/d" } });
		await capped.fire("session_start");
		await capped.fire("input", { type: "input", text: "/skill:interrogate", source: "interactive" });
		expect(rosterSeats(capped)).toEqual(["a", "b"]);
	});
});

describe("Status Segment", () => {
	it("is absent in a session that never activates pstack", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.fire("input", { type: "input", text: "hello", source: "interactive" });
		await h.todo(todo(1, 3));
		await h.read(PLAYBOOK);
		h.seatRun("0-Critic", "pstack-panel-a-critic");
		await h.fire("session_compact");
		expect(h.snapshots.filter(snapshot => snapshot.sequence !== null)).toEqual([]);
		expect(h.sentMessages).toEqual([]);
		expect(h.entries).toEqual([]);
	});

	it("reflects playbook, step progress and panel attendance", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		await h.read(PLAYBOOK);
		expect(h.segment()).toBe("pstack · feature");
		await h.todo(todo(3, 7));
		expect(h.segment()).toBe("pstack · feature · 3/7");
		h.seatRun("0-Critic", "pstack-panel-a-critic");
		h.seatRun("1-Critic", "pstack-panel-b-critic");
		expect(h.segment()).toBe("pstack · feature · 3/7 · panel 2/3");
		h.seatRun("2-Critic", "pstack-panel-c-critic", "failed");
		expect(h.segment()).toBe("pstack · feature · 3/7 · panel 2/3");
		await h.todo(todo(4, 7));
		expect(h.segment()).toBe("pstack · feature · 4/7 · panel 2/3");
	});

	it("shows a seat that fell back to another model as a dropout", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		h.lifecycle("0-Critic", "pstack-panel-b-critic", "started");
		h.events.emit("task:subagent:event", { id: "0-Critic", event: { type: "retry_fallback_applied", from: "openai/b", to: "anthropic/a" } });
		expect(h.segment()).toBe("pstack · dropouts 1");
		expect(await h.status()).toContain("anthropic/a");
	});

	it("keeps the playbook through the Opening a PR playbook that every playbook ends with, and follows a change of playbook", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		await h.read(PLAYBOOK);
		await h.read("/pkg/skills/poteto-mode/playbooks/opening-a-pr.md");
		expect(h.segment()).toBe("pstack · feature");
		await h.read("skill://poteto-mode/playbooks/bug-fix.md:1-40");
		expect(h.segment()).toBe("pstack · bug-fix");
	});

	it("ignores failed reads, other files and failed or empty todo results", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		await h.read(PLAYBOOK, true);
		await h.read("/pkg/skills/other/playbooks/feature.md");
		await h.read("/repo/src/playbooks/feature.md");
		await h.todo(todo(1, 3), true);
		await h.todo([]);
		expect(h.segment()).toBe("pstack");
	});

	it("counts abandoned todo items as done and names the item in progress", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		await h.todo([{ name: "P", tasks: [{ content: "a", status: "abandoned" }, { content: "b", status: "in_progress" }, { content: "c", status: "blocked" }] }]);
		expect(h.segment()).toBe("pstack · 1/3");
		expect(await h.status()).toContain("now: b");
	});

	it("publishes a tombstone when the session moves to one where pstack is not active, and at shutdown", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		expect(h.segment()).toBe("pstack");
		h.entries.length = 0;
		await h.fire("session_switch");
		expect(h.snapshots.at(-1)?.sequence).toBeNull();
		expect(await h.status()).toContain("inactive");

		const ended = createHarness();
		await ended.fire("session_start");
		await ended.command("poteto", "x");
		await ended.fire("session_shutdown");
		expect(ended.snapshots.at(-1)?.sequence).toBeNull();
	});
});

describe("run state rebuild", () => {
	it("restores the active flag, playbook, progress, receipts and segment when a session is resumed", async () => {
		const first = createHarness();
		await first.fire("session_start");
		await first.command("poteto", "resume me");
		await first.read(PLAYBOOK);
		await first.todo(todo(2, 5));
		first.seatRun("0-Critic", "pstack-panel-a-critic");
		first.lifecycle("1-Critic", "pstack-panel-b-critic", "started");
		first.events.emit("task:subagent:event", { id: "1-Critic", event: { type: "retry_fallback_applied", from: "openai/b", to: "anthropic/a" } });
		const expected = first.segment();
		expect(expected).toBe("pstack · feature · 2/5 · panel 1/3 · dropouts 1");

		const resumed = createHarness({ entries: first.entries });
		await resumed.fire("session_start");
		expect(resumed.segment()).toBe(expected);
		const report = await resumed.status();
		expect(report).toContain("resume me");
		expect(report).toContain("feature");
		expect(report).toContain("2/5");
		expect(resumed.sentMessages).toEqual([]);
	});

	it("rebuilds on session_switch, session_branch and session_tree", async () => {
		const source = createHarness();
		await source.fire("session_start");
		await source.command("poteto", "x");
		await source.read(PLAYBOOK);
		for (const event of ["session_switch", "session_branch", "session_tree"]) {
			const h = createHarness({ entries: source.entries });
			await h.fire(event);
			expect(h.segment()).toBe("pstack · feature");
		}
	});

	it("keeps the run through a second session_start without double-counting", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		h.seatRun("0-Critic", "pstack-panel-a-critic");
		await h.fire("session_start");
		expect(h.segment()).toBe("pstack · panel 1/3");
	});

	it("does not count receipts or dropouts recorded before activation, nor malformed entries", () => {
		const custom = (customType: string, data: unknown): SessionEntry => ({ type: "custom", customType, data });
		const receipt = { seat: "a", agent: "pstack-panel-a-critic", id: "0", status: "completed" };
		const dropout = { seat: "a", agent: "pstack-panel-a-critic", id: "0", from: "x/a", to: "y/b" };
		const activated = custom(RUN_ENTRY_TYPE, { kind: "activated", seats: ["a", "b"] });
		expect(rebuildRunState([custom(RECEIPT_ENTRY_TYPE, receipt), custom("dev.codesook.pstack.dropout", dropout)])).toBe(INACTIVE_RUN);
		const state = rebuildRunState([
			custom(RECEIPT_ENTRY_TYPE, receipt),
			activated,
			custom(RUN_ENTRY_TYPE, { kind: "progress", done: 5, total: 2 }),
			custom(RUN_ENTRY_TYPE, { kind: "activated", seats: ["a", "b", "c"] }),
			custom(RUN_ENTRY_TYPE, { kind: "playbook", playbook: "" }),
			custom(RUN_ENTRY_TYPE, "junk"),
			custom(RECEIPT_ENTRY_TYPE, { ...receipt, seat: "z" }),
			custom(RECEIPT_ENTRY_TYPE, receipt),
			{ type: "message", customType: RECEIPT_ENTRY_TYPE, data: receipt } as never,
		]);
		expect(state.active).toBe(true);
		expect(state.seats).toEqual(["a", "b"]);
		expect(state.progress).toBeUndefined();
		expect(state.playbook).toBeUndefined();
		expect(state.receipts).toHaveLength(1);
	});
});

describe("compaction", () => {
	it("keeps the state and segment, and sends the model a hidden reminder of the playbook and step", async () => {
		const h = createHarness();
		await h.fire("session_start");
		await h.command("poteto", "x");
		await h.read(PLAYBOOK);
		await h.todo(todo(3, 7));
		h.sentMessages.length = 0;
		await h.fire("session_compact", { type: "session_compact", fromExtension: false });
		expect(h.sentMessages).toHaveLength(1);
		const { message, options } = h.sentMessages[0]!;
		expect(message.display).toBe(false);
		expect(options).toEqual({ deliverAs: "nextTurn" });
		expect(message.content).toContain("feature");
		expect(message.content).toContain("3/7");
		expect(message.content).toContain("step 4");
		expect(h.segment()).toBe("pstack · feature · 3/7");
		expect(await h.status()).toContain("feature");

		const rebuilt = createHarness({ entries: h.entries });
		await rebuilt.fire("session_start");
		expect(rebuilt.segment()).toBe("pstack · feature · 3/7");
	});
});

describe("Instruction Mode suspension", () => {
	it("asks Caveman and Ponytail to switch off when pstack activates, once", async () => {
		const h = createHarness();
		await h.fire("session_start");
		expect(h.suspensions).toEqual([]);
		await h.command("poteto", "x");
		expect(h.suspensions).toEqual([{ protocol: 1, source: "pstack", modes: ["caveman", "ponytail"] }]);
		await h.command("poteto", "again");
		expect(h.suspensions).toHaveLength(1);
	});

	it("re-emits when an active session is resumed or navigated, and stays silent for an inactive one", async () => {
		const first = createHarness();
		await first.fire("session_start");
		await first.command("poteto", "x");
		for (const event of ["session_start", "session_switch", "session_branch", "session_tree"]) {
			const resumed = createHarness({ entries: first.entries });
			await resumed.fire(event);
			expect(resumed.suspensions).toHaveLength(1);
		}
		const inactive = createHarness();
		await inactive.fire("session_start");
		expect(inactive.suspensions).toEqual([]);
	});

	it("leaves a mode alone when its suspend toggle is off", async () => {
		const ponytailOnly = createHarness({ behavior: { suspendCaveman: false } });
		await ponytailOnly.fire("session_start");
		await ponytailOnly.command("poteto", "x");
		expect(ponytailOnly.suspensions[0]?.modes).toEqual(["ponytail"]);
		const cavemanOnly = createHarness({ behavior: { suspendPonytail: false } });
		await cavemanOnly.fire("session_start");
		await cavemanOnly.command("poteto", "x");
		expect(cavemanOnly.suspensions[0]?.modes).toEqual(["caveman"]);
		const neither = createHarness({ behavior: { suspendCaveman: false, suspendPonytail: false } });
		await neither.fire("session_start");
		await neither.command("poteto", "x");
		expect(neither.suspensions).toEqual([]);
	});
});
