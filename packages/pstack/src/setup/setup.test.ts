import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import pstackExtension from "../index.ts";
import { MODEL_ROLES, PANEL_ROLES, WORK_ROLES } from "../roles.ts";
import { listChoices, type ModelQuery } from "./catalog.ts";
import { CANCEL, KEEP_CURRENT, SAVE, UNSET } from "./flow.ts";
import { createHostSetupSettings } from "./host-settings.ts";
import { PRESET_NAMES, presetAssignment } from "./presets.ts";
import { probeAll, type ModelProbe } from "./probe.ts";
import { SINGLE_VENDOR_WARNING, checkPanel, modelKey } from "./rules.ts";
import { sameConfig, snapshot, type ConfigSnapshot, type SetupSettings } from "./settings.ts";

const FAMILY: Record<string, string> = { anthropic: "anthropic", "openai-codex": "openai", openai: "openai" };
const model = (provider: string, id: string) => ({ provider, id, name: id }) as never as { provider: string; id: string; name: string };
const SERVED = [
	model("anthropic", "claude-opus-5-5"),
	model("anthropic", "claude-sonnet-5-5"),
	model("anthropic", "claude-haiku-4-5"),
	model("anthropic", "claude-opus-4-1"),
	model("anthropic", "claude-sonnet-4-5"),
	model("openai-codex", "gpt-6-sol"),
	model("openai-codex", "gpt-6-mini"),
	model("openai-codex", "gpt-5-codex"),
];
const SERVED_SPECS = SERVED.map(served => `${served.provider}/${served.id}`);
const OPUS = "anthropic/claude-opus-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const HAIKU = "anthropic/claude-haiku-4-5";
const CODEX = "openai-codex/gpt-6-sol";

const USER_CONFIG: ConfigSnapshot = {
	roles: { default: "anthropic/claude-opus-5-5:high", commit: "anthropic/claude-haiku-4-5", vision: "openai-codex/gpt-6-mini", tiny: "anthropic/claude-haiku-4-5", advisor: OPUS },
	chains: { default: ["openai-codex/gpt-6-sol"] },
	isolation: false,
};

const clone = (config: ConfigSnapshot): ConfigSnapshot => structuredClone(config);
const modelsApi = (served = SERVED) =>
	({
		list: () => served,
		family: (served: { provider: string }) => FAMILY[served.provider] ?? served.provider,
		resolve: () => undefined,
	}) as unknown as ModelQuery;

function fakeSettings(initial: ConfigSnapshot = USER_CONFIG) {
	const state = clone(initial);
	const writes: string[] = [];
	const hooks: { afterCommit?: (state: ConfigSnapshot) => void } = {};
	const settings: SetupSettings = {
		modelRoles: () => ({ ...state.roles }),
		fallbackChains: () => structuredClone(state.chains),
		taskIsolation: () => state.isolation,
		setModelRole: (role, value) => {
			writes.push(role);
			if (value === undefined) delete state.roles[role];
			else state.roles[role] = value;
		},
		setFallbackChain: (role, chain) => {
			writes.push(`chain:${role}`);
			if (chain === undefined) delete state.chains[role];
			else state.chains[role] = chain;
		},
		setTaskIsolation: enabled => {
			writes.push("task.isolation.enabled");
			state.isolation = enabled;
		},
		commit: async () => hooks.afterCommit?.(state),
	};
	return { state, writes, hooks, settings };
}

type Matcher = string | ((label: string) => boolean);
const matches = (matcher: Matcher, label: string) => (typeof matcher === "string" ? label === matcher || label.startsWith(`${matcher}:`) : matcher(label));

function createHarness(options: { settings?: ReturnType<typeof fakeSettings>; probe?: ModelProbe; answers?: Array<Matcher | undefined>; confirms?: boolean[]; served?: typeof SERVED; hasUI?: boolean } = {}) {
	const fake = options.settings ?? fakeSettings();
	const probed: string[] = [];
	const probe: ModelProbe = options.probe ?? (async spec => (probed.push(spec), { ok: true }));
	const answers = [...(options.answers ?? [])];
	const confirms = [...(options.confirms ?? [])];
	const selects: Array<{ title: string; labels: string[] }> = [];
	const confirmed: string[] = [];
	const notices: Array<{ level: string; message: string }> = [];
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const pi = {
		events: { on: () => () => {}, emit: () => {} },
		on: () => {},
		registerCommand: (name: string, command: never) => void commands.set(name, command),
		appendEntry: () => {},
		logger: { info() {}, warn() {}, error() {} },
	};
	const ctx = {
		hasUI: options.hasUI ?? true,
		models: modelsApi(options.served),
		ui: {
			notify: (message: string, level: string) => void notices.push({ level, message }),
			select: async (title: string, items: Array<string | { label: string }>) => {
				const labels = items.map(item => (typeof item === "string" ? item : item.label));
				selects.push({ title, labels });
				const matcher = answers.shift();
				return matcher === undefined ? undefined : labels.find(label => matches(matcher, label));
			},
			confirm: async (title: string) => (confirmed.push(title), confirms.shift() ?? false),
		},
	};
	pstackExtension(pi as never, { homeDirectory: "/nonexistent", setup: { settings: () => fake.settings, probe: () => probe } });
	return { ...fake, probed, selects, confirmed, notices, run: (args = "setup") => commands.get("pstack")!.handler(args, ctx) };
}

const pstackKeys = (config: ConfigSnapshot) => Object.keys(config.roles).filter(role => role.startsWith("pstack-"));
const nonPstack = (config: ConfigSnapshot) => ({
	roles: Object.fromEntries(Object.entries(config.roles).filter(([role]) => !role.startsWith("pstack-"))),
	chains: Object.fromEntries(Object.entries(config.chains).filter(([role]) => !role.startsWith("pstack-"))),
});
const levels = (h: { notices: Array<{ level: string }> }) => h.notices.map(notice => notice.level);

describe("/pstack setup choices", () => {
	it("offers only models the registry serves", async () => {
		const h = createHarness({ answers: [KEEP_CURRENT, "pstack-build", CANCEL] });
		await h.run();
		const modelMenu = h.selects.find(select => select.title.startsWith("pstack-build"));
		expect(modelMenu?.labels).toEqual([...listChoices(modelsApi()).map(choice => choice.spec), UNSET]);
		expect(modelMenu?.labels.sort()).toEqual([...SERVED_SPECS, UNSET].sort());
	});

	it("offers a preset only when the registry can fill it", async () => {
		const claudeOnly = createHarness({ served: SERVED.filter(served => served.provider === "anthropic"), answers: [CANCEL] });
		await claudeOnly.run();
		const labels = claudeOnly.selects[0]!.labels;
		expect(labels).toContain("claude-only");
		expect(labels).toContain("lean");
		expect(labels).not.toContain("claude-codex");
	});

	it("reports an empty registry and writes nothing", async () => {
		const h = createHarness({ served: [] });
		await h.run();
		expect(levels(h)).toEqual(["error"]);
		expect(h.writes).toEqual([]);
	});

	it("shows what, when and recommended text for every role", async () => {
		const h = createHarness({ answers: [KEEP_CURRENT, ...MODEL_ROLES.flatMap(role => [role.id, undefined]), CANCEL] });
		// Escaping a model menu keeps the role; re-open each role from the role menu.
		await h.run();
		for (const role of MODEL_ROLES) {
			const menu = h.selects.find(select => select.title.startsWith(role.id));
			expect(menu).toBeDefined();
			expect(menu!.title).toContain(role.what);
			expect(menu!.title).toContain(role.when);
			expect(menu!.title).toContain(role.recommended);
		}
	});

	it("does nothing without a UI", async () => {
		const h = createHarness({ hasUI: false });
		await h.run();
		expect(h.selects).toEqual([]);
		expect(h.writes).toEqual([]);
	});
});

describe("presets", () => {
	const choices = listChoices(modelsApi());
	const seatSpecs = (assignment: Record<string, string | undefined>) => PANEL_ROLES.map(role => assignment[role.id]);
	const filledSeats = (assignment: Record<string, string | undefined>) => seatSpecs(assignment).filter(spec => spec !== undefined);
	for (const name of PRESET_NAMES) {
		it(`${name} fills every work role with a served model and gives the seats it fills distinct served models`, () => {
			const assignment = presetAssignment(name, choices)!;
			expect(Object.keys(assignment).sort()).toEqual(MODEL_ROLES.map(role => role.id).sort());
			for (const role of WORK_ROLES) expect(SERVED_SPECS).toContain(assignment[role.id]!);
			const seats = filledSeats(assignment) as string[];
			for (const spec of seats) expect(SERVED_SPECS).toContain(spec);
			expect(new Set(seats.map(modelKey)).size).toBe(seats.length);
		});
	}

	it("claude-only fills seats A to C with the top, mid and cheap Claude models and leaves D and E unset", () => {
		const assignment = presetAssignment("claude-only", choices)!;
		expect(seatSpecs(assignment)).toEqual([OPUS, SONNET, HAIKU, undefined, undefined]);
		expect(Object.values(assignment).every(spec => spec === undefined || spec.startsWith("anthropic/"))).toBe(true);
	});

	it("lean fills seats A and B only", () => {
		const assignment = presetAssignment("lean", choices)!;
		expect(seatSpecs(assignment)).toEqual([SONNET, HAIKU, undefined, undefined, undefined]);
	});

	it("claude-codex is claude-only plus exactly one Codex seat, and moves the judge to Codex", () => {
		const assignment = presetAssignment("claude-codex", choices)!;
		expect(seatSpecs(assignment)).toEqual([OPUS, SONNET, HAIKU, CODEX, undefined]);
		expect(assignment["pstack-judge"]).toBe(CODEX);
		expect({ ...assignment, "pstack-judge": undefined, "pstack-panel-d": undefined }).toEqual({
			...presetAssignment("claude-only", choices)!,
			"pstack-judge": undefined,
			"pstack-panel-d": undefined,
		});
	});

	it("leaves seats absent when the registry has too few distinct models", () => {
		const two = listChoices(modelsApi(SERVED.slice(0, 2)));
		const assignment = presetAssignment("claude-only", two)!;
		expect(filledSeats(assignment)).toHaveLength(2);
		for (const role of WORK_ROLES) expect(assignment[role.id]).toBeDefined();
	});

	it("does not rank a pinned snapshot above newer releases", () => {
		const claude = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-20250514"];
		const assignment = presetAssignment("claude-only", listChoices(modelsApi(claude.map(id => model("anthropic", id)))))!;
		expect(Object.values(assignment)).not.toContain("anthropic/claude-opus-4-20250514");
	});

	it("is unavailable when the vendor has no served model", () => {
		expect(presetAssignment("claude-codex", listChoices(modelsApi(SERVED.slice(0, 5))))).toBeUndefined();
		expect(presetAssignment("claude-only", listChoices(modelsApi(SERVED.slice(5))))).toBeUndefined();
	});

	describe("claude-codex on roles the user already has", () => {
		const existing = {
			"pstack-explore": HAIKU,
			"pstack-build": OPUS,
			"pstack-judge": SONNET,
			"pstack-panel-a": OPUS,
			"pstack-panel-b": SONNET,
		};

		it("keeps every other role, adds a Codex seat in the first free seat and moves the judge", () => {
			const assignment = presetAssignment("claude-codex", choices, existing)!;
			expect(assignment).toEqual({ ...existing, "pstack-judge": CODEX, "pstack-panel-c": CODEX });
		});

		it("adds no seat when a seat already runs Codex, and changes nothing when rerun", () => {
			const once = presetAssignment("claude-codex", choices, existing)!;
			expect(presetAssignment("claude-codex", choices, once)).toEqual(once);
			const withCodexSeat = { ...existing, "pstack-panel-b": "openai-codex/gpt-6-mini" };
			expect(presetAssignment("claude-codex", choices, withCodexSeat)).toEqual({ ...withCodexSeat, "pstack-judge": CODEX });
		});

		it("replaces the last seat when every seat is taken", () => {
			const full = { ...existing, "pstack-panel-c": HAIKU, "pstack-panel-d": "anthropic/claude-opus-4-1", "pstack-panel-e": "anthropic/claude-sonnet-4-5" };
			expect(presetAssignment("claude-codex", choices, full)).toEqual({ ...full, "pstack-judge": CODEX, "pstack-panel-e": CODEX });
		});
	});
});

describe("/pstack setup writes", () => {
	it("writes the preset to pstack roles and gives configured seats an empty chain", async () => {
		const h = createHarness({ answers: ["claude-only", SAVE], confirms: [false] });
		await h.run();
		const expected = presetAssignment("claude-only", listChoices(modelsApi()))!;
		for (const role of MODEL_ROLES) expect(h.state.roles[role.id] as string | undefined).toBe(expected[role.id]);
		for (const role of PANEL_ROLES) expect(h.state.chains[role.id] as string[] | undefined).toEqual(expected[role.id] === undefined ? undefined : []);
	});

	it("probes every selected model once and before writing", async () => {
		const order: string[] = [];
		const base = fakeSettings();
		const original = base.settings.setModelRole;
		base.settings.setModelRole = (role, value) => (order.push("write"), original(role, value));
		const h = createHarness({
			settings: base,
			probe: async spec => (order.push(`probe:${spec}`), { ok: true }),
			answers: ["claude-only", SAVE],
		});
		await h.run();
		const expected = presetAssignment("claude-only", listChoices(modelsApi()))!;
		const probes = order.filter(entry => entry.startsWith("probe:")).map(entry => entry.slice(6));
		expect(probes.sort()).toEqual([...new Set(Object.values(expected))].sort() as string[]);
		expect(order.lastIndexOf(order.filter(entry => entry.startsWith("probe:")).at(-1)!)).toBeLessThan(order.indexOf("write"));
	});

	it("a failed probe writes nothing", async () => {
		const h = createHarness({
			probe: async spec => (spec === HAIKU ? { ok: false, reason: "401" } : { ok: true }),
			answers: ["claude-only", SAVE, CANCEL],
		});
		await h.run();
		expect(h.writes).toEqual([]);
		expect(h.state).toEqual(USER_CONFIG);
		expect(levels(h)).toContain("error");
		expect(h.notices.some(notice => notice.message.includes(HAIKU))).toBe(true);
	});

	it("a throwing probe counts as a failure", async () => {
		const failures = await probeAll(["a/x", "a/x", "b/y"], async spec => {
			if (spec === "b/y") throw new Error("boom");
			return { ok: true };
		});
		expect(failures).toEqual([{ spec: "b/y", reason: "boom" }]);
	});

	it("leaves non-pstack roles and chains byte-for-byte unchanged and writes only pstack keys", async () => {
		const stale = { ...USER_CONFIG, roles: { ...USER_CONFIG.roles, "pstack-build": "anthropic/claude-opus-4-1", "pstack-panel-e": "anthropic/claude-opus-4-1" } };
		const h = createHarness({ settings: fakeSettings(stale), answers: ["lean", SAVE], confirms: [false] });
		await h.run();
		expect(nonPstack(h.state)).toEqual(nonPstack(USER_CONFIG));
		expect(JSON.stringify(nonPstack(h.state))).toBe(JSON.stringify(nonPstack(USER_CONFIG)));
		expect(h.writes.length).toBeGreaterThan(0);
		for (const key of h.writes) expect(key.replace(/^chain:/, "")).toMatch(/^(pstack-|task\.isolation)/);
		expect(pstackKeys(h.state).length).toBeGreaterThan(0);
	});

	it("unsetting a role and a seat removes the role and the seat chain", async () => {
		const h = createHarness({ answers: ["claude-only", "pstack-explore", UNSET, "pstack-panel-c", UNSET, SAVE] });
		await h.run();
		expect(h.state.roles["pstack-explore"]).toBeUndefined();
		expect(h.state.roles["pstack-panel-c"]).toBeUndefined();
		expect(h.state.chains["pstack-panel-c"]).toBeUndefined();
		expect(h.state.chains["pstack-panel-b"]).toEqual([]);
	});

	it("restores the previous config when the readback differs from what was written", async () => {
		const fake = fakeSettings();
		fake.hooks.afterCommit = state => {
			if (state.roles["pstack-judge"]) state.roles["pstack-judge"] = "anthropic/other";
		};
		const h = createHarness({ settings: fake, answers: ["claude-only", SAVE] });
		const before = clone(USER_CONFIG);
		await h.run();
		expect(sameConfig(snapshot(fake.settings), before)).toBe(true);
		expect(h.notices.at(-1)?.level).toBe("error");
	});

	it("restores a non-pstack role that the readback shows was changed", async () => {
		const fake = fakeSettings();
		let first = true;
		fake.hooks.afterCommit = state => {
			if (first) state.roles.default = "anthropic/clobbered";
			first = false;
		};
		const h = createHarness({ settings: fake, answers: ["claude-only", SAVE] });
		await h.run();
		expect(sameConfig(snapshot(fake.settings), USER_CONFIG)).toBe(true);
		expect(h.notices.at(-1)?.level).toBe("error");
	});

	it("restores when the write throws part-way", async () => {
		const fake = fakeSettings();
		const original = fake.settings.setModelRole;
		let calls = 0;
		fake.settings.setModelRole = (role, value) => {
			if (++calls === 3) throw new Error("disk full");
			original(role, value);
		};
		const h = createHarness({ settings: fake, answers: ["claude-only", SAVE] });
		await h.run();
		expect(sameConfig(snapshot(fake.settings), USER_CONFIG)).toBe(true);
		expect(h.notices.at(-1)?.message).toContain("disk full");
	});

	it("rerunning with the same choices yields an identical config and no writes", async () => {
		const fake = fakeSettings();
		await createHarness({ settings: fake, answers: ["claude-only", SAVE] }).run();
		const afterFirst = clone(fake.state);
		fake.writes.length = 0;
		await createHarness({ settings: fake, answers: [KEEP_CURRENT, SAVE] }).run();
		expect(fake.state).toEqual(afterFirst);
		expect(JSON.stringify(fake.state)).toBe(JSON.stringify(afterFirst));
		expect(fake.writes).toEqual([]);
	});
});

describe("panel rules", () => {
	const vendorOf = (spec: string) => (spec.startsWith("anthropic/") ? "anthropic" : "openai");

	it("refuses two seats on the same model and writes nothing", async () => {
		const h = createHarness({ answers: ["claude-only", "pstack-panel-b", OPUS, SAVE, CANCEL] });
		await h.run();
		expect(h.writes).toEqual([]);
		expect(h.probed).toEqual([]);
		expect(levels(h)).toContain("error");
	});

	it("treats the same model through another provider or thinking suffix as the same model", () => {
		const seats = (a: string, b: string) => [
			{ seat: "a" as const, model: a },
			{ seat: "b" as const, model: b },
		];
		expect(checkPanel(seats(OPUS, "bedrock/claude-opus-5-5"), vendorOf).errors).toHaveLength(1);
		expect(checkPanel(seats(OPUS, `${OPUS}:high`), vendorOf).errors).toHaveLength(1);
		expect(checkPanel(seats(OPUS, SONNET), vendorOf).errors).toEqual([]);
	});

	it("flags a single-vendor panel and passes a mixed one", () => {
		const seat = (seatId: "a" | "b", model: string | undefined) => ({ seat: seatId, model });
		const single = checkPanel([seat("a", OPUS), seat("b", SONNET)], vendorOf);
		expect(single.warnings).toHaveLength(1);
		expect(single.warnings[0]).toContain(SINGLE_VENDOR_WARNING);
		expect(checkPanel([seat("a", OPUS), seat("b", CODEX)], vendorOf).warnings).toEqual([]);
		expect(checkPanel([seat("a", undefined)], vendorOf)).toEqual({ errors: [], warnings: [] });
	});

	it("warns about a single-vendor panel but still saves it", async () => {
		const h = createHarness({ answers: ["claude-only", SAVE] });
		await h.run();
		expect(h.notices.some(notice => notice.level === "warning")).toBe(true);
		expect(h.state.roles["pstack-panel-a"]).toBeDefined();
	});

	it("does not warn for a mixed-vendor panel", async () => {
		const h = createHarness({ answers: ["claude-codex", SAVE] });
		await h.run();
		expect(levels(h)).not.toContain("warning");
	});
});

describe("task isolation", () => {
	it("declining the offer leaves task.isolation.enabled unchanged", async () => {
		const h = createHarness({ answers: ["claude-only", SAVE], confirms: [false] });
		await h.run();
		expect(h.confirmed).toHaveLength(1);
		expect(h.state.isolation).toBe(false);
		expect(h.writes).not.toContain("task.isolation.enabled");
		expect(h.state.roles["pstack-build"]).toBeDefined();
	});

	it("enables it only after explicit confirmation", async () => {
		const h = createHarness({ answers: ["claude-only", SAVE], confirms: [true] });
		await h.run();
		expect(h.state.isolation).toBe(true);
	});

	it("does not ask when isolation is already on", async () => {
		const h = createHarness({ settings: fakeSettings({ ...USER_CONFIG, isolation: true }), answers: ["claude-only", SAVE] });
		await h.run();
		expect(h.confirmed).toEqual([]);
		expect(h.state.isolation).toBe(true);
	});

	it("does not ask when the probe failed or setup was cancelled", async () => {
		const failed = createHarness({ probe: async () => ({ ok: false, reason: "x" }), answers: ["claude-only", SAVE, CANCEL] });
		await failed.run();
		const cancelled = createHarness({ answers: ["claude-only", CANCEL] });
		await cancelled.run();
		expect(failed.confirmed).toEqual([]);
		expect(cancelled.confirmed).toEqual([]);
	});
});

describe("/pstack preset", () => {
	it("claude-codex probes Codex before writing, adds the Codex seat and moves the judge", async () => {
		const order: string[] = [];
		const base = fakeSettings();
		const original = base.settings.setModelRole;
		base.settings.setModelRole = (role, value) => (order.push("write"), original(role, value));
		const h = createHarness({ settings: base, probe: async spec => (order.push(`probe:${spec}`), { ok: true }), confirms: [false] });
		await h.run("preset claude-codex");
		expect(order.indexOf(`probe:${CODEX}`)).toBeGreaterThanOrEqual(0);
		expect(order.indexOf(`probe:${CODEX}`)).toBeLessThan(order.indexOf("write"));
		expect(h.state.roles["pstack-judge"]).toBe(CODEX);
		expect(PANEL_ROLES.filter(role => h.state.roles[role.id]?.startsWith("openai-codex/"))).toHaveLength(1);
		expect(nonPstack(h.state)).toEqual(nonPstack(USER_CONFIG));
	});

	it("claude-only writes seats A to C only", async () => {
		const h = createHarness({ confirms: [false] });
		await h.run("preset claude-only");
		expect(PANEL_ROLES.map(role => h.state.roles[role.id] as string | undefined)).toEqual([OPUS, SONNET, HAIKU, undefined, undefined]);
		expect(PANEL_ROLES.map(role => h.state.chains[role.id] as string[] | undefined)).toEqual([[], [], [], undefined, undefined]);
	});

	it("claude-codex on an existing pstack config keeps the other roles, adds one Codex seat and moves the judge", async () => {
		const mine = { ...USER_CONFIG, roles: { ...USER_CONFIG.roles, "pstack-build": OPUS, "pstack-explore": HAIKU, "pstack-judge": SONNET, "pstack-panel-a": OPUS, "pstack-panel-b": SONNET } };
		const h = createHarness({ settings: fakeSettings(mine), confirms: [false, false] });
		await h.run("preset claude-codex");
		expect(h.state.roles).toEqual({ ...mine.roles, "pstack-judge": CODEX, "pstack-panel-c": CODEX });
		h.writes.length = 0;
		await h.run("preset claude-codex");
		expect(h.writes).toEqual([]);
	});

	it("an unreachable preset model writes nothing", async () => {
		const h = createHarness({ probe: async spec => (spec === CODEX ? { ok: false, reason: "401" } : { ok: true }) });
		await h.run("preset claude-codex");
		expect(h.writes).toEqual([]);
		expect(h.state).toEqual(USER_CONFIG);
		expect(h.notices.some(notice => notice.level === "error" && notice.message.includes(CODEX))).toBe(true);
	});

	it("rejects an unknown or missing preset name without probing or writing", async () => {
		for (const args of ["preset", "preset nope"]) {
			const h = createHarness();
			await h.run(args);
			expect(levels(h)).toEqual(["warning"]);
			expect(h.probed).toEqual([]);
			expect(h.writes).toEqual([]);
		}
	});

	it("reports a preset the registry cannot fill and writes nothing", async () => {
		const h = createHarness({ served: SERVED.slice(0, 5) });
		await h.run("preset claude-codex");
		expect(levels(h)).toEqual(["error"]);
		expect(h.probed).toEqual([]);
		expect(h.writes).toEqual([]);
	});

	it("does nothing without a UI", async () => {
		const h = createHarness({ hasUI: false });
		await h.run("preset claude-only");
		expect(h.probed).toEqual([]);
		expect(h.writes).toEqual([]);
	});

	it("rerunning a preset changes nothing", async () => {
		const h = createHarness({ confirms: [false, false] });
		await h.run("preset lean");
		const after = clone(h.state);
		h.writes.length = 0;
		await h.run("preset lean");
		expect(h.state).toEqual(after);
		expect(h.writes).toEqual([]);
	});
});

describe("host settings adapter", () => {
	it("writes sibling-safe roles, empty seat chains and isolation through OMP settings", async () => {
		const host = Settings.isolated({
			modelRoles: { default: "anthropic/claude-opus-5-5:high", commit: "anthropic/claude-haiku-4-5" },
			"retry.fallbackChains": { default: ["openai-codex/gpt-6-sol"] },
		});
		const settings = createHostSetupSettings(host);
		settings.setModelRole("pstack-judge", OPUS);
		settings.setFallbackChain("pstack-panel-a", []);
		settings.setTaskIsolation(true);
		await settings.commit();
		expect(settings.modelRoles()).toEqual({ default: "anthropic/claude-opus-5-5:high", commit: "anthropic/claude-haiku-4-5", "pstack-judge": OPUS });
		expect(settings.fallbackChains()).toEqual({ default: ["openai-codex/gpt-6-sol"], "pstack-panel-a": [] });
		expect(settings.taskIsolation()).toBe(true);
		settings.setModelRole("pstack-judge", undefined);
		settings.setFallbackChain("pstack-panel-a", undefined);
		expect(settings.modelRoles()["pstack-judge"]).toBeUndefined();
		expect(settings.fallbackChains()).toEqual({ default: ["openai-codex/gpt-6-sol"] });
	});
});
