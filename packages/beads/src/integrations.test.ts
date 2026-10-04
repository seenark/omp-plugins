import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { SharedDisplayEvents } from "@codesook/omp-shared-display/client";
import codegraphExtension from "../../codegraph/src/index";
import beadsExtension from "./index";

type Integration = "codegraph" | "beads";
type Hook = (event: { systemPrompt: readonly string[] }, context: ExtensionContext) => Promise<{ systemPrompt: string[] } | undefined | void> | void;
type Settings = { policy?: string; visibility?: "ready" | "always" | "never" };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function fixture(initialized: Record<Integration, boolean>) {
	const root = mkdtempSync(path.join(os.tmpdir(), "omp-integrations-test-"));
	const project = path.join(root, "project");
	const workspaces = { codegraph: path.join(root, "native-codegraph"), beads: path.join(root, "native-beads", ".beads") };
	const globalConfigPath = path.join(root, "global.json");
	mkdirSync(project);
	const hooks = new Map<string, Hook[]>();
	const footer = new Map<string, string | undefined>();
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const events: SharedDisplayEvents = {
		on(channel, listener) {
			const handlers = listeners.get(channel) ?? new Set();
			handlers.add(listener);
			listeners.set(channel, handlers);
			return () => { handlers.delete(listener); };
		},
		emit(channel, data) { for (const listener of listeners.get(channel) ?? []) listener(data); },
	};
	let invalidBeads = false;
	// Native CLI output is injected at the process boundary; both extensions and policy readers are real.
	const pi = {
		on(name: string, hook: Hook) { hooks.set(name, [...hooks.get(name) ?? [], hook]); },
		registerCommand() {},
		events,
		async exec(command: string, args: string[]) {
			if (command === "codegraph") return { code: 0, stderr: "", stdout: JSON.stringify({ initialized: initialized.codegraph, projectPath: workspaces.codegraph, indexPath: path.join(workspaces.codegraph, ".codegraph") }) };
			if (command !== "bd") throw new Error(`Unexpected native command: ${command}`);
			if (!initialized.beads) return { code: 1, stderr: "", stdout: JSON.stringify({ error: "no_beads_directory", message: "No active beads workspace found." }) };
			if (args[0] === "where") return { code: 0, stderr: "", stdout: JSON.stringify({ path: workspaces.beads, database_path: path.join(workspaces.beads, "embeddeddolt") }) };
			if (args[0] === "count") return invalidBeads
				? { code: 1, stderr: "Error: corrupt database", stdout: "" }
				: { code: 0, stderr: "", stdout: JSON.stringify({ count: 0 }) };
			throw new Error(`Unexpected Beads operation: ${args[0]}`);
		},
		getAllTools: () => [{ name: "mcp__codegraph_explore", sourceInfo: { source: "mcp" } }],
		getActiveTools: () => ["mcp__codegraph_explore"],
	} as unknown as ExtensionAPI;
	const context = { cwd: project, hasUI: true, ui: { setStatus: (key: string, text?: string) => footer.set(key, text) } } as unknown as ExtensionContext;
	codegraphExtension(pi, { globalConfigPath });
	beadsExtension(pi, { globalConfigPath });
	const lifecycle = async (name: string) => { for (const hook of hooks.get(name) ?? []) await hook({ systemPrompt: [] }, context); };
	cleanups.push(async () => { await lifecycle("session_shutdown"); rmSync(root, { recursive: true, force: true }); });
	const settings = (scope: "project" | "global", values: Partial<Record<Integration, Settings>>) => {
		const target = scope === "global" ? globalConfigPath : path.join(project, ".omp", "codesook-omp.json");
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, JSON.stringify({ version: 1,
			behavior: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { policy: value.policy }])),
			display: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { visibility: value.visibility }])),
		}));
	};
	return {
		lifecycle, settings, footer,
		corruptBeads() { invalidBeads = true; },
		async turn(expected: Integration[]) {
			const previous = Object.freeze(["Repository safety rules", "Other plugin instructions"]);
			let prompt: readonly string[] = previous;
			for (const hook of hooks.get("before_agent_start") ?? []) {
				const result = await hook({ systemPrompt: prompt }, context);
				if (result) prompt = result.systemPrompt;
			}
			expect(prompt.slice(0, previous.length)).toEqual([...previous]);
			expect(previous).toEqual(["Repository safety rules", "Other plugin instructions"]);
			// Workspace-specific entries distinguish guidance without pinning prose or forwarding calls.
			expect(prompt.slice(previous.length).map(entry => {
				const owners = (Object.keys(workspaces) as Integration[]).filter(name => entry.includes(workspaces[name]));
				expect(owners).toHaveLength(1);
				return owners[0];
			})).toEqual(expected);
		},
	};
}

for (const [label, codegraph, beads, guidance] of [
	["neither", false, false, []],
	["CodeGraph only", true, false, ["codegraph"]],
	["Beads only", false, true, ["beads"]],
	["both", true, true, ["codegraph", "beads"]],
] as const) {
	test(`${label} initialized supplies only its own ready guidance and preserves prior prompt entries`, async () => {
		const app = fixture({ codegraph, beads });
		await app.lifecycle("session_start");
		await app.turn([...guidance]);
		expect(app.footer.get("codegraph")).toBe(codegraph ? "CodeGraph: ready" : undefined);
		expect(app.footer.get("beads")).toBe(beads ? "Beads: ready" : undefined);
	});
}

for (const enabled of ["codegraph", "beads"] as const) {
	const disabled = enabled === "codegraph" ? "beads" : "codegraph";
	test(`${enabled} policy and visibility remain independent across global inheritance and project overrides`, async () => {
		const app = fixture({ codegraph: true, beads: true });
		app.settings("global", { [enabled]: { policy: "auto", visibility: "never" }, [disabled]: { policy: "off", visibility: "always" } });
		await app.lifecycle("session_start");
		await app.turn([enabled]);
		expect(app.footer.get(enabled)).toBeUndefined();
		expect(app.footer.get(disabled)).toBe(`${disabled === "beads" ? "Beads" : "CodeGraph"}: suppressed`);

		app.settings("project", { [enabled]: { policy: "off", visibility: "always" }, [disabled]: { policy: "auto", visibility: "never" } });
		await app.turn([disabled]);
		expect(app.footer.get(enabled)).toBe(`${enabled === "beads" ? "Beads" : "CodeGraph"}: suppressed`);
		expect(app.footer.get(disabled)).toBeUndefined();
	});
}

test("invalid native Beads database cannot add guidance or suppress ready CodeGraph", async () => {
	const app = fixture({ codegraph: true, beads: true });
	await app.lifecycle("session_start");
	await app.turn(["codegraph", "beads"]);
	app.corruptBeads();
	await app.turn(["codegraph"]);
	expect(app.footer.get("codegraph")).toBe("CodeGraph: ready");
	expect(app.footer.get("beads")).toBeUndefined();
});

test("invalid Beads policy fails closed without invalidating CodeGraph settings", async () => {
	const app = fixture({ codegraph: true, beads: true });
	app.settings("project", { beads: { policy: "invalid" } });
	await app.lifecycle("session_start");
	await app.turn(["codegraph"]);
	expect(app.footer.get("codegraph")).toBe("CodeGraph: ready");
	expect(app.footer.get("beads")).toBeUndefined();
});
