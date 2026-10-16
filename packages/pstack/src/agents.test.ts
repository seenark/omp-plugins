import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveAgentModelSelection, resolveModelRoleValue } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { parseAgentFields } from "@oh-my-pi/pi-coding-agent/discovery/helpers";
import { parseFrontmatter } from "@oh-my-pi/pi-utils";
import { AGENTS_DIRECTORY, agentDrift, writeAgents } from "./agents.ts";
import { LANE_AGENTS, MODEL_ROLES, PANEL_SEATS, WORK_ROLES } from "./roles.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempAgents(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-agents-"));
	roots.push(root);
	return root;
}

/** Parse a shipped agent with OMP's own frontmatter and agent-field parsers. */
function shipped(name: string) {
	const { frontmatter } = parseFrontmatter(fs.readFileSync(path.join(AGENTS_DIRECTORY, `${name}.md`), "utf8"), { source: name });
	const fields = parseAgentFields(frontmatter);
	if (!fields) throw new Error(`OMP would drop ${name}`);
	return fields;
}

const FORBIDDEN_FOR_READ_ONLY = ["edit", "write", "bash", "eval", "exec", "ast_edit", "task"];

describe("role table", () => {
	it("names the fixed roles with their fallbacks", () => {
		expect(WORK_ROLES.map(role => [role.id, role.fallback])).toEqual([
			["pstack-explore", "@smol"],
			["pstack-build", "@task"],
			["pstack-mechanical", "@tiny"],
			["pstack-design", "@designer"],
			["pstack-judge", "@slow"],
			["pstack-security", "@slow"],
		]);
		expect(PANEL_SEATS).toEqual(["a", "b", "c", "d", "e"]);
	});

	it("gives every role its what, when and recommended text", () => {
		expect(MODEL_ROLES).toHaveLength(11);
		for (const role of MODEL_ROLES) {
			expect(role.what.length).toBeGreaterThan(0);
			expect(role.when.length).toBeGreaterThan(0);
			expect(role.recommended.length).toBeGreaterThan(0);
		}
	});
});

describe("generated agents", () => {
	it("match the role table on disk", () => {
		expect(agentDrift()).toEqual([]);
	});

	it("regeneration is idempotent", () => {
		const directory = tempAgents();
		expect(writeAgents(directory).length).toBe(LANE_AGENTS.length);
		expect(writeAgents(directory)).toEqual([]);
		expect(agentDrift(directory)).toEqual([]);
	});

	it("detect a hand edit, a missing file and a stale pstack agent, but ignore vendored agents", () => {
		const directory = tempAgents();
		writeAgents(directory);
		fs.writeFileSync(path.join(directory, "poteto-agent.md"), "vendored\n");
		expect(agentDrift(directory)).toEqual([]);

		fs.appendFileSync(path.join(directory, "pstack-build.md"), "hand edit\n");
		fs.rmSync(path.join(directory, "pstack-judge.md"));
		fs.writeFileSync(path.join(directory, "pstack-retired.md"), "stale\n");
		expect(agentDrift(directory).sort()).toEqual([
			"differs from role table: pstack-build.md",
			"missing pstack-judge.md",
			"not in role table: pstack-retired.md",
		]);

		writeAgents(directory);
		expect(agentDrift(directory)).toEqual([]);
		expect(fs.existsSync(path.join(directory, "poteto-agent.md"))).toBe(true);
		expect(fs.existsSync(path.join(directory, "pstack-retired.md"))).toBe(false);
	});

	it("are all accepted by OMP's agent parser with the table's name, model list and tools", () => {
		expect(LANE_AGENTS).toHaveLength(WORK_ROLES.length + PANEL_SEATS.length * 2);
		for (const lane of LANE_AGENTS) {
			const fields = shipped(lane.name);
			expect(fields.name).toBe(lane.name);
			expect(fields.model).toEqual(lane.model);
			expect(fields.tools).toEqual([...lane.tools]);
		}
	});

	it("give each work role a two-entry model list: the pstack role, then the built-in role", () => {
		for (const role of WORK_ROLES) expect(shipped(role.id).model).toEqual([`@${role.id}`, role.fallback]);
	});

	it("give each panel seat's critic and builder only the seat role", () => {
		for (const seat of PANEL_SEATS) {
			expect(shipped(`pstack-panel-${seat}-critic`).model).toEqual([`@pstack-panel-${seat}`]);
			expect(shipped(`pstack-panel-${seat}-builder`).model).toEqual([`@pstack-panel-${seat}`]);
		}
	});

	it("keep every read-only lane away from mutating tools", () => {
		const readOnly = LANE_AGENTS.filter(lane => lane.access === "read-only");
		expect(readOnly.length).toBeGreaterThan(PANEL_SEATS.length);
		for (const lane of readOnly) {
			const tools = shipped(lane.name).tools ?? [];
			expect(tools.length).toBeGreaterThan(0);
			for (const forbidden of FORBIDDEN_FOR_READ_ONLY) expect(tools).not.toContain(forbidden);
		}
	});

	it("give builders and write roles an edit tool (the guard above would pass an empty list)", () => {
		for (const lane of LANE_AGENTS.filter(lane => lane.access === "write")) expect(shipped(lane.name).tools).toContain("edit");
		expect(LANE_AGENTS.filter(lane => lane.kind === "builder")).toHaveLength(PANEL_SEATS.length);
	});

	it("make every critic return a structured verdict with severity, file, line, claim and evidence", () => {
		for (const seat of PANEL_SEATS) {
			const critic = shipped(`pstack-panel-${seat}-critic`);
			expect(critic.structured).toBe(true);
			const output = critic.output as {
				properties: { verdict: { enum: string[] }; findings: { elements: { properties: Record<string, unknown> } } };
			};
			expect(output.properties.verdict.enum).toEqual(["approve", "concerns", "reject"]);
			expect(Object.keys(output.properties.findings.elements.properties).sort()).toEqual(
				["claim", "evidence", "file", "line", "severity"],
			);
			expect(shipped(`pstack-panel-${seat}-builder`).output).toBeUndefined();
		}
	});
});

describe("model resolution with OMP's own resolver", () => {
	const model = (provider: string, id: string) =>
		({ provider, id, name: id, api: "x", reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 1000 }) as never;
	const available = [model("anthropic", "task-model"), model("openai", "build-model"), model("google", "seat-model")];

	/** The model a spawn would take: the first resolvable pattern, in attempt order, as OMP's child session does. */
	function modelFor(agent: string, roles: Record<string, string>) {
		const settings = Settings.isolated({ modelRoles: roles });
		const selection = resolveAgentModelSelection({ agentModel: shipped(agent).model, settings });
		const resolved = selection.patterns
			.map(pattern => resolveModelRoleValue(pattern, available, { settings }).model?.id)
			.find(id => id !== undefined);
		return { resolved, role: selection.role };
	}

	it("runs the build agent on the @task model while pstack-build is unset", () => {
		expect(modelFor("pstack-build", { task: "anthropic/task-model" })).toEqual({ resolved: "task-model", role: "task" });
	});

	it("runs the build agent on the pstack-build model once it is set", () => {
		const roles = { task: "anthropic/task-model", "pstack-build": "openai/build-model" };
		expect(modelFor("pstack-build", roles)).toEqual({ resolved: "build-model", role: "pstack-build" });
	});

	it("runs a seat's critic on the seat model once the seat is set, and resolves nothing while it is unset", () => {
		expect(modelFor("pstack-panel-b-critic", { task: "anthropic/task-model", "pstack-panel-b": "google/seat-model" }).resolved).toBe(
			"seat-model",
		);
		expect(modelFor("pstack-panel-b-critic", { task: "anthropic/task-model" }).resolved).toBeUndefined();
	});
});
