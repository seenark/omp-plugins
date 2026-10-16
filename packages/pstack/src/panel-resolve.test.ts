import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LANE_AGENTS } from "./roles.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..");
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Runs in a child whose HOME is a scratch directory, so OMP's user-level discovery and settings never read or write
 * the real `~/.omp`. The child loads the package the way OMP loads a linked plugin and answers with JSON.
 */
const CHILD = `
import * as os from "node:os";
import { discoverAgents } from "@oh-my-pi/pi-coding-agent/task/discovery";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createExtensionModelQuery } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/model-api";
import { guardSeatSpawn } from "\${packageRoot}/src/panel.ts";
const [home, modelRoles] = process.argv.slice(1);
if (!os.homedir().startsWith(home)) throw new Error("HOME is not isolated: " + os.homedir());
const { agents } = await discoverAgents(home, home, { explicit: ["\${packageRoot}"], mode: "explicit-only", configured: [], configuredLevel: "user" });
const available = [{ provider: "p", id: "m", name: "m", api: "x", reasoning: false, input: ["text"], contextWindow: 1, maxTokens: 1 }];
const ctx = { models: createExtensionModelQuery({ getAvailable: () => available }, Settings.isolated({ modelRoles: JSON.parse(modelRoles) }), () => undefined) };
const spawns = Object.fromEntries(["a", "b"].map(seat => [seat, guardSeatSpawn({ agent: "pstack-panel-" + seat + "-critic" }, ctx, 5)?.block === true]));
const found = Object.fromEntries(agents.filter(agent => agent.name.startsWith("pstack-")).map(agent => [agent.name, { model: agent.model, tools: agent.tools }]));
process.stdout.write(JSON.stringify({ found, spawns }));
`;

function run(modelRoles: Record<string, string>) {
	const child = CHILD.replaceAll("${packageRoot}", PACKAGE_ROOT.replaceAll("\\", "\\\\"));
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-panel-home-"));
	roots.push(home);
	const result = spawnSync(process.execPath, ["--eval", child, home, JSON.stringify(modelRoles)], {
		cwd: PACKAGE_ROOT,
		encoding: "utf8",
		env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: path.join(home, "agent"), XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local", "share") },
	});
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
	return JSON.parse(result.stdout) as { found: Record<string, { model?: string[]; tools?: string[] }>; spawns: Record<string, boolean> };
}

describe("panel agents under an isolated HOME", () => {
	it("OMP discovers every lane agent from the package with its model list and tools", () => {
		const { found } = run({});
		for (const lane of LANE_AGENTS) {
			expect(found[lane.name]?.model).toEqual(lane.model);
			expect(found[lane.name]?.tools).toEqual([...lane.tools]);
		}
	});

	it("blocks the spawn of a seat whose role is unset and lets a set seat through", () => {
		expect(run({ "pstack-panel-a": "p/m" }).spawns).toEqual({ a: false, b: true });
		expect(run({}).spawns).toEqual({ a: true, b: true });
	});
});
