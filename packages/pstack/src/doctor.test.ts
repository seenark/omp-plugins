import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CHANNEL } from "@codesook/omp-shared-display/client";
import { DEFAULT_POTETO_DIRECTORY } from "./activation.ts";
import { DEFAULT_PSTACK_BEHAVIOR } from "./behavior.ts";
import { diagnose, workflowCalledSkills } from "./doctor.ts";
import pstackExtension from "./index.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDirectory(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-doctor-"));
	roots.push(root);
	return root;
}

const OPUS = "anthropic/claude-opus-5-5";
const CODEX = "openai-codex/gpt-6-sol";
const SONNET = "anthropic/claude-sonnet-5-5";
const FAMILY: Record<string, string> = { anthropic: "anthropic", "openai-codex": "openai" };

/** A skills tree: poteto-mode calls pstack-tdd and interrogate; bro is standalone. */
function skillsFixture(): string {
	const skills = path.join(tempDirectory(), "skills");
	const write = (relative: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(skills, relative)), { recursive: true });
		fs.writeFileSync(path.join(skills, relative), text);
	};
	write("poteto-mode/SKILL.md", "---\nname: poteto-mode\n---\nRun `/skill:interrogate` before shipping.\n");
	write("poteto-mode/playbooks/bug-fix.md", "See the **pstack-tdd** skill for the failing-test-first cadence.\n");
	for (const name of ["pstack-tdd", "interrogate", "bro"]) write(`${name}/SKILL.md`, `---\nname: ${name}\n---\n`);
	return skills;
}

interface World {
	roles?: Record<string, string>;
	/** Skill name to the path OMP resolves it from; defaults to pstack's own copy. */
	skillPaths?: Record<string, string>;
	isolation?: boolean;
	loaded?: string[];
	hasHost?: boolean;
	/** Roles that are set in config but that the registry cannot serve. */
	unserved?: string[];
	/** Skills OMP does not list at all. */
	unlisted?: string[];
}

const HEALTHY_ROLES: Record<string, string> = {
	"pstack-explore": SONNET,
	"pstack-build": SONNET,
	"pstack-mechanical": SONNET,
	"pstack-design": OPUS,
	"pstack-judge": OPUS,
	"pstack-security": OPUS,
	"pstack-panel-a": OPUS,
	"pstack-panel-b": CODEX,
};

function createWorld(world: World = {}) {
	const skills = skillsFixture();
	const roles = world.roles ?? HEALTHY_ROLES;
	const bus = new Map<string, Array<(data: unknown) => void>>();
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => unknown }>();
	const notices: Array<{ level: string; message: string }> = [];
	const events = {
		on: (channel: string, handler: (data: unknown) => void) => {
			bus.set(channel, [...(bus.get(channel) ?? []), handler]);
			return () => void bus.set(channel, (bus.get(channel) ?? []).filter(other => other !== handler));
		},
		emit: (channel: string, data: unknown) => void (bus.get(channel) ?? []).forEach(handler => handler(data)),
	};
	const skillCommands = ["poteto-mode", "pstack-tdd", "interrogate", "bro"].filter(name => !world.unlisted?.includes(name)).map(name => ({
		name: `skill:${name}`,
		source: "skill",
		path: world.skillPaths?.[name] ?? path.join(skills, name, "SKILL.md"),
	}));
	const pi = {
		events,
		on: () => {},
		registerCommand: (name: string, command: never) => void commands.set(name, command),
		appendEntry: () => {},
		getCommands: () => [...skillCommands, ...(world.loaded ?? ["caveman", "ponytail"]).map(name => ({ name, source: "extension" }))],
		logger: { info() {}, warn() {}, error() {} },
	};
	const ctx = {
		hasUI: true,
		ui: { notify: (message: string, level: string) => void notices.push({ level, message }) },
		models: {
			resolve: (spec: string) => {
				const model = world.unserved?.includes(spec.slice(1)) ? undefined : roles[spec.slice(1)];
				return model ? { provider: model.split("/")[0], id: model.split("/")[1] } : undefined;
			},
			family: (model: { provider: string }) => FAMILY[model.provider] ?? model.provider,
		},
	};
	const settings = {
		modelRoles: () => roles,
		fallbackChains: () => ({}),
		taskIsolation: () => world.isolation ?? true,
	};
	pstackExtension(pi as never, {
		homeDirectory: tempDirectory(),
		skillDirectory: path.join(skills, "poteto-mode"),
		setup: { settings: () => settings as never },
	});
	if (world.hasHost ?? true) events.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "e1", active: true });
	return {
		notices,
		events,
		doctor: async () => {
			notices.length = 0;
			await commands.get("pstack")!.handler("doctor", ctx);
			return notices[0]!;
		},
	};
}

describe("/pstack doctor", () => {
	it("reports a healthy setup at info level", async () => {
		expect((await createWorld().doctor()).level).toBe("info");
	});

	it("flags two seats on the same model as an error naming the model", async () => {
		const result = await createWorld({ roles: { ...HEALTHY_ROLES, "pstack-panel-b": OPUS } }).doctor();
		expect(result.level).toBe("error");
		expect(result.message).toContain(OPUS);
	});

	it("flags a single-vendor panel as a warning and passes a mixed one", async () => {
		const single = await createWorld({ roles: { ...HEALTHY_ROLES, "pstack-panel-b": SONNET } }).doctor();
		expect(single.level).toBe("warning");
		expect(single.message).toContain("anthropic");
	});

	it("flags a workflow-called skill owned by another source, and ignores a foreign standalone skill", async () => {
		const foreign = path.join(tempDirectory(), "pstack-tdd", "SKILL.md");
		const stolen = await createWorld({ skillPaths: { "pstack-tdd": foreign } }).doctor();
		expect(stolen.level).toBe("error");
		expect(stolen.message).toContain("pstack-tdd");
		expect(stolen.message).toContain(foreign);
		const standalone = await createWorld({ skillPaths: { bro: path.join(tempDirectory(), "bro", "SKILL.md") } }).doctor();
		expect(standalone.level).toBe("info");
	});

	it("flags a workflow-called skill OMP does not list", async () => {
		const result = await createWorld({ unlisted: ["pstack-tdd"] }).doctor();
		expect(result.level).toBe("error");
		expect(result.message).toContain("pstack-tdd");
	});

	it("flags disabled task isolation as a warning", async () => {
		expect((await createWorld({ isolation: false }).doctor()).level).toBe("warning");
	});

	it("flags a missing Display Host as a warning, and clears it when a host appears", async () => {
		const world = createWorld({ hasHost: false });
		expect((await world.doctor()).level).toBe("warning");
		world.events.emit(CHANNEL, { protocol: 1, kind: "host", epoch: "e1", active: true });
		expect((await world.doctor()).level).toBe("info");
	});

	it("flags a role set to a model the registry does not serve", async () => {
		const result = await createWorld({ unserved: ["pstack-judge"] }).doctor();
		expect(result.level).toBe("error");
		expect(result.message).toContain("pstack-judge");
	});

	it("warns when no panel seat has a model", async () => {
		const { "pstack-panel-a": _a, "pstack-panel-b": _b, ...work } = HEALTHY_ROLES;
		expect((await createWorld({ roles: work }).doctor()).level).toBe("warning");
	});
});

describe("diagnose", () => {
	const base = () => {
		const skills = skillsFixture();
		return {
			models: { resolve: () => undefined, family: () => "x" } as never,
			settings: { modelRoles: () => ({}), taskIsolation: () => true },
			behavior: { ...DEFAULT_PSTACK_BEHAVIOR },
			commands: [] as never[],
			skillsRoot: skills,
			displayHostAvailable: true,
		};
	};

	it("reports each Instruction Mode: loaded and suspended, loaded and left running, not loaded", () => {
		const commands = [{ name: "caveman", source: "extension" }] as never[];
		const find = (input: ReturnType<typeof base>, mode: string) => diagnose({ ...input, commands }).filter(finding => finding.check === "instruction-modes" && finding.message.startsWith(mode));
		const input = base();
		const suspended = find(input, "caveman");
		const kept = find({ ...input, behavior: { ...input.behavior, suspendCaveman: false } }, "caveman");
		const absent = find(input, "ponytail");
		expect([suspended.length, kept.length, absent.length]).toEqual([1, 1, 1]);
		expect(new Set([suspended[0]!.message, kept[0]!.message, absent[0]!.message]).size).toBe(3);
	});

	it("flags an unset-to-served mismatch per role", () => {
		const input = { ...base(), settings: { modelRoles: () => ({ "pstack-judge": OPUS }), taskIsolation: () => true } };
		const findings = diagnose(input).filter(finding => finding.check === "roles" && finding.severity === "error");
		expect(findings.map(finding => finding.message).join("\n")).toContain("pstack-judge");
	});

	it("cannot verify ownership when OMP lists no skill commands", () => {
		const finding = diagnose(base()).find(candidate => candidate.check === "skills")!;
		expect(finding.severity).toBe("warning");
	});
});

describe("workflowCalledSkills", () => {
	it("finds the skills the poteto-mode tree names and skips standalone ones", () => {
		expect(workflowCalledSkills(skillsFixture()).sort()).toEqual(["interrogate", "poteto-mode", "pstack-tdd"]);
	});

	it("covers the vendored workflows", () => {
		const called = workflowCalledSkills(path.dirname(DEFAULT_POTETO_DIRECTORY));
		for (const name of ["poteto-mode", "pstack-tdd", "interrogate", "arena", "swarm", "architect", "how", "why"]) expect(called).toContain(name);
	});
});
