import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CODESOOK_OMP_CONFIG_CHANGED, isRecord } from "@codesook/omp-shared-display/config-store";
import { SHARED_DISPLAY_CHANNEL, type FrameSequence } from "@codesook/omp-shared-display/client";
import { INSTRUCTION_MODE_SUSPENSION_CHANNEL, suspendInstructionModes } from "@codesook/omp-shared-display/instruction-mode";
import { SKILL_USE_EVENT } from "@codesook/omp-shared-display/skill-use";
import ponytailExtension from "./index.ts";
import { DEFAULT_SKILL_DIRECTORY, getCodesookOmpConfigPath } from "./types.ts";

const homes: string[] = [];
let agentCounter = 0;

afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function makeHome(rootConfig?: unknown): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-test-"));
	homes.push(home);
	if (rootConfig !== undefined) writeRootConfig(home, rootConfig);
	return home;
}

function writeRootConfig(home: string, value: unknown): void {
	const file = getCodesookOmpConfigPath(home);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

const rootDoc = (behavior: Record<string, unknown> = {}, display: Record<string, unknown> = {}) => ({ version: 1, display, behavior });
const upstreamEntry = (mode: unknown) => ({ type: "custom", customType: "ponytail-mode", id: "x", data: { mode } });

type Handler = (event: unknown, ctx: unknown) => unknown;
type Command = { handler: (args: string, ctx: unknown) => unknown; getArgumentCompletions?: (prefix: string) => unknown };
type Snapshot = { kind: string; source: string; sequence: FrameSequence | null };

function createHarness(
	options: { home?: string; env?: NodeJS.ProcessEnv; entries?: unknown[]; agent?: { id: string; parentId?: string }; idle?: boolean } = {},
) {
	const home = options.home ?? makeHome();
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const busHandlers = new Map<string, Array<(data: unknown) => void>>();
	const entries: unknown[] = options.entries ?? [];
	const notices: Array<{ level: string; message: string }> = [];
	const sent: Array<{ text: string; options?: unknown }> = [];
	const statuses: Array<string | undefined> = [];
	const snapshots: Snapshot[] = [];
	const events = {
		on(channel: string, handler: (data: unknown) => void) {
			busHandlers.set(channel, [...(busHandlers.get(channel) ?? []), handler]);
			return () => busHandlers.set(channel, (busHandlers.get(channel) ?? []).filter(item => item !== handler));
		},
		emit(channel: string, data: unknown) {
			if (channel === SHARED_DISPLAY_CHANNEL && isRecord(data) && data.kind === "snapshot" && data.source === "ponytail") {
				snapshots.push(data as Snapshot);
			}
			for (const handler of busHandlers.get(channel) ?? []) handler(data);
			// A host that is already running answers a producer's ready message, so every publish becomes a snapshot.
			if (isRecord(data) && data.kind === "ready" && data.source === "ponytail") {
				events.emit(SHARED_DISPLAY_CHANNEL, { protocol: 1, kind: "host", epoch: "e1", active: true });
			}
		},
	};
	const pi = {
		events,
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerCommand: (name: string, command: Command) => void commands.set(name, command),
		appendEntry: (customType: string, data: unknown) => void entries.push({ type: "custom", customType, data }),
		sendUserMessage: (text: string, sendOptions?: unknown) => void sent.push({ text, options: sendOptions }),
		logger: { warn: () => {}, info: () => {}, error: () => {} },
	};
	let idle = options.idle ?? true;
	const agent = options.agent ?? { id: `agent-${agentCounter++}` };
	const ctx = {
		hasUI: true,
		agent,
		isIdle: () => idle,
		ui: {
			notify: (message: string, level: string) => void notices.push({ level, message }),
			setStatus: (_key: string, text: string | undefined) => void statuses.push(text),
			theme: { fg: (_color: string, text: string) => text },
		},
		sessionManager: { getBranch: () => entries },
	};
	ponytailExtension(pi as never, { homeDirectory: home, env: options.env ?? {} });
	const fire = (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx);
	return {
		home,
		entries,
		notices,
		sent,
		statuses,
		snapshots,
		events,
		ctx,
		commands,
		fire,
		setIdle: (value: boolean) => void (idle = value),
		command: (name: string, args = "") => commands.get(name)!.handler(args, ctx),
		prompt: async (base: string[] = ["BASE-1", "BASE-2"]) => {
			const result = (await fire("before_agent_start", { systemPrompt: base })) as { systemPrompt: string[] } | undefined;
			return result?.systemPrompt;
		},
	};
}

const skillBody = (): string =>
	fs
		.readFileSync(path.join(DEFAULT_SKILL_DIRECTORY, "ponytail", "SKILL.md"), "utf8")
		.replace(/^---[\s\S]*?---\s*/, "");
const expectedText = (mode: "lite" | "full" | "ultra"): string => {
	const others = ["lite", "full", "ultra"].filter(item => item !== mode);
	const lines = skillBody()
		.split(/\r?\n/)
		.filter(line => !others.some(other => line.startsWith(`| **${other}** |`)));
	return `PONYTAIL MODE ACTIVE — level: ${mode}\n\n${lines.join("\n")}`;
};

describe("Ponytail Mode Levels", () => {
	it("injects the filtered vendored skill for each Mode Level by appending one element", async () => {
		const harness = createHarness();
		await harness.fire("session_start");
		for (const mode of ["lite", "full", "ultra"] as const) {
			await harness.command("ponytail", mode);
			const base = ["BASE-1", "BASE-2"];
			const result = await harness.prompt(base);
			expect(result).toHaveLength(base.length + 1);
			expect(result!.slice(0, 2)).toEqual(["BASE-1", "BASE-2"]);
			expect(result![2]).toBe(expectedText(mode));
			expect(base).toEqual(["BASE-1", "BASE-2"]);
			expect(result![2]).toContain(`| **${mode}** |`);
			for (const other of ["lite", "full", "ultra"].filter(item => item !== mode)) {
				expect(result![2]).not.toContain(`| **${other}** |`);
			}
		}
	});

	it("injects nothing for off and records the choice", async () => {
		const harness = createHarness();
		await harness.fire("session_start");
		await harness.command("ponytail", "off");
		expect(await harness.prompt()).toBeUndefined();
		expect(harness.entries.at(-1)).toEqual({ type: "custom", customType: "ponytail-mode", data: { mode: "off" } });
	});

	it("keeps review, written by older Upstream versions, as a fixed one-line instruction", async () => {
		const harness = createHarness({ entries: [upstreamEntry("review")] });
		await harness.fire("session_start");
		expect(await harness.prompt()).toEqual([
			"BASE-1",
			"BASE-2",
			"PONYTAIL MODE ACTIVE — level: review. Behavior defined by /ponytail-review skill.",
		]);
		await harness.command("ponytail", "review");
		expect(harness.notices.at(-1)?.level).toBe("warning");
		expect(harness.entries).toHaveLength(1);
	});

	it("starts at full, then follows the default mode from the root config", async () => {
		const plain = createHarness();
		await plain.fire("session_start");
		expect((await plain.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: full\n\n");
		const configured = createHarness({ home: makeHome(rootDoc({ ponytail: { defaultMode: "ultra" } })) });
		await configured.fire("session_start");
		expect((await configured.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: ultra\n\n");
		const off = createHarness({ home: makeHome(rootDoc({ ponytail: { defaultMode: "off" } })) });
		await off.fire("session_start");
		expect(await off.prompt()).toBeUndefined();
	});
});

describe("Ponytail session state", () => {
	it("rehydrates on /new (session_switch) and branch events from the new branch", async () => {
		const harness = createHarness();
		await harness.fire("session_start");
		await harness.command("ponytail", "ultra");
		expect((await harness.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: ultra");
		harness.entries.length = 0; // /new: an empty branch
		await harness.fire("session_switch", { reason: "new" });
		expect((await harness.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: full");
		harness.entries.push(upstreamEntry("lite"));
		await harness.fire("session_branch");
		expect((await harness.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: lite");
		harness.entries.push(upstreamEntry("off"));
		await harness.fire("session_tree");
		expect(await harness.prompt()).toBeUndefined();
	});

	it("resumes a session whose entries Upstream wrote", async () => {
		const harness = createHarness({
			entries: [
				{ type: "message", id: "m" },
				upstreamEntry("lite"),
				{ type: "custom", customType: "other", data: { mode: "off" } },
				upstreamEntry(" ULTRA "),
				upstreamEntry("banana"),
				{ type: "custom", customType: "ponytail-mode", data: "nope" },
			],
		});
		await harness.fire("session_start");
		expect((await harness.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: ultra\n\n");
	});

	it("turns off for exactly the Upstream deactivation phrases", async () => {
		const harness = createHarness();
		await harness.fire("session_start");
		await harness.fire("input", { text: "please add a normal mode toggle", source: "interactive" });
		await harness.fire("input", { text: "stop ponytail", source: "extension" });
		expect(harness.entries).toEqual([]);
		expect(await harness.prompt()).toHaveLength(3);
		await harness.fire("input", { text: "  Stop Ponytail! ", source: "interactive" });
		expect(harness.entries.at(-1)).toEqual({ type: "custom", customType: "ponytail-mode", data: { mode: "off" } });
		expect(await harness.prompt()).toBeUndefined();
		await harness.command("ponytail", "full");
		await harness.fire("input", { text: "Normal mode.", source: "interactive" });
		expect(await harness.prompt()).toBeUndefined();
	});

	it("lets a subagent start at its parent's Mode Level and record it", async () => {
		const parent = createHarness({ agent: { id: "parent-1" } });
		await parent.fire("session_start");
		await parent.command("ponytail", "ultra");
		const child = createHarness({ agent: { id: "child-1", parentId: "parent-1" } });
		await child.fire("session_start");
		expect((await child.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: ultra");
		expect(child.entries).toEqual([{ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } }]);
		// A later parent change does not move a running child; a /new in the child is a fresh Agent Session.
		await parent.command("ponytail", "lite");
		expect((await child.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: ultra");
		await parent.command("ponytail", "off");
		const offChild = createHarness({ agent: { id: "child-2", parentId: "parent-1" } });
		await offChild.fire("session_start");
		expect(await offChild.prompt()).toBeUndefined();
		const orphan = createHarness({ agent: { id: "child-3", parentId: "gone" } });
		await orphan.fire("session_start");
		expect((await orphan.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: full");
		await parent.fire("session_shutdown");
		const late = createHarness({ agent: { id: "child-4", parentId: "parent-1" } });
		await late.fire("session_start");
		expect((await late.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: full");
	});

	it("keeps a subagent's own entry over its parent", async () => {
		const parent = createHarness({ agent: { id: "parent-2" } });
		await parent.fire("session_start");
		await parent.command("ponytail", "ultra");
		const child = createHarness({ agent: { id: "child-5", parentId: "parent-2" }, entries: [upstreamEntry("lite")] });
		await child.fire("session_start");
		expect((await child.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: lite");
		expect(child.entries).toHaveLength(1);
	});
});

describe("Ponytail configuration", () => {
	it("fails closed to off when the root config cannot be parsed", async () => {
		const harness = createHarness({ home: makeHome("{ not json") });
		await harness.fire("session_start");
		expect(await harness.prompt()).toBeUndefined();
		expect(harness.notices.some(notice => notice.level === "warning" && notice.message.includes("stays off"))).toBe(true);
		await harness.command("ponytail", "lite");
		expect(await harness.prompt()).toHaveLength(3);
	});

	it("fails closed to off for a default mode outside the Upstream runtime modes", async () => {
		for (const defaultMode of ["review", "banana", "wenyan", 3]) {
			const harness = createHarness({ home: makeHome(rootDoc({ ponytail: { defaultMode } })) });
			await harness.fire("session_start");
			expect(await harness.prompt()).toBeUndefined();
			expect(harness.notices.some(notice => notice.level === "warning")).toBe(true);
		}
	});

	it("lets PONYTAIL_DEFAULT_MODE override the saved default, as Upstream documents", async () => {
		const home = makeHome(rootDoc({ ponytail: { defaultMode: "ultra" } }));
		const harness = createHarness({ home, env: { PONYTAIL_DEFAULT_MODE: " Lite " } });
		await harness.fire("session_start");
		expect((await harness.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: lite");
		await harness.command("ponytail", "default off");
		expect(harness.notices.at(-1)?.message).toBe("Saved default off, but env override keeps default at lite.");
		const ignored = createHarness({ home, env: { PONYTAIL_DEFAULT_MODE: "review" } });
		await ignored.fire("session_start");
		expect(await ignored.prompt()).toBeUndefined(); // review is no default; the saved default (now off) applies
	});

	it("saves /ponytail default only under behavior.ponytail.defaultMode and keeps other keys", async () => {
		const original = rootDoc({ ponytail: { defaultMode: "full", future: 1 }, caveman: { defaultMode: "caveman" } }, { ponytail: { visible: false } });
		const home = makeHome(original);
		const harness = createHarness({ home });
		await harness.fire("session_start");
		await harness.command("ponytail", "default ultra");
		expect(harness.notices.at(-1)).toEqual({ level: "info", message: "Default Ponytail mode set to ultra." });
		const saved = JSON.parse(fs.readFileSync(getCodesookOmpConfigPath(home), "utf8"));
		expect(saved).toEqual(rootDoc({ ponytail: { defaultMode: "ultra", future: 1 }, caveman: { defaultMode: "caveman" } }, { ponytail: { visible: false } }));
		expect(harness.entries).toEqual([]);
		await harness.command("ponytail", "status");
		expect(harness.notices.at(-1)?.message).toBe("Ponytail: current full • default ultra");
		await harness.command("ponytail", "default review");
		expect(harness.notices.at(-1)?.level).toBe("warning");
		expect(JSON.parse(fs.readFileSync(getCodesookOmpConfigPath(home), "utf8")).behavior.ponytail.defaultMode).toBe("ultra");
		expect(fs.existsSync(path.join(home, ".config", "ponytail"))).toBe(false);
	});

	it("never overwrites an unparseable root config when saving a default", async () => {
		const home = makeHome("{ broken");
		const harness = createHarness({ home });
		await harness.fire("session_start");
		await harness.command("ponytail", "default lite");
		expect(harness.notices.at(-1)?.level).toBe("error");
		expect(fs.readFileSync(getCodesookOmpConfigPath(home), "utf8")).toBe("{ broken");
	});

	it("follows a live config change until the session sets its own Mode Level", async () => {
		const harness = createHarness();
		await harness.fire("session_start");
		harness.events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: rootDoc({ ponytail: { defaultMode: "lite" } }) });
		expect((await harness.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: lite");
		await harness.command("ponytail", "ultra");
		harness.events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: rootDoc({ ponytail: { defaultMode: "off" } }) });
		expect((await harness.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: ultra");
		harness.events.emit(CODESOOK_OMP_CONFIG_CHANGED, { config: "garbage" });
		expect((await harness.prompt())![2]).toStartWith("PONYTAIL MODE ACTIVE — level: ultra");
	});
});

describe("/ponytail commands", () => {
	it("toggles on, reports status, and rejects unknown input", async () => {
		const harness = createHarness({ home: makeHome(rootDoc({ ponytail: { defaultMode: "off" } })) });
		await harness.fire("session_start");
		await harness.command("ponytail");
		expect(harness.entries.at(-1)).toEqual({ type: "custom", customType: "ponytail-mode", data: { mode: "full" } });
		await harness.command("ponytail");
		expect(harness.notices.at(-1)?.message).toBe("Ponytail: current full • default off");
		expect(harness.entries).toHaveLength(1);
		await harness.command("ponytail", "ULTRA");
		expect(harness.entries.at(-1)).toEqual({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
		await harness.command("ponytail", "caveman");
		expect(harness.notices.at(-1)?.level).toBe("warning");
		expect(harness.entries).toHaveLength(2);
		expect(harness.commands.get("ponytail")!.getArgumentCompletions!("default u")).toEqual([{ value: "default ultra", label: "default ultra" }]);
		expect(harness.commands.get("ponytail")!.getArgumentCompletions!("zzz")).toBeNull();
	});

	it("registers the helper commands and sends the vendored skill itself", async () => {
		const harness = createHarness();
		for (const name of ["ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help"]) {
			expect(harness.commands.has(name)).toBe(true);
			await harness.command(name);
			const body = fs
				.readFileSync(path.join(DEFAULT_SKILL_DIRECTORY, name, "SKILL.md"), "utf8")
				.replace(/^---[\s\S]*?---\s*/, "")
				.trim();
			const message = harness.sent.at(-1)!.text;
			expect(message).toStartWith(`[IMPORTANT: User invoked the "${name}" skill; follow its instructions. Full skill below.]`);
			expect(message).toContain(body);
			expect(message).not.toContain("/skill:");
			expect(harness.sent.at(-1)!.options).toBeUndefined();
		}
		await harness.command("ponytail-review", " focus on auth ");
		expect(harness.sent.at(-1)!.text).toEndWith("---\n\nUser: focus on auth");
	});

	it("queues a helper command as a follow-up while the agent is busy", async () => {
		const harness = createHarness({ idle: false });
		await harness.command("ponytail-audit", "src");
		expect(harness.sent).toHaveLength(1);
		expect(harness.sent[0]!.options).toEqual({ deliverAs: "followUp" });
		expect(harness.notices.at(-1)?.message).toBe("ponytail-audit queued as follow-up.");
	});

	it("reports each helper command as a user Skill Use with the vendored SKILL.md path", async () => {
		const harness = createHarness();
		const uses: unknown[] = [];
		harness.events.on(SKILL_USE_EVENT, data => void uses.push(data));
		for (const name of ["ponytail-review", "ponytail-audit", "ponytail-debt"]) await harness.command(name);
		expect(uses).toEqual(
			["ponytail-review", "ponytail-audit", "ponytail-debt"].map(name => ({
				name,
				path: path.join(DEFAULT_SKILL_DIRECTORY, name, "SKILL.md"),
				source: "user",
			})),
		);
	});

	it("reports no Skill Use for /ponytail mode commands", async () => {
		const harness = createHarness();
		const uses: unknown[] = [];
		harness.events.on(SKILL_USE_EVENT, data => void uses.push(data));
		await harness.command("ponytail", "ultra");
		expect(uses).toEqual([]);
	});
});

describe("Ponytail display", () => {
	const frameText = (snapshot: Snapshot | undefined) => snapshot!.sequence!.frames.map(frame => frame.join("\n"));

	it("publishes a Shared Display snapshot per Mode Level and clears it for off", async () => {
		const harness = createHarness();
		await harness.fire("session_start");
		expect(frameText(harness.snapshots.at(-1))).toEqual(["○ 🐴⚡ ponytail"]);
		await harness.fire("agent_start");
		expect(frameText(harness.snapshots.at(-1))).toEqual(["● 🐴⚡ ponytail"]);
		await harness.fire("agent_end", { willContinue: true });
		expect(frameText(harness.snapshots.at(-1))).toEqual(["● 🐴⚡ ponytail"]);
		await harness.fire("agent_end", { willContinue: false });
		expect(frameText(harness.snapshots.at(-1))).toEqual(["○ 🐴⚡ ponytail"]);
		await harness.command("ponytail", "ultra");
		expect(frameText(harness.snapshots.at(-1))).toEqual(["○ 🐴🔥 ponytail"]);
		await harness.command("ponytail", "off");
		expect(harness.snapshots.at(-1)!.sequence).toBeNull();
		harness.entries.push(upstreamEntry("review"));
		await harness.fire("session_branch");
		expect(frameText(harness.snapshots.at(-1))).toEqual(["○ 🐴 ponytail"]);
	});

	it("shows a different packaged glyph for lite, full and ultra", async () => {
		const harness = createHarness();
		const published: Record<string, string[]> = {};
		for (const mode of ["lite", "full", "ultra"]) {
			await harness.command("ponytail", mode);
			published[mode] = frameText(harness.snapshots.at(-1));
		}
		expect(published).toEqual({ lite: ["○ 🐴🌿 ponytail"], full: ["○ 🐴⚡ ponytail"], ultra: ["○ 🐴🔥 ponytail"] });
	});

	it("uses the configured template, user glyphs, and visibility", async () => {
		const home = makeHome(
			rootDoc({}, { ponytail: { template: "{mode}/{modeIcon}/{activity}/{glyph}", glyphDirectory: "~/glyphs", nativeVisible: true } }),
		);
		fs.mkdirSync(path.join(home, "glyphs"));
		fs.writeFileSync(path.join(home, "glyphs", "full.txt"), "fps=4\nAA\nBB\n");
		const harness = createHarness({ home });
		await harness.fire("session_start");
		expect(harness.snapshots.at(-1)!.sequence).toEqual({ frames: [["{mode}/{modeIcon}/○/AA"], ["{mode}/{modeIcon}/○/BB"]], fps: 4 });
		expect(harness.statuses.at(-1)).toBe("{mode}/{modeIcon}/○/AA");
		writeRootConfig(home, rootDoc({}, { ponytail: { visible: false } }));
		await harness.fire("session_switch");
		expect(harness.snapshots.at(-1)!.sequence).toBeNull();
		expect(harness.statuses.at(-1)).toBeUndefined();
	});

	it("shows the native status only when nativeVisible is on and clears it on shutdown", async () => {
		const harness = createHarness();
		await harness.fire("session_start");
		expect(harness.statuses.at(-1)).toBeUndefined();
		const native = createHarness({ home: makeHome(rootDoc({}, { ponytail: { nativeVisible: true } })) });
		await native.fire("session_start");
		expect(native.statuses.at(-1)).toBe("○ 🐴⚡ ponytail");
		await native.fire("session_shutdown");
		expect(native.statuses.at(-1)).toBeUndefined();
		expect(native.snapshots.at(-1)!.sequence).toBeNull();
	});
});

describe("Ponytail suspension by pstack", () => {
	const level = async (harness: ReturnType<typeof createHarness>) => (await harness.prompt())?.[2]?.split("\n")[0];

	it("switches the session to off, never writes the config, and leaves /ponytail working", async () => {
		const home = makeHome(rootDoc({ ponytail: { defaultMode: "full" } }));
		const configBefore = fs.readFileSync(getCodesookOmpConfigPath(home), "utf8");
		const harness = createHarness({ home });
		await harness.fire("session_start");
		suspendInstructionModes(harness.events, "pstack", ["ponytail"]);
		expect(await harness.prompt()).toBeUndefined();
		expect(harness.snapshots.at(-1)!.sequence).toBeNull();
		expect(fs.readFileSync(getCodesookOmpConfigPath(home), "utf8")).toBe(configBefore);
		await harness.command("ponytail", "lite");
		expect(await level(harness)).toBe("PONYTAIL MODE ACTIVE — level: lite");
	});

	it("leaves a parallel session on its configured Mode Level", async () => {
		const home = makeHome();
		const suspended = createHarness({ home });
		const parallel = createHarness({ home });
		await suspended.fire("session_start");
		await parallel.fire("session_start");
		suspendInstructionModes(suspended.events, "pstack", ["ponytail"]);
		expect(await suspended.prompt()).toBeUndefined();
		expect(await level(parallel)).toBe("PONYTAIL MODE ACTIVE — level: full");
	});

	it("keeps the suspension when the session is resumed", async () => {
		const first = createHarness();
		await first.fire("session_start");
		suspendInstructionModes(first.events, "pstack", ["ponytail"]);
		const resumed = createHarness({ entries: [...first.entries] });
		await resumed.fire("session_start");
		expect(await resumed.prompt()).toBeUndefined();
	});

	it("applies a suspension that arrives before the session starts", async () => {
		const harness = createHarness();
		suspendInstructionModes(harness.events, "pstack", ["ponytail"]);
		await harness.fire("session_start");
		expect(await harness.prompt()).toBeUndefined();
	});

	it("ignores a suspension that does not name Ponytail or has another protocol version", async () => {
		const harness = createHarness();
		await harness.fire("session_start");
		suspendInstructionModes(harness.events, "pstack", ["caveman"]);
		harness.events.emit(INSTRUCTION_MODE_SUSPENSION_CHANNEL, { protocol: 2, source: "pstack", modes: ["ponytail"] });
		expect(await level(harness)).toBe("PONYTAIL MODE ACTIVE — level: full");
	});
});
